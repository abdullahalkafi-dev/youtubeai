import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { loadConfig } from './config';

async function bootstrap() {
  const cfg = loadConfig();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: ['log', 'warn', 'error'] });
  app.useBodyParser('json', { limit: '64kb' });
  app.setGlobalPrefix('api/podcast');
  app.enableCors({ origin: true, credentials: false });
  app.enableShutdownHooks();
  await app.listen(cfg.PORT, '0.0.0.0');
  Logger.log(`Podcast service listening on :${cfg.PORT} (enabled=${cfg.PODCAST_ENABLED}, auto=${cfg.PODCAST_AUTO})`, 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Podcast service failed to start', err);
  process.exit(1);
});
