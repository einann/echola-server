import { IsString, IsNotEmpty, IsUUID } from 'class-validator';

export class AddReactionEvent {
  @IsUUID()
  @IsNotEmpty()
  messageId: string;

  @IsString()
  @IsNotEmpty()
  emoji: string;
}

export class RemoveReactionEvent {
  @IsUUID()
  @IsNotEmpty()
  messageId: string;

  @IsString()
  @IsNotEmpty()
  emoji: string;
}
