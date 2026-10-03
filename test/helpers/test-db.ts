import { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import { mikroOrmConfig } from '../../src/infrastructure/database/mikro-orm.config';

// O schema do banco de testes é garantido pelo preload
// `test/helpers/setup-schema.ts` (script `test` do package.json).

let orm: MikroORM | undefined;
let ormPromise: Promise<MikroORM> | undefined;

export async function getTestOrm(): Promise<MikroORM> {
  if (!ormPromise || !orm) {
    ormPromise = MikroORM.init({
      ...mikroOrmConfig,
      dbName: process.env.DB_NAME_TEST ?? 'wagering_test',
      debug: false,
    }).then((o) => (orm = o));
    orm = await ormPromise;
  }
  return ormPromise!;
}

export async function forkEm(): Promise<EntityManager> {
  const o = await getTestOrm();
  return o.em.fork();
}

export async function closeTestOrm(): Promise<void> {
  if (orm) {
    await orm.close();
    orm = undefined;
    ormPromise = undefined;
  }
}

export function newPlayerId(): string {
  return randomUUID();
}
