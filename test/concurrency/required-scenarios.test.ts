import { describe, test, expect, afterAll } from 'bun:test';
import { getTestOrm, forkEm, closeTestOrm, newPlayerId } from '../helpers/test-db';
import { CreateWalletUseCase } from '../../src/application/wallets/create-wallet.use-case';
import { ProcessWagerTransactionUseCase } from '../../src/application/wagering/process-wager-transaction.use-case';
import { WagerTransactionKind } from '../../src/domain/wagering/enums/wager-kind.enum';
import { WagerTransactionStatus } from '../../src/domain/wagering/enums/transaction-status.enum';
import { FailureCode } from '../../src/domain/shared/errors/failure-code.enum';

const ormPromise = getTestOrm();

async function rawQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const orm = await ormPromise;
  return orm.em.getConnection().execute(sql, params) as unknown as T[];
}

async function createWallet(amount = '100.00') {
  const em = await forkEm();
  const playerId = newPlayerId();
  const wallet = await new CreateWalletUseCase(em).execute({
    playerId,
    initialBalance: { amount, currency: 'BRL' },
  });
  return { playerId, walletId: wallet.id };
}

async function submit(
  walletId: string,
  playerId: string,
  kind: WagerTransactionKind,
  amount: string,
  key: string,
  reference?: string,
) {
  const em = await forkEm();
  return new ProcessWagerTransactionUseCase(em).execute({
    providerId: 'provider-a',
    externalTransactionId: key,
    idempotencyKey: `k:${key}`,
    playerId,
    walletId,
    roundId: 'r1',
    gameId: 'g1',
    kind,
    money: { amount, currency: 'BRL' },
    referenceExternalTransactionId: reference,
  });
}

