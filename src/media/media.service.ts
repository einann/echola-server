/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StorageService } from '../storage/storage.service';
import { StorageBucket } from '../storage/enums';
import { ImageProcessor, VideoProcessor } from './processors';
import { MediaType } from './enums';
import { ProcessedMedia } from './interfaces';
import { MediaUploadRequestDto, MediaUploadConfirmDto } from './dto';
import { PresignedUrlResult, UploadResult } from '../storage/interfaces';

@Injectable()
export class MediaService {
  constructor(
    private readonly storageService: StorageService,
    private readonly imageProcessor: ImageProcessor,
    private readonly videoProcessor: VideoProcessor,
  ) {}

  /**
   * Yükleme için presigned URL üretir
   */
  async requestUploadUrl(dto: MediaUploadRequestDto): Promise<PresignedUrlResult> {
    const fileKey = this.generateTempKey(dto.fileName);

    return this.storageService.generatePresignedUploadUrl(
      StorageBucket.TEMP,
      fileKey,
      dto.mimeType,
    );
  }

  /**
   * Yüklenen dosyayı işler ve kalıcı storage'a taşır
   */
  async confirmUpload(dto: MediaUploadConfirmDto): Promise<ProcessedMedia> {
    // 1. Temp'ten dosyayı al
    const buffer = await this.storageService.getBuffer(StorageBucket.TEMP, dto.fileKey);

    // 2. Media tipine göre işle
    const processed = await this.processMedia(buffer, dto.mediaType);

    // 3. İşlenmiş dosyaları yükle
    const result = await this.uploadProcessedMedia(processed, dto.conversationId, dto.mediaType);

    // 4. Temp dosyayı sil
    await this.storageService.delete(StorageBucket.TEMP, dto.fileKey);

    return result;
  }

  /**
   * Download URL üretir (client'ın dosyayı indirmesi için)
   */
  async getDownloadUrl(bucket: StorageBucket, fileKey: string): Promise<string> {
    return this.storageService.generatePresignedDownloadUrl(bucket, fileKey);
  }

  private async processMedia(
    buffer: Buffer,
    mediaType: MediaType,
  ): Promise<{
    mainBuffer: Buffer;
    thumbnailBuffer?: Buffer;
    metadata: any;
  }> {
    switch (mediaType) {
      case MediaType.IMAGE: {
        const result = await this.imageProcessor.process(buffer);
        return {
          mainBuffer: result.optimized,
          thumbnailBuffer: result.thumbnail,
          metadata: result.metadata,
        };
      }

      case MediaType.VIDEO: {
        const result = await this.videoProcessor.process(buffer, 'video/mp4');
        return {
          mainBuffer: buffer, // Video'yu olduğu gibi bırak (veya transcode et)
          thumbnailBuffer: result.thumbnail,
          metadata: result.metadata,
        };
      }

      case MediaType.AUDIO:
        return {
          mainBuffer: buffer,
          metadata: { mimeType: 'audio/mpeg', size: buffer.length },
        };

      case MediaType.DOCUMENT:
        return {
          mainBuffer: buffer,
          metadata: {
            mimeType: 'application/octet-stream',
            size: buffer.length,
          },
        };

      default:
        // eslint-disable-next-line @typescript-eslint/restrict-template-expressions
        throw new Error(`Unsupported media type: ${mediaType}`);
    }
  }

  private async uploadProcessedMedia(
    processed: { mainBuffer: Buffer; thumbnailBuffer?: Buffer; metadata: any },
    conversationId: string,
    mediaType: MediaType,
  ): Promise<ProcessedMedia> {
    const baseKey = `${conversationId}/${randomUUID()}`;
    const bucket = this.getBucketForMediaType(mediaType);

    // Ana dosyayı yükle
    const mainResult = await this.storageService.uploadBuffer(
      bucket,
      `${baseKey}.${this.getExtension(processed.metadata.mimeType)}`,
      processed.mainBuffer,
      processed.metadata.mimeType,
    );

    // Thumbnail varsa yükle
    let thumbnailResult: UploadResult;
    if (processed.thumbnailBuffer) {
      thumbnailResult = await this.storageService.uploadBuffer(
        StorageBucket.THUMBNAILS,
        `${baseKey}_thumb.jpg`,
        processed.thumbnailBuffer,
        'image/jpeg',
      );
    }

    return {
      originalKey: mainResult.key,
      originalUrl: mainResult.url,
      originalSize: mainResult.size,
      // @ts-expect-error 'TODO: düzeltilecek'
      thumbnailKey: thumbnailResult?.key,
      // @ts-expect-error 'TODO: düzeltilecek'
      thumbnailUrl: thumbnailResult?.url,
      metadata: processed.metadata,
    };
  }

  private generateTempKey(fileName: string): string {
    const ext = fileName.split('.').pop();
    return `${randomUUID()}.${ext}`;
  }

  private getBucketForMediaType(mediaType: MediaType): StorageBucket {
    return mediaType === MediaType.DOCUMENT ? StorageBucket.DOCUMENTS : StorageBucket.MEDIA;
  }

  private getExtension(mimeType: string): string {
    const map: Record<string, string> = {
      'image/jpeg': 'jpg',
      'image/png': 'png',
      'image/webp': 'webp',
      'video/mp4': 'mp4',
      'audio/mpeg': 'mp3',
    };
    return map[mimeType] || 'bin';
  }
}
