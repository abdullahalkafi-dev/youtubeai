import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { AppModule } from './app.module';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { BigIntInterceptor } from './common/interceptors/bigint.interceptor';
import { DevLogsService } from './dev-logs/dev-logs.service';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  const configService = app.get(ConfigService);
  const logger = new Logger('Bootstrap');

  // Global prefix
  app.setGlobalPrefix('api');

  // CORS
  const frontendUrl = configService.get<string>('FRONTEND_URL', 'http://localhost:3000');
  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (mobile apps, curl, etc.)
      if (!origin) return callback(null, true);
      // Allow the configured frontend URL and any dev tunnel variant
      if (
        origin === frontendUrl ||
        origin.includes('asse.devtunnels.ms') ||
        origin.includes('localhost')
      ) {
        return callback(null, true);
      }
      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  // Cookie parser
  app.use(cookieParser());

  // Global pipes, interceptors, filters
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const reflector = app.get(Reflector);
  const devLogsService = app.get(DevLogsService);

  app.useGlobalInterceptors(
    new LoggingInterceptor(devLogsService),
    new BigIntInterceptor(),
    new TransformInterceptor(reflector),
  );
  app.useGlobalFilters(new AllExceptionsFilter(devLogsService));

  const port = configService.get<number>('PORT', 3001);
  const server = await app.listen(port);
  if (server && typeof server.setTimeout === 'function') {
    server.setTimeout(180000); // 3 minutes HTTP socket timeout for AI image generation
    server.headersTimeout = 190000;
  }
  logger.log(`🚀 Application running on http://localhost:${port}`);
  logger.log(`📝 API docs at http://localhost:${port}/api`);
}

bootstrap().catch((err) => {
  console.error('Failed to start application:', err);
  process.exit(1);
});
