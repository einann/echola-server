import { IsString, IsMimeType, IsNumber, Max } from 'class-validator';

export class RequestAvatarUploadDto {
  @IsString()
  fileName: string;

  @IsMimeType()
  mimeType: string;

  @IsNumber()
  @Max(5 * 1024 * 1024) // 5MB max
  fileSize: number;
}

export class ConfirmAvatarUploadDto {
  @IsString()
  fileKey: string;
}
