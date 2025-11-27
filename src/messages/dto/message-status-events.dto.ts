import { IsString } from 'class-validator';

export class MessageDeliveredEvent {
  @IsString()
  messageId: string;
}

export class MessageReadEvent {
  @IsString()
  messageId: string;
}
