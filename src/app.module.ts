import { Module } from '@nestjs/common';
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
export class AppModule {}
