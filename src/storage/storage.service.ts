import { Injectable, OnModuleInit } from '@nestjs/common';
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
import * as crypto from 'crypto';

@Injectable()
export class StorageService implements OnModuleInit {
  private s3Client: S3Client;
  private bucketName: string;

  constructor(private configService: ConfigService) {
    this.bucketName = this.configService.get('S3_BUCKET_NAME') as string;

    this.s3Client = new S3Client({
      endpoint: this.configService.get('S3_ENDPOINT') as string,
      region: this.configService.get('S3_REGION') as string,
      credentials: {
        accessKeyId: this.configService.get('S3_ACCESS_KEY') as string,
        secretAccessKey: this.configService.get('S3_SECRET_KEY') as string,
      },
      forcePathStyle: true, // Required for MinIO
    });
  }

  async onModuleInit() {
    await this.ensureBucketExists();
  }

  private async ensureBucketExists() {
    try {
      await this.s3Client.send(
        new HeadBucketCommand({ Bucket: this.bucketName }),
      );
      console.log(`✅ S3 bucket "${this.bucketName}" exists`);
    } catch (error) {
      if (error.name === 'NotFound') {
        console.log(`📦 Creating S3 bucket "${this.bucketName}"...`);
        await this.s3Client.send(
          new CreateBucketCommand({ Bucket: this.bucketName }),
        );
        console.log(`✅ S3 bucket "${this.bucketName}" created`);
      } else {
        console.error('Error checking bucket:', error);
      }
    }
  }

  async generateUploadUrl(
    fileName: string,
    contentType: string,
    expiresIn = 300, // 5 minutes
  ): Promise<{ uploadUrl: string; fileKey: string }> {
    // Generate unique file key
    const fileKey = this.generateFileKey(fileName);

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
      ContentType: contentType,
    });

    const uploadUrl = await getSignedUrl(this.s3Client, command, { expiresIn });

    return { uploadUrl, fileKey };
  }

  async generateDownloadUrl(
    fileKey: string,
    expiresIn = 3600,
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn });
  }

  async uploadFile(
    fileKey: string,
    buffer: Buffer,
    contentType: string,
  ): Promise<string> {
    await this.s3Client.send(
      new PutObjectCommand({
        Bucket: this.bucketName,
        Key: fileKey,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    return this.getPublicUrl(fileKey);
  }

  async deleteFile(fileKey: string): Promise<void> {
    await this.s3Client.send(
      new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: fileKey,
      }),
    );
  }

  getPublicUrl(fileKey: string): string {
    const endpoint = this.configService.get('S3_ENDPOINT') as string;
    return `${endpoint}/${this.bucketName}/${fileKey}`;
  }

  private generateFileKey(originalFileName: string): string {
    const timestamp = Date.now();
    const randomString = crypto.randomBytes(8).toString('hex');
    const extension = originalFileName.split('.').pop();
    return `uploads/${timestamp}-${randomString}.${extension}`;
  }
}
