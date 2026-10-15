import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { WorkerModule } from './worker/worker.module';

async function bootstrap() {
  const app = await NestFactory.createApplicationContext(WorkerModule, { logger: ['log', 'warn', 'error'] });
  app.enableShutdownHooks();
  Logger.log('Reel worker started', 'Bootstrap');
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Reel worker failed to start', err);
  process.exit(1);
});
