import {
  Controller,
  Post,
  Body,
  UseGuards,
  Request,
  UseInterceptors,
  UploadedFile,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAccessGuard } from '../auth/guards/jwt-access.guard';
import { StorageOrchestrationService } from './storage-orchestration.service';
import { RequestUploadUrlDto } from './dto/request-upload-url.dto';
import { ConfirmUploadDto } from './dto/confirm-upload.dto';

@Controller('storage')
@UseGuards(JwtAccessGuard)
export class StorageController {
  constructor(
    private storageOrchestrationService: StorageOrchestrationService,
  ) {}

  /**
   * Request presigned URL for client-side upload
   */
  @Post('request-url')
  async requestUploadUrl(@Body() dto: RequestUploadUrlDto) {
    const result = await this.storageOrchestrationService.requestPresignedUrl({
      fileName: dto.fileName,
      mimeType: dto.mimeType,
      fileType: dto.fileType,
      fileSize: dto.fileSize,
    });

    return {
      ...result,
      instructions: 'Use PUT request to upload file directly to this URL',
    };
  }

  /**
   * Confirm upload and process file
   */
  @Post('confirm')
  async confirmUpload(@Request() req, @Body() dto: ConfirmUploadDto) {
    const userId = req.user.userId;

    const message =
      await this.storageOrchestrationService.confirmAndProcessUpload(userId, {
        fileKey: dto.fileKey,
        fileName: dto.fileName,
        fileType: dto.fileType,
        conversationId: dto.conversationId,
      });

    return {
      success: true,
      message,
    };
  }

  /**
   * Direct upload endpoint (alternative flow)
   */
  @Post('direct')
  @UseInterceptors(FileInterceptor('file'))
  async directUpload(
    @Request() req,
    @UploadedFile() file: Express.Multer.File,
    @Body('conversationId') conversationId: string,
    @Body('fileType') fileType: 'image' | 'video' | 'audio' | 'document',
  ) {
    if (!file) {
      throw new BadRequestException('No file provided');
    }

    const userId = req.user.userId;

    const message = await this.storageOrchestrationService.processDirectUpload({
      file,
      fileType,
      conversationId,
      userId,
    });

    return {
      success: true,
      message,
    };
  }
}
