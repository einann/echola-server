import { IsString, IsEnum } from 'class-validator';

export class ConfirmUploadDto {
  @IsString()
  fileKey: string;

  @IsString()
  conversationId: string;

  @IsEnum(['image', 'video', 'audio', 'document'])
  fileType: 'image' | 'video' | 'audio' | 'document';

  @IsString()
  fileName: string;

  @IsString()
  mimeType: string;
}
