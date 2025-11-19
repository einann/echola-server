import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { MessagesService } from '../messages/messages.service';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  SendMessageEvent,
  MessageDeliveredEvent,
  MessageReadEvent,
  TypingEvent,
} from './dto/websocket-events.dto';

@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  },
  namespace: '/chat',
})
@UsePipes(new ValidationPipe())
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private messagesService: MessagesService,
    private redisService: RedisService,
    private prismaService: PrismaService,
  ) {
    // Subscribe to Redis pub/sub for cross-server message delivery
    this.subscribeToRedisChannels();
  }

  // ============================================
  // Connection Lifecycle
  // ============================================

  async handleConnection(client: Socket) {
    try {
      // Extract token from handshake
      const token =
        (client.handshake.auth.token as string) ||
        client.handshake.headers.authorization?.split(' ')[1];

      if (!token) {
        client.disconnect();
        return;
      }

      // Verify JWT token
      const payload = this.jwtService.verify(token, {
        secret: this.configService.get('JWT_ACCESS_SECRET'),
      });

      const userId = payload.sub!;

      // Attach user info to socket
      client.data.userId = userId;
      client.data.deviceId = payload.deviceId;

      // Join user to their personal room
      client.join(`user:${userId}`);

      // Mark user as online in Redis
      await this.redisService.setUserOnline(userId, client.id);

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
        client.join(`conversation:${participant.conversationId}`);
      }

      // Deliver any queued messages from Redis inbox
      await this.deliverQueuedMessages(userId, client);

      // Notify user's contacts that they came online
      await this.broadcastPresenceChange(userId, true);

      console.log(`Client connected: ${client.id}, User: ${userId}`);
    } catch (error) {
      console.error('Connection error:', error);
      client.disconnect();
    }
  }

  async handleDisconnect(client: Socket) {
    const userId = client.data.userId as string;

    if (userId) {
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

      console.log(`Client disconnected: ${client.id}, User: ${userId}`);
    }
  }

  // ============================================
  // Message Sending (Primary WebSocket Flow)
  // ============================================

  @SubscribeMessage('send_message')
  async handleSendMessage(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: SendMessageEvent,
  ) {
    try {
      const userId = client.data.userId;

      // Send message via service (saves to DB)
      const message = await this.messagesService.sendMessage(userId, data);

      // Immediately acknowledge to sender
      client.emit('message_sent', {
        tempId: data['tempId'], // Client-generated temp ID for optimistic updates
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
        const isOnline = await this.redisService.isUserOnline(
          participant.userId,
        );

        if (isOnline) {
          // Deliver via WebSocket
          this.server
            .to(`user:${participant.userId}`)
            .emit('new_message', message);

          // Auto-mark as delivered after 1 second (simulating network delivery)
          setTimeout(async () => {
            await this.messagesService.markMessageAsDelivered(
              participant.userId,
              message.id,
            );

            // Notify sender of delivery
            this.server.to(`user:${userId}`).emit('message_delivered', {
              messageId: message.id,
              userId: participant.userId,
              deliveredAt: new Date(),
            });
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

      return { success: true, messageId: message.id };
    } catch (error) {
      console.error('Error sending message:', error);
      client.emit('error', {
        message: 'Failed to send message',
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // Message Status Updates
  // ============================================

  @SubscribeMessage('message_delivered')
  async handleMessageDelivered(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: MessageDeliveredEvent,
  ) {
    try {
      const userId = client.data.userId;

      await this.messagesService.markMessageAsDelivered(userId, data.messageId);

      // Get message to find sender
      const message = await this.prismaService.message.findUnique({
        where: { id: data.messageId },
      });

      if (message) {
        // Notify sender
        this.server.to(`user:${message.senderId}`).emit('message_delivered', {
          messageId: data.messageId,
          userId,
          deliveredAt: new Date(),
        });
      }

      return { success: true };
    } catch (error) {
      console.error('Error marking message as delivered:', error);
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('message_read')
  async handleMessageRead(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: MessageReadEvent,
  ) {
    try {
      const userId = client.data.userId;

      await this.messagesService.markMessageAsRead(userId, data.messageId);

      // Get message to find sender
      const message = await this.prismaService.message.findUnique({
        where: { id: data.messageId },
      });

      if (message) {
        // Notify sender
        this.server.to(`user:${message.senderId}`).emit('message_read', {
          messageId: data.messageId,
          userId,
          readAt: new Date(),
        });
      }

      return { success: true };
    } catch (error) {
      console.error('Error marking message as read:', error);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // Typing Indicators
  // ============================================

  @SubscribeMessage('typing_start')
  async handleTypingStart(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: TypingEvent,
  ) {
    const userId = client.data.userId;

    // Set typing indicator in Redis (5-second TTL)
    await this.redisService.setTyping(data.conversationId, userId);

    // Broadcast to conversation participants (except sender)
    client.to(`conversation:${data.conversationId}`).emit('user_typing', {
      conversationId: data.conversationId,
      userId,
    });
  }

  @SubscribeMessage('typing_stop')
  handleTypingStop(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: TypingEvent,
  ) {
    const userId = client.data.userId;

    // Broadcast to conversation participants
    client
      .to(`conversation:${data.conversationId}`)
      .emit('user_stopped_typing', {
        conversationId: data.conversationId,
        userId,
      });
  }

  // ============================================
  // Helper Methods
  // ============================================

  private async deliverQueuedMessages(userId: string, client: Socket) {
    try {
      const queuedMessages = await this.redisService.getInboxMessages(userId);

      for (const message of queuedMessages) {
        // Deliver message
        client.emit('new_message', message);

        // Mark as delivered
        await this.messagesService.markMessageAsDelivered(userId, message.id);

        // Remove from inbox
        await this.redisService.removeFromInbox(userId, message.id);

        // Notify sender of delivery
        this.server.to(`user:${message.senderId}`).emit('message_delivered', {
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
      this.server.to(`user:${contactId}`).emit('presence_changed', {
        userId,
        isOnline,
        lastSeenAt: isOnline ? null : new Date(),
      });
    }
  }

  private async subscribeToRedisChannels() {
    // Subscribe to all conversation channels for cross-server message delivery
    // This enables horizontal scaling - messages sent from Server A reach users on Server B
    await this.redisService.subscribe('conversation:*', (data) => {
      if (data.type === 'new_message') {
        // Deliver to local connected clients
        this.server
          .to(`conversation:${data.message.conversationId}`)
          .emit('new_message', data.message);
      }
    });
  }
}
