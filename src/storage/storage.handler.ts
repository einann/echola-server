import { Injectable, ForbiddenException, Inject } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { AuthenticatedSocket } from '../gateway/types/socket.types';
import {
  MediaUploadService,
  UploadedMediaResult,
} from './media-upload.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  ConfirmFileUploadEvent,
  RequestFileUploadEvent,
} from './dto/file-upload-events.dto';
import { RedisService, UploadMetadata } from '../redis';

/**
 * Handles ONLY file upload WebSocket events
 * Does NOT handle message creation - that's MessagesHandler's job
 */
@Injectable()
export class StorageHandler {
  constructor(
    private mediaUploadService: MediaUploadService,
    private redisService: RedisService,
    private prismaService: PrismaService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Handle presigned URL request
   * Returns upload URL to client - NO message creation
   */
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

    // Generate presigned URL
    const result = await this.mediaUploadService.generatePresignedUrl(
      data.fileName,
      data.mimeType,
      data.fileType,
      data.fileSize,
    );

    // Cache metadata in Redis for later confirmation
    const metadata: UploadMetadata = {
      fileName: data.fileName,
      fileType: data.fileType,
      conversationId: data.conversationId,
      fileSize: data.fileSize,
    };

    await this.redisService.setUploadMetadata(
      userId,
      result.fileKey,
      metadata,
      300,
    );

    // Send response to client
    client.emit('file:upload:url', {
      ...result,
      instructions: 'Use PUT request to upload file directly to this URL',
    });

    this.logger.log(
      { userId, fileKey: result.fileKey, conversationId: data.conversationId },
      'Presigned URL generated',
    );
  }

  /**
   * Handle upload confirmation
   * Processes the file and emits event for MessagesHandler to create message
   * NO message creation here!
   */
  async confirmUpload(
    client: AuthenticatedSocket,
    data: ConfirmFileUploadEvent,
  ): Promise<void> {
    const userId = client.data.userId;

    // Verify upload request was initiated by this user
    const uploadMetadata = await this.redisService.getUploadMetadata(
      userId,
      data.fileKey,
    );

    if (!uploadMetadata) {
      throw new ForbiddenException('Invalid or expired upload request');
    }

    if (uploadMetadata.conversationId !== data.conversationId) {
      throw new ForbiddenException('Conversation mismatch');
    }

    try {
      let mediaResult: UploadedMediaResult;

      // Process based on file type
      if (data.fileType === 'image') {
        mediaResult = await this.mediaUploadService.processUploadedImage(
          data.fileKey,
        );
      } else {
        // For non-images, just get the public URL
        mediaResult = {
          mediaUrl: this.mediaUploadService['storageService'].getPublicUrl(
            data.fileKey,
          ),
          fileSize: data.fileSize,
          processedFileKey: data.fileKey,
        };
      }

      // Clean up Redis metadata
      await this.redisService.deleteUploadMetadata(userId, data.fileKey);

      // Storage is done, now let Messages handle the rest
      // TODO: Burası komple yanlış. Burada bir şekilde mesaj kaydı / güncellemesi yapılmalı.
      client.emit('file:processed', {
        conversationId: data.conversationId,
        fileName: data.fileName,
        fileType: data.fileType,
        content: data.content || '',
        ...mediaResult,
      });

      this.logger.log(
        { userId, fileKey: data.fileKey, conversationId: data.conversationId },
        'File upload confirmed and processed',
      );
    } catch (error) {
      this.logger.error(
        { error: error as string, userId, fileKey: data.fileKey },
        'Failed to process upload',
      );

      // Emit error to client
      client.emit('file:upload:error', {
        error: 'Failed to process file upload',
        fileKey: data.fileKey,
      });
    }
  }
}
