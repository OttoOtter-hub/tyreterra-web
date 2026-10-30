import * as dotenv from 'dotenv';

// APP_ENV=staging → loads .env.staging; default (unset) → loads .env (production stays default)
const envFile = process.env.APP_ENV === 'staging' ? '.env.staging' : '.env';
dotenv.config({ path: envFile });

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { applyBodyLimits } from './body-limits';
import { corsOptions } from './cors';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });

  // Behind nginx: take the client IP from X-Forwarded-For (one proxy hop),
  // otherwise every request is 127.0.0.1 and the auth rate limits are shared by all users.
  app.set('trust proxy', 1);
  app.setGlobalPrefix('api');
  applyBodyLimits(app);
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.enableCors(corsOptions());

  const port = process.env.PORT ?? 3001;
  // Loopback by default — only nginx should reach the API; set HOST=0.0.0.0 to expose it.
  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(port, host);
  console.log(`API running on http://${host}:${port}/api [env: ${envFile}]`);
}

bootstrap();
