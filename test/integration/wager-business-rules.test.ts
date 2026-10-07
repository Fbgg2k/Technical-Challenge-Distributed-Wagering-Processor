import { afterAll, describe, expect, test } from 'bun:test';
import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateWalletUseCase } from '../../src/application/wallets/create-wallet.use-case';
import { ProcessWagerTransactionUseCase } from '../../src/application/wagering/process-wager-transaction.use-case';
import { FailureCode } from '../../src/domain/shared/errors/failure-code.enum';
import { WagerTransactionKind } from '../../src/domain/wagering/enums/wager-kind.enum';
import { WagerTransactionStatus } from '../../src/domain/wagering/enums/transaction-status.enum';
import { closeTestOrm, forkEm, getTestOrm, newPlayerId } from '../helpers/test-db';

const ormPromise = getTestOrm();

type Submission = {
  providerId?: string;
  externalTransactionId?: string;
  idempotencyKey?: string;
  playerId: string;
  walletId: string;
  roundId?: string;
  kind: WagerTransactionKind;
  amount: string;
  currency?: string;
  referenceExternalTransactionId?: string;
};

async function rawQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const orm = await ormPromise;
  return orm.em.getConnection().execute(sql, params) as unknown as T[];
}

async function createWallet(amount = '100.00', currency = 'BRL') {
  const playerId = newPlayerId();
  const result = await new CreateWalletUseCase(await forkEm()).execute({
    playerId,
    initialBalance: { amount, currency },
  });
  return { playerId, walletId: result.id };
}

async function submit(spec: Submission) {
  const externalTransactionId = spec.externalTransactionId ?? randomUUID();
  return new ProcessWagerTransactionUseCase(await forkEm()).execute({
    providerId: spec.providerId ?? 'provider-rules',
    externalTransactionId,
    idempotencyKey: spec.idempotencyKey ?? `key:${externalTransactionId}`,
    playerId: spec.playerId,
    walletId: spec.walletId,
    roundId: spec.roundId ?? 'round-rules',
    gameId: 'game-rules',
    kind: spec.kind,
    money: { amount: spec.amount, currency: spec.currency ?? 'BRL' },
    referenceExternalTransactionId: spec.referenceExternalTransactionId,
  });
}

