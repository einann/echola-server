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
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @IsOptional()
  @IsString()
  avatarUrl?: string;
}
