import {
  IsString,
  IsEnum,
  IsOptional,
  IsArray,
  MinLength,
  MaxLength,
  IsUrl,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ConversationType } from 'generated/prisma/client';
import { sanitizeString } from '../../common/utils/sanitize.util';

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
  @Transform(({ value }) => sanitizeString(value))
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => sanitizeString(value))
  description?: string;

  @IsOptional()
  @IsUrl({}, { message: 'avatarUrl must be a valid URL' })
  avatarUrl?: string;
}
