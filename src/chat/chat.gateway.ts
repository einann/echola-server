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
import { BadRequestException, UsePipes, ValidationPipe } from '@nestjs/common';
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
  RequestFileUploadEvent,
  ConfirmFileUploadEvent,
} from './dto/websocket-events.dto';
import { StorageService } from 'src/storage/storage.service';
import { FileProcessorService } from 'src/storage/file-processor.service';
import { AuthenticatedSocket } from './types/socket.types';

@WebSocketGateway({
  cors: {
    // origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    origin: '*',
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
    private storageService: StorageService,
    private fileProcessorService: FileProcessorService,
  ) {
    // Subscribe to Redis pub/sub for cross-server message delivery
    void this.subscribeToRedisChannels();
  }

  // ============================================
  // Connection Lifecycle
  // ============================================

  async handleConnection(client: AuthenticatedSocket) {
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

  async handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.data.userId;

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
    @ConnectedSocket() client: AuthenticatedSocket,
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
    @ConnectedSocket() client: AuthenticatedSocket,
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
    @ConnectedSocket() client: AuthenticatedSocket,
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
    @ConnectedSocket() client: AuthenticatedSocket,
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
    @ConnectedSocket() client: AuthenticatedSocket,
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
  // File Upload via WebSocket
  // ============================================

  @SubscribeMessage('file:upload:request')
  async handleFileUploadRequest(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: RequestFileUploadEvent,
  ) {
    try {
      const userId = client.data.userId;

      // Verify user is participant in the conversation
      const participant =
        await this.prismaService.conversationParticipant.findFirst({
          where: {
            conversationId: data.conversationId,
            userId,
            leftAt: null,
          },
        });

      if (!participant) {
        client.emit('error', {
          message: 'You are not a participant in this conversation',
        });
        return { success: false };
      }

      // Validate file type and size
      this.validateFileRequest(data.fileType, data.fileSize, data.mimeType);

      // Generate presigned upload URL (5 minutes expiry)
      const { uploadUrl, fileKey } =
        await this.storageService.generateUploadUrl(
          data.fileName,
          data.mimeType,
          300,
        );

      // Cache the file metadata in Redis temporarily (5 minutes TTL)
      // This prevents users from confirming uploads they didn't request
      await this.redisService.set(
        `upload:${userId}:${fileKey}`,
        JSON.stringify({
          fileName: data.fileName,
          fileType: data.fileType,
          conversationId: data.conversationId,
          fileSize: data.fileSize,
        }),
        300, // 5 minutes
      );

      // Send presigned URL back to client
      client.emit('file:upload:url', {
        uploadUrl,
        fileKey,
        expiresIn: 300,
        instructions: 'Use PUT request to upload file directly to this URL',
      });

      return { success: true };
    } catch (error) {
      console.error('Error requesting file upload:', error);
      client.emit('error', {
        message: 'Failed to generate upload URL',
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  @SubscribeMessage('file:upload:complete')
  async handleFileUploadComplete(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: ConfirmFileUploadEvent,
  ) {
    try {
      const userId = client.data.userId;

      // Verify this upload request was initiated by this user
      const uploadMetadata = await this.redisService.get(
        `upload:${userId}:${data.fileKey}`,
      );

      if (!uploadMetadata) {
        client.emit('error', {
          message: 'Invalid or expired upload request',
        });
        return { success: false };
      }

      const metadata = JSON.parse(uploadMetadata);

      // Verify conversation matches
      if (metadata.conversationId !== data.conversationId) {
        client.emit('error', {
          message: 'Conversation mismatch',
        });
        return { success: false };
      }

      let mediaUrl = this.storageService.getPublicUrl(data.fileKey);
      let thumbnailUrl: string | undefined;
      let processedFileSize = data.fileSize;

      // Process images: compress, resize, create thumbnail
      if (data.fileType === 'image') {
        try {
          // Download the uploaded file from S3
          const downloadUrl = await this.storageService.generateDownloadUrl(
            data.fileKey,
          );
          const response = await fetch(downloadUrl);
          const buffer = Buffer.from(await response.arrayBuffer());

          // Process image (compress, resize, create thumbnail)
          const { processedBuffer, thumbnailBuffer } =
            await this.fileProcessorService.validateAndProcessImage(buffer);

          // Upload processed image
          const processedFileKey = `processed/${data.fileKey}`;
          await this.storageService.uploadFile(
            processedFileKey,
            processedBuffer,
            'image/jpeg',
          );
          mediaUrl = this.storageService.getPublicUrl(processedFileKey);
          processedFileSize = processedBuffer.length;

          // Upload thumbnail
          const thumbnailFileKey = `thumbnails/${data.fileKey}`;
          await this.storageService.uploadFile(
            thumbnailFileKey,
            thumbnailBuffer,
            'image/jpeg',
          );
          thumbnailUrl = this.storageService.getPublicUrl(thumbnailFileKey);

          // Delete original unprocessed file
          await this.storageService.deleteFile(data.fileKey);
        } catch (error) {
          console.error('Error processing image:', error);
          // Fall back to using original upload if processing fails
          console.log('Using original uploaded image');
        }
      }

      // Create message with media
      const message = await this.messagesService.sendMessage(userId, {
        conversationId: data.conversationId,
        content: data.content || '', // Optional caption
        contentType: data.fileType,
        mediaUrl,
        thumbnailUrl,
        fileName: data.fileName,
        fileSize: processedFileSize,
      });

      // Delete the temporary upload metadata from Redis
      await this.redisService.del(`upload:${userId}:${data.fileKey}`);

      // Acknowledge to sender
      client.emit('file:upload:success', {
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

          // Auto-mark as delivered after 1 second
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
      console.error('Error completing file upload:', error);
      client.emit('error', {
        message: 'Failed to complete file upload',
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // Helper Methods
  // ============================================

  private async deliverQueuedMessages(
    userId: string,
    client: AuthenticatedSocket,
  ) {
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

  // ============================================
  // Helper: Validate File Request
  // ============================================

  private validateFileRequest(
    fileType: string,
    fileSize: number,
    mimeType: string,
  ) {
    const allowedTypes = this.getAllowedMimeTypes(fileType);
    const maxSize = this.getMaxFileSize(fileType);

    if (!allowedTypes.includes(mimeType)) {
      throw new BadRequestException(`Invalid MIME type for ${fileType}`);
    }

    if (fileSize > maxSize) {
      throw new BadRequestException(
        `File size exceeds ${maxSize / 1024 / 1024}MB limit for ${fileType}`,
      );
    }
  }

  private getAllowedMimeTypes(fileType: string): string[] {
    const mimeTypes = {
      image: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
      video: ['video/mp4', 'video/quicktime', 'video/webm'],
      audio: ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm'],
      document: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      ],
    };

    return mimeTypes[fileType] || [];
  }

  private getMaxFileSize(fileType: string): number {
    const sizes = {
      image: this.configService.get<number>('MAX_IMAGE_SIZE') || 10485760, // 10MB
      video: this.configService.get<number>('MAX_VIDEO_SIZE') || 104857600, // 100MB
      audio: this.configService.get<number>('MAX_DOCUMENT_SIZE') || 26214400, // 25MB
      document: this.configService.get<number>('MAX_DOCUMENT_SIZE') || 26214400, // 25MB
    };

    return sizes[fileType] || 10485760; // 10MB default
  }
}
