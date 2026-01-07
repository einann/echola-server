import { Injectable } from '@nestjs/common';
import { MediaService } from './media.service';
import { MediaUploadRequestDto, MediaUploadConfirmDto } from './dto';
import { ProcessedMedia } from './interfaces';
import { PresignedUrlResult } from '../storage/interfaces';

@Injectable()
export class MediaHandler {
  constructor(private readonly mediaService: MediaService) {}

  /**
   * Socket event: media:request_upload
   */
  async handleUploadRequest(dto: MediaUploadRequestDto): Promise<PresignedUrlResult> {
    return this.mediaService.requestUploadUrl(dto);
  }

  /**
   * Socket event: media:confirm_upload
   * İşlem tamamlanınca ProcessedMedia döner, bu MessageHandler'a iletilir
   */
  async handleUploadConfirm(dto: MediaUploadConfirmDto): Promise<ProcessedMedia> {
    return this.mediaService.confirmUpload(dto);
  }
}
