import { Socket } from 'socket.io';

export interface SocketData {
  userId: string;
  deviceId: string;
}

export interface AuthenticatedSocket extends Socket {
  data: SocketData;
}
