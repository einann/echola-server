import {
  IsString,
  IsNotEmpty,
  IsUUID,
  IsArray,
  IsOptional,
  IsEnum,
  ArrayMinSize,
  MaxLength,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { sanitizeString } from '../../common/utils/sanitize.util';

export class AddMembersDto {
  @IsUUID()
  @IsNotEmpty()
  conversationId: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  userIds: string[];
}

export class RemoveMemberDto {
  @IsUUID()
  @IsNotEmpty()
  conversationId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;
}

export class LeaveGroupDto {
  @IsUUID()
  @IsNotEmpty()
  conversationId: string;
}

export class UpdateMemberRoleDto {
  @IsUUID()
  @IsNotEmpty()
  conversationId: string;

  @IsUUID()
  @IsNotEmpty()
  userId: string;

  @IsEnum(['member', 'admin'])
  role: 'member' | 'admin';
}

export class UpdateGroupInfoDto {
  @IsUUID()
  @IsNotEmpty()
  conversationId: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  @Transform(({ value }) => sanitizeString(value))
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  @Transform(({ value }) => sanitizeString(value))
  description?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
