import { IsOptional, IsInt, Min, Max, IsString, IsEnum, IsBoolean } from 'class-validator';
import { Type } from 'class-transformer';
import { ConversationType } from 'generated/prisma/client';

export class PaginationQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @IsString()
  cursor?: string; // Conversation ID to start after

  @IsOptional()
  @IsString()
  search?: string; // Search by conversation name or participant name

  @IsOptional()
  @IsEnum(ConversationType)
  type?: ConversationType; // Filter by conversation type

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  muted?: boolean; // Filter by muted status

  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  archived?: boolean; // Filter by archived status
}
