import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { ApiModule } from './api/api.module';
import { loadConfig } from './config/config';

async function bootstrap() {
  const cfg = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(ApiModule, { logger: ['log', 'warn', 'error'] });
  app.useBodyParser('json', { limit: '512kb' });
  app.setGlobalPrefix('api/reels');
  app.enableCors({ origin: true, credentials: false });
  app.enableShutdownHooks();
  await app.listen(cfg.PORT, '0.0.0.0');
  Logger.log(`Reel API listening on :${cfg.PORT} (enabled=${cfg.REELS_ENABLED})`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Reel API failed to start', err);
  process.exit(1);
});
