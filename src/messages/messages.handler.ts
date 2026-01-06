/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable, Inject } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { MessagesService } from './messages.service';
import { MediaService } from '../media/media.service';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { SocketService } from '../socket/socket.service';
import { AuthenticatedSocket } from '../gateway/types/socket.types';
import {
  SendTextMessageEvent,
  RequestMediaUploadEvent,
  ConfirmMediaUploadEvent,
  MediaUploadUrlResponse,
  TypingEvent,
} from './dto/send-message-events.dto';
import {
  MessageDeliveredEvent,
  MessageReadEvent,
} from './dto/message-status-events.dto';
import { DeleteMessageDto } from './dto/delete-message.dto';

@Injectable()
export class MessagesHandler {
  constructor(
    private messagesService: MessagesService,
    private mediaService: MediaService,
    private redisService: RedisService,
    private prismaService: PrismaService,
    private socketService: SocketService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  // ============================================
  // TEXT MESSAGE
  // ============================================

  async sendTextMessage(
    client: AuthenticatedSocket,
    data: SendTextMessageEvent,
  ): Promise<void> {
    const userId = client.data.userId;

    const message = await this.messagesService.sendMessage(userId, {
      conversationId: data.conversationId,
      content: data.content,
      replyToId: data.replyToId,
    });

    // Acknowledge to sender
    client.emit('message_sent', {
      tempId: data.tempId,
      message,
    });

    // Deliver to other participants
    await this.deliverToParticipants(data.conversationId, userId, message);
  }

  // ============================================
  // MEDIA UPLOAD FLOW
  // ============================================

  /**
   * Step 1: Client requests upload URL
   * Event: media:request_upload
   */
  async requestMediaUpload(
    client: AuthenticatedSocket,
    data: RequestMediaUploadEvent,
  ): Promise<MediaUploadUrlResponse> {
    const userId = client.data.userId;

    // Verify user is participant in conversation
    await this.verifyParticipant(data.conversationId, userId);

    // Get presigned URL from media service
    const result = await this.mediaService.requestUploadUrl({
      // @ts-expect-error 'TODO: Prisma/enum ile dto karışıyor'
      mediaType: data.mediaType,
      mimeType: data.mimeType,
      fileName: data.fileName,
      fileSize: data.fileSize,
      conversationId: data.conversationId,
    });

    this.logger.log(
      {
        userId,
        conversationId: data.conversationId,
        fileName: data.fileName,
        mediaType: data.mediaType,
      },
      'Media upload URL requested',
    );

    return {
      uploadUrl: result.uploadUrl,
      fileKey: result.fileKey,
      expiresAt: result.expiresAt,
      tempId: data.tempId,
    };
  }

  /**
   * Step 2: Client confirms upload is complete
   * Event: media:confirm_upload
   */
  async confirmMediaUpload(
    client: AuthenticatedSocket,
    data: ConfirmMediaUploadEvent,
  ): Promise<void> {
    const userId = client.data.userId;

    // Verify user is participant
    await this.verifyParticipant(data.conversationId, userId);

    // Process media (resize, thumbnail, move to permanent storage)
    const processedMedia = await this.mediaService.confirmUpload({
      fileKey: data.fileKey,
      // @ts-expect-error 'TODO: Prisma/enum ile dto karışıyor'
      mediaType: data.mediaType,
      conversationId: data.conversationId,
    });

    // Create message with attachment
    const message = await this.messagesService.createMediaMessage({
      conversationId: data.conversationId,
      senderId: userId,
      media: {
        ...processedMedia,
        fileName: data.fileName,
      },
      caption: data.caption,
      replyToId: data.replyToId,
    });

    // Acknowledge to sender
    client.emit('message_sent', {
      tempId: data.tempId,
      message,
    });

    // Deliver to other participants
    await this.deliverToParticipants(data.conversationId, userId, message);

    this.logger.log(
      {
        userId,
        messageId: message.id,
        conversationId: data.conversationId,
        mediaType: data.mediaType,
      },
      'Media message sent',
    );
  }

  // ============================================
  // MESSAGE STATUS
  // ============================================

  async markDelivered(
    client: AuthenticatedSocket,
    data: MessageDeliveredEvent,
  ): Promise<void> {
    const userId = client.data.userId;

    await this.messagesService.markMessageAsDelivered(userId, data.messageId);

    const message = await this.prismaService.message.findUnique({
      where: { id: data.messageId },
      select: { senderId: true },
    });

    if (message) {
      this.socketService.emitToUser(message.senderId, 'message_delivered', {
        messageId: data.messageId,
        userId,
        deliveredAt: new Date(),
      });
    }
  }

  async markRead(
    client: AuthenticatedSocket,
    data: MessageReadEvent,
  ): Promise<void> {
    const userId = client.data.userId;

    await this.messagesService.markMessageAsRead(userId, data.messageId);

    const message = await this.prismaService.message.findUnique({
      where: { id: data.messageId },
      select: { senderId: true },
    });

    if (message) {
      this.socketService.emitToUser(message.senderId, 'message_read', {
        messageId: data.messageId,
        userId,
        readAt: new Date(),
      });
    }
  }

  // ============================================
  // DELETE MESSAGE
  // ============================================

  async deleteMessage(
    client: AuthenticatedSocket,
    data: DeleteMessageDto,
  ): Promise<any> {
    const userId = client.data.userId;

    // Get message before deletion (for conversationId)
    const message = await this.messagesService.getMessageById(data.messageId);

    const result = await this.messagesService.deleteMessage(
      data.messageId,
      userId,
      data.deleteForEveryone,
    );

    // Notify all participants in conversation
    this.socketService.emitToConversation(
      message.conversationId,
      'message_deleted',
      {
        messageId: data.messageId,
        conversationId: message.conversationId,
        deletedBy: userId,
        deleteForEveryone: data.deleteForEveryone,
        deletedAt: result.deletedAt,
      },
    );

    return result;
  }

  // ============================================
  // TYPING INDICATOR
  // ============================================

  handleTyping(client: AuthenticatedSocket, data: TypingEvent): void {
    const userId = client.data.userId;

    // Broadcast to conversation (except sender)
    client.to(data.conversationId).emit('user_typing', {
      conversationId: data.conversationId,
      userId,
      timestamp: new Date(),
    });
  }

  handleStopTyping(client: AuthenticatedSocket, data: TypingEvent): void {
    const userId = client.data.userId;

    client.to(data.conversationId).emit('user_stop_typing', {
      conversationId: data.conversationId,
      userId,
    });
  }

  // ============================================
  // HELPERS
  // ============================================

  private async verifyParticipant(
    conversationId: string,
    userId: string,
  ): Promise<void> {
    const participant =
      await this.prismaService.conversationParticipant.findFirst({
        where: {
          conversationId,
          userId,
          leftAt: null,
        },
      });

    if (!participant) {
      throw new Error('You are not a participant in this conversation');
    }
  }

  private async deliverToParticipants(
    conversationId: string,
    senderId: string,
    message: any,
  ): Promise<void> {
    // Get other participants
    const participants =
      await this.prismaService.conversationParticipant.findMany({
        where: {
          conversationId,
          userId: { not: senderId },
          leftAt: null,
        },
      });

    // Invalidate cache
    await this.redisService.invalidateConversationCache(conversationId);

    // Deliver to each participant
    for (const participant of participants) {
      const isOnline = await this.redisService.isUserOnline(participant.userId);

      if (isOnline) {
        this.socketService.emitToUser(
          participant.userId,
          'new_message',
          message,
        );

        // Auto-mark as delivered
        this.scheduleDeliveryConfirmation(
          participant.userId,
          senderId,
          message.id,
        );
      } else {
        // Add to offline inbox
        await this.redisService.addToInbox(participant.userId, message);
      }
    }

    // Publish to Redis for other server instances
    await this.redisService.publish(`conversation:${conversationId}`, {
      type: 'new_message',
      message,
      senderId,
    });
  }

  private scheduleDeliveryConfirmation(
    recipientId: string,
    senderId: string,
    messageId: string,
  ): void {
    setTimeout(() => {
      void (async () => {
        try {
          await this.messagesService.markMessageAsDelivered(
            recipientId,
            messageId,
          );

          this.socketService.emitToUser(senderId, 'message_delivered', {
            messageId,
            userId: recipientId,
            deliveredAt: new Date(),
          });
        } catch (error) {
          this.logger.warn(
            { messageId, recipientId, error: error.message },
            'Failed to mark message as delivered',
          );
        }
      })();
    }, 1000);
  }
}
