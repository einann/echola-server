import { IsEmail, IsOptional, IsString } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  password: string;

  // Device information
  @IsString()
  deviceId: string;

  @IsString()
  deviceName: string;

  @IsString()
  deviceType: 'mobile' | 'desktop' | 'web';

  @IsString()
  @IsOptional()
  fcmToken?: string; // For push notifications
}
