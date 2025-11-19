import { IsString, IsOptional, IsInt, Min, MaxLength } from 'class-validator';

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
