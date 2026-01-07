import { Injectable } from '@nestjs/common';
import { AuthenticatedSocket } from '../gateway/types/socket.types';
import { GroupManagementService } from './group-management.service';
import { RedisService } from '../redis/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { SocketService } from '../socket/socket.service';
import {
  AddMembersDto,
  LeaveGroupDto,
  RemoveMemberDto,
  UpdateGroupInfoDto,
  UpdateMemberRoleDto,
} from './dto/group-management.dto';

@Injectable()
export class GroupsHandler {
  constructor(
    private groupManagementService: GroupManagementService,
    private redisService: RedisService,
    private prismaService: PrismaService,
    private socketService: SocketService,
  ) {}

  async addMembers(client: AuthenticatedSocket, data: AddMembersDto): Promise<void> {
    const userId = client.data.userId;

    const result = await this.groupManagementService.addMembers(
      userId,
      data.conversationId,
      data.userIds,
    );

    // Acknowledge to admin
    client.emit('group:members:added', result);

    // Notify all existing members
    this.socketService.emitToConversation(data.conversationId, 'group:member:joined', {
      conversationId: data.conversationId,
      members: result.addedMembers,
      addedBy: userId,
    });

    // Notify newly added members and have them join the room
    for (const member of result.addedMembers) {
      this.socketService.emitToUser(member.id, 'group:added', {
        conversationId: result.conversation,
        addedBy: userId,
      });

      // Add them to the conversation room
      const memberSockets = await this.socketService.getUserSockets(member.id);
      for (const socket of memberSockets) {
        socket.join(`conversation:${data.conversationId}`);
      }
    }

    // Publish to Redis
    await this.redisService.publish(`conversation:${data.conversationId}`, {
      type: 'member_added',
      members: result.addedMembers,
      addedBy: userId,
    });
  }

  async removeMember(client: AuthenticatedSocket, data: RemoveMemberDto): Promise<void> {
    const adminId = client.data.userId;

    const result = await this.groupManagementService.removeMember(
      adminId,
      data.conversationId,
      data.userId,
    );

    // Acknowledge to admin
    client.emit('group:member:removed', result);

    // Notify the removed user
    this.socketService.emitToUser(data.userId, 'group:removed', {
      conversationId: data.conversationId,
      removedBy: adminId,
    });

    // Remove them from the conversation room
    const removedUserSockets = await this.socketService.getUserSockets(data.userId);
    for (const socket of removedUserSockets) {
      socket.leave(`conversation:${data.conversationId}`);
    }

    // Notify remaining members
    this.socketService.emitToConversation(data.conversationId, 'group:member:left', {
      conversationId: data.conversationId,
      user: result.removedUser,
      removedBy: adminId,
    });

    // Publish to Redis
    await this.redisService.publish(`conversation:${data.conversationId}`, {
      type: 'member_removed',
      userId: data.userId,
      removedBy: adminId,
    });
  }

  async leaveGroup(client: AuthenticatedSocket, data: LeaveGroupDto): Promise<void> {
    const userId = client.data.userId;

    const result = await this.groupManagementService.leaveGroup(userId, data.conversationId);

    // Acknowledge to user
    client.emit('group:left', result);

    // Remove from conversation room
    void client.leave(`conversation:${data.conversationId}`);

    // Get user info for notification
    const user = await this.prismaService.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        displayName: true,
        username: true,
        avatarUrl: true,
      },
    });

    // Notify remaining members
    this.socketService.emitToConversation(data.conversationId, 'group:member:left', {
      conversationId: data.conversationId,
      user,
      leftVoluntarily: true,
    });

    // Publish to Redis
    await this.redisService.publish(`conversation:${data.conversationId}`, {
      type: 'member_left',
      userId,
    });
  }

  async updateRole(client: AuthenticatedSocket, data: UpdateMemberRoleDto): Promise<void> {
    const adminId = client.data.userId;

    const result = await this.groupManagementService.updateMemberRole(
      adminId,
      data.conversationId,
      data.userId,
      data.role,
    );

    // Acknowledge to admin
    client.emit('group:role:updated', result);

    // Notify the user whose role changed
    this.socketService.emitToUser(data.userId, 'group:your_role:updated', {
      conversationId: data.conversationId,
      newRole: data.role,
      updatedBy: adminId,
    });

    // Notify all members
    this.socketService.emitToConversation(data.conversationId, 'group:member:role:changed', {
      conversationId: data.conversationId,
      user: result.user,
      newRole: data.role,
      updatedBy: adminId,
    });

    // Publish to Redis
    await this.redisService.publish(`conversation:${data.conversationId}`, {
      type: 'role_updated',
      userId: data.userId,
      newRole: data.role,
      updatedBy: adminId,
    });
  }

  async updateGroupInfo(client: AuthenticatedSocket, data: UpdateGroupInfoDto): Promise<void> {
    const adminId = client.data.userId;

    const result = await this.groupManagementService.updateGroupInfo(adminId, data.conversationId, {
      name: data.name,
      description: data.description,
      avatarUrl: data.avatarUrl,
    });

    // Acknowledge to admin
    client.emit('group:info:updated', result);

    // Notify all members
    this.socketService.emitToConversation(data.conversationId, 'group:info:changed', {
      conversationId: data.conversationId,
      updates: {
        name: data.name,
        description: data.description,
        avatarUrl: data.avatarUrl,
      },
      updatedBy: adminId,
    });

    // Publish to Redis
    await this.redisService.publish(`conversation:${data.conversationId}`, {
      type: 'info_updated',
      updates: {
        name: data.name,
        description: data.description,
        avatarUrl: data.avatarUrl,
      },
      updatedBy: adminId,
    });
  }

  async getMembers(client: AuthenticatedSocket, data: { conversationId: string }): Promise<void> {
    const userId = client.data.userId;

    const result = await this.groupManagementService.getGroupMembers(userId, data.conversationId);

    client.emit('group:members:list', result);
  }
}
