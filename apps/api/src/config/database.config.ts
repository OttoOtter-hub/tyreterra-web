import { TypeOrmModuleOptions } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { PasswordResetToken } from '../auth/entities/password-reset-token.entity';
import { Company } from '../companies/entities/company.entity';
import { Listing } from '../listings/entities/listing.entity';
import { Request } from '../requests/entities/request.entity';
import { Offer } from '../offers/entities/offer.entity';
import { Deal } from '../deals/entities/deal.entity';
import { Message } from '../messages/entities/message.entity';
import { Rating } from '../ratings/entities/rating.entity';
import { AuditLog } from '../audit/entities/audit-log.entity';

export const ALL_ENTITIES = [
  User, Company, Listing, Request, Offer, Deal, Message, Rating, AuditLog, PasswordResetToken,
];

// Prefer DATABASE_URL (used by .env.staging) when present; otherwise fall back
// to the discrete DATABASE_HOST/PORT/USER/PASSWORD/NAME vars (current .env / prod).
// Default behaviour is unchanged when DATABASE_URL is absent.
export const databaseConfig = (): TypeOrmModuleOptions => {
  const connectionUrl = process.env.DATABASE_URL;

  const base = {
    type: 'postgres' as const,
    entities: ALL_ENTITIES,
    synchronize: process.env.NODE_ENV !== 'production',
    logging: process.env.NODE_ENV === 'development',
    migrations: ['dist/migrations/*.js'],
    migrationsTableName: 'migrations',
  };

  if (connectionUrl) {
    return {
      ...base,
      url: connectionUrl,
      ssl: connectionUrl.includes('neon.tech') ? { rejectUnauthorized: false } : false,
    };
  }

  return {
    ...base,
    host: process.env.DATABASE_HOST ?? 'localhost',
    port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
    username: process.env.DATABASE_USER ?? 'postgres',
    password: process.env.DATABASE_PASSWORD ?? 'postgres',
    database: process.env.DATABASE_NAME ?? 'tyreterra',
    ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: false } : false,
  };
};
