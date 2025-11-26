import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConversationType } from '@prisma/client';

@Injectable()
export class GroupManagementService {
  constructor(private prisma: PrismaService) {}

  // ============================================
  // Permission Checks
  // ============================================

  private async verifyGroupAdmin(
    userId: string,
    conversationId: string,
  ): Promise<void> {
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

  private async verifyGroupMember(
    userId: string,
    conversationId: string,
  ): Promise<void> {
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

  private async isGroupCreator(
    userId: string,
    conversationId: string,
  ): Promise<boolean> {
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

    // Verify all users exist
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds }, isActive: true },
    });

    if (users.length !== userIds.length) {
      throw new NotFoundException('One or more users not found');
    }

    // Check if any users are already participants
    const existingParticipants =
      await this.prisma.conversationParticipant.findMany({
        where: {
          conversationId,
          userId: { in: userIds },
          leftAt: null,
        },
      });

    if (existingParticipants.length > 0) {
      const existingUserIds = existingParticipants.map((p) => p.userId);
      throw new BadRequestException(
        `Users already in group: ${existingUserIds.join(', ')}`,
      );
    }

    // Add users as members
    const newParticipants = await this.prisma.$transaction(
      userIds.map((userId) =>
        this.prisma.conversationParticipant.create({
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

    // Get conversation details for the response
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
      addedMembers: newParticipants.map((p) => p.user),
      addedBy: adminId,
    };
  }

  // ============================================
  // Remove Member from Group
  // ============================================

  async removeMember(
    adminId: string,
    conversationId: string,
    userIdToRemove: string,
  ) {
    // Verify admin permissions
    await this.verifyGroupAdmin(adminId, conversationId);

    // Can't remove yourself using this method (use leaveGroup instead)
    if (adminId === userIdToRemove) {
      throw new BadRequestException(
        'Use leave group to remove yourself from the group',
      );
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
        throw new BadRequestException(
          'Group creator must promote another admin before leaving',
        );
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
    const updatedParticipant = await this.prisma.conversationParticipant.update(
      {
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
      },
    );

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
