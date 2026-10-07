import { describe, test, expect } from 'bun:test';
import { MikroORM } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { mikroOrmConfig } from '../../src/infrastructure/database/mikro-orm.config';

/**
 * Teste de migrations em banco isolado (`wagering_migration_test`):
 * - up() cria o schema completo;
 * - down() reverte migration por migration (reversibilidade);
 * - up() novamente restaura o schema.
 */

const SCRATCH_DB = 'wagering_migration_test';

let adminOrm: MikroORM | undefined;

async function adminExec(sql: string): Promise<void> {
  if (!adminOrm) {
    adminOrm = await MikroORM.init({
      ...mikroOrmConfig,
      dbName: 'postgres',
      extensions: [Migrator],
    });
  }
  await adminOrm.em.getConnection().execute(sql);
}

async function initScratch(): Promise<MikroORM> {
  return MikroORM.init({
    ...mikroOrmConfig,
    dbName: SCRATCH_DB,
    extensions: [Migrator],
  });
}

async function tables(orm: MikroORM): Promise<string[]> {
  const rows = (await orm.em.getConnection().execute(
    `select table_name from information_schema.tables
     where table_schema = 'public' and table_name not like 'mikro_orm_%'
     order by 1`,
  )) as Array<{ table_name: string }>;
  return rows.map((r) => r.table_name);
}

async function columns(orm: MikroORM, table: string): Promise<string[]> {
  const rows = (await orm.em.getConnection().execute(
    `select column_name from information_schema.columns
     where table_name = ? order by 1`,
    [table],
  )) as Array<{ column_name: string }>;
  return rows.map((r) => r.column_name);
}

describe('migrations (banco isolado)', () => {
  test('up() cria o schema completo', async () => {
    await adminExec(`drop database if exists ${SCRATCH_DB} with (force)`);
    await adminExec(`create database ${SCRATCH_DB}`);

    const orm = await initScratch();
    await orm.getMigrator().up();

    const t = await tables(orm);
    expect(t).toContain('wallets');
    expect(t).toContain('wager_transactions');
    expect(t).toContain('wallet_ledger_entries');
    expect(t).toContain('inbox_messages');
    expect(t).toContain('outbox_messages');

    // constraints financeiras do schema
    const constraints = (await orm.em.getConnection().execute(
      `select constraint_name from information_schema.table_constraints
       where table_name = 'wallets'`,
    )) as Array<{ constraint_name: string }>;
    const names = constraints.map((c) => c.constraint_name);
    expect(names).toContain('wallets_balance_non_negative');
    expect(names).toContain('wallets_player_id_currency_unique');

    // colunas das migrations de referências pendentes e resposta idempotente
    const cols = await columns(orm, 'wager_transactions');
    expect(cols).toContain('reference_attempts');
    expect(cols).toContain('reference_next_attempt_at');
    expect(cols).toContain('response_balance_amount');
    expect(cols).toContain('response_balance_currency');

    await orm.close();
  });

  test('down() reverte migration por migration (reversível)', async () => {
    const orm = await initScratch();

    // reverte a última migration (snapshot de resposta idempotente)
    await orm.getMigrator().down();
    let cols = await columns(orm, 'wager_transactions');
    expect(cols).not.toContain('response_balance_amount');
    expect(cols).toContain('reference_attempts');

    // reverte a migration de referências pendentes
    await orm.getMigrator().down();
    cols = await columns(orm, 'wager_transactions');
    expect(cols).not.toContain('reference_attempts');

    // reverte a migration inicial (drop de todo o schema)
    await orm.getMigrator().down();
    const t = await tables(orm);
    expect(t).not.toContain('wallets');
    expect(t).not.toContain('wager_transactions');
    expect(t).not.toContain('wallet_ledger_entries');

    // sobe tudo de novo e valida o estado final
    await orm.getMigrator().up();
    await orm.getMigrator().up();
    const t2 = await tables(orm);
    expect(t2).toContain('wallets');
    const cols2 = await columns(orm, 'wager_transactions');
    expect(cols2).toContain('reference_attempts');
    expect(cols2).toContain('response_balance_amount');

    await orm.close();
    await adminExec(`drop database if exists ${SCRATCH_DB} with (force)`);
    if (adminOrm) {
      await adminOrm.close();
      adminOrm = undefined;
    }
  });
});
