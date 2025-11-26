import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { MessagesModule } from '../messages/messages.module';
import { PrismaModule } from '../prisma/prisma.module';
import { RedisModule } from '../redis/redis.module';
import { StorageModule } from 'src/storage/storage.module';
import { GroupManagementService } from 'src/conversations/group-management.service';

@Module({
  imports: [
    JwtModule.register({}),
    ConfigModule,
    MessagesModule,
    PrismaModule,
    RedisModule,
    StorageModule,
  ],
  providers: [ChatGateway, GroupManagementService],
  exports: [ChatGateway],
})
export class ChatModule {}
