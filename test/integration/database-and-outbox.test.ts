import { describe, test, expect, afterAll } from 'bun:test';
import { getTestOrm, forkEm, closeTestOrm, newPlayerId } from '../helpers/test-db';
import { CreateWalletUseCase } from '../../src/application/wallets/create-wallet.use-case';
import { ProcessWagerTransactionUseCase } from '../../src/application/wagering/process-wager-transaction.use-case';
import { OutboxPublisher } from '../../src/infrastructure/messaging/outbox/outbox-publisher.service';
import { WagerTransactionKind } from '../../src/domain/wagering/enums/wager-kind.enum';
import { WagerTransactionStatus } from '../../src/domain/wagering/enums/transaction-status.enum';

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

async function bet(walletId: string, playerId: string, amount: string, key: string) {
  const em = await forkEm();
  return new ProcessWagerTransactionUseCase(em).execute({
    providerId: 'provider-a',
    externalTransactionId: key,
    idempotencyKey: `k:${key}`,
    playerId,
    walletId,
    roundId: 'r1',
    gameId: 'g1',
    kind: WagerTransactionKind.Bet,
    money: { amount, currency: 'BRL' },
  });
}

describe('integração — constraints e atomicidade', () => {
  afterAll(async () => {
    await closeTestOrm();
  });

  test('constraints: saldo negativo violado, ledger append-only, wallet duplicada', async () => {
    const { playerId, walletId } = await createWallet('50.00');

    await expect(
      rawQuery(`insert into wallets (id, player_id, currency, balance_amount, version, created_at, updated_at)
                values (gen_random_uuid(), ?, 'BRL', '-1.00', 1, now(), now())`, [playerId]),
    ).rejects.toThrow();

    // ledger é append-only
    const entry = await rawQuery<{ id: string }>(
      'select id from wallet_ledger_entries where wallet_id = ? limit 1',
      [walletId],
    );
    if (entry.length > 0) {
      await expect(
        rawQuery(`update wallet_ledger_entries set money_amount = '0.00' where id = ?`, [entry[0].id]),
      ).rejects.toThrow();
    }

    // wallet duplicada playerId+currency
    const em = await forkEm();
    await expect(
      new CreateWalletUseCase(em).execute({
        playerId,
        initialBalance: { amount: '50.00', currency: 'BRL' },
      }),
    ).rejects.toThrow();
  });

  test('atomicidade: wallet + tx + ledger + inbox + outbox consistentes', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const em = await forkEm();

    const extId = `atomic-${crypto.randomUUID()}`;
    const msgId = `msg-atomic-${crypto.randomUUID()}`;
    await new ProcessWagerTransactionUseCase(em).execute(
      {
        providerId: 'provider-a',
        externalTransactionId: extId,
        idempotencyKey: `k:${extId}`,
        playerId,
        walletId,
        roundId: 'r1',
        gameId: 'g1',
        kind: WagerTransactionKind.Bet,
        money: { amount: '25.00', currency: 'BRL' },
      },
      { inbox: { messageId: msgId, consumerName: 'test-consumer', payloadHash: 'h', receivedAt: new Date() } },
    );

    const wallets = await rawQuery<{ balance_amount: string }>(
      'select balance_amount from wallets where id = ?',
      [walletId],
    );
    expect(wallets[0].balance_amount).toBe('75.00');

    const inbox = await rawQuery<{ c: string }>(
      `select count(*) as c from inbox_messages where message_id = ? and processed_at is not null`,
      [msgId],
    );
    expect(Number(inbox[0].c)).toBe(1);

    const outbox = await rawQuery<{ c: string }>(
      `select count(*) as c from outbox_messages where event_type in ('WagerTransactionProcessed','WalletBalanceChanged')`,
    );
    expect(Number(outbox[0].c)).toBeGreaterThanOrEqual(2);

    // invariant final:
    const calculated = await rawQuery<{ s: string }>(
      `select coalesce(sum(case when direction = 'CREDIT' then money_amount else -money_amount end), 0) as s
       from wallet_ledger_entries where wallet_id = ?`,
      [walletId],
    );
    expect(calculated[0].s).toBe(wallets[0].balance_amount);
  });

  test('inbox: redelivery com mesmo messageId não duplica efeito', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const extId = `inbox-ext-${crypto.randomUUID()}`;
    const msgId = `msg-redelivery-${crypto.randomUUID()}`;
    const em = await forkEm();
    const input = {
      providerId: 'provider-a',
      externalTransactionId: extId,
      idempotencyKey: `k:${extId}`,
      playerId,
      walletId,
      roundId: 'r1',
      gameId: 'g1',
      kind: WagerTransactionKind.Bet,
      money: { amount: '10.00', currency: 'BRL' },
    } as const;

    const inbox = { messageId: msgId, consumerName: 'test-consumer', payloadHash: 'h', receivedAt: new Date() };
    const r1 = await new ProcessWagerTransactionUseCase(em.fork()).execute(input, { inbox });
    const r2 = await new ProcessWagerTransactionUseCase(em.fork()).execute(input, { inbox });
    expect(r1.status).toBe(WagerTransactionStatus.Processed);
    expect(r2.idempotentReplay).toBe(true);

    const debits = await rawQuery<{ c: string }>(
      `select count(*) as c from wallet_ledger_entries where wallet_id = ? and direction = 'DEBIT'`,
      [walletId],
    );
    expect(Number(debits[0].c)).toBe(1);
  });

  test('dois publishers concorrentes não publicam em duplicidade', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    await bet(walletId, playerId, '10.00', `pub-${Date.now()}`);

    const orm = await ormPromise;
    if (!process.env.SQS_EVENTS_QUEUE_URL) {
      process.env.SQS_EVENTS_QUEUE_URL =
        'http://localhost:4566/000000000000/integration-events.fifo';
    }
    process.env.SQS_ENDPOINT = process.env.SQS_ENDPOINT ?? 'http://localhost:4566';
    process.env.AWS_REGION = process.env.AWS_REGION ?? 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = process.env.AWS_ACCESS_KEY_ID ?? 'test';
    process.env.AWS_SECRET_ACCESS_KEY = process.env.AWS_SECRET_ACCESS_KEY ?? 'test';
    process.env.OUTBOX_PUBLISHER_ENABLED = 'false';

    const p1 = new OutboxPublisher(orm.em.fork());
    const p2 = new OutboxPublisher(orm.em.fork());
    const [a, b] = await Promise.all([p1.tick(), p2.tick()]);
    expect(a + b).toBeGreaterThanOrEqual(1);

    const published = await rawQuery<{ c: string }>(
      `select count(*) as c from outbox_messages where aggregate_id = ? and published_at is not null`,
      [walletId],
    );
    const total = await rawQuery<{ c: string }>(
      `select count(*) as c from outbox_messages where aggregate_id = ?`,
      [walletId],
    );
    expect(Number(published[0].c)).toBe(Number(total[0].c));
    expect(Number(total[0].c)).toBe(2);
  });
});
