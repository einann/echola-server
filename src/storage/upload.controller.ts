import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  BadRequestException,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { StorageService } from './storage.service';
import { FileProcessorService } from './file-processor.service';
import { MessagesService } from '../messages/messages.service';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';
import { ConfigService } from '@nestjs/config';

@Controller('upload')
@UseGuards(JwtAccessGuard)
export class UploadController {
  constructor(
    private storageService: StorageService,
    private fileProcessorService: FileProcessorService,
    private messagesService: MessagesService,
    private configService: ConfigService,
  ) {}

  // ============================================
  // Presigned URL Flow (Recommended)
  // ============================================

  @Post('request-url')
  async requestUploadUrl(@Request() req, @Body() dto: RequestUploadUrlDto) {
    // Validate file type and size limits
    this.validateFileRequest(dto.fileType, dto.fileSize, dto.mimeType);

    // Generate presigned upload URL
    const { uploadUrl, fileKey } = await this.storageService.generateUploadUrl(
      dto.fileName,
      dto.mimeType,
      300, // 5 minutes expiry
    );

    return {
      uploadUrl,
      fileKey,
      expiresIn: 300,
      instructions: 'Use PUT request to upload file directly to this URL',
    };
  }

  @Post('confirm')
  async confirmUpload(@Request() req, @Body() dto: ConfirmUploadDto) {
    const userId = req.user.userId;

    let mediaUrl = this.storageService.getPublicUrl(dto.fileKey);
    let thumbnailUrl: string | undefined;
    let processedFileKey: string | undefined;
    let thumbnailFileKey: string | undefined;

    // For images, we need to process and create thumbnails
    // Client uploads original → we download, process, re-upload optimized version
    if (dto.fileType === 'image') {
      try {
        // Download the uploaded file from S3
        const downloadUrl = await this.storageService.generateDownloadUrl(
          dto.fileKey,
        );
        const response = await fetch(downloadUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

        // Process image (compress, resize, create thumbnail)
        const { processedBuffer, thumbnailBuffer } =
          await this.fileProcessorService.validateAndProcessImage(buffer);

        // Upload processed image
        processedFileKey = `processed/${dto.fileKey}`;
        await this.storageService.uploadFile(
          processedFileKey,
          processedBuffer,
          'image/jpeg',
        );
        mediaUrl = this.storageService.getPublicUrl(processedFileKey);

        // Upload thumbnail
        thumbnailFileKey = `thumbnails/${dto.fileKey}`;
        await this.storageService.uploadFile(
          thumbnailFileKey,
          thumbnailBuffer,
          'image/jpeg',
        );
        thumbnailUrl = this.storageService.getPublicUrl(thumbnailFileKey);

        // Delete original unprocessed file
        await this.storageService.deleteFile(dto.fileKey);
      } catch (error) {
        console.error('Error processing image:', error);
        throw new BadRequestException('Failed to process image');
      }
    }

    // Create message with media
    const message = await this.messagesService.sendMessage(userId, {
      conversationId: dto.conversationId,
      content: '',
      contentType: dto.fileType,
      mediaUrl,
      thumbnailUrl,
      fileName: dto.fileName,
      fileSize: undefined, // We don't track processed size
    });

    return {
      success: true,
      message,
    };
  }

  // ============================================
  // Direct Upload Flow (Alternative/Fallback)
  // ============================================

  @Post('direct')
  @UseInterceptors(FileInterceptor('file'))
  async directUpload(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
    @Body('conversationId') conversationId: string,
    @Body('fileType') fileType: 'image' | 'video' | 'audio' | 'document',
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const userId = req.user.userId;
    let mediaUrl: string;
    let thumbnailUrl: string | undefined;
    let fileSize = file.size;

    // Process based on file type
    if (fileType === 'image') {
      const { processedBuffer, thumbnailBuffer, mimeType } =
        await this.fileProcessorService.validateAndProcessImage(file.buffer);

      // Upload processed image
      const imageKey = this.generateFileKey(file.originalname);
      mediaUrl = await this.storageService.uploadFile(
        imageKey,
        processedBuffer,
        mimeType,
      );
      fileSize = processedBuffer.length;

      // Upload thumbnail
      const thumbnailKey = `thumbnails/${imageKey}`;
      thumbnailUrl = await this.storageService.uploadFile(
        thumbnailKey,
        thumbnailBuffer,
        mimeType,
      );
    } else {
      // For non-images, validate and upload directly
      const allowedTypes = this.getAllowedMimeTypes(fileType);
      const maxSize = this.getMaxFileSize(fileType);

      await this.fileProcessorService.validateFile(
        file.buffer,
        allowedTypes,
        maxSize,
      );

      const fileKey = this.generateFileKey(file.originalname);
      mediaUrl = await this.storageService.uploadFile(
        fileKey,
        file.buffer,
        file.mimetype,
      );
    }

    // Create message with media
    const message = await this.messagesService.sendMessage(userId, {
      conversationId,
      content: '',
      contentType: fileType,
      mediaUrl,
      thumbnailUrl,
      fileName: file.originalname,
      fileSize,
    });

    return {
      success: true,
      message,
    };
  }

  // ============================================
  // Helper Methods
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
      image: this.configService.get<number>('MAX_IMAGE_SIZE'),
      video: this.configService.get<number>('MAX_VIDEO_SIZE'),
      audio: this.configService.get<number>('MAX_DOCUMENT_SIZE'),
      document: this.configService.get<number>('MAX_DOCUMENT_SIZE'),
    };

    return sizes[fileType] || 10485760; // 10MB default
  }

  private generateFileKey(originalFileName: string): string {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(7);
    const extension = originalFileName.split('.').pop();
    return `uploads/${timestamp}-${randomString}.${extension}`;
  }
}
