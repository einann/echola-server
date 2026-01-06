import { IsEnum, IsString, IsNumber, IsOptional } from 'class-validator';
import { MediaType } from '../enums';

export class MediaUploadRequestDto {
  @IsEnum(MediaType)
  mediaType: MediaType;

  @IsString()
  mimeType: string;

  @IsString()
  fileName: string;

  @IsNumber()
  fileSize: number;

  @IsString()
  @IsOptional()
  conversationId?: string; // Opsiyonel, key üretimi için
}
