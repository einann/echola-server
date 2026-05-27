/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import { Injectable } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  CreateBucketCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageBucket } from './enums';
import { PresignedUrlResult, UploadResult } from './interfaces';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from 'src/config/env.validation';

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;

  constructor(
    private readonly logger: Logger,
    private configService: ConfigService<EnvironmentVariables>,
  ) {
    this.s3Client = new S3Client({
      endpoint: this.configService.get('S3_ENDPOINT', { infer: true })!,
      region: this.configService.get('S3_REGION', { infer: true })!,
      credentials: {
        accessKeyId: this.configService.get('S3_ACCESS_KEY', { infer: true })!,
        secretAccessKey: this.configService.get('S3_SECRET_KEY', {
          infer: true,
        })!,
      },
      forcePathStyle: true,
    });
  }

  async onModuleInit(): Promise<void> {
    const buckets = Object.values(StorageBucket);

    for (const bucket of buckets) {
      await this.ensureBucketExists(bucket);
    }
  }

  private async ensureBucketExists(bucket: string): Promise<void> {
    try {
      await this.s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
    } catch (error: any) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        await this.s3Client.send(new CreateBucketCommand({ Bucket: bucket }));
        this.logger.log(`Bucket created: ${bucket}`);
      } else {
        throw error;
      }
    }
  }

  async generatePresignedUploadUrl(
    bucket: StorageBucket,
    fileKey: string,
    contentType: string,
    expiresIn = 3600,
  ): Promise<PresignedUrlResult> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: fileKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn });

    return {
      uploadUrl,
      fileKey,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
    };
  }

  async generatePresignedDownloadUrl(
    bucket: StorageBucket,
    fileKey: string,
    expiresIn = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: fileKey,
    });

    return getSignedUrl(this.s3Client, command, { expiresIn });
  }

  /**
   * Returns a short-lived signed URL for the given avatar key, or null if no
   * key is set. The key is the stable identifier stored in the DB; the URL is
   * regenerated on every read because it expires.
   */
  async getAvatarUrl(avatarKey: string | null | undefined): Promise<string | null> {
    if (!avatarKey) return null;
    return this.generatePresignedDownloadUrl(StorageBucket.MEDIA, avatarKey, 3600);
  }

  async uploadBuffer(
    bucket: StorageBucket,
    fileKey: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<UploadResult> {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: fileKey,
      Body: buffer,
      ContentType: contentType,
    });

    await this.s3Client.send(command);

    return {
      key: fileKey,
      bucket,
      url: this.buildPublicUrl(bucket, fileKey),
      size: buffer.length,
    };
  }

  async getBuffer(bucket: StorageBucket, fileKey: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: fileKey,
    });

    const response = await this.s3Client.send(command);
    const chunks: Uint8Array[] = [];

    for await (const chunk of response.Body as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }

  async delete(bucket: StorageBucket, fileKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: fileKey,
    });

    await this.s3Client.send(command);
  }

  async deleteMany(bucket: StorageBucket, fileKeys: string[]): Promise<void> {
    await Promise.all(fileKeys.map((key) => this.delete(bucket, key)));
  }

  private buildPublicUrl(bucket: StorageBucket, fileKey: string): string {
    return `${process.env.S3_ENDPOINT}/${bucket}/${fileKey}`;
  }

  /**
   * Check if storage is healthy by verifying bucket accessibility
   */
  async checkHealth(): Promise<boolean> {
    const bucket = this.configService.get('S3_BUCKET_NAME', { infer: true })!;
    await this.s3Client.send(new HeadBucketCommand({ Bucket: bucket }));
    return true;
  }
}
