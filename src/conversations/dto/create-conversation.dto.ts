import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  MinLength,
  MaxLength,
} from 'class-validator';
import { ConversationType } from '@prisma/client';

export class CreateConversationDto {
  @IsEnum(ConversationType)
  type: ConversationType;

  // For DIRECT: single participant ID
  // For GROUP: array of participant IDs
  @IsArray()
  @IsString({ each: true })
  participantIds: string[];

  // Group-specific fields (optional for DIRECT)
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
