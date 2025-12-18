import { Module } from '@nestjs/common';
import { MessagesController } from './messages.controller';
import { MessagesService } from './messages.service';
import { PrismaModule } from '../prisma/prisma.module';
import { ReactionsService } from './reactions.service';
import { MessagesHandler } from './messages.handler';
import { ReactionsHandler } from './reactions.handler';
import { MediaModule } from 'src/media/media.module';

@Module({
  imports: [PrismaModule, MediaModule],
  controllers: [MessagesController],
  providers: [
    MessagesService,
    MessagesHandler,
    ReactionsService,
    ReactionsHandler,
  ],
  exports: [MessagesService, MessagesHandler, ReactionsHandler],
})
export class MessagesModule {}
