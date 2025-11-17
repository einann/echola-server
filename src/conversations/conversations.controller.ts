import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  UseGuards,
  Request,
} from '@nestjs/common';
import { ConversationsService } from './conversations.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';

@Controller('conversations')
@UseGuards(JwtAccessGuard)
export class ConversationsController {
  constructor(private conversationsService: ConversationsService) {}

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
  async getUserConversations(@Request() req) {
    return this.conversationsService.getUserConversations(req.user.userId);
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
}
