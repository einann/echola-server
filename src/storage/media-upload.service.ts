import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { StorageService } from './storage.service';
import { FileProcessorService } from './file-processor.service';
import { StorageValidationService } from './storage-validation.service';

export interface UploadedMediaResult {
  mediaUrl: string;
  thumbnailUrl?: string;
  fileSize: number;
  processedFileKey: string;
  thumbnailFileKey?: string;
}

@Injectable()
export class MediaUploadService {
  constructor(
    private storageService: StorageService,
    private storageValidationService: StorageValidationService,
    private fileProcessorService: FileProcessorService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Generate presigned URL for client-side upload
   * Returns URL and metadata for client to use
   */
  async generatePresignedUrl(
    fileName: string,
    mimeType: string,
    fileType: string,
    fileSize: number,
  ): Promise<{
    uploadUrl: string;
    fileKey: string;
    expiresIn: number;
  }> {
    // Validate file request
    this.storageValidationService.validateFileRequest(
      fileType,
      fileSize,
      mimeType,
    );

    // Generate unique file key
    const fileKey = this.storageValidationService.generateFileKey(fileName);

    // Generate presigned upload URL (5 minutes expiry)
    const uploadUrl = await this.storageService.generatePresignedUploadUrl(
      fileKey,
      mimeType,
      300,
    );

    this.logger.log(
      { fileKey, fileType, fileSize },
      'Generated presigned upload URL',
    );

    return {
      uploadUrl,
      fileKey,
      expiresIn: 300,
    };
  }

  /**
   * Process uploaded image: download, compress, create thumbnail, re-upload
   * Returns URLs and metadata - does NOT create messages
   */
  async processUploadedImage(fileKey: string): Promise<UploadedMediaResult> {
    try {
      this.logger.log({ fileKey }, 'Processing uploaded image');

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

      this.logger.log(
        { processedFileKey, thumbnailFileKey },
        'Image processing complete',
      );

      return {
        mediaUrl,
        thumbnailUrl,
        fileSize: processedBuffer.length,
        processedFileKey,
        thumbnailFileKey,
      };
    } catch (error) {
      this.logger.error(
        { error: error as string, fileKey },
        'Failed to process image',
      );
      throw new BadRequestException('Failed to process image');
    }
  }

  /**
   * Process image from buffer (for direct uploads)
   * Returns URLs and metadata - does NOT create messages
   */
  async processImageBuffer(
    buffer: Buffer,
    originalName: string,
  ): Promise<UploadedMediaResult> {
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
   * Upload non-image file (video, audio, document)
   * Returns URL and metadata - does NOT create messages
   */
  async uploadFile(
    buffer: Buffer,
    originalName: string,
    fileType: 'video' | 'audio' | 'document',
  ): Promise<UploadedMediaResult> {
    // Validate file
    const allowedTypes =
      this.storageValidationService.getAllowedMimeTypes(fileType);
    const maxSize = this.storageValidationService.getMaxFileSize(fileType);

    const { mimeType, size } = await this.fileProcessorService.validateFile(
      buffer,
      allowedTypes,
      maxSize,
    );

    // Upload file
    const fileKey = this.storageValidationService.generateFileKey(originalName);
    await this.storageService.uploadBuffer(fileKey, buffer, mimeType);
    const mediaUrl = this.storageService.getPublicUrl(fileKey);

    return {
      mediaUrl,
      fileSize: size,
      processedFileKey: fileKey,
    };
  }

  /**
   * Delete media files (main file and thumbnail if exists)
   */
  async deleteMediaFiles(
    mediaUrl: string,
    thumbnailUrl?: string,
  ): Promise<void> {
    try {
      // Extract file key from URL
      const mediaFileKey = this.extractFileKeyFromUrl(mediaUrl);
      await this.storageService.deleteFile(mediaFileKey);

      if (thumbnailUrl) {
        const thumbnailFileKey = this.extractFileKeyFromUrl(thumbnailUrl);
        await this.storageService.deleteFile(thumbnailFileKey);
      }

      this.logger.log({ mediaFileKey }, 'Media files deleted');
    } catch (error) {
      this.logger.error(
        { error: error as string, mediaUrl },
        'Failed to delete media files',
      );
      // Don't throw - deletion failure shouldn't block message deletion
    }
  }

  /**
   * Extract file key from public URL
   * e.g., "http://localhost:9000/echola-media/processed/file.jpg" → "processed/file.jpg"
   */
  private extractFileKeyFromUrl(url: string): string {
    const urlParts = url.split('/');
    // Find bucket name index and return everything after it
    const bucketIndex = urlParts.findIndex((part) =>
      part.includes('echola-media'),
    );
    return urlParts.slice(bucketIndex + 1).join('/');
  }
}
