/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Catch, ArgumentsHost, HttpException } from '@nestjs/common';
import { BaseWsExceptionFilter } from '@nestjs/websockets';
import { ConfigService } from '@nestjs/config';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { Socket } from 'socket.io';

interface ErrorResponse {
  message: string;
  code: string;
  timestamp: string;
}

@Catch()
export class AllWsExceptionsFilter extends BaseWsExceptionFilter {
  constructor(private configService?: ConfigService) {
    super();
  }

  catch(exception: unknown, host: ArgumentsHost) {
    const client = host.switchToWs().getClient<Socket>();
    const data = host.switchToWs().getData<any>();

    const errorResponse = this.buildErrorResponse(exception);

    // Emit error to client (sanitized)
    client.emit('error', errorResponse);

    // Log full error details server-side only
    this.logError(exception, client.data?.userId, data);
  }

  private buildErrorResponse(exception: unknown): ErrorResponse {
    const timestamp = new Date().toISOString();

    // Handle Prisma errors specifically
    if (exception instanceof PrismaClientKnownRequestError) {
      return this.handlePrismaError(exception, timestamp);
    }

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

    // Handle standard Error (sanitized - no stack trace)
    if (exception instanceof Error) {
      // In production, don't expose internal error messages
      const isDevelopment =
        this.configService?.get('NODE_ENV') === 'development';

      return {
        message: isDevelopment
          ? exception.message
          : 'An internal error occurred',
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

  private handlePrismaError(
    error: PrismaClientKnownRequestError,
    timestamp: string,
  ): ErrorResponse {
    // Map Prisma error codes to user-friendly messages
    switch (error.code) {
      case 'P2002': // Unique constraint violation
        return {
          message: 'This record already exists',
          code: 'DUPLICATE_ENTRY',
          timestamp,
        };

      case 'P2025': // Record not found
        return {
          message: 'Record not found',
          code: 'NOT_FOUND',
          timestamp,
        };

      case 'P2003': // Foreign key constraint failed
        return {
          message: 'Related record not found',
          code: 'INVALID_REFERENCE',
          timestamp,
        };

      case 'P2014': // Required relation violation
        return {
          message: 'Required relationship is missing',
          code: 'MISSING_RELATION',
          timestamp,
        };

      default:
        return {
          message: 'Database operation failed',
          code: 'DATABASE_ERROR',
          timestamp,
        };
    }
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
    const isDevelopment = this.configService?.get('NODE_ENV') === 'development';

    const errorInfo = {
      timestamp: new Date().toISOString(),
      userId,
      event: eventData?.event || 'unknown',
      conversationId: eventData?.conversationId,
    };

    // In development, log full details
    if (isDevelopment) {
      console.error('WebSocket error (DEV):', {
        ...errorInfo,
        error:
          exception instanceof Error
            ? {
                name: exception.name,
                message: exception.message,
                stack: exception.stack,
              }
            : exception,
        eventData,
      });
    } else {
      // In production, log minimal info (no stack traces to console)
      console.error('WebSocket error:', {
        ...errorInfo,
        errorType: exception instanceof Error ? exception.name : 'Unknown',
        errorCode:
          exception instanceof PrismaClientKnownRequestError
            ? exception.code
            : 'N/A',
      });

      // Send to monitoring service (Sentry, DataDog, etc.)
      // this.monitoringService.captureException(exception, {
      //   context: 'websocket',
      //   userId,
      //   eventData,
      // });
    }
  }
}
