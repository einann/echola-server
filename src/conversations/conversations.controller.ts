import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
  Put,
  Delete,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { GroupManagementService } from './group-management.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { PaginationQueryDto } from './dto/pagination.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';

@Controller('conversations')
@UseGuards(JwtAccessGuard)
export class ConversationsController {
  constructor(
    private conversationsService: ConversationsService,
    private groupManagementService: GroupManagementService,
  ) {}

  @Post()
  async createConversation(
    @Request() req,
    @Body() createDto: CreateConversationDto,
  ) {
    return this.conversationsService.createConversation(
      req.user.userId,
      createDto,
    );
  }

  @Get()
  async getUserConversations(
    @Request() req,
    @Query() paginationQuery: PaginationQueryDto,
  ) {
    return this.conversationsService.getUserConversations(req.user.userId, {
      limit: paginationQuery.limit,
      cursor: paginationQuery.cursor,
      search: paginationQuery.search,
      type: paginationQuery.type,
      muted: paginationQuery.muted,
    });
  }

  @Get(':id')
  async getConversationById(
    @Request() req,
    @Param('id') conversationId: string,
  ) {
    return this.conversationsService.getConversationById(
      req.user.userId,
      conversationId,
    );
  }

  // ============================================
  // Group Management Endpoints
  // ============================================

  @Post(':id/members')
  async addMembers(
    @Request() req,
    @Param('id') conversationId: string,
    @Body() body: { userIds: string[] },
  ) {
    return this.groupManagementService.addMembers(
      req.user.userId,
      conversationId,
      body.userIds,
    );
  }

  @Delete(':id/members/:userId')
  @HttpCode(HttpStatus.OK)
  async removeMember(
    @Request() req,
    @Param('id') conversationId: string,
    @Param('userId') userIdToRemove: string,
  ) {
    return this.groupManagementService.removeMember(
      req.user.userId,
      conversationId,
      userIdToRemove,
    );
  }

  @Post(':id/leave')
  @HttpCode(HttpStatus.OK)
  async leaveGroup(@Request() req, @Param('id') conversationId: string) {
    return this.groupManagementService.leaveGroup(
      req.user.userId,
      conversationId,
    );
  }

  @Put(':id/members/:userId/role')
  async updateMemberRole(
    @Request() req,
    @Param('id') conversationId: string,
    @Param('userId') targetUserId: string,
    @Body() body: { role: 'member' | 'admin' },
  ) {
    return this.groupManagementService.updateMemberRole(
      req.user.userId,
      conversationId,
      targetUserId,
      body.role,
    );
  }

  @Put(':id')
  async updateGroupInfo(
    @Request() req,
    @Param('id') conversationId: string,
    @Body() body: { name?: string; description?: string; avatarUrl?: string },
  ) {
    return this.groupManagementService.updateGroupInfo(
      req.user.userId,
      conversationId,
      body,
    );
  }

  @Get(':id/members')
  async getGroupMembers(@Request() req, @Param('id') conversationId: string) {
    return this.groupManagementService.getGroupMembers(
      req.user.userId,
      conversationId,
    );
  }

  // ============================================
  // Mute/Unmute Conversation
  // ============================================

  @Post(':id/mute')
  @HttpCode(HttpStatus.OK)
  async muteConversation(@Request() req, @Param('id') conversationId: string) {
    return this.conversationsService.muteConversation(
      req.user.userId,
      conversationId,
    );
  }

  @Post(':id/unmute')
  @HttpCode(HttpStatus.OK)
  async unmuteConversation(
    @Request() req,
    @Param('id') conversationId: string,
  ) {
    return this.conversationsService.unmuteConversation(
      req.user.userId,
      conversationId,
    );
  }

  // ============================================
  // Delete Conversation
  // ============================================

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  async deleteConversation(
    @Request() req,
    @Param('id') conversationId: string,
  ) {
    return this.conversationsService.deleteConversation(
      req.user.userId,
      conversationId,
    );
  }
}
