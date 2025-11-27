import { Module } from '@nestjs/common';
import { ConnectionHandler } from './connection.handler';
import { MessagesModule } from '../messages/messages.module';

@Module({
  imports: [MessagesModule],
  providers: [ConnectionHandler],
  exports: [ConnectionHandler],
})
export class ConnectionModule {}
