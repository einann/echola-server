import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from 'src/config/env.validation';

type FileType = 'image' | 'video' | 'audio' | 'document';

interface FileTypeConfig {
  mimeTypes: string[];
  maxSize: number;
}

@Injectable()
export class StorageValidationService {
  private readonly fileTypeConfigs: Record<FileType, FileTypeConfig>;

  constructor(private configService: ConfigService<EnvironmentVariables>) {
    this.fileTypeConfigs = {
      image: {
        mimeTypes: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'],
        maxSize:
          this.configService.get('MAX_IMAGE_SIZE', { infer: true }) || 10485760, // 10MB
      },
      video: {
        mimeTypes: ['video/mp4', 'video/quicktime', 'video/webm'],
        maxSize:
          this.configService.get('MAX_VIDEO_SIZE', { infer: true }) ||
          104857600, // 100MB
      },
      audio: {
        mimeTypes: ['audio/mpeg', 'audio/mp4', 'audio/wav', 'audio/webm'],
        maxSize:
          this.configService.get('MAX_DOCUMENT_SIZE', { infer: true }) ||
          26214400, // 25MB
      },
      document: {
        mimeTypes: [
          'application/pdf',
          'application/msword',
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          'application/vnd.openxmlformats-officedocument.spreadsheetml.document',
        ],
        maxSize:
          this.configService.get('MAX_DOCUMENT_SIZE', { infer: true }) ||
          26214400, // 25MB
      },
    };
  }

  /**
   * Validates file type and size, throws BadRequestException if invalid
   */
  validateFileRequest(
    fileType: string,
    fileSize: number,
    mimeType: string,
  ): void {
    // Type guard to ensure fileType is valid
    if (!this.isValidFileType(fileType)) {
      throw new BadRequestException(`Invalid file type: ${fileType}`);
    }

    const config = this.fileTypeConfigs[fileType];

    if (!config.mimeTypes.includes(mimeType)) {
      throw new BadRequestException(
        `Invalid MIME type for ${fileType}. Allowed types: ${config.mimeTypes.join(', ')}`,
      );
    }

    if (fileSize > config.maxSize) {
      throw new BadRequestException(
        `File size exceeds ${config.maxSize / 1024 / 1024}MB limit for ${fileType}`,
      );
    }
  }

  /**
   * Get allowed MIME types for a file type
   */
  getAllowedMimeTypes(fileType: string): string[] {
    if (!this.isValidFileType(fileType)) {
      return [];
    }
    return this.fileTypeConfigs[fileType].mimeTypes;
  }

  /**
   * Get max file size for a file type
   */
  getMaxFileSize(fileType: string): number {
    if (!this.isValidFileType(fileType)) {
      return 10485760; // 10MB default
    }
    return this.fileTypeConfigs[fileType].maxSize;
  }

  /**
   * Generate a unique file key with timestamp and random string
   */
  generateFileKey(originalFileName: string): string {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substring(7);
    const extension = originalFileName.split('.').pop() || 'bin';
    return `uploads/${timestamp}-${randomString}.${extension}`;
  }

  /**
   * Type guard to check if string is a valid FileType
   */
  private isValidFileType(fileType: string): fileType is FileType {
    return ['image', 'video', 'audio', 'document'].includes(fileType);
  }

  /**
   * Get human-readable size limit for a file type
   */
  getMaxFileSizeFormatted(fileType: string): string {
    const bytes = this.getMaxFileSize(fileType);
    const mb = bytes / 1024 / 1024;
    return `${mb}MB`;
  }
}
