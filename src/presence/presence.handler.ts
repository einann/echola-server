import { Injectable } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { AuthenticatedSocket } from '../gateway/types/socket.types';
import { TypingEvent } from './dto/typing-events.dto';

@Injectable()
export class PresenceHandler {
  constructor(private redisService: RedisService) {}

  async startTyping(client: AuthenticatedSocket, data: TypingEvent): Promise<void> {
    const userId = client.data.userId;

    // Set typing indicator in Redis (5-second TTL)
    await this.redisService.setTyping(data.conversationId, userId);

    // Broadcast to conversation participants (except sender)
    client.to(`conversation:${data.conversationId}`).emit('user_typing', {
      conversationId: data.conversationId,
      userId,
    });
  }

  stopTyping(client: AuthenticatedSocket, data: TypingEvent): void {
    const userId = client.data.userId;

    // Broadcast to conversation participants
    client.to(`conversation:${data.conversationId}`).emit('user_stopped_typing', {
      conversationId: data.conversationId,
      userId,
    });
  }
}
