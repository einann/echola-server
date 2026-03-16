import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { Logger } from 'nestjs-pino';
import { initializeSentry } from './config/sentry.config';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  // Use pino instead of default NestJS logger
  app.useLogger(app.get(Logger));

  // Get config service
  const configService = app.get(ConfigService);

  // Initialize sentry first before any setup
  initializeSentry(configService);

  // ================================
  // TRUST PROXY (for rate limiting behind load balancers)
  // ================================
  app.set('trust proxy', 1);

  // ================================
  // SECURITY HEADERS (Helmet)
  // ================================
  app.use(helmet());

  // ================================
  // GLOBAL EXCEPTION FILTER
  // ================================
  app.useGlobalFilters(new HttpExceptionFilter(configService));

  // ================================
  // GLOBAL INTERCEPTORS
  // ================================
  // Transform all responses to standard format
  app.useGlobalInterceptors(new TransformInterceptor());

  // Timeout protection (30 seconds)
  app.useGlobalInterceptors(new TimeoutInterceptor(30000));

  // ================================
  // GLOBAL VALIDATION PIPE
  // ================================
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // ================================
  // CORS CONFIGURATION
  // ================================
  app.enableCors({
    origin: configService.get<string>('FRONTEND_URL') || 'http://localhost:3000',
    credentials: true,
  });

  // ================================
  // WEBSOCKET ADAPTER
  // ================================
  const redisIoAdapter = new RedisIoAdapter(app, configService);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  // ================================
  // GRACEFUL SHUTDOWN
  // ================================
  const logger = app.get(Logger);
  const SHUTDOWN_TIMEOUT_MS = 15000;

  app.enableShutdownHooks();

  const gracefulShutdown = (signal: string) => {
    logger.warn(`${signal} signal received: closing HTTP server gracefully`);

    // Force exit if graceful shutdown takes too long
    const forceExitTimeout = setTimeout(() => {
      logger.error(`Graceful shutdown timed out after ${SHUTDOWN_TIMEOUT_MS}ms, forcing exit`);
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);

    app
      .close()
      .then(() => {
        clearTimeout(forceExitTimeout);
        logger.log('Server closed successfully');
        process.exit(0);
      })
      .catch((err: unknown) => {
        clearTimeout(forceExitTimeout);
        logger.error(`Error during shutdown: ${err instanceof Error ? err.message : String(err)}`);
        process.exit(1);
      });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  // ================================
  // START SERVER
  // ================================
  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);

  logger.log(`Echola backend is running on: http://localhost:${port}`);
  logger.log(`WebSocket server is running on: ws://localhost:${port}/chat`);
  logger.log(`Environment: ${configService.get('NODE_ENV')}`);
}

void bootstrap();
