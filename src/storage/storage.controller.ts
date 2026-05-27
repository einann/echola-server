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
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { StorageService } from './storage.service';
import { StorageBucket } from './enums';
import { JwtAccessGuard } from 'src/auth/guards/jwt-access.guard';

// Dev-only controller. Registered conditionally in StorageModule.forRoot()
// when NODE_ENV !== 'production'. Used for Postman testing of storage flows.
@ApiTags('Storage')
@ApiBearerAuth('access-token')
@Controller('storage')
@UseGuards(JwtAccessGuard)
export class StorageController {
  constructor(private readonly storageService: StorageService) {}

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

  @Post('upload/:bucket')
  @UseInterceptors(FileInterceptor('file'))
  async uploadFile(
    @Param('bucket') bucket: StorageBucket,
    @UploadedFile() file: Express.Multer.File,
    @Body('fileKey') fileKey?: string,
  ) {
    const key = fileKey || `test/${Date.now()}-${file.originalname}`;

    const result = await this.storageService.uploadBuffer(bucket, key, file.buffer, file.mimetype);

    return {
      success: true,
      data: result,
    };
  }

  @Get('download-url/:bucket/*')
  async getDownloadUrl(
    @Param('bucket') bucket: StorageBucket,
    @Param() params: { bucket: string; path: string[] },
  ) {
    const fileKey = params.path.join('/');
    const url = await this.storageService.generatePresignedDownloadUrl(bucket, fileKey);

    return { url };
  }

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

  @Get('buckets')
  getBuckets() {
    return {
      buckets: Object.values(StorageBucket),
    };
  }
}
