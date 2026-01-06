import {
  Controller,
  Post,
  Get,
  Delete,
  Body,
  Param,
  UseGuards,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { StorageService } from './storage.service';
import { StorageBucket } from './enums';
import { JwtAccessGuard } from 'src/auth/guards/jwt-access.guard';

// Only for development/testing - remove in production!
@Controller('storage')
@UseGuards(JwtAccessGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

  /**
   * POST /storage/presigned-url
   * Test: Presigned URL üret
   */
  @Post('presigned-url')
  async generatePresignedUrl(
    @Body()
    dto: {
      bucket: StorageBucket;
      fileKey: string;
      contentType: string;
      expiresIn?: number;
    },
  ) {
    return this.storageService.generatePresignedUploadUrl(
      dto.bucket,
      dto.fileKey,
      dto.contentType,
      dto.expiresIn,
    );
  }

  /**
   * POST /storage/upload
   * Test: Direkt dosya yükle (multipart)
   */
  @Post('upload/:bucket')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @Param('bucket') bucket: StorageBucket,
    @UploadedFile() file: Express.Multer.File,
    @Body('fileKey') fileKey?: string,
  ) {
    const key = fileKey || `test/${Date.now()}-${file.originalname}`;

    const result = await this.storageService.uploadBuffer(
      bucket,
      key,
      file.buffer,
      file.mimetype,
    );

    return {
      success: true,
      data: result,
    };
  }

  /**
   * GET /storage/download-url/:bucket/:key
   * Test: Download URL al
   */
  @Get('download-url/:bucket/*')
  async getDownloadUrl(
    @Param('bucket') bucket: StorageBucket,
    @Param() params: { bucket: string; path: string[] },
  ) {
    const fileKey = params.path.join('/');
    const url = await this.storageService.generatePresignedDownloadUrl(
      bucket,
      fileKey,
    );

    return { url };
  }

  /**
   * DELETE /storage/:bucket/:key
   * Test: Dosya sil
   * TODO: yukarıdaki gibi düzeltilecek.
   */
  @Delete(':bucket/*')
  async deleteFile(
    @Param('bucket') bucket: StorageBucket,
    @Param() params: { bucket: string; path: string[] },
  ) {
    const fileKey = params.path.join('/');
    await this.storageService.delete(bucket, fileKey);

    return {
      success: true,
      message: `Deleted ${bucket}/${fileKey}`,
    };
  }

  /**
   * GET /storage/buckets
   * Test: Mevcut bucket'ları listele
   */
  @Get('buckets')
  getBuckets() {
    return {
      buckets: Object.values(StorageBucket),
    };
  }
}
