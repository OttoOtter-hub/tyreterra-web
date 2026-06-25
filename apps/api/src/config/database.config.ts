import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { Company } from '../companies/entities/company.entity';
import { Listing } from '../listings/entities/listing.entity';
import { Request } from '../requests/entities/request.entity';
import { Offer } from '../offers/entities/offer.entity';
import { Deal } from '../deals/entities/deal.entity';
import { Message } from '../messages/entities/message.entity';
import { Rating } from '../ratings/entities/rating.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';

export const ALL_ENTITIES = [
  User, Company, Listing, Request, Offer, Deal, Message, Rating, AuditLog,
];

export const databaseConfig = (): TypeOrmModuleOptions => ({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
  username: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? 'postgres',
  database: process.env.DATABASE_NAME ?? 'tyreterra',
  entities: ALL_ENTITIES,
  // In dev: auto-sync keeps schema current without running migrations manually.
  // In prod: set synchronize=false and run migrations explicitly.
  synchronize: process.env.NODE_ENV !== 'production',
  logging: process.env.NODE_ENV === 'development',
  migrations: ['dist/migrations/*.js'],
  migrationsTableName: 'migrations',
});
