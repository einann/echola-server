import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { RedisModule } from './redis/redis.module';
import { AuthModule } from './auth/auth.module';
import { ConversationsModule } from './conversations/conversations.module';
import { MessagesModule } from './messages/messages.module';
import { ConnectionModule } from './connection/connection.module';
import { GatewayModule } from './gateway/gateway.module';
import { PresenceModule } from './presence/presence.module';
import { SocketModule } from './socket/socket.module';
import { RequestContextMiddleware } from './common/middleware/request-context.middleware';
import { RateLimitMiddleware } from './common/middleware/rate-limit.middleware';
import { LoggerModule } from './common/logger/logger.module';
import { validate } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { MediaModule } from './media/media.module';
import { StorageModule } from './storage/storage.module';
import { UsersModule } from './users/users.module';
import { EmailModule } from './email/email.module';
import { MetricsModule } from './metrics/metrics.module';
import { NotificationsModule } from './notifications/notifications.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
      validate,
    }),
    LoggerModule,
    EmailModule,
    AuthModule,
    ConnectionModule,
    ConversationsModule,
    GatewayModule,
    HealthModule,
    MediaModule,
    MessagesModule,
    PresenceModule,
    PrismaModule,
    RedisModule,
    StorageModule,
    SocketModule,
    UsersModule,
    MetricsModule,
    NotificationsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Request Context (must be first)
    consumer.apply(RequestContextMiddleware).forRoutes('*');
    consumer.apply(RateLimitMiddleware).forRoutes('*');
  }

  constructor() {}
}
