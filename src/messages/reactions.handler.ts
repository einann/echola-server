import { Injectable } from '@nestjs/common';
import { Socket } from 'socket.io';
import { ReactionsService } from './reactions.service';
import { RedisService } from '../redis/redis.service';
import { SocketService } from '../socket/socket.service';
import { AuthenticatedSocket } from '../gateway/types/socket.types';
import {
  AddReactionEvent,
  RemoveReactionEvent,
} from './dto/message-reaction-events.dto';

@Injectable()
export class ReactionsHandler {
  constructor(
    private reactionsService: ReactionsService,
    private redisService: RedisService,
    private socketService: SocketService,
  ) {}

  async addReaction(
    client: AuthenticatedSocket,
    data: AddReactionEvent,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const userId = client.data.userId;

      const reaction = await this.reactionsService.addReaction(
        userId,
        data.messageId,
        data.emoji,
      );

      if (!reaction) {
        throw new Error('Reaction creation error.');
      }

      // Acknowledge to sender
      client.emit('message:reaction:added', { reaction });

      // Broadcast to all participants in the conversation
      this.socketService.emitToConversation(
        reaction.message.conversationId,
        'message:reaction:updated',
        {
          messageId: data.messageId,
          reaction: {
            id: reaction.id,
            emoji: reaction.emoji,
            user: reaction.user,
            createdAt: reaction.createdAt,
          },
          action: 'add',
        },
      );

      // Publish to Redis for other server instances
      await this.redisService.publish(
        `conversation:${reaction.message.conversationId}`,
        {
          type: 'reaction_added',
          messageId: data.messageId,
          reaction,
        },
      );

      return { success: true };
    } catch (error) {
      console.error('Error adding reaction:', error);
      client.emit('error', {
        message: 'Failed to add reaction',
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  async removeReaction(
    client: AuthenticatedSocket,
    data: RemoveReactionEvent,
  ): Promise<{ success: boolean; error?: string }> {
    try {
      const userId = client.data.userId;

      const result = await this.reactionsService.removeReaction(
        userId,
        data.messageId,
        data.emoji,
      );

      // Acknowledge to sender
      client.emit('message:reaction:removed', {
        messageId: data.messageId,
        emoji: data.emoji,
      });

      // Broadcast to all participants in the conversation
      this.socketService.emitToConversation(
        result.conversationId,
        'message:reaction:updated',
        {
          messageId: data.messageId,
          reaction: {
            emoji: data.emoji,
            userId,
          },
          action: 'remove',
        },
      );

      // Publish to Redis for other server instances
      await this.redisService.publish(`conversation:${result.conversationId}`, {
        type: 'reaction_removed',
        messageId: data.messageId,
        emoji: data.emoji,
        userId,
      });

      return { success: true };
    } catch (error) {
      console.error('Error removing reaction:', error);
      client.emit('error', {
        message: 'Failed to remove reaction',
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }

  async getReactions(
    client: Socket,
    data: { messageId: string },
  ): Promise<{ success: boolean; reactions?: any; error?: string }> {
    try {
      const reactions = await this.reactionsService.getMessageReactions(
        data.messageId,
      );

      client.emit('message:reactions:list', reactions);

      return { success: true, reactions };
    } catch (error) {
      console.error('Error getting reactions:', error);
      client.emit('error', {
        message: 'Failed to get reactions',
        error: error.message,
      });
      return { success: false, error: error.message };
    }
  }
}