describe('cenários obrigatórios restantes', () => {
  afterAll(async () => {
    await closeTestOrm();
  });

  test('3 instâncias simultâneas sobre a mesma wallet', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const results = await Promise.all([
      submit(walletId, playerId, WagerTransactionKind.Bet, '40.00', `i3-a-${Date.now()}`),
      submit(walletId, playerId, WagerTransactionKind.Bet, '40.00', `i3-b-${Date.now()}`),
      submit(walletId, playerId, WagerTransactionKind.Bet, '40.00', `i3-c-${Date.now()}`),
    ]);
    const processed = results.filter((r) => r.status === WagerTransactionStatus.Processed);
    const rejected = results.filter((r) => r.status === WagerTransactionStatus.Rejected);
    expect(processed.length + rejected.length).toBe(3);
    const wallet = await rawQuery<{ balance_amount: string }>(
      'select balance_amount from wallets where id = ?',
      [walletId],
    );
    const balance = Number(wallet[0].balance_amount);
    expect([60, 20]).toContain(balance);
    const debits = await rawQuery<{ c: string }>(
      `select count(*) as c from wallet_ledger_entries where wallet_id = ? and direction = 'DEBIT'`,
      [walletId],
    );
    expect(Number(debits[0].c)).toBe(processed.length);
  });

  test('ROLLBACK entregue antes da referência (PENDING_REFERENCE)', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const extBet = `rb-bet-${Date.now()}`;
    const extRollback = `rb-rb-${Date.now()}`;
    const r1 = await submit(
      walletId,
      playerId,
      WagerTransactionKind.Rollback,
      '30.00',
      extRollback,
      extBet,
    );
    expect(r1.status).toBe(WagerTransactionStatus.PendingReference);

    const r2 = await submit(walletId, playerId, WagerTransactionKind.Bet, '30.00', extBet);
    expect(r2.status).toBe(WagerTransactionStatus.Processed);

    // worker reprocessa
    const em = await forkEm();
    const useCase = new ProcessWagerTransactionUseCase(em);
    const pending = await rawQuery<{ id: string }>(
      `select id from wager_transactions where status = ? and wallet_id = ?`,
      [WagerTransactionStatus.PendingReference, walletId],
    );
    for (const row of pending) {
      await useCase.retryPendingReference(row.id);
    }

    const rollback = await rawQuery<{ status: string; reference_transaction_id: string | null }>(
      `select status, reference_transaction_id from wager_transactions where external_transaction_id = ?`,
      [extRollback],
    );
    expect(rollback.length).toBe(1);
    expect(rollback[0].status).toBe('PROCESSED');
    expect(rollback[0].reference_transaction_id).not.toBeNull();

    const wallet = await rawQuery<{ balance_amount: string }>(
      'select balance_amount from wallets where id = ?',
      [walletId],
    );
    expect(wallet[0].balance_amount).toBe('100.00');
  });

  test('REFUND antes da referência e worker morto antes do ack (redelivery)', async () => {
    const { playerId, walletId } = await createWallet('200.00');
    const extBet = `rf-bet-${Date.now()}`;
    const msgId = `rf-msg-${Date.now()}`;
    const inbox = { messageId: msgId, consumerName: 'test-consumer', payloadHash: 'h', receivedAt: new Date() };

    const em = await forkEm();
    // REFUND antes da BET -> PENDING_REFERENCE, com inbox (simula entrega SQS)
    await new ProcessWagerTransactionUseCase(em.fork()).execute(
      {
        providerId: 'provider-a',
        externalTransactionId: `rf-rf-${Date.now()}`,
        idempotencyKey: `k:rf-${Date.now()}`,
        playerId,
        walletId,
        roundId: 'r1',
        gameId: 'g1',
        kind: WagerTransactionKind.Refund,
        money: { amount: '50.00', currency: 'BRL' },
        referenceExternalTransactionId: extBet,
      },
      { inbox },
    );

    // BET chega
    await submit(walletId, playerId, WagerTransactionKind.Bet, '50.00', extBet);

    // redelivery da mesma mensagem (worker morreu antes do ack)
    const em2 = await forkEm();
    const redelivered = await new ProcessWagerTransactionUseCase(em2.fork()).execute(
      {
        providerId: 'provider-a',
        externalTransactionId: `rf-rf-${Date.now()}`,
        idempotencyKey: `k:rf-${Date.now()}`,
        playerId,
        walletId,
        roundId: 'r1',
        gameId: 'g1',
        kind: WagerTransactionKind.Refund,
        money: { amount: '50.00', currency: 'BRL' },
        referenceExternalTransactionId: extBet,
      },
      { inbox },
    );
    expect(redelivered.idempotentReplay).toBe(true);

    const debits = await rawQuery<{ c: string }>(
      `select count(*) as c from wallet_ledger_entries where wallet_id = ? and direction = 'DEBIT'`,
      [walletId],
    );
    expect(Number(debits[0].c)).toBe(1);
  });

  test('rejeição definitiva após esgotar tentativas de referência', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const em = await forkEm();
    const r = await new ProcessWagerTransactionUseCase(em).execute({
      providerId: 'provider-a',
      externalTransactionId: `gone-${Date.now()}`,
      idempotencyKey: `k:gone-${Date.now()}`,
      playerId,
      walletId,
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Refund,
      money: { amount: '20.00', currency: 'BRL' },
      referenceExternalTransactionId: 'never-exists',
    });
    expect(r.status).toBe(WagerTransactionStatus.PendingReference);

    const pending = await rawQuery<{ id: string }>(
      `select id from wager_transactions where status = ? and wallet_id = ?`,
      [WagerTransactionStatus.PendingReference, walletId],
    );
    const useCase = new ProcessWagerTransactionUseCase(await forkEm());
    for (const row of pending) {
      await useCase.retryPendingReference(row.id, 1);
    }

    const tx = await rawQuery<{ status: string, failure_code: string }>(
      `select status, failure_code from wager_transactions where id = ?`,
      [pending[0].id],
    );
    expect(tx[0].status).toBe('REJECTED');
    expect(tx[0].failure_code).toBe(FailureCode.ReferenceNotFound);
  });

  test('consistência final: wallet.balance == saldo reconstruído pelo ledger', async () => {
    const rows = await rawQuery<{ w: string; b: string; s: string }>(
      `select w.id as w, w.balance_amount as b,
        coalesce(sum(case when l.direction = 'CREDIT' then l.money_amount else -l.money_amount end), 0) as s
       from wallets w left join wallet_ledger_entries l on l.wallet_id = w.id
       group by w.id, w.balance_amount`,
    );
    for (const row of rows) {
      expect(Number(row.b)).toBe(Number(row.s));
    }
  });
});
