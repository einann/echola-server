import { IsUUID, IsArray, ArrayMinSize, IsOptional, IsString } from 'class-validator';

export class ForwardMessageDto {
  @IsUUID()
  messageId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  targetConversationIds: string[];

  @IsOptional()
  @IsString()
  tempId?: string;
}

export class ForwardMessageEvent {
  @IsUUID()
  messageId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  targetConversationIds: string[];

  @IsOptional()
  @IsString()
  tempId?: string;
}
