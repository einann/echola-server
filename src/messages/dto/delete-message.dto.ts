import { IsUUID, IsBoolean, IsOptional } from 'class-validator';

export class DeleteMessageDto {
  @IsUUID()
  messageId: string;

  @IsOptional()
  @IsBoolean()
  deleteForEveryone?: boolean; // Admin can delete for everyone
}
