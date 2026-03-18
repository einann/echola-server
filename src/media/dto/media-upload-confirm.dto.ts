import { IsString, IsEnum, IsOptional } from 'class-validator';
import { MediaType } from '../enums';

export class MediaUploadConfirmDto {
  @IsString()
  fileKey: string; // Temp bucket key

  @IsEnum(MediaType)
  mediaType: MediaType;

  @IsString()
  conversationId: string;

  @IsString()
  @IsOptional()
  mimeType?: string; // Original mimeType for audio processing

  @IsString()
  @IsOptional()
  caption?: string;
}
