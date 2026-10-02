import { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import { randomUUID } from 'crypto';
import { mikroOrmConfig } from '../../src/infrastructure/database/mikro-orm.config';

let orm: MikroORM;
let ormPromise: Promise<MikroORM>;

export async function getTestOrm(): Promise<MikroORM> {
  if (!ormPromise) {
    ormPromise = MikroORM.init({
      ...mikroOrmConfig,
      dbName: process.env.DB_NAME_TEST ?? 'wagering_test',
      debug: false,
    }).then((o) => (orm = o));
  }
  return ormPromise;
}

export async function forkEm(): Promise<EntityManager> {
  const o = await getTestOrm();
  return o.em.fork();
}

export async function closeTestOrm(): Promise<void> {
  if (orm) {
    await orm.close();
  }
}

export function newPlayerId(): string {
  return randomUUID();
}
