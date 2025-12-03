import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { StorageModule } from './storage/storage.module';
import { ConnectionModule } from './connection/connection.module';
import { GatewayModule } from './gateway/gateway.module';
import { PresenceModule } from './presence/presence.module';
import { SocketModule } from './socket/socket.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { LoggingMiddleware } from './common/middleware/logging.middleware';
import { RateLimitMiddleware } from './common/middleware/rate-limit.middleware';
import { RedisService } from './redis';
import { ModuleRef } from '@nestjs/core';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    AuthModule,
    ConnectionModule,
    ConversationsModule,
    GatewayModule,
    MessagesModule,
    PresenceModule,
    PrismaModule,
    RedisModule,
    SocketModule,
    StorageModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // ================================
    // APPLY MIDDLEWARE GLOBALLY
    // ================================

    // 1. Request Context (must be first)
    consumer.apply(RequestContextMiddleware).forRoutes('*');

    // 2. Logging (after context is set)
    consumer.apply(LoggingMiddleware).forRoutes('*');

    // 3. Rate limiting (after logging)
    consumer.apply(RateLimitMiddleware).forRoutes('*');

    // ================================
    // APPLY SPECIFIC RATE LIMITS
    // ================================

    // Stricter rate limit for auth endpoints
    consumer
      .apply((req, res, next) => {
        const middleware = new RateLimitMiddleware(
          this.moduleRef.get(RedisService),
        );
        middleware.configure({
          windowMs: 15 * 60 * 1000, // 15 minutes
          maxRequests: 5, // 5 attempts per 15 minutes
          message: 'Too many login attempts, please try again later',
        });
        return middleware.use(req, res, next);
      })
      .forRoutes('/auth/login', '/auth/register');

    // Moderate rate limit for file uploads
    // TODO: Buraya gerek kalmayabilir çünkü storage endpointleri zaten guard'lı, kontrol edilecek
    consumer
      .apply((req, res, next) => {
        const middleware = new RateLimitMiddleware(
          this.moduleRef.get(RedisService),
        );
        middleware.configure({
          windowMs: 60 * 60 * 1000, // 1 hour
          maxRequests: 50, // 50 uploads per hour
          message: 'Upload limit reached, please try again later',
        });
        return middleware.use(req, res, next);
      })
      .forRoutes('/storage/upload', '/storage/presigned-url');
  }

  constructor(private moduleRef: ModuleRef) {} // Import ModuleRef from @nestjs/core
}
