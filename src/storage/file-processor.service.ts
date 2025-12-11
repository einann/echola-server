import { Injectable, BadRequestException, Inject } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from '../config/env.validation';

export interface ProcessedImageResult {
  processedBuffer: Buffer;
  thumbnailBuffer: Buffer;
  mimeType: string;
  size: number;
}

export interface FileValidationResult {
  mimeType: string;
  size: number;
}

@Injectable()
export class FileProcessorService {
  constructor(
    private configService: ConfigService<EnvironmentVariables>,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  /**
   * Validate and process an image: compress, resize, generate thumbnail
   * Pure function - no side effects, no storage operations
   */
  async validateAndProcessImage(buffer: Buffer): Promise<ProcessedImageResult> {
    // Validate file type
    const fileType = await fileTypeFromBuffer(buffer);

    if (
      !fileType ||
      !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(
        fileType.mime,
      )
    ) {
      throw new BadRequestException('Invalid image file type');
    }

    // Validate size
    const maxSize = this.configService.get('MAX_IMAGE_SIZE', { infer: true });
    if (maxSize && buffer.length > maxSize) {
      throw new BadRequestException(
        `Image size exceeds ${maxSize / 1024 / 1024}MB limit`,
      );
    }

    this.logger.log({ originalSize: buffer.length }, 'Processing image');

    try {
      // Process image: compress and resize if too large
      const processedBuffer = await sharp(buffer)
        .resize(2048, 2048, {
          fit: 'inside',
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85, progressive: true })
        .toBuffer();

      // Generate thumbnail (400x400)
      const thumbnailBuffer = await sharp(buffer)
        .resize(400, 400, {
          fit: 'cover',
        })
        .jpeg({ quality: 80 })
        .toBuffer();

      this.logger.log(
        {
          originalSize: buffer.length,
          processedSize: processedBuffer.length,
          thumbnailSize: thumbnailBuffer.length,
          compressionRatio: (
            (1 - processedBuffer.length / buffer.length) *
            100
          ).toFixed(2),
        },
        'Image processed successfully',
      );

      return {
        processedBuffer,
        thumbnailBuffer,
        mimeType: 'image/jpeg', // We convert everything to JPEG
        size: processedBuffer.length,
      };
    } catch (error) {
      this.logger.error({ error: error as string }, 'Failed to process image'); // TODO, global http exception filter should handle this, will look
      throw new BadRequestException('Failed to process image');
    }
  }

  /**
   * Validate file (non-image files)
   * Pure function - just validation, no side effects
   */
  async validateFile(
    buffer: Buffer,
    allowedTypes: string[],
    maxSize: number,
  ): Promise<FileValidationResult> {
    // Validate file type from content (not just extension)
    const fileType = await fileTypeFromBuffer(buffer);

    if (!fileType || !allowedTypes.includes(fileType.mime)) {
      throw new BadRequestException(
        `Invalid file type. Allowed: ${allowedTypes.join(', ')}`,
      );
    }

    // Validate size
    if (buffer.length > maxSize) {
      throw new BadRequestException(
        `File size exceeds ${maxSize / 1024 / 1024}MB limit`,
      );
    }

    return {
      mimeType: fileType.mime,
      size: buffer.length,
    };
  }
}
