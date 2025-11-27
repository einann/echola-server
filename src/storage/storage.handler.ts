import { Injectable, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedSocket } from '../gateway/types/socket.types';
import { StorageService } from './storage.service';
import { FileProcessorService } from './file-processor.service';
import { MessagesService } from '../messages/messages.service';
import { PrismaService } from '../prisma/prisma.service';
import { SocketService } from '../socket/socket.service';
import {
  ConfirmFileUploadEvent,
  RequestFileUploadEvent,
} from './dto/file-upload-events.dto';
import { RedisService, UploadMetadata } from '../redis';
import { StorageValidationService } from './storage-validation.service';

@Injectable()
export class StorageHandler {
  constructor(
    private configService: ConfigService,
    private storageService: StorageService,
    private storageValidationService: StorageValidationService,
    private fileProcessorService: FileProcessorService,
    private messagesService: MessagesService,
    private redisService: RedisService,
    private prismaService: PrismaService,
    private socketService: SocketService,
  ) {}

  async requestUpload(
    client: AuthenticatedSocket,
    data: RequestFileUploadEvent,
  ): Promise<void> {
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
      throw new ForbiddenException(
        'You are not a participant in this conversation',
      );
    }

    // Validate file type and size (throws exceptions on validation failure)
    this.storageValidationService.validateFileRequest(
      data.fileType,
      data.fileSize,
      data.mimeType,
    );

    const fileKey = this.storageValidationService.generateFileKey(
      data.fileName,
    );

    // Generate presigned upload URL (5 minutes expiry)
    const uploadUrl = await this.storageService.generatePresignedUploadUrl(
      data.fileName,
      data.mimeType,
      300,
    );

    const metadata: UploadMetadata = {
      fileName: data.fileName,
      fileType: data.fileType,
      conversationId: data.conversationId,
      fileSize: data.fileSize,
    };

    // Cache the file metadata in Redis temporarily (5 minutes TTL)
    await this.redisService.setUploadMetadata(userId, fileKey, metadata, 300);

    // Send presigned URL back to client
    client.emit('file:upload:url', {
      uploadUrl,
      fileKey,
      expiresIn: 300,
      instructions: 'Use PUT request to upload file directly to this URL',
    });
  }

  async confirmUpload(
    client: AuthenticatedSocket,
    data: ConfirmFileUploadEvent,
  ): Promise<void> {
    const userId = client.data.userId;

    // Verify this upload request was initiated by this user
    const uploadMetadata: UploadMetadata | null =
      await this.redisService.getUploadMetadata(userId, data.fileKey);

    if (!uploadMetadata) {
      throw new ForbiddenException('Invalid or expired upload request');
    }

    // Verify conversation matches
    if (uploadMetadata.conversationId !== data.conversationId) {
      throw new ForbiddenException('Conversation mismatch');
    }

    let mediaUrl = this.storageService.getPublicUrl(data.fileKey);
    let thumbnailUrl: string | undefined;
    let processedFileSize = data.fileSize;

    // Process images: compress, resize, create thumbnail
    if (data.fileType === 'image') {
      try {
        // Download the uploaded file from S3
        const downloadUrl =
          await this.storageService.generatePresignedDownloadUrl(data.fileKey);
        const response = await fetch(downloadUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

        // Process image (compress, resize, create thumbnail)
        const { processedBuffer, thumbnailBuffer } =
          await this.fileProcessorService.validateAndProcessImage(buffer);

        // Upload processed image
        const processedFileKey = `processed/${data.fileKey}`;
        await this.storageService.uploadBuffer(
          processedFileKey,
          processedBuffer,
          'image/jpeg',
        );
        mediaUrl = this.storageService.getPublicUrl(processedFileKey);
        processedFileSize = processedBuffer.length;

        // Upload thumbnail
        const thumbnailFileKey = `thumbnails/${data.fileKey}`;
        await this.storageService.uploadBuffer(
          thumbnailFileKey,
          thumbnailBuffer,
          'image/jpeg',
        );
        thumbnailUrl = this.storageService.getPublicUrl(thumbnailFileKey);

        // Delete original unprocessed file
        await this.storageService.deleteFile(data.fileKey);

        // Delete metadata from redis
        await this.redisService.deleteUploadMetadata(userId, data.fileKey);
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

            void this.socketService.emitToUser(userId, 'message_delivered', {
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
}
