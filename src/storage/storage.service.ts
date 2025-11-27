// src/storage/storage.service.ts
import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface PresignedUploadResult {
  uploadUrl: string;
  fileKey: string;
}

/**
 * Low-level S3/MinIO storage operations
 * This service ONLY handles direct interactions with the storage backend
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private s3Client: S3Client;
  private bucketName: string;
  private s3Endpoint: string;

  constructor(private configService: ConfigService) {
    this.bucketName = this.configService.get('S3_BUCKET_NAME') as string;
    this.s3Endpoint = this.configService.get('S3_ENDPOINT') as string;

    this.s3Client = new S3Client({
      endpoint: this.s3Endpoint,
      region: this.configService.get('S3_REGION') as string,
      credentials: {
        accessKeyId: this.configService.get('S3_ACCESS_KEY') as string,
        secretAccessKey: this.configService.get('S3_SECRET_KEY') as string,
      },
      forcePathStyle: true, // Required for MinIO
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucketExists();
  }

  /**
   * Ensure the S3 bucket exists, create if it doesn't
   */
  private async ensureBucketExists(): Promise<void> {
    try {
      await this.s3Client.send(
        new HeadBucketCommand({ Bucket: this.bucketName }),
      );
      this.logger.log(`✅ S3 bucket "${this.bucketName}" exists`);
    } catch (error) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
      if (error.name === 'NotFound') {
        this.logger.log(`📦 Creating S3 bucket "${this.bucketName}"...`);
        await this.s3Client.send(
          new CreateBucketCommand({ Bucket: this.bucketName }),
        );
        this.logger.log(`✅ S3 bucket "${this.bucketName}" created`);
      } else {
        this.logger.error('Error checking bucket:', error);
        throw error;
      }
    }
  }

  /**
   * Generate a presigned URL for client-side upload
   * @param fileKey - The S3 object key (path) where file will be stored
   * @param contentType - MIME type of the file
   * @param expiresIn - URL expiration time in seconds (default: 5 minutes)
   */
  async generatePresignedUploadUrl(
    fileKey: string,
    contentType: string,
    expiresIn = 300,
  ): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
      ContentType: contentType,
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Generate a presigned URL for downloading/viewing a file
   * @param fileKey - The S3 object key (path) of the file
   * @param expiresIn - URL expiration time in seconds (default: 1 hour)
   */
  async generatePresignedDownloadUrl(
    fileKey: string,
    expiresIn = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Upload a file directly from a buffer (server-side upload)
   * @param fileKey - The S3 object key (path) where file will be stored
   * @param buffer - File contents as a buffer
   * @param contentType - MIME type of the file
   */
  async uploadBuffer(
    fileKey: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fileKey,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    this.logger.log(`Uploaded file: ${fileKey}`);
  }

  /**
   * Download a file as a buffer
   * @param fileKey - The S3 object key (path) of the file
   */
  async downloadBuffer(fileKey: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
    });

    const response = await this.s3Client.send(command);
    const stream = response.Body as ReadableStream;

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    return Buffer.concat(chunks);
  }

  /**
   * Delete a file from storage
   * @param fileKey - The S3 object key (path) of the file to delete
   */
  async deleteFile(fileKey: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: fileKey,
      }),
    );

    this.logger.log(`Deleted file: ${fileKey}`);
  }

  /**
   * Get the public URL for a file (works if bucket has public read policy)
   * For private buckets, use generatePresignedDownloadUrl instead
   * @param fileKey - The S3 object key (path) of the file
   */
  getPublicUrl(fileKey: string): string {
    return `${this.s3Endpoint}/${this.bucketName}/${fileKey}`;
  }

  /**
   * Check if a file exists in storage
   * @param fileKey - The S3 object key (path) of the file
   */
  async fileExists(fileKey: string): Promise<boolean> {
    try {
      await this.s3Client.send(
        new HeadBucketCommand({ Bucket: this.bucketName }),
      );
      return true;
    } catch {
      return false;
    }
  }
}
