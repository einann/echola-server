import {
  IsString,
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsOptional,
} from 'class-validator';

export class RequestFileUploadEvent {
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @IsNumber()
  fileSize: number;

  @IsEnum(['image', 'video', 'audio', 'document'])
  fileType: 'image' | 'video' | 'audio' | 'document';

  @IsString()
  @IsNotEmpty()
  conversationId: string;
}

export class ConfirmFileUploadEvent {
  @IsString()
  @IsNotEmpty()
  fileKey: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsEnum(['image', 'video', 'audio', 'document'])
  fileType: 'image' | 'video' | 'audio' | 'document';

  @IsString()
  @IsNotEmpty()
  conversationId: string;

  @IsNumber()
  fileSize: number;

  @IsString()
  @IsOptional()
  content?: string; // Optional caption for media
}
