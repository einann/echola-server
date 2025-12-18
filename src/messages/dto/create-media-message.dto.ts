import { ProcessedMedia } from '../../media/interfaces';

export class CreateMediaMessageDto {
  conversationId: string;
  senderId: string;
  media: ProcessedMedia & {
    bucket?: string;
    fileName?: string;
  };
  caption?: string;
  replyToId?: string;
}
