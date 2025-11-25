import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ReactionsService } from './reactions.service';

@Module({
  imports: [PrismaModule],
  controllers: [MessagesController],
  providers: [MessagesService, ReactionsService],
  exports: [MessagesService, ReactionsService],
})
export class MessagesModule {}
