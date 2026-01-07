import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConversationDto } from './dto/create-conversation.dto';
import { ConversationType } from 'generated/prisma/client';
import { EnvironmentVariables } from '../config/env.validation';

@Injectable()
export class ConversationsService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService<EnvironmentVariables>,
  ) {}

  async createConversation(userId: string, createDto: CreateConversationDto) {
    const { type, participantIds, name, description, avatarUrl } = createDto;

    // Validation: DIRECT must have exactly 1 other participant
    if (type === ConversationType.DIRECT && participantIds.length !== 1) {
      throw new BadRequestException('Direct conversation must have exactly one other participant');
    }

    // Validation: GROUP must have at least 2 participants (excluding creator)
    if (type === ConversationType.GROUP && participantIds.length < 1) {
      throw new BadRequestException('Group conversation must have at least one other participant');
    }

    // Validation: GROUP size limit (including creator)
    if (type === ConversationType.GROUP) {
      const maxGroupSize = this.configService.get('MAX_GROUP_SIZE', {
        infer: true,
      }) as number; // Non-null assertion: validated in env.validation.ts
      const totalParticipants = participantIds.length + 1; // +1 for creator

      if (totalParticipants > maxGroupSize) {
        throw new BadRequestException(
          `Group size cannot exceed ${maxGroupSize} members. You are trying to add ${totalParticipants} members.`,
        );
      }
    }

    // Check if DIRECT conversation already exists
    if (type === ConversationType.DIRECT) {
      const existingConversation = await this.findDirectConversation(userId, participantIds[0]);
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

  async getUserConversations(
    userId: string,
    options?: {
      limit?: number;
      cursor?: string;
      search?: string;
      type?: ConversationType;
      muted?: boolean;
      archived?: boolean;
    },
  ) {
    const limit = options?.limit || 20;
    const cursor = options?.cursor;
    const search = options?.search;
    const type = options?.type;
    const muted = options?.muted;
    const archived = options?.archived;

    // Build where clause with cursor for pagination
    const whereClause = {
      userId,
      leftAt: null, // Only active conversations
      conversation: {},
      isMuted: false,
      isArchived: false,
    };

    // Apply muted filter
    if (muted !== undefined) {
      whereClause.isMuted = muted;
    }

    // Apply archived filter
    if (archived !== undefined) {
      whereClause.isArchived = archived;
    }

    // Build conversation filter
    const conversationFilter: any = {};

    // Apply type filter
    if (type) {
      conversationFilter.type = type;
    }

    // Apply search filter (search in group name or participant names)
    if (search) {
      conversationFilter.OR = [
        // Search in group name
        {
          name: {
            contains: search,
            mode: 'insensitive',
          },
        },
        // Search in participant names
        {
          participants: {
            some: {
              leftAt: null,
              user: {
                OR: [
                  {
                    displayName: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                  {
                    username: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                  {
                    email: {
                      contains: search,
                      mode: 'insensitive',
                    },
                  },
                ],
              },
            },
          },
        },
      ];
    }

    // If cursor provided, get conversations updated before that conversation
    if (cursor) {
      const cursorConversation = await this.prisma.conversation.findUnique({
        where: { id: cursor },
        select: { updatedAt: true },
      });

      if (cursorConversation) {
        conversationFilter.updatedAt = { lt: cursorConversation.updatedAt };
      }
    }

    // Merge conversation filters
    whereClause.conversation = conversationFilter;

    const participants = await this.prisma.conversationParticipant.findMany({
      where: whereClause,
      take: limit + 1, // Fetch one extra to check if there's more
      select: {
        isPinned: true,
        pinnedAt: true,
        lastReadAt: true,
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

    // Sort results: pinned conversations first (by pinnedAt DESC), then unpinned (by updatedAt DESC)
    const sortedParticipants = participants.sort((a, b) => {
      // If both are pinned or both are not pinned
      if (a.isPinned === b.isPinned) {
        if (a.isPinned && a.pinnedAt && b.pinnedAt) {
          // Both pinned: sort by pinnedAt DESC
          return b.pinnedAt.getTime() - a.pinnedAt.getTime();
        }
        // Both unpinned: sort by conversation updatedAt DESC
        return b.conversation.updatedAt.getTime() - a.conversation.updatedAt.getTime();
      }
      // One is pinned, one is not: pinned comes first
      return a.isPinned ? -1 : 1;
    });

    // Check if there are more results
    const hasMore = sortedParticipants.length > limit;
    const items = hasMore ? sortedParticipants.slice(0, limit) : sortedParticipants;

    // Calculate unread counts for all conversations
    const conversationsWithUnread = await Promise.all(
      items.map(async (p) => {
        const unreadCount = await this.prisma.message.count({
          where: {
            conversationId: p.conversation.id,
            senderId: { not: userId },
            createdAt: p.lastReadAt ? { gt: p.lastReadAt } : undefined, // If never read, count all messages from others
            isDeleted: false,
          },
        });

        return {
          ...p.conversation,
          lastMessage: p.conversation.messages[0] || null,
          unreadCount,
          isPinned: p.isPinned,
          pinnedAt: p.pinnedAt,
        };
      }),
    );

    return {
      data: conversationsWithUnread,
      pagination: {
        hasMore,
        nextCursor: hasMore ? items[items.length - 1].conversation.id : null,
      },
    };
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
      throw new ForbiddenException('You are not a participant in this conversation');
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
    // Find all DIRECT conversations where user1 is an active participant
    const conversations = await this.prisma.conversation.findMany({
      where: {
        type: ConversationType.DIRECT,
        participants: {
          some: {
            userId: user1Id,
            leftAt: null,
          },
        },
      },
      include: {
        participants: {
          where: {
            leftAt: null,
          },
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

    // Find the conversation with exactly 2 participants: user1 and user2
    const existingConversation = conversations.find((conv) => {
      if (conv.participants.length !== 2) return false;

      const participantIds = conv.participants.map((p) => p.userId);
      return participantIds.includes(user1Id) && participantIds.includes(user2Id);
    });

    return existingConversation || null;
  }

  // ============================================
  // Mute/Unmute Conversation
  // ============================================

  async muteConversation(userId: string, conversationId: string) {
    // Verify user is participant
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
      },
    });

    if (!participant) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    // Update isMuted to true
    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { isMuted: true },
    });

    return {
      conversationId,
      isMuted: true,
      message: 'Conversation muted successfully',
    };
  }

  async unmuteConversation(userId: string, conversationId: string) {
    // Verify user is participant
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
      },
    });

    if (!participant) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    // Update isMuted to false
    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { isMuted: false },
    });

    return {
      conversationId,
      isMuted: false,
      message: 'Conversation unmuted successfully',
    };
  }

  // ============================================
  // Archive/Unarchive Conversation
  // ============================================

  async archiveConversation(userId: string, conversationId: string) {
    // Verify user is participant
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
      },
    });

    if (!participant) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    // Update isArchived to true
    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { isArchived: true },
    });

    return {
      conversationId,
      isArchived: true,
      message: 'Conversation archived successfully',
    };
  }

  async unarchiveConversation(userId: string, conversationId: string) {
    // Verify user is participant
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
      },
    });

    if (!participant) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    // Update isArchived to false
    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { isArchived: false },
    });

    return {
      conversationId,
      isArchived: false,
      message: 'Conversation unarchived successfully',
    };
  }

  // ============================================
  // Pin/Unpin Conversation
  // ============================================

  async pinConversation(userId: string, conversationId: string) {
    // Verify user is participant
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
      },
    });

    if (!participant) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    // Check max pinned conversations limit (e.g., 5)
    const pinnedCount = await this.prisma.conversationParticipant.count({
      where: {
        userId,
        isPinned: true,
        leftAt: null,
      },
    });

    const MAX_PINNED = 5;
    if (pinnedCount >= MAX_PINNED && !participant.isPinned) {
      throw new BadRequestException(
        `You can only pin up to ${MAX_PINNED} conversations. Unpin another conversation first.`,
      );
    }

    // Update isPinned to true and set pinnedAt timestamp
    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: {
        isPinned: true,
        pinnedAt: new Date(),
      },
    });

    return {
      conversationId,
      isPinned: true,
      message: 'Conversation pinned successfully',
    };
  }

  async unpinConversation(userId: string, conversationId: string) {
    // Verify user is participant
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
      },
    });

    if (!participant) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    // Update isPinned to false and clear pinnedAt
    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: {
        isPinned: false,
        pinnedAt: null,
      },
    });

    return {
      conversationId,
      isPinned: false,
      message: 'Conversation unpinned successfully',
    };
  }

  // ============================================
  // Delete/Hide Conversation
  // ============================================

  async deleteConversation(userId: string, conversationId: string) {
    // Verify user is participant
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
      },
      include: {
        conversation: {
          select: {
            type: true,
          },
        },
      },
    });

    if (!participant) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    // For GROUP conversations, redirect to leave group
    if (participant.conversation.type === 'GROUP') {
      throw new BadRequestException('Use leave group endpoint to exit group conversations');
    }

    // For DIRECT conversations, soft delete (set leftAt)
    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { leftAt: new Date() },
    });

    return {
      conversationId,
      message: 'Conversation deleted successfully',
    };
  }
}
