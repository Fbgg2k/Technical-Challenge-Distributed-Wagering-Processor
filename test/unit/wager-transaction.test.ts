import { describe, test, expect } from 'bun:test';
import { WagerTransaction } from '../../src/domain/wagering/entities/wager-transaction.entity';
import { WagerTransactionKind } from '../../src/domain/wagering/enums/wager-kind.enum';
import { WagerTransactionStatus } from '../../src/domain/wagering/enums/transaction-status.enum';
import { FailureCode } from '../../src/domain/shared/errors/failure-code.enum';
import { LedgerDirection } from '../../src/domain/ledger/enums/ledger-direction.enum';
import { Money } from '../../src/domain/wallet/value-objects/money.vo';

const m = (v: string) => Money.from({ amount: v, currency: 'BRL' });

function create(kind: WagerTransactionKind, ref?: string) {
  return WagerTransaction.create({
    id: 'tx1',
    providerId: 'provider-a',
    externalTransactionId: 'ext-1',
    idempotencyKey: 'provider-a:ext-1',
    payloadHash: 'hash',
    walletId: 'w1',
    playerId: 'p1',
    roundId: 'r1',
    gameId: 'g1',
    kind,
    money: m('25.00'),
    referenceExternalTransactionId: ref,
  });
}

describe('WagerTransaction', () => {
  test('nasce PENDING e exige referência para REFUND/ROLLBACK', () => {
    expect(create(WagerTransactionKind.Bet).status).toBe(WagerTransactionStatus.Pending);
    expect(() => create(WagerTransactionKind.Refund)).toThrow();
    expect(() => create(WagerTransactionKind.Rollback)).toThrow();
    expect(create(WagerTransactionKind.Refund, 'bet-1').status).toBe(WagerTransactionStatus.Pending);
  });

  test('OPENING não pode ser submetido externamente', () => {
    expect(() => create(WagerTransactionKind.Opening)).toThrow();
  });

  test('transições para PROCESSED/REJECTED/FAILED são terminais', () => {
    const tx = create(WagerTransactionKind.Bet);
    tx.markProcessed(undefined, new Date());
    expect(tx.status).toBe(WagerTransactionStatus.Processed);
    expect(tx.isTerminal()).toBe(true);
    expect(() => tx.reject(FailureCode.InsufficientFunds)).toThrow();
    expect(() => tx.markProcessed(undefined, new Date())).toThrow();
  });

  test('LOSS não afeta saldo e não gera ledger', () => {
    const loss = create(WagerTransactionKind.Loss);
    expect(loss.affectsBalance()).toBe(false);
    const bet = create(WagerTransactionKind.Bet);
    expect(bet.affectsBalance()).toBe(true);
  });

  test('ROLLBACK inverte direção da referência', () => {
    const bet = create(WagerTransactionKind.Bet);
    const win = create(WagerTransactionKind.Win);
    const refund = create(WagerTransactionKind.Refund, 'bet-1');
    const rollbackBet = create(WagerTransactionKind.Rollback, 'bet-1');
    const rollbackWin = create(WagerTransactionKind.Rollback, 'win-1');
    expect(rollbackBet.ledgerDirectionFor(bet)).toBe(LedgerDirection.Credit);
    expect(rollbackWin.ledgerDirectionFor(win)).toBe(LedgerDirection.Debit);
    expect(refund.ledgerDirectionFor()).toBe(LedgerDirection.Credit);
  });

  test('matchesPayload compara hash', () => {
    const tx = create(WagerTransactionKind.Bet);
    expect(tx.matchesPayload('hash')).toBe(true);
    expect(tx.matchesPayload('other')).toBe(false);
  });
});
