import 'express';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      startTime: number;
      userId?: string;
      deviceId?: string;
    }
  }
}
