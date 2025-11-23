import {
  IsString,
  IsOptional,
  IsInt,
  Min,
  MaxLength,
  IsNotEmpty,
  IsNumber,
  IsEnum,
} from 'class-validator';

export class SendMessageEvent {
  @IsString()
  conversationId: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;

  @IsOptional()
  @IsString()
  contentType?: string;

  @IsOptional()
  @IsString()
  mediaUrl?: string;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  fileSize?: number;

  @IsOptional()
  @IsString()
  replyToId?: string;
}

export class MessageDeliveredEvent {
  @IsString()
  messageId: string;
}

export class MessageReadEvent {
  @IsString()
  messageId: string;
}

export class TypingEvent {
  @IsString()
  conversationId: string;
}

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
