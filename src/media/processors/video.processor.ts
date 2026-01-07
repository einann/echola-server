/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-call */
import { Injectable } from '@nestjs/common';
import { spawn } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { MediaMetadata } from '../interfaces';

export interface VideoProcessResult {
  thumbnail: Buffer;
  metadata: MediaMetadata;
}

@Injectable()
export class VideoProcessor {
  private readonly TEMP_DIR = '/tmp/video-processing';
  private readonly THUMBNAIL_TIME = '00:00:01'; // 1. saniyeden al

  async process(buffer: Buffer, mimeType: string): Promise<VideoProcessResult> {
    const jobId = randomUUID();
    const inputPath = join(this.TEMP_DIR, `${jobId}-input`);
    const outputPath = join(this.TEMP_DIR, `${jobId}-thumb.jpg`);

    try {
      await fs.mkdir(this.TEMP_DIR, { recursive: true });
      await fs.writeFile(inputPath, buffer);

      // FFprobe ile metadata al
      const metadata = await this.extractMetadata(inputPath, mimeType);

      // FFmpeg ile thumbnail üret
      await this.generateThumbnail(inputPath, outputPath);
      const thumbnail = await fs.readFile(outputPath);

      return { thumbnail, metadata };
    } finally {
      // Cleanup
      await fs.unlink(inputPath).catch(() => {});
      await fs.unlink(outputPath).catch(() => {});
    }
  }

  private extractMetadata(inputPath: string, mimeType: string): Promise<MediaMetadata> {
    return new Promise((resolve, reject) => {
      const ffprobe = spawn('ffprobe', [
        '-v',
        'quiet',
        '-print_format',
        'json',
        '-show_format',
        '-show_streams',
        inputPath,
      ]);

      let output = '';
      ffprobe.stdout.on('data', (data) => (output += data));
      ffprobe.on('close', (code) => {
        if (code !== 0) {
          reject(new Error('FFprobe failed'));
          return;
        }

        const data = JSON.parse(output);
        const videoStream = data.streams.find((s) => s.codec_type === 'video');

        resolve({
          width: videoStream?.width,
          height: videoStream?.height,
          duration: parseFloat(data.format?.duration || '0'),
          mimeType,
          size: parseInt(data.format?.size || '0'),
        });
      });
    });
  }

  private generateThumbnail(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const ffmpeg = spawn('ffmpeg', [
        '-i',
        inputPath,
        '-ss',
        this.THUMBNAIL_TIME,
        '-vframes',
        '1',
        '-vf',
        'scale=200:200:force_original_aspect_ratio=increase,crop=200:200',
        '-y',
        outputPath,
      ]);

      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error('FFmpeg failed'));
        }
      });
    });
  }
}
