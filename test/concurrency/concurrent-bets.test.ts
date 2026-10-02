import { describe, test, expect, afterAll } from 'bun:test';
import { closeTestOrm, getTestOrm, forkEm, newPlayerId } from '../helpers/test-db';
import { CreateWalletUseCase } from '../../src/application/wallets/create-wallet.use-case';
import { ProcessWagerTransactionUseCase } from '../../src/application/wagering/process-wager-transaction.use-case';
import { WagerTransactionKind } from '../../src/domain/wagering/enums/wager-kind.enum';
import { WagerTransactionStatus } from '../../src/domain/wagering/enums/transaction-status.enum';
import { FailureCode } from '../../src/domain/shared/errors/failure-code.enum';
import { randomUUID } from 'crypto';

const ormPromise = getTestOrm();

async function createWallet(initialAmount = '100.00', initialCurrency = 'BRL') {
  const em = await forkEm();
  const useCase = new CreateWalletUseCase(em);
  const playerId = newPlayerId();
  const wallet = await useCase.execute({
    playerId,
    initialBalance: { amount: initialAmount, currency: initialCurrency },
  });
  return { playerId, walletId: wallet.id };
}

interface BetSpec {
  amount: string;
  key: string;
  extId: string;
}

async function submitBet(
  walletId: string,
  playerId: string,
  spec: BetSpec,
  roundId = 'round-1',
) {
  const em = await forkEm();
  const useCase = new ProcessWagerTransactionUseCase(em);
  return useCase.execute({
    providerId: 'provider-a',
    externalTransactionId: spec.extId,
    idempotencyKey: spec.key,
    playerId,
    walletId,
    roundId,
    gameId: 'fortune-chimp',
    kind: WagerTransactionKind.Bet,
    money: { amount: spec.amount, currency: 'BRL' },
  });
}

async function rawQuery<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const orm = await ormPromise;
  return orm.em.getConnection().execute(sql, params) as unknown as T[];
}

describe('concorrência — mesma wallet', () => {
  afterAll(async () => {
    await closeTestOrm();
  });

  test('cenário obrigatório: duas apostas de 80 em saldo 100 → exatamente uma vence', async () => {
    const { playerId, walletId } = await createWallet('100.00');

    const [r1, r2] = await Promise.all([
      submitBet(walletId, playerId, { amount: '80.00', key: `${walletId}:1`, extId: `ext-1-${randomUUID()}` }),
      submitBet(walletId, playerId, { amount: '80.00', key: `${walletId}:2`, extId: `ext-2-${randomUUID()}` }),
    ]);

    const statuses = [r1.status, r2.status].sort();
    expect(statuses).toEqual([WagerTransactionStatus.Processed, WagerTransactionStatus.Rejected].sort());

    const processed = [r1, r2].find((r) => r.status === WagerTransactionStatus.Processed)!;
    expect(processed.balance?.amount).toBe('20.00');

    const rejected = [r1, r2].find((r) => r.status === WagerTransactionStatus.Rejected)!;
    expect(rejected.failureCode).toBe(FailureCode.InsufficientFunds);

    const wallets = await rawQuery<{ balance_amount: string; version: number }>(
      'select balance_amount, version from wallets where id = ?',
      [walletId],
    );
    expect(wallets[0].balance_amount).toBe('20.00');

    const debits = await rawQuery<{ c: string }>(
      `select count(*) as c from wallet_ledger_entries where wallet_id = ? and direction = 'DEBIT'`,
      [walletId],
    );
    expect(Number(debits[0].c)).toBe(1);

    // invariant final
    const calculated = await rawQuery<{ s: string }>(
      `select coalesce(sum(case when direction = 'CREDIT' then money_amount else -money_amount end), 0) as s
       from wallet_ledger_entries where wallet_id = ?`,
      [walletId],
    );
    expect(calculated[0].s).toBe('20.00');
  });

  test('mesma aposta enviada 50 vezes em paralelo → um único débito', async () => {
    const { playerId, walletId } = await createWallet('100.00');
    const extId = `ext-50x-${randomUUID()}`;
    const key = `${walletId}:50x`;

    const results = await Promise.all(
      Array.from({ length: 50 }, () =>
        submitBet(walletId, playerId, { amount: '10.00', key, extId }),
      ),
    );

    const processed = results.filter((r) => r.status === WagerTransactionStatus.Processed);
    const firsts = results.filter((r) => r.idempotentReplay === false);
    expect(processed.length).toBe(50);
    expect(firsts.length).toBe(1);

    const debits = await rawQuery<{ c: string }>(
      `select count(*) as c from wallet_ledger_entries where wallet_id = ? and direction = 'DEBIT'`,
      [walletId],
    );
    expect(Number(debits[0].c)).toBe(1);

    const wallets = await rawQuery<{ balance_amount: string }>(
      'select balance_amount from wallets where id = ?',
      [walletId],
    );
    expect(wallets[0].balance_amount).toBe('90.00');
  });

  test('wallets diferentes processadas em paralelo preservam saldos independentes', async () => {
    const w1 = await createWallet('50.00');
    const w2 = await createWallet('70.00');

    await Promise.all([
      submitBet(w1.walletId, w1.playerId, { amount: '20.00', key: `k:${w1.walletId}`, extId: `e1-${randomUUID()}` }),
      submitBet(w2.walletId, w2.playerId, { amount: '30.00', key: `k:${w2.walletId}`, extId: `e2-${randomUUID()}` }),
    ]);

    const rows = await rawQuery<{ id: string; balance_amount: string }>(
      'select id, balance_amount from wallets where id in (?, ?)',
      [w1.walletId, w2.walletId],
    );
    const balances = Object.fromEntries(rows.map((r) => [r.id, r.balance_amount]));
    expect(balances[w1.walletId]).toBe('30.00');
    expect(balances[w2.walletId]).toBe('40.00');
  });
});
