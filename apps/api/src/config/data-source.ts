import 'reflect-metadata';
import { DataSource } from 'typeorm';
import { ALL_ENTITIES } from './database.config';

// Used by TypeORM CLI for migration:generate / migration:run
export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
  username: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? 'postgres',
  database: process.env.DATABASE_NAME ?? 'tyreterra',
  entities: ALL_ENTITIES,
  migrations: ['src/migrations/*.ts'],
  migrationsTableName: 'migrations',
});
