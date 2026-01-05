import { Controller, Post, Get, Body, Param, UseGuards } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaUploadRequestDto, MediaUploadConfirmDto } from './dto';
import { JwtAccessGuard } from 'src/auth/guards/jwt-access.guard';

@Controller('media')
@UseGuards(JwtAccessGuard)
export class MediaController {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * POST /media/upload-url
   * Presigned upload URL al
   */
  @Post('upload-url')
  async getUploadUrl(@Body() dto: MediaUploadRequestDto) {
    return this.mediaService.requestUploadUrl(dto);
  }

  /**
   * POST /media/confirm
   * Yüklemeyi onayla ve işle
   */
  @Post('confirm')
  async confirmUpload(@Body() dto: MediaUploadConfirmDto) {
    const processedMedia = await this.mediaService.confirmUpload(dto);

    return {
      success: true,
      data: processedMedia,
    };
  }

  /**
   * GET /media/download-url/:bucket/:key
   * Download URL al
   */
  @Get('download-url/:bucket/*')
  async getDownloadUrl(
    @Param('bucket') bucket: string,
    @Param() params: { bucket: string; path: string[] },
  ) {
    const fileKey = params.path.join('/');
    const url = await this.mediaService.getDownloadUrl(bucket as any, fileKey);

    return { url };
  }
}
