import { Injectable } from '@nestjs/common';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { StorageBucket } from './enums';
import { PresignedUrlResult, UploadResult } from './interfaces';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from 'src/config/env.validation';

@Injectable()
export class StorageService {
  private readonly s3Client: S3Client;

  constructor(private configService: ConfigService<EnvironmentVariables>) {
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

  /**
   * Presigned upload URL üretir
   */
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

  /**
   * Presigned download URL üretir
   */
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
   * Buffer'dan dosya yükler (işlenmiş medyalar için)
   */
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

  /**
   * Dosyayı Buffer olarak okur (processing için)
   */
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

  /**
   * Dosya siler
   */
  async delete(bucket: StorageBucket, fileKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: bucket,
      Key: fileKey,
    });

    await this.s3Client.send(command);
  }

  /**
   * Toplu silme
   */
  async deleteMany(bucket: StorageBucket, fileKeys: string[]): Promise<void> {
    await Promise.all(fileKeys.map((key) => this.delete(bucket, key)));
  }

  private buildPublicUrl(bucket: StorageBucket, fileKey: string): string {
    return `${process.env.MINIO_ENDPOINT}/${bucket}/${fileKey}`;
  }
}
