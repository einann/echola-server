/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { BaseWsExceptionFilter } from '@nestjs/websockets';
import {
  AuthenticatedSocket,
  SocketData,
} from 'src/gateway/types/socket.types';

interface ErrorResponse {
  message: string;
  code: string;
  timestamp: string;
}

@Catch()
export class AllWsExceptionsFilter extends BaseWsExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<AuthenticatedSocket>();
    const data = host.switchToWs().getData<SocketData>();

    const errorResponse = this.buildErrorResponse(exception);

    // Emit error to client
    client.emit('error', errorResponse);

    // Log error with context
    this.logError(exception, client.data?.userId, data);
  }

  private buildErrorResponse(exception: unknown): ErrorResponse {
    const timestamp = new Date().toISOString();

    // Handle NestJS HTTP exceptions (from services)
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const message =
        typeof response === 'string'
          ? response
          : (response as any).message || 'An error occurred';

      return {
        message,
        code: this.mapHttpStatusToCode(status),
        timestamp,
      };
    }

    // Handle standard Error
    if (exception instanceof Error) {
      return {
        message: exception.message,
        code: 'INTERNAL_ERROR',
        timestamp,
      };
    }

    // Unknown error type
    return {
      message: 'An unknown error occurred',
      code: 'UNKNOWN_ERROR',
      timestamp,
    };
  }

  private mapHttpStatusToCode(status: number): string {
    const statusMap: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'VALIDATION_ERROR',
      429: 'RATE_LIMIT_EXCEEDED',
      500: 'INTERNAL_ERROR',
    };
    return statusMap[status] || 'INTERNAL_ERROR';
  }

  private logError(exception: unknown, userId?: string, eventData?: any) {
    const errorInfo = {
      timestamp: new Date().toISOString(),
      userId,
      eventData,
      error:
        exception instanceof Error
          ? {
              name: exception.name,
              message: exception.message,
              stack: exception.stack,
            }
          : exception,
    };

    // Log based on error type
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      // Client errors (4xx) - log as warning
      console.warn('WebSocket client error:', errorInfo);
    } else {
      // Server errors (5xx) or unknown - log as error
      console.error('WebSocket server error:', errorInfo);
    }

    // TODO: In production, send to monitoring service
    // this.monitoringService.captureException(exception, errorInfo);
  }
}
