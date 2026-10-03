import { MikroORM } from '@mikro-orm/postgresql';
import { Migrator } from '@mikro-orm/migrations';
import { mikroOrmConfig } from '../../src/infrastructure/database/mikro-orm.config';

/**
 * Preload do `bun test` (ver script `test` no package.json):
 * executado ANTES de qualquer arquivo de teste, garante que o
 * schema do banco de testes existe (migrations aplicadas).
 *
 * Torna a suíte auto-contida: basta criar o banco vazio
 * (`create database wagering_test`) que o schema é aplicado aqui.
 */

const orm = await MikroORM.init({
  ...mikroOrmConfig,
  dbName: process.env.DB_NAME_TEST ?? 'wagering_test',
  extensions: [Migrator],
});

async function hasTables(): Promise<boolean> {
  const rows = (await orm.em.getConnection().execute(
    `select 1 from information_schema.tables
     where table_schema = 'public' and table_name = 'wallets'`,
  )) as Array<unknown>;
  return rows.length > 0;
}

if (!(await hasTables())) {
  try {
    await orm.getMigrator().up();
  } catch {
    // o migrator do MikroORM pode reportar erro espúrio de criação
    // duplicada da tabela de controle em schema vazio; as migrations
    // são aplicadas mesmo assim — aguarda a conclusão abaixo
  }
  // aguarda o schema ficar pronto (conclusão em background)
  for (let i = 0; i < 50 && !(await hasTables()); i++) {
    await new Promise((r) => setTimeout(r, 200));
  }
}

if (!(await hasTables())) {
  throw new Error('schema de testes não ficou pronto (wallets table missing)');
}

await orm.close();
