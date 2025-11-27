import { Injectable } from '@nestjs/common';
import { MessagesService } from './messages.service';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { SocketService } from '../socket/socket.service';
import { AuthenticatedSocket } from '../gateway/types/socket.types';
import { SendMessageEvent } from './dto/send-message-events.dto';
import {
  MessageDeliveredEvent,
  MessageReadEvent,
} from './dto/message-status-events.dto';

@Injectable()
export class MessagesHandler {
  constructor(
    private messagesService: MessagesService,
    private redisService: RedisService,
    private prismaService: PrismaService,
    private socketService: SocketService,
  ) {}

  async sendMessage(
    client: AuthenticatedSocket,
    data: SendMessageEvent,
  ): Promise<void> {
    const userId = client.data.userId;

    // Send message via service (saves to DB)
    const message = await this.messagesService.sendMessage(userId, data);

    // Immediately acknowledge to sender
    client.emit('message_sent', {
      tempId: data['tempId'] as string,
      message,
    });

    // Get conversation participants
    const participants =
      await this.prismaService.conversationParticipant.findMany({
        where: {
          conversationId: data.conversationId,
          userId: { not: userId },
          leftAt: null,
        },
      });

    // Invalidate conversation cache
    await this.redisService.invalidateConversationCache(data.conversationId);

    // Deliver to online recipients via WebSocket
    for (const participant of participants) {
      const isOnline = await this.redisService.isUserOnline(participant.userId);

      if (isOnline) {
        // Deliver via WebSocket
        this.socketService.emitToUser(
          participant.userId,
          'new_message',
          message,
        );

        // Auto-mark as delivered after 1 second
        setTimeout(() => {
          void (async () => {
            await this.messagesService.markMessageAsDelivered(
              participant.userId,
              message.id,
            );

            // Notify sender of delivery
            this.socketService.emitToUser(userId, 'message_delivered', {
              messageId: message.id,
              userId: participant.userId,
              deliveredAt: new Date(),
            });
          })();
        }, 1000);
      } else {
        // User offline: add to Redis inbox
        await this.redisService.addToInbox(participant.userId, message);
      }
    }

    // Publish to Redis for other server instances
    await this.redisService.publish(`conversation:${data.conversationId}`, {
      type: 'new_message',
      message,
      senderId: userId,
    });
  }

  async markDelivered(
    client: AuthenticatedSocket,
    data: MessageDeliveredEvent,
  ): Promise<void> {
    const userId = client.data.userId;

    await this.messagesService.markMessageAsDelivered(userId, data.messageId);

    // Get message to find sender
    const message = await this.prismaService.message.findUnique({
      where: { id: data.messageId },
    });

    if (message) {
      // Notify sender
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

    // Get message to find sender
    const message = await this.prismaService.message.findUnique({
      where: { id: data.messageId },
    });

    if (message) {
      // Notify sender
      this.socketService.emitToUser(message.senderId, 'message_read', {
        messageId: data.messageId,
        userId,
        readAt: new Date(),
      });
    }
  }
}
