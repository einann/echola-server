import { Module } from '@nestjs/common';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { PrismaModule } from '../prisma/prisma.module';
import { GroupManagementService } from './group-management.service';
import { GroupsHandler } from './groups.handler';

@Module({
  imports: [PrismaModule],
  controllers: [ConversationsController],
  providers: [ConversationsService, GroupManagementService, GroupsHandler],
  exports: [ConversationsService, GroupManagementService, GroupsHandler],
})
export class ConversationsModule {}
