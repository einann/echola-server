import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { SocketService } from '../socket/socket.service';
import { MessagesService } from '../messages/messages.service';
import { AuthenticatedSocket } from '../gateway/types/socket.types';

@Injectable()
export class ConnectionHandler {
  constructor(
    private prismaService: PrismaService,
    private redisService: RedisService,
    private socketService: SocketService,
    private messagesService: MessagesService,
  ) {}

  async handleUserConnected(socket: AuthenticatedSocket, userId: string) {
    try {
      // Join user to their personal room
      void socket.join(`user:${userId}`);

      // Mark user as online in Redis
      await this.redisService.setUserOnline(userId, socket.id);

      // Update user online status in database
      await this.prismaService.user.update({
        where: { id: userId },
        data: { isOnline: true },
      });

      // Get user's conversations and join those rooms
      const participants =
        await this.prismaService.conversationParticipant.findMany({
          where: { userId, leftAt: null },
          select: { conversationId: true },
        });

      for (const participant of participants) {
        void socket.join(`conversation:${participant.conversationId}`);
      }

      // Deliver any queued messages from Redis inbox
      await this.deliverQueuedMessages(userId, socket);

      // Notify user's contacts that they came online
      await this.broadcastPresenceChange(userId, true);

      console.log(`Client connected: ${socket.id}, User: ${userId}`);
      return true;
    } catch (error) {
      console.error('Connection setup error:', error);
      return false;
    }
  }

  async handleUserDisconnected(userId: string) {
    try {
      // Mark user as offline in Redis
      await this.redisService.setUserOffline(userId);

      // Update user offline status in database
      await this.prismaService.user.update({
        where: { id: userId },
        data: {
          isOnline: false,
          lastSeenAt: new Date(),
        },
      });

      // Notify user's contacts that they went offline
      await this.broadcastPresenceChange(userId, false);

      console.log(`User disconnected: ${userId}`);
      return true;
    } catch (error) {
      console.error('Disconnection error:', error);
      return false;
    }
  }

  private async deliverQueuedMessages(
    userId: string,
    socket: AuthenticatedSocket,
  ) {
    try {
      const queuedMessages = await this.redisService.getInboxMessages(userId);

      for (const message of queuedMessages) {
        // Deliver message
        socket.emit('new_message', message);

        // Mark as delivered
        await this.messagesService.markMessageAsDelivered(userId, message.id);

        // Remove from inbox
        await this.redisService.removeFromInbox(userId, message.id);

        // Notify sender of delivery
        this.socketService.emitToUser(message.senderId, 'message_delivered', {
          messageId: message.id,
          userId,
          deliveredAt: new Date(),
        });
      }

      if (queuedMessages.length > 0) {
        console.log(
          `Delivered ${queuedMessages.length} queued messages to user ${userId}`,
        );
      }
    } catch (error) {
      console.error('Error delivering queued messages:', error);
    }
  }

  private async broadcastPresenceChange(userId: string, isOnline: boolean) {
    // Get user's conversations
    const participants =
      await this.prismaService.conversationParticipant.findMany({
        where: { userId, leftAt: null },
        include: { conversation: { include: { participants: true } } },
      });

    // Collect all unique user IDs from conversations
    const contactIds = new Set<string>();
    for (const participant of participants) {
      for (const p of participant.conversation.participants) {
        if (p.userId !== userId && p.leftAt === null) {
          contactIds.add(p.userId);
        }
      }
    }

    // Notify each contact
    for (const contactId of contactIds) {
      this.socketService.emitToUser(contactId, 'presence_changed', {
        userId,
        isOnline,
        lastSeenAt: isOnline ? null : new Date(),
      });
    }
  }
}
