import { IsString, IsUUID, IsOptional, IsNumber, Min, MinLength, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchMessagesDto {
  @IsUUID()
  conversationId: string;

  @IsString()
  @MinLength(2)
  query: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number = 20;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  offset?: number = 0;
}

export class SearchMessagesEvent {
  @IsUUID()
  conversationId: string;

  @IsString()
  @MinLength(2)
  query: string;

  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsNumber()
  @Min(0)
  offset?: number;
}
