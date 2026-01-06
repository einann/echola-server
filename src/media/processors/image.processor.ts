import { Injectable } from '@nestjs/common';
import sharp from 'sharp';
import { MediaMetadata } from '../interfaces';

export interface ImageProcessResult {
  optimized: Buffer;
  thumbnail: Buffer;
  metadata: MediaMetadata;
}

@Injectable()
export class ImageProcessor {
  private readonly THUMBNAIL_SIZE = 200;
  private readonly MAX_DIMENSION = 1920;
  private readonly QUALITY = 80;

  async process(buffer: Buffer): Promise<ImageProcessResult> {
    const image = sharp(buffer);
    const originalMetadata = await image.metadata();

    // Metadata çıkar
    const metadata: MediaMetadata = {
      width: originalMetadata.width,
      height: originalMetadata.height,
      mimeType: `image/${originalMetadata.format}`,
      size: buffer.length,
    };

    // Optimize et (boyut sınırla, kalite ayarla)
    const optimized = await this.optimize(buffer, originalMetadata);

    // Thumbnail üret
    const thumbnail = await this.generateThumbnail(buffer);

    return { optimized, thumbnail, metadata };
  }

  private async optimize(
    buffer: Buffer,
    metadata: sharp.Metadata,
  ): Promise<Buffer> {
    let pipeline = sharp(buffer);

    // Boyut sınırlama
    if (
      metadata.width > this.MAX_DIMENSION ||
      metadata.height > this.MAX_DIMENSION
    ) {
      pipeline = pipeline.resize(this.MAX_DIMENSION, this.MAX_DIMENSION, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Format ve kalite
    return pipeline
      .jpeg({ quality: this.QUALITY, progressive: true })
      .toBuffer();
  }

  private async generateThumbnail(buffer: Buffer): Promise<Buffer> {
    return sharp(buffer)
      .resize(this.THUMBNAIL_SIZE, this.THUMBNAIL_SIZE, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 70 })
      .toBuffer();
  }
}
