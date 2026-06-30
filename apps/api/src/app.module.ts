import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
import { AuthModule } from './auth/auth.module';
import { VatModule } from './vat/vat.module';
import { ListingsModule } from './listings/listings.module';
import { RequestsModule } from './requests/requests.module';
import { OffersModule } from './offers/offers.module';
import { DealsModule } from './deals/deals.module';
import { RatingsModule } from './ratings/ratings.module';
import { AdminModule } from './admin/admin.module';
import { databaseConfig } from './config/database.config';

@Module({
  imports: [
    // APP_ENV=staging → .env.staging; default → .env (production stays default behaviour)
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: process.env.APP_ENV === 'staging' ? '.env.staging' : '.env',
    }),
    TypeOrmModule.forRootAsync({ useFactory: databaseConfig }),
    ScheduleModule.forRoot(),
    // Registered globally so the guard/storage infra is available, but NOT
    // applied via APP_GUARD — only attached explicitly via @UseGuards() +
    // @Throttle() on specific auth endpoints (login/register), scoped per
    // the hardening sprint's "auth only for now" requirement.
    ThrottlerModule.forRoot({
      throttlers: [{ name: 'default', ttl: 60_000, limit: 1000 }],
      setHeaders: true,
    }),
    AuthModule,
    VatModule,
    ListingsModule,
    RequestsModule,
    OffersModule,
    DealsModule,
    RatingsModule,
    AdminModule,
  ],
})
export class AppModule {}
