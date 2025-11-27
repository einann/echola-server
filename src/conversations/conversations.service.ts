import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ConversationType } from 'generated/prisma/client';

@Injectable()
export class ConversationsService {
  constructor(private prisma: PrismaService) {}

  async createConversation(userId: string, createDto: CreateConversationDto) {
    const { type, participantIds, name, description, avatarUrl } = createDto;

    // Validation: DIRECT must have exactly 1 other participant
    if (type === ConversationType.DIRECT && participantIds.length !== 1) {
      throw new BadRequestException(
        'Direct conversation must have exactly one other participant',
      );
    }

    // Validation: GROUP must have at least 2 participants (excluding creator)
    if (type === ConversationType.GROUP && participantIds.length < 1) {
      throw new BadRequestException(
        'Group conversation must have at least one other participant',
      );
    }

    // Check if DIRECT conversation already exists
    if (type === ConversationType.DIRECT) {
      const existingConversation = await this.findDirectConversation(
        userId,
        participantIds[0],
      );
      if (existingConversation) {
        return existingConversation;
      }
    }

    // Verify all participants exist
    const participants = await this.prisma.user.findMany({
      where: { id: { in: participantIds } },
    });

    if (participants.length !== participantIds.length) {
      throw new NotFoundException('One or more participants not found');
    }

    // Create conversation with participants
    const conversation = await this.prisma.conversation.create({
      data: {
        type,
        name: type === ConversationType.GROUP ? name : null,
        description: type === ConversationType.GROUP ? description : null,
        avatarUrl: type === ConversationType.GROUP ? avatarUrl : null,
        createdBy: type === ConversationType.GROUP ? userId : null,
        participants: {
          create: [
            // Add creator as participant
            {
              userId,
              role: type === ConversationType.GROUP ? 'admin' : 'member',
            },
            // Add other participants
            ...participantIds.map((participantId) => ({
              userId: participantId,
              role: 'member',
            })),
          ],
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                displayName: true,
                username: true,
                avatarUrl: true,
                isOnline: true,
                lastSeenAt: true,
              },
            },
          },
        },
      },
    });

    return conversation;
  }

  async getUserConversations(userId: string) {
    const participants = await this.prisma.conversationParticipant.findMany({
      where: {
        userId,
        leftAt: null, // Only active conversations
      },
      include: {
        conversation: {
          include: {
            participants: {
              where: { leftAt: null },
              include: {
                user: {
                  select: {
                    id: true,
                    email: true,
                    displayName: true,
                    username: true,
                    avatarUrl: true,
                    isOnline: true,
                    lastSeenAt: true,
                  },
                },
              },
            },
            messages: {
              take: 1,
              orderBy: { createdAt: 'desc' },
              include: {
                sender: {
                  select: {
                    id: true,
                    displayName: true,
                    username: true,
                  },
                },
              },
            },
          },
        },
      },
      orderBy: {
        conversation: {
          updatedAt: 'desc',
        },
      },
    });

    return participants.map((p) => ({
      ...p.conversation,
      lastMessage: p.conversation.messages[0] || null,
      unreadCount: 0, // Will implement this later
    }));
  }

  async getConversationById(userId: string, conversationId: string) {
    // Verify user is participant
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
      },
    });

    if (!participant) {
      throw new ForbiddenException(
        'You are not a participant in this conversation',
      );
    }

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          where: { leftAt: null },
          include: {
            user: {
              select: {
                id: true,
                email: true,
                displayName: true,
                username: true,
                avatarUrl: true,
                isOnline: true,
                lastSeenAt: true,
              },
            },
          },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    return conversation;
  }

  private async findDirectConversation(user1Id: string, user2Id: string) {
    const conversation = await this.prisma.conversation.findFirst({
      where: {
        type: ConversationType.DIRECT,
        participants: {
          every: {
            userId: { in: [user1Id, user2Id] },
            leftAt: null,
          },
        },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                displayName: true,
                username: true,
                avatarUrl: true,
                isOnline: true,
                lastSeenAt: true,
              },
            },
          },
        },
      },
    });

    // Verify it has exactly 2 participants
    if (conversation && conversation.participants.length === 2) {
      return conversation;
    }

    return null;
  }
}
