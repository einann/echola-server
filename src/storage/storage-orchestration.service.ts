import { Injectable, BadRequestException } from '@nestjs/common';
import { StorageService } from './storage.service';
import { StorageValidationService } from './storage-validation.service';
import { FileProcessorService } from './file-processor.service';
import { MessagesService } from '../messages/messages.service';
import {
  UploadRequest,
  UploadConfirmation,
  DirectUploadData,
  ProcessedUpload,
} from './types/storage.types';

@Injectable()
export class StorageOrchestrationService {
  constructor(
    private storageService: StorageService,
    private storageValidationService: StorageValidationService,
    private fileProcessorService: FileProcessorService,
    private messagesService: MessagesService,
  ) {}

  /**
   * Generate presigned URL for client-side upload
   */
  async requestPresignedUrl(request: UploadRequest): Promise<{
    uploadUrl: string;
    fileKey: string;
    expiresIn: number;
  }> {
    // Validate file
    this.storageValidationService.validateFileRequest(
      request.fileType,
      request.fileSize,
      request.mimeType,
    );

    // Generate unique file key
    const fileKey = this.storageValidationService.generateFileKey(
      request.fileName,
    );

    // Generate presigned upload URL (5 minutes expiry)
    const uploadUrl = await this.storageService.generatePresignedUploadUrl(
      fileKey,
      request.mimeType,
      300,
    );

    return {
      uploadUrl,
      fileKey,
      expiresIn: 300,
    };
  }

  /**
   * Process and confirm upload after client uploads to presigned URL
   */
  async confirmAndProcessUpload(
    userId: string,
    confirmation: UploadConfirmation,
  ) {
    let mediaUrl = this.storageService.getPublicUrl(confirmation.fileKey);
    let thumbnailUrl: string | undefined;
    let processedFileSize: number | undefined;

    // Process images: download, compress, create thumbnail, re-upload
    if (confirmation.fileType === 'image') {
      const processed = await this.processUploadedImage(confirmation.fileKey);
      mediaUrl = processed.mediaUrl;
      thumbnailUrl = processed.thumbnailUrl;
      processedFileSize = processed.fileSize;
    }

    // Create message with media
    const message = await this.messagesService.sendMessage(userId, {
      conversationId: confirmation.conversationId,
      content: '',
      contentType: confirmation.fileType,
      mediaUrl,
      thumbnailUrl,
      fileName: confirmation.fileName,
      fileSize: processedFileSize,
    });

    return message;
  }

  /**
   * Handle direct file upload (buffer already in memory)
   */
  async processDirectUpload(data: DirectUploadData) {
    let mediaUrl: string;
    let thumbnailUrl: string | undefined;
    let fileSize = data.file.size;

    if (data.fileType === 'image') {
      const processed = await this.processImageBuffer(
        data.file.buffer,
        data.file.originalname,
      );
      mediaUrl = processed.mediaUrl;
      thumbnailUrl = processed.thumbnailUrl;
      fileSize = processed.fileSize;
    } else {
      mediaUrl = await this.uploadNonImageFile(data.file, data.fileType);
    }

    // Create message with media
    const message = await this.messagesService.sendMessage(data.userId, {
      conversationId: data.conversationId,
      content: '',
      contentType: data.fileType,
      mediaUrl,
      thumbnailUrl,
      fileName: data.file.originalname,
      fileSize,
    });

    return message;
  }

  /**
   * Process an image that's already uploaded to storage
   */
  private async processUploadedImage(
    fileKey: string,
  ): Promise<ProcessedUpload> {
    try {
      // Download the uploaded file from S3
      const downloadUrl =
        await this.storageService.generatePresignedDownloadUrl(fileKey);
      const response = await fetch(downloadUrl);
      const buffer = Buffer.from(await response.arrayBuffer());

      // Process image (compress, resize, create thumbnail)
      const { processedBuffer, thumbnailBuffer } =
        await this.fileProcessorService.validateAndProcessImage(buffer);

      // Upload processed image
      const processedFileKey = `processed/${fileKey}`;
      await this.storageService.uploadBuffer(
        processedFileKey,
        processedBuffer,
        'image/jpeg',
      );
      const mediaUrl = this.storageService.getPublicUrl(processedFileKey);

      // Upload thumbnail
      const thumbnailFileKey = `thumbnails/${fileKey}`;
      await this.storageService.uploadBuffer(
        thumbnailFileKey,
        thumbnailBuffer,
        'image/jpeg',
      );
      const thumbnailUrl = this.storageService.getPublicUrl(thumbnailFileKey);

      // Delete original unprocessed file
      await this.storageService.deleteFile(fileKey);

      return {
        mediaUrl,
        thumbnailUrl,
        fileSize: processedBuffer.length,
        processedFileKey,
        thumbnailFileKey,
      };
    } catch (error) {
      console.error('Error processing image:', error);
      throw new BadRequestException('Failed to process image');
    }
  }

  /**
   * Process an image from a buffer (direct upload)
   */
  private async processImageBuffer(
    buffer: Buffer,
    originalName: string,
  ): Promise<ProcessedUpload> {
    const { processedBuffer, thumbnailBuffer, mimeType } =
      await this.fileProcessorService.validateAndProcessImage(buffer);

    // Upload processed image
    const imageKey =
      this.storageValidationService.generateFileKey(originalName);
    await this.storageService.uploadBuffer(imageKey, processedBuffer, mimeType);
    const mediaUrl = this.storageService.getPublicUrl(imageKey);

    // Upload thumbnail
    const thumbnailKey = `thumbnails/${imageKey}`;
    await this.storageService.uploadBuffer(
      thumbnailKey,
      thumbnailBuffer,
      mimeType,
    );
    const thumbnailUrl = this.storageService.getPublicUrl(thumbnailKey);

    return {
      mediaUrl,
      thumbnailUrl,
      fileSize: processedBuffer.length,
      processedFileKey: imageKey,
      thumbnailFileKey: thumbnailKey,
    };
  }

  /**
   * Upload non-image files (video, audio, document)
   */
  private async uploadNonImageFile(
    file: Express.Multer.File,
    fileType: 'video' | 'audio' | 'document',
  ): Promise<string> {
    // Validate file
    const allowedTypes =
      this.storageValidationService.getAllowedMimeTypes(fileType);
    const maxSize = this.storageValidationService.getMaxFileSize(fileType);

    await this.fileProcessorService.validateFile(
      file.buffer,
      allowedTypes,
      maxSize,
    );

    // Upload file
    const fileKey = this.storageValidationService.generateFileKey(
      file.originalname,
    );
    await this.storageService.uploadBuffer(fileKey, file.buffer, file.mimetype);

    return this.storageService.getPublicUrl(fileKey);
  }
}
