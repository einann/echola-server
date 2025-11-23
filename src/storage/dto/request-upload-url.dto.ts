import { IsString, IsEnum, IsInt, Min, Max } from 'class-validator';

export class RequestUploadUrlDto {
  @IsString()
  fileName: string;

  @IsEnum(['image', 'video', 'audio', 'document'])
  fileType: 'image' | 'video' | 'audio' | 'document';

  @IsString()
  mimeType: string;

  @IsInt()
  @Min(1)
  @Max(104857600) // 100MB max
  fileSize: number;
}
