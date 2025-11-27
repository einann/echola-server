import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  ConnectedSocket,
  MessageBody,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { UsePipes, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { AuthenticatedSocket, SocketData } from './types/socket.types';
import { SocketService } from '../socket/socket.service';
import { ConnectionHandler } from '../connection/connection.handler';
import { MessagesHandler } from '../messages/messages.handler';
import { ReactionsHandler } from '../messages/reactions.handler';
import { PresenceHandler } from '../presence/presence.handler';
import { StorageHandler } from '../storage/storage.handler';
import { GroupsHandler } from '../conversations/groups.handler';
import { RedisService } from '../redis/redis.service';

import { TypingEvent } from '../presence/dto/typing-events.dto';
import {
  RequestFileUploadEvent,
  ConfirmFileUploadEvent,
} from '../storage/dto/file-upload-events.dto';
import {
  AddMembersDto,
  LeaveGroupDto,
  RemoveMemberDto,
  UpdateGroupInfoDto,
  UpdateMemberRoleDto,
} from '../conversations/dto/group-management.dto';
import { SendMessageEvent } from '../messages/dto/send-message-events.dto';
import {
  AddReactionEvent,
  RemoveReactionEvent,
} from '../messages/dto/message-reaction-events.dto';
import {
  MessageDeliveredEvent,
  MessageReadEvent,
} from '../messages/dto/message-status-events.dto';
import { JwtPayload } from './types/jwt.types';
import { RedisConversationEvent } from 'src/redis/types/redis-data.types';

@WebSocketGateway({
  cors: {
    origin: '*', // TODO: Update with process.env.FRONTEND_URL
    credentials: true,
  },
  namespace: '/chat',
})
@UsePipes(new ValidationPipe())
export class ChatGateway
  implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit
{
  @WebSocketServer()
  server: Server;

  constructor(
    private jwtService: JwtService,
    private configService: ConfigService,
    private socketService: SocketService,
    private connectionHandler: ConnectionHandler,
    private messagesHandler: MessagesHandler,
    private reactionsHandler: ReactionsHandler,
    private presenceHandler: PresenceHandler,
    private storageHandler: StorageHandler,
    private groupsHandler: GroupsHandler,
    private redisService: RedisService,
  ) {
    // Subscribe to Redis pub/sub for cross-server message delivery
    void this.subscribeToRedisChannels();
  }

  afterInit(server: Server) {
    // Share server instance globally
    this.socketService.setServer(server);
  }

  // ============================================
  // Connection Lifecycle
  // ============================================

  async handleConnection(client: Socket<any, any, any, SocketData>) {
    try {
      // Extract token from handshake
      const token =
        (client.handshake.auth.token as string) ||
        (client.handshake.headers.authorization?.split(' ')[1] as string);

      if (!token) {
        client.disconnect();
        return;
      }

      // Verify JWT token
      const payload = this.jwtService.verify<JwtPayload>(token, {
        secret: this.configService.get<string>('JWT_ACCESS_SECRET'),
      });

      const userId = payload.sub;

      // Attach user info to socket
      client.data.userId = userId;
      client.data.deviceId = payload.deviceId;

      // Delegate connection setup to handler
      await this.connectionHandler.handleUserConnected(client, userId);
    } catch (error) {
      console.error('Connection error:', error);
      client.disconnect();
    }
  }

  async handleDisconnect(client: AuthenticatedSocket) {
    const userId = client.data.userId;
    if (userId) {
      await this.connectionHandler.handleUserDisconnected(userId);
    }
  }

  // ============================================
  // Message Events
  // ============================================

  @SubscribeMessage('send_message')
  handleSendMessage(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: SendMessageEvent,
  ) {
    return this.messagesHandler.sendMessage(client, data);
  }

  @SubscribeMessage('message_delivered')
  handleMessageDelivered(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: MessageDeliveredEvent,
  ) {
    return this.messagesHandler.markDelivered(client, data);
  }

  @SubscribeMessage('message_read')
  handleMessageRead(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: MessageReadEvent,
  ) {
    return this.messagesHandler.markRead(client, data);
  }

  // ============================================
  // Reaction Events
  // ============================================

  @SubscribeMessage('message:reaction:add')
  handleAddReaction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: AddReactionEvent,
  ) {
    return this.reactionsHandler.addReaction(client, data);
  }

  @SubscribeMessage('message:reaction:remove')
  handleRemoveReaction(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: RemoveReactionEvent,
  ) {
    return this.reactionsHandler.removeReaction(client, data);
  }

  @SubscribeMessage('message:reactions:get')
  handleGetReactions(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { messageId: string },
  ) {
    return this.reactionsHandler.getReactions(client, data);
  }

  // ============================================
  // Typing Indicators
  // ============================================

  @SubscribeMessage('typing_start')
  handleTypingStart(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: TypingEvent,
  ) {
    return this.presenceHandler.startTyping(client, data);
  }

  @SubscribeMessage('typing_stop')
  handleTypingStop(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: TypingEvent,
  ) {
    return this.presenceHandler.stopTyping(client, data);
  }

  // ============================================
  // File Upload Events
  // ============================================

  @SubscribeMessage('file:upload:request')
  handleFileUploadRequest(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: RequestFileUploadEvent,
  ) {
    return this.storageHandler.requestUpload(client, data);
  }

  @SubscribeMessage('file:upload:complete')
  handleFileUploadComplete(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: ConfirmFileUploadEvent,
  ) {
    return this.storageHandler.confirmUpload(client, data);
  }

  // ============================================
  // Group Management Events
  // ============================================

  @SubscribeMessage('group:members:add')
  handleAddMembers(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: AddMembersDto,
  ) {
    return this.groupsHandler.addMembers(client, data);
  }

  @SubscribeMessage('group:member:remove')
  handleRemoveMember(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: RemoveMemberDto,
  ) {
    return this.groupsHandler.removeMember(client, data);
  }

  @SubscribeMessage('group:leave')
  handleLeaveGroup(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: LeaveGroupDto,
  ) {
    return this.groupsHandler.leaveGroup(client, data);
  }

  @SubscribeMessage('group:role:update')
  handleUpdateRole(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: UpdateMemberRoleDto,
  ) {
    return this.groupsHandler.updateRole(client, data);
  }

  @SubscribeMessage('group:info:update')
  handleUpdateGroupInfo(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: UpdateGroupInfoDto,
  ) {
    return this.groupsHandler.updateGroupInfo(client, data);
  }

  @SubscribeMessage('group:members:get')
  handleGetMembers(
    @ConnectedSocket() client: AuthenticatedSocket,
    @MessageBody() data: { conversationId: string },
  ) {
    return this.groupsHandler.getMembers(client, data);
  }

  // ============================================
  // Redis Pub/Sub
  // ============================================

  private async subscribeToRedisChannels() {
    await this.redisService.subscribe(
      'conversation:*',
      (data: RedisConversationEvent) => {
        if (data.type === 'new_message' && data.message) {
          this.socketService.emitToConversation(
            data.message.conversationId,
            'new_message',
            data.message,
          );
        }
      },
    );
  }
}
