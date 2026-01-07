import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class ReactionsService {
  constructor(private prisma: PrismaService) {}

  async addReaction(userId: string, messageId: string, emoji: string) {
    // Verify message exists
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: { conversation: true },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.isDeleted) {
      throw new BadRequestException('Cannot react to deleted message');
    }

    // Verify user is participant in the conversation
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId: message.conversationId,
        userId,
        leftAt: null,
      },
    });

    if (!participant) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    // Validate emoji (basic validation - can be enhanced)
    if (!emoji || emoji.length > 10) {
      throw new BadRequestException('Invalid emoji');
    }

    // Check if reaction already exists (upsert behavior)
    const existingReaction = await this.prisma.messageReaction.findUnique({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId,
          emoji,
        },
      },
    });

    if (existingReaction) {
      // Reaction already exists, return it
      return this.getReactionWithUser(existingReaction.id);
    }

    // Create new reaction
    const reaction = await this.prisma.messageReaction.create({
      data: {
        messageId,
        userId,
        emoji,
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarUrl: true,
          },
        },
        message: {
          select: {
            id: true,
            conversationId: true,
            senderId: true,
          },
        },
      },
    });

    return reaction;
  }

  async removeReaction(userId: string, messageId: string, emoji: string) {
    // Find the reaction
    const reaction = await this.prisma.messageReaction.findUnique({
      where: {
        messageId_userId_emoji: {
          messageId,
          userId,
          emoji,
        },
      },
      include: {
        message: {
          select: {
            id: true,
            conversationId: true,
          },
        },
      },
    });

    if (!reaction) {
      throw new NotFoundException('Reaction not found');
    }

    // Delete the reaction
    await this.prisma.messageReaction.delete({
      where: {
        id: reaction.id,
      },
    });

    return {
      id: reaction.id,
      messageId,
      userId,
      emoji,
      conversationId: reaction.message.conversationId,
    };
  }

  async getMessageReactions(messageId: string) {
    const reactions = await this.prisma.messageReaction.findMany({
      where: { messageId },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group reactions by emoji
    const groupedReactions = reactions.reduce(
      (acc, reaction) => {
        const emoji = reaction.emoji;
        if (!acc[emoji]) {
          acc[emoji] = {
            emoji,
            count: 0,
            users: [],
          };
        }
        acc[emoji].count++;
        acc[emoji].users.push(reaction.user);
        return acc;
      },
      {} as Record<string, { emoji: string; count: number; users: any[] }>,
    );

    return {
      messageId,
      reactions: Object.values(groupedReactions),
      total: reactions.length,
    };
  }

  private async getReactionWithUser(reactionId: string) {
    return await this.prisma.messageReaction.findUnique({
      where: { id: reactionId },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarUrl: true,
          },
        },
        message: {
          select: {
            id: true,
            conversationId: true,
            senderId: true,
          },
        },
      },
    });
  }
}