describe('integração — regras financeiras do README_JG', () => {
  afterAll(async () => {
    await closeTestOrm();
  });

  test('WIN credita e LOSS é processada sem alterar saldo nem criar ledger', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const win = await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Win,
      amount: '15.00',
    });
    const loss = await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Loss,
      amount: '10.00',
    });

    expect(win.status).toBe(WagerTransactionStatus.Processed);
    expect(win.balance?.amount).toBe('115.00');
    expect(loss.status).toBe(WagerTransactionStatus.Processed);
    expect(loss.balance?.amount).toBe('115.00');

    const ledger = await rawQuery<{ direction: string; money_amount: string }>(
      'select direction, money_amount from wallet_ledger_entries where wallet_id = ? order by created_at',
      [walletId],
    );
    expect(ledger).toHaveLength(2);
    expect(ledger.map(({ direction, money_amount }) => [direction, money_amount])).toEqual([
      ['CREDIT', '100.00'],
      ['CREDIT', '15.00'],
    ]);

    const lossEvents = await rawQuery<{ event_type: string }>(
      `select event_type from outbox_messages
       where payload->'data'->>'transactionId' = ?`,
      [loss.transactionId],
    );
    expect(lossEvents.map((event) => event.event_type)).toEqual(['WagerTransactionProcessed']);
  });

  test('REFUND reverte uma BET processada uma única vez com valor igual', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const betExternalId = `bet-${randomUUID()}`;
    const bet = await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Bet,
      amount: '25.00',
      externalTransactionId: betExternalId,
    });
    const refundExternalId = `refund-${randomUUID()}`;
    const refund = await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Refund,
      amount: '25.00',
      externalTransactionId: refundExternalId,
      referenceExternalTransactionId: betExternalId,
    });
    const duplicateRefund = await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Refund,
      amount: '25.00',
      referenceExternalTransactionId: betExternalId,
    });

    expect(bet.status).toBe(WagerTransactionStatus.Processed);
    expect(refund.status).toBe(WagerTransactionStatus.Processed);
    expect(refund.balance?.amount).toBe('100.00');
    expect(duplicateRefund.status).toBe(WagerTransactionStatus.Rejected);
    expect(duplicateRefund.failureCode).toBe(FailureCode.DuplicateReversal);

    const result = await rawQuery<{ balance_amount: string; entries: string }>(
      `select w.balance_amount,
              (select count(*) from wallet_ledger_entries l
               where l.wallet_id = w.id and l.transaction_id in (
                 select id from wager_transactions where external_transaction_id in (?, ?)
               )) as entries
       from wallets w where w.id = ?`,
      [betExternalId, refundExternalId, walletId],
    );
    expect(result[0].balance_amount).toBe('100.00');
    expect(Number(result[0].entries)).toBe(2);
  });

  test('ROLLBACK de WIN gera débito, e rejeita reversão que causaria saldo negativo', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const winExternalId = `win-${randomUUID()}`;
    const win = await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Win,
      amount: '50.00',
      externalTransactionId: winExternalId,
    });
    const spend = await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Bet,
      amount: '140.00',
    });
    expect(win.status).toBe(WagerTransactionStatus.Processed);
    expect(spend.status).toBe(WagerTransactionStatus.Processed);
    expect(spend.balance?.amount).toBe('10.00');

    const rollback = await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Rollback,
      amount: '50.00',
      referenceExternalTransactionId: winExternalId,
    });
    expect(rollback.status).toBe(WagerTransactionStatus.Rejected);
    expect(rollback.failureCode).toBe(FailureCode.NegativeBalanceReversal);
    expect(rollback.balance?.amount).toBe('10.00');

    const finalWallet = await rawQuery<{ balance_amount: string }>(
      'select balance_amount from wallets where id = ?',
      [walletId],
    );
    expect(finalWallet[0].balance_amount).toBe('10.00');
  });

  test('ROLLBACK de REFUND inverte o crédito da referência', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const betExternalId = `bet-${randomUUID()}`;
    await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Bet,
      amount: '25.00',
      externalTransactionId: betExternalId,
    });
    const refundExternalId = `refund-${randomUUID()}`;
    const refund = await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Refund,
      amount: '25.00',
      externalTransactionId: refundExternalId,
      referenceExternalTransactionId: betExternalId,
    });
    const rollback = await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Rollback,
      amount: '25.00',
      referenceExternalTransactionId: refundExternalId,
    });

    expect(refund.status).toBe(WagerTransactionStatus.Processed);
    expect(rollback.status).toBe(WagerTransactionStatus.Processed);
    expect(rollback.balance?.amount).toBe('75.00');
  });

  test('REFUND rejeita valor divergente e referência que não seja BET', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const betExternalId = `bet-${randomUUID()}`;
    const winExternalId = `win-${randomUUID()}`;
    await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Bet,
      amount: '20.00',
      externalTransactionId: betExternalId,
    });
    await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Win,
      amount: '10.00',
      externalTransactionId: winExternalId,
    });

    const amountMismatch = await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Refund,
      amount: '19.00',
      referenceExternalTransactionId: betExternalId,
    });
    const invalidKind = await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Refund,
      amount: '10.00',
      referenceExternalTransactionId: winExternalId,
    });

    expect(amountMismatch.status).toBe(WagerTransactionStatus.Rejected);
    expect(amountMismatch.failureCode).toBe(FailureCode.AmountMismatch);
    expect(invalidKind.status).toBe(WagerTransactionStatus.Rejected);
    expect(invalidKind.failureCode).toBe(FailureCode.ReferenceInvalid);
  });

  test('reversão rejeita referência de outro player, wallet ou rodada', async () => {
    const source = await createWallet('100.00');
    const otherWallet = await createWallet('100.00');
    const references = [
      { playerId: newPlayerId(), walletId: source.walletId, roundId: 'round-rules' },
      { playerId: source.playerId, walletId: otherWallet.walletId, roundId: 'round-rules' },
      { playerId: source.playerId, walletId: source.walletId, roundId: 'another-round' },
    ];

    for (const referenceOwner of references) {
      const externalId = `bet-${randomUUID()}`;
      await submit({
        ...referenceOwner,
        kind: WagerTransactionKind.Bet,
        amount: '10.00',
        externalTransactionId: externalId,
      });
      const reversal = await submit({
        playerId: source.playerId,
        walletId: source.walletId,
        kind: WagerTransactionKind.Refund,
        amount: '10.00',
        referenceExternalTransactionId: externalId,
      });
      expect(reversal.status).toBe(WagerTransactionStatus.Rejected);
      expect(reversal.failureCode).toBe(FailureCode.ReferenceInvalid);
    }
  });

  test('reversão exige o mesmo provider e operação na mesma moeda da wallet', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const externalId = `bet-${randomUUID()}`;
    await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Bet,
      amount: '10.00',
      externalTransactionId: externalId,
    });

    const otherProvider = await submit({
      providerId: 'another-provider',
      playerId,
      walletId,
      kind: WagerTransactionKind.Refund,
      amount: '10.00',
      referenceExternalTransactionId: externalId,
    });
    const currencyMismatch = await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Bet,
      amount: '10.00',
      currency: 'USD',
    });

    expect(otherProvider.status).toBe(WagerTransactionStatus.PendingReference);
    expect(currencyMismatch.status).toBe(WagerTransactionStatus.Rejected);
    expect(currencyMismatch.failureCode).toBe(FailureCode.CurrencyMismatch);
  });

  test('duas reversões concorrentes da mesma BET produzem somente um crédito', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const betExternalId = `bet-${randomUUID()}`;
    await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Bet,
      amount: '30.00',
      externalTransactionId: betExternalId,
    });

    const reversals = await Promise.all([
      submit({
        playerId,
        walletId,
        kind: WagerTransactionKind.Refund,
        amount: '30.00',
        referenceExternalTransactionId: betExternalId,
      }),
      submit({
        playerId,
        walletId,
        kind: WagerTransactionKind.Refund,
        amount: '30.00',
        referenceExternalTransactionId: betExternalId,
      }),
    ]);

    expect(reversals.filter((r) => r.status === WagerTransactionStatus.Processed)).toHaveLength(1);
    expect(reversals.filter((r) => r.failureCode === FailureCode.DuplicateReversal)).toHaveLength(
      1,
    );
    const wallet = await rawQuery<{ balance_amount: string }>(
      'select balance_amount from wallets where id = ?',
      [walletId],
    );
    expect(wallet[0].balance_amount).toBe('100.00');
  });

  test('replay devolve o saldo observado na resposta original, não o saldo atual', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const original = {
      providerId: 'provider-replay',
      externalTransactionId: `bet-${randomUUID()}`,
      idempotencyKey: `key-${randomUUID()}`,
      playerId,
      walletId,
      roundId: 'round-replay',
      kind: WagerTransactionKind.Bet,
      amount: '20.00',
    } as const;
    const firstResponse = await submit(original);
    await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Win,
      amount: '5.00',
    });

    const replay = await submit(original);
    expect(firstResponse.balance?.amount).toBe('80.00');
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.transactionId).toBe(firstResponse.transactionId);
    expect(replay.balance?.amount).toBe(firstResponse.balance?.amount);
  });

  test('replay de aposta rejeitada preserva o saldo observado na rejeição', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const rejectedBet = {
      playerId,
      walletId,
      kind: WagerTransactionKind.Bet,
      amount: '150.00',
      externalTransactionId: `bet-${randomUUID()}`,
      idempotencyKey: `key-${randomUUID()}`,
    } as const;
    const initialRejection = await submit(rejectedBet);
    await submit({
      playerId,
      walletId,
      kind: WagerTransactionKind.Bet,
      amount: '20.00',
    });

    const replay = await submit(rejectedBet);
    expect(initialRejection.status).toBe(WagerTransactionStatus.Rejected);
    expect(initialRejection.balance?.amount).toBe('100.00');
    expect(replay.status).toBe(WagerTransactionStatus.Rejected);
    expect(replay.failureCode).toBe(FailureCode.InsufficientFunds);
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.balance?.amount).toBe('100.00');

    await expect(
      submit({
        playerId,
        walletId,
        kind: WagerTransactionKind.Bet,
        amount: '-1.00',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});
