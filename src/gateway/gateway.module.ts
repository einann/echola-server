import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { ChatGateway } from './chat.gateway';
import { ConnectionModule } from '../connection/connection.module';
import { MessagesModule } from '../messages/messages.module';
import { PresenceModule } from '../presence/presence.module';
import { StorageModule } from '../storage/storage.module';
import { ConversationsModule } from '../conversations/conversations.module';

@Module({
  imports: [
    JwtModule.register({}),
    ConfigModule,
    ConnectionModule,
    MessagesModule,
    PresenceModule,
    StorageModule,
    ConversationsModule,
  ],
  providers: [ChatGateway],
  exports: [ChatGateway],
})
export class GatewayModule {}
