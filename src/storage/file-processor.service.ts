import { Injectable, BadRequestException } from '@nestjs/common';
import sharp from 'sharp';
import { fileTypeFromBuffer } from 'file-type';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class FileProcessorService {
  constructor(private configService: ConfigService) {}

  async validateAndProcessImage(buffer: Buffer): Promise<{
    processedBuffer: Buffer;
    thumbnailBuffer: Buffer;
    mimeType: string;
    size: number;
  }> {
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
    const maxSize = this.configService.get<number>('MAX_IMAGE_SIZE');
    if (maxSize && buffer.length > maxSize) {
      throw new BadRequestException(
        `Image size exceeds ${maxSize / 1024 / 1024}MB limit`,
      );
    }

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

    return {
      processedBuffer,
      thumbnailBuffer,
      mimeType: 'image/jpeg', // We convert everything to JPEG
      size: processedBuffer.length,
    };
  }

  async validateFile(
    buffer: Buffer,
    allowedTypes: string[],
    maxSize: number,
  ): Promise<{ mimeType: string; size: number }> {
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
