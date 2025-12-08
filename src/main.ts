import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './common/adapters/redis-io.adapter';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { TimeoutInterceptor } from './common/interceptors/timeout.interceptor';
import { Logger } from 'nestjs-pino';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Use pino instead of default NestJS logger
  app.useLogger(app.get(Logger));

  // Get config service
  const configService = app.get(ConfigService);

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
    origin:
      configService.get<string>('FRONTEND_URL') || 'http://localhost:3000',
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
  app.enableShutdownHooks();

  process.on('SIGTERM', () => {
    void (async () => {
      console.log(
        '⚠️  SIGTERM signal received: closing HTTP server gracefully',
      );
      await app.close();
    })();
  });

  process.on('SIGINT', () => {
    void (async () => {
      console.log('⚠️  SIGINT signal received: closing HTTP server gracefully');
      await app.close();
    });
  });

  // ================================
  // START SERVER
  // ================================
  const port = configService.get<number>('PORT') || 3000;
  await app.listen(port);

  const logger = app.get(Logger);
  logger.log(`🚀 Echola backend is running on: http://localhost:${port}`);
  logger.log(`🔌 WebSocket server is running on: ws://localhost:${port}/chat`);
  logger.log(`📝 Environment: ${configService.get('NODE_ENV')}`);
}

void bootstrap();
