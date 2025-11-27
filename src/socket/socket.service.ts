import { Injectable } from '@nestjs/common';
import { Server } from 'socket.io';

@Injectable()
export class SocketService {
  private server: Server;

  setServer(server: Server) {
    this.server = server;
  }

  getServer(): Server {
    return this.server;
  }

  // Convenience methods for common operations
  emitToRoom(room: string, event: string, data: any) {
    this.server.to(room).emit(event, data);
  }

  emitToUser(userId: string, event: string, data: any) {
    this.server.to(`user:${userId}`).emit(event, data);
  }

  emitToConversation(conversationId: string, event: string, data: any) {
    this.server.to(`conversation:${conversationId}`).emit(event, data);
  }

  async getUserSockets(userId: string) {
    return await this.server.to(`user:${userId}`).fetchSockets();
  }

  async getConversationSockets(conversationId: string) {
    return await this.server
      .to(`conversation:${conversationId}`)
      .fetchSockets();
  }
}
