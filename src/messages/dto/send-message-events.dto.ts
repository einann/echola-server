import {
  IsString,
  IsOptional,
  Min,
  MaxLength,
  IsNotEmpty,
  IsNumber,
  IsEnum,
  IsUUID,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { Type } from 'class-transformer';
import { MediaType } from 'generated/prisma/client';

// ============================================
// TEXT MESSAGE
// ============================================

export class SendTextMessageEvent {
  @IsUUID()
  conversationId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(10000)
  content: string;

  @IsOptional()
  @IsUUID()
  replyToId?: string;

  @IsOptional()
  @IsString()
  tempId?: string; // Client-side temporary ID for optimistic UI
}

// ============================================
// TYPING INDICATOR
// ============================================

export class TypingEvent {
  @IsUUID()
  conversationId: string;
}

// ============================================
// MEDIA UPLOAD FLOW
// ============================================

export class RequestMediaUploadEvent {
  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsString()
  @IsNotEmpty()
  mimeType: string;

  @IsNumber()
  @Min(1)
  fileSize: number;

  @IsEnum(MediaType)
  mediaType: MediaType;

  @IsUUID()
  conversationId: string;

  @IsOptional()
  @IsString()
  tempId?: string; // For client tracking
}

export class ConfirmMediaUploadEvent {
  @IsString()
  @IsNotEmpty()
  fileKey: string; // Key in temp bucket

  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsEnum(MediaType)
  mediaType: MediaType;

  @IsUUID()
  conversationId: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  caption?: string;

  @IsOptional()
  @IsUUID()
  replyToId?: string;

  @IsOptional()
  @IsString()
  tempId?: string;
}

// ============================================
// MULTIPLE ATTACHMENTS (Future-proof)
// ============================================

export class AttachmentInfo {
  @IsString()
  @IsNotEmpty()
  fileKey: string;

  @IsString()
  @IsNotEmpty()
  fileName: string;

  @IsEnum(MediaType)
  mediaType: MediaType;
}

export class SendMediaMessageEvent {
  @IsUUID()
  conversationId: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentInfo)
  attachments: AttachmentInfo[];

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  caption?: string;

  @IsOptional()
  @IsUUID()
  replyToId?: string;

  @IsOptional()
  @IsString()
  tempId?: string;
}

// ============================================
// UPLOAD URL RESPONSE
// ============================================

export class MediaUploadUrlResponse {
  uploadUrl: string;
  fileKey: string;
  expiresAt: Date;
  tempId?: string;
}

// ============================================
// LEGACY (Backward compatibility - deprecate later)
// ============================================

/** @deprecated Use SendTextMessageEvent instead */
export class SendMessageEvent {
  @IsUUID()
  conversationId: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  content?: string;

  @IsOptional()
  @IsUUID()
  replyToId?: string;

  @IsOptional()
  @IsString()
  tempId?: string;
}
