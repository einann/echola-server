import {
  Controller,
  Post,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  Request,
  Query,
} from '@nestjs/common';
import { MessagesService } from './messages.service';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { DeleteMessageDto } from './dto/delete-message.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('messages')
@UseGuards(JwtAccessGuard)
export class MessagesController {
  constructor(private messagesService: MessagesService) {}

  @Post()
  async sendMessage(@Request() req, @Body() sendMessageDto: SendMessageDto) {
    return this.messagesService.sendMessage(req.user.userId, sendMessageDto);
  }

  @Get('conversation/:conversationId')
  async getMessages(
    @Request() req,
    @Param('conversationId') conversationId: string,
    @Query('limit') limit?: string,
    @Query('before') beforeMessageId?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 50;
    return this.messagesService.getMessages(
      req.user.userId,
      conversationId,
      limitNum,
      beforeMessageId,
    );
  }

  @Put(':messageId/delivered')
  async markAsDelivered(@Request() req, @Param('messageId') messageId: string) {
    return this.messagesService.markMessageAsDelivered(
      req.user.userId,
      messageId,
    );
  }

  @Put(':messageId/read')
  async markAsRead(@Request() req, @Param('messageId') messageId: string) {
    return this.messagesService.markMessageAsRead(req.user.userId, messageId);
  }

  @Put('conversation/:conversationId/read')
  async markConversationAsRead(
    @Request() req,
    @Param('conversationId') conversationId: string,
  ) {
    return this.messagesService.markConversationAsRead(
      req.user.userId,
      conversationId,
    );
  }

  @Put(':messageId')
  async editMessage(
    @Request() req,
    @Param('messageId') messageId: string,
    @Body('content') content: string,
  ) {
    return this.messagesService.editMessage(
      req.user.userId,
      messageId,
      content,
    );
  }

  @Delete(':messageId')
  async deleteMessage(
    @Request() req,
    @Param('messageId') messageId: string,
    @Body() dto: DeleteMessageDto,
  ) {
    return this.messagesService.deleteMessage(
      messageId,
      req.user.id,
      dto.deleteForEveryone,
    );
  }

  @Get('conversation/:conversationId/unread-count')
  async getUnreadCount(
    @Request() req,
    @Param('conversationId') conversationId: string,
  ) {
    return this.messagesService.getUnreadCount(req.user.userId, conversationId);
  }
}
