import { IsString, IsOptional, MinLength, IsNumber, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class SearchUsersDto {
  @IsString()
  @MinLength(2, { message: 'Search query must be at least 2 characters' })
  query: string;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(1)
  @Max(50)
  limit?: number = 20;

  @IsOptional()
  @IsNumber()
  @Type(() => Number)
  @Min(0)
  offset?: number = 0;
}
