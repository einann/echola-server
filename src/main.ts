import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { RedisIoAdapter } from './chat/socket-io-adapter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Get config service
  const configService = app.get(ConfigService);

  // Enable global validation
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // Enable CORS
  app.enableCors({
    origin:
      (configService.get('FRONTEND_URL') as string) || 'http://localhost:3000',
    credentials: true,
  });

  // Setup Redis adapter for Socket.IO
  const redisIoAdapter = new RedisIoAdapter(app, configService);
  await redisIoAdapter.connectToRedis();
  app.useWebSocketAdapter(redisIoAdapter);

  const port = (configService.get('PORT') as number) || 3000;
  await app.listen(port);
  console.log(`🚀 Echola backend is running on: http://localhost:${port}`);
  console.log(`🔌 WebSocket server is running on: ws://localhost:${port}/chat`);
}
bootstrap();
