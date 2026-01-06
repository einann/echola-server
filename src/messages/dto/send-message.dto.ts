import { IsString, IsOptional, IsUUID, MaxLength } from 'class-validator';

export class SendMessageDto {
  @IsUUID()
  conversationId: string;

  @IsString()
  @MaxLength(4000)
  content: string;

  @IsUUID()
  @IsOptional()
  replyToId?: string;
}
