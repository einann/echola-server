import { IsOptional, IsBoolean } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  notifyOnMessage?: boolean;

  @IsOptional()
  @IsBoolean()
  notifyOnMention?: boolean;

  @IsOptional()
  @IsBoolean()
  notifySound?: boolean;
}
