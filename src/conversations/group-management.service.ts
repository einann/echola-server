import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationParticipant, ConversationType } from 'generated/prisma/client';
import { EnvironmentVariables } from '../config/env.validation';

@Injectable()
export class GroupManagementService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService<EnvironmentVariables>,
  ) {}

  // ============================================
  // Permission Checks
  // ============================================

  private async verifyGroupAdmin(userId: string, conversationId: string): Promise<void> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        participants: {
          where: { userId, leftAt: null },
        },
      },
    });

    if (!conversation) {
      throw new NotFoundException('Conversation not found');
    }

    if (conversation.type !== ConversationType.GROUP) {
      throw new BadRequestException('This operation is only for group chats');
    }

    const participant = conversation.participants[0];
    if (!participant) {
      throw new ForbiddenException('You are not a member of this group');
    }

    if (participant.role !== 'admin') {
      throw new ForbiddenException('Only admins can perform this action');
    }
  }

  private async verifyGroupMember(userId: string, conversationId: string): Promise<void> {
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
      },
    });

    if (!participant) {
      throw new ForbiddenException('You are not a member of this group');
    }
  }

  private async isGroupCreator(userId: string, conversationId: string): Promise<boolean> {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: { createdBy: true },
    });

    return conversation?.createdBy === userId;
  }

  // ============================================
  // Add Members to Group
  // ============================================

  async addMembers(adminId: string, conversationId: string, userIds: string[]) {
    // Verify admin permissions
    await this.verifyGroupAdmin(adminId, conversationId);

    // Check current group size
    const currentMembersCount = await this.prisma.conversationParticipant.count({
      where: {
        conversationId,
        leftAt: null,
      },
    });

    const maxGroupSize = this.configService.get('MAX_GROUP_SIZE', {
      infer: true,
    }) as number; // Non-null assertion: validated in env.validation.ts
    const newTotalSize = currentMembersCount + userIds.length;

    if (newTotalSize > maxGroupSize) {
      throw new BadRequestException(
        `Cannot add ${userIds.length} members. Group size limit is ${maxGroupSize}. Current size: ${currentMembersCount}`,
      );
    }

    // Verify all users exist
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true },
    });

    if (users.length !== userIds.length) {
      throw new NotFoundException('One or more users not found');
    }

    // Check which users are currently active participants
    const activeParticipants = await this.prisma.conversationParticipant.findMany({
      where: {
        conversationId,
        userId: { in: userIds },
        leftAt: null,
      },
    });

    if (activeParticipants.length > 0) {
      const activeUserIds = activeParticipants.map((p) => p.userId);
      throw new ConflictException(`Users already in group: ${activeUserIds.join(', ')}`);
    }

    // Find users who previously left (to re-add them)
    const previousParticipants = await this.prisma.conversationParticipant.findMany({
      where: {
        conversationId,
        userId: { in: userIds },
        leftAt: { not: null },
      },
    });

    const previousUserIds = previousParticipants.map((p) => p.userId);
    const newUserIds = userIds.filter((id) => !previousUserIds.includes(id));

    // Perform operations in transaction
    const newParticipants = await this.prisma.$transaction(async (tx) => {
      const results: ConversationParticipant[] = [];

      // Re-add users who previously left (update leftAt to null and joinedAt to now)
      if (previousUserIds.length > 0) {
        await tx.conversationParticipant.updateMany({
          where: {
            conversationId,
            userId: { in: previousUserIds },
          },
          data: {
            leftAt: null,
            joinedAt: new Date(), // Update joinedAt to current timestamp
            role: 'member',
          },
        });

        // Fetch the updated records to return
        const updatedParticipants = await tx.conversationParticipant.findMany({
          where: {
            conversationId,
            userId: { in: previousUserIds },
          },
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
                username: true,
                avatarUrl: true,
                email: true,
              },
            },
          },
        });

        results.push(...updatedParticipants);
      }

      // Add genuinely new users
      if (newUserIds.length > 0) {
        const created = await Promise.all(
          newUserIds.map((userId) =>
            tx.conversationParticipant.create({
              data: {
                conversationId,
                userId,
                role: 'member',
              },
              include: {
                user: {
                  select: {
                    id: true,
                    displayName: true,
                    username: true,
                    avatarUrl: true,
                    email: true,
                  },
                },
              },
            }),
          ),
        );

        results.push(...created);
      }

      return results;
    });

    // Get conversation details
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        name: true,
        type: true,
      },
    });

    return {
      conversation,
      // @ts-expect-error 'TODO'
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      addedMembers: newParticipants.map((p) => p.user),
      addedBy: adminId,
    };
  }

  // ============================================
  // Remove Member from Group
  // ============================================

  async removeMember(adminId: string, conversationId: string, userIdToRemove: string) {
    // Verify admin permissions
    await this.verifyGroupAdmin(adminId, conversationId);

    // Can't remove yourself using this method (use leaveGroup instead)
    if (adminId === userIdToRemove) {
      throw new BadRequestException('Use leave group to remove yourself from the group');
    }

    // Can't remove the group creator
    const isCreator = await this.isGroupCreator(userIdToRemove, conversationId);
    if (isCreator) {
      throw new ForbiddenException('Cannot remove the group creator');
    }

    // Find the participant
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId: userIdToRemove,
        leftAt: null,
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
      },
    });

    if (!participant) {
      throw new NotFoundException('User is not a member of this group');
    }

    // Soft delete: set leftAt timestamp
    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { leftAt: new Date() },
    });

    return {
      conversationId,
      removedUser: participant.user,
      removedBy: adminId,
    };
  }

  // ============================================
  // Leave Group
  // ============================================

  async leaveGroup(userId: string, conversationId: string) {
    // Verify user is a member
    await this.verifyGroupMember(userId, conversationId);

    // Check if user is the creator
    const isCreator = await this.isGroupCreator(userId, conversationId);
    if (isCreator) {
      // Check if there are other admins
      const otherAdmins = await this.prisma.conversationParticipant.findMany({
        where: {
          conversationId,
          userId: { not: userId },
          role: 'admin',
          leftAt: null,
        },
      });

      if (otherAdmins.length === 0) {
        throw new BadRequestException('Group creator must promote another admin before leaving');
      }
    }

    // Find participant
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
      },
    });

    if (!participant) {
      throw new NotFoundException('You are not a member of this group');
    }

    // Mark as left
    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { leftAt: new Date() },
    });

    return {
      conversationId,
      userId,
      leftAt: new Date(),
    };
  }

  // ============================================
  // Update Member Role (Promote/Demote Admin)
  // ============================================

  async updateMemberRole(
    adminId: string,
    conversationId: string,
    targetUserId: string,
    newRole: 'member' | 'admin',
  ) {
    // Verify admin permissions
    await this.verifyGroupAdmin(adminId, conversationId);

    // Can't change your own role
    if (adminId === targetUserId) {
      throw new BadRequestException('You cannot change your own role');
    }

    // Find target participant
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId: targetUserId,
        leftAt: null,
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
      },
    });

    if (!participant) {
      throw new NotFoundException('User is not a member of this group');
    }

    // Don't allow demoting the creator
    if (newRole === 'member') {
      const isCreator = await this.isGroupCreator(targetUserId, conversationId);
      if (isCreator) {
        throw new ForbiddenException('Cannot demote the group creator');
      }
    }

    // Update role
    const updatedParticipant = await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { role: newRole },
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
    });

    return {
      conversationId,
      user: updatedParticipant.user,
      newRole,
      updatedBy: adminId,
    };
  }

  // ============================================
  // Update Group Info
  // ============================================

  async updateGroupInfo(
    adminId: string,
    conversationId: string,
    updates: { name?: string; description?: string; avatarUrl?: string },
  ) {
    // Verify admin permissions
    await this.verifyGroupAdmin(adminId, conversationId);

    // Update conversation
    const updatedConversation = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(updates.name && { name: updates.name }),
        ...(updates.description !== undefined && {
          description: updates.description,
        }),
        ...(updates.avatarUrl !== undefined && {
          avatarUrl: updates.avatarUrl,
        }),
        updatedAt: new Date(),
      },
      include: {
        participants: {
          where: { leftAt: null },
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
        },
      },
    });

    return {
      conversation: updatedConversation,
      updatedBy: adminId,
    };
  }

  // ============================================
  // Get Group Members
  // ============================================

  async getGroupMembers(userId: string, conversationId: string) {
    // Verify user is a member
    await this.verifyGroupMember(userId, conversationId);

    const participants = await this.prisma.conversationParticipant.findMany({
      where: {
        conversationId,
        leftAt: null,
      },
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarUrl: true,
            isOnline: true,
            lastSeenAt: true,
          },
        },
      },
      orderBy: [{ role: 'desc' }, { joinedAt: 'asc' }], // Admins first, then by join date
    });

    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      select: {
        id: true,
        name: true,
        description: true,
        avatarUrl: true,
        createdBy: true,
        createdAt: true,
      },
    });

    return {
      conversation,
      members: participants.map((p) => ({
        ...p.user,
        role: p.role,
        joinedAt: p.joinedAt,
      })),
      totalMembers: participants.length,
    };
  }
}
