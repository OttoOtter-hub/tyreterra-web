import 'reflect-metadata';
import * as dotenv from 'dotenv';

// APP_ENV=staging → loads .env.staging; default (unset) → loads .env (production stays default)
const envFile = process.env.APP_ENV === 'staging' ? '.env.staging' : '.env';
dotenv.config({ path: envFile });

import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from './database.config';

const connectionUrl = process.env.DATABASE_URL;

// Used by TypeORM CLI for migration:generate / migration:run
export const AppDataSource = new DataSource({
  type: 'postgres',
  ...(connectionUrl
    ? {
        url: connectionUrl,
        ssl: connectionUrl.includes('neon.tech') ? { rejectUnauthorized: false } : false,
      }
    : {
        host: process.env.DATABASE_HOST ?? 'localhost',
        port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
        username: process.env.DATABASE_USER ?? 'postgres',
        password: process.env.DATABASE_PASSWORD ?? 'postgres',
        database: process.env.DATABASE_NAME ?? 'tyreterra',
        ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
      }),
  entities: ALL_ENTITIES,
  migrations: ['src/migrations/*.ts'],
  migrationsTableName: 'migrations',
});
