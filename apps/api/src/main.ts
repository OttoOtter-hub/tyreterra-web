import * as dotenv from 'dotenv';

// APP_ENV=staging → loads .env.staging; default (unset) → loads .env (production stays default)
const envFile = process.env.APP_ENV === 'staging' ? '.env.staging' : '.env';
dotenv.config({ path: envFile });

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Behind nginx: take the client IP from X-Forwarded-For (one proxy hop),
  // otherwise every request is 127.0.0.1 and the auth rate limits are shared by all users.
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors({ origin: process.env.CORS_ORIGIN || 'http://localhost:3000' });

  const port = process.env.PORT ?? 3001;
  await app.listen(port);
  console.log(`API running on http://localhost:${port}/api [env: ${envFile}]`);
}

bootstrap();
