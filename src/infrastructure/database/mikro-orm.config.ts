import { defineConfig, PostgreSqlDriver } from '@mikro-orm/postgresql';

export const mikroOrmConfig = defineConfig({
  driver: PostgreSqlDriver,
  host: process.env.DB_HOST ?? 'localhost',
  port: Number(process.env.DB_PORT ?? 5432),
  dbName: process.env.DB_NAME ?? 'wagering',
  user: process.env.DB_USER ?? 'wagering',
  password: process.env.DB_PASSWORD ?? 'wagering',
  entities: ['./src/infrastructure/database/entities/*.orm-entity.ts'],
  entitiesTs: ['./src/infrastructure/database/entities/*.orm-entity.ts'],
  migrations: {
    path: './dist/infrastructure/database/migrations',
    pathTs: './src/infrastructure/database/migrations',
  },
  debug: process.env.DB_DEBUG === 'true',
});

export default mikroOrmConfig;
