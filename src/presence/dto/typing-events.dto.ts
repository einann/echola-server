import { IsString } from 'class-validator';

export class TypingEvent {
  @IsString()
  conversationId: string;
}
