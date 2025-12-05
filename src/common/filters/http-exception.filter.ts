import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';

interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
  path: string;
  requestId: string;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  constructor(private configService: ConfigService) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const errorResponse = this.buildErrorResponse(exception, request);
    const status = this.getStatus(exception);

    // Log error server-side
    this.logError(exception, request);

    // Send sanitized error to client
    response.status(status).json(errorResponse);
  }

  private buildErrorResponse(
    exception: unknown,
    request: Request,
  ): ErrorResponse {
    const timestamp = new Date().toISOString();
    const path = request.originalUrl;
    const requestId = request.requestId || 'unknown';

    // Handle Prisma errors
    if (exception instanceof PrismaClientKnownRequestError) {
      return {
        success: false,
        error: this.handlePrismaError(exception),
        timestamp,
        path,
        requestId,
      };
    }

    // Handle NestJS HTTP exceptions
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      const message =
        typeof exceptionResponse === 'string'
          ? exceptionResponse
          : (exceptionResponse as any).message || 'An error occurred';

      const details =
        typeof exceptionResponse === 'object'
          ? (exceptionResponse as any).details
          : undefined;

      return {
        success: false,
        error: {
          code: this.mapHttpStatusToCode(status),
          message: Array.isArray(message) ? message.join(', ') : message,
          details,
        },
        timestamp,
        path,
        requestId,
      };
    }

    // Handle standard errors
    const isDevelopment = this.configService.get('NODE_ENV') === 'development';

    return {
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message:
          isDevelopment && exception instanceof Error
            ? exception.message
            : 'An internal server error occurred',
      },
      timestamp,
      path,
      requestId,
    };
  }

  private handlePrismaError(error: PrismaClientKnownRequestError) {
    switch (error.code) {
      case 'P2002':
        return {
          code: 'DUPLICATE_ENTRY',
          message: 'A record with this information already exists',
          details: { field: (error.meta?.target as string[]) || [] },
        };

      case 'P2025':
        return {
          code: 'NOT_FOUND',
          message: 'The requested record was not found',
        };

      case 'P2003':
        return {
          code: 'INVALID_REFERENCE',
          message: 'Referenced record does not exist',
          details: { field: error.meta?.field_name },
        };

      case 'P2014':
        return {
          code: 'MISSING_RELATION',
          message: 'Required relationship is missing',
        };

      default:
        return {
          code: 'DATABASE_ERROR',
          message: 'A database error occurred',
        };
    }
  }

  private getStatus(exception: unknown): number {
    if (exception instanceof HttpException) {
      return exception.getStatus();
    }

    if (exception instanceof PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002':
          return HttpStatus.CONFLICT;
        case 'P2025':
          return HttpStatus.NOT_FOUND;
        case 'P2003':
        case 'P2014':
          return HttpStatus.BAD_REQUEST;
        default:
          return HttpStatus.INTERNAL_SERVER_ERROR;
      }
    }

    return HttpStatus.INTERNAL_SERVER_ERROR;
  }

  private mapHttpStatusToCode(status: number): string {
    const statusMap: Record<number, string> = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      408: 'REQUEST_TIMEOUT',
      409: 'CONFLICT',
      422: 'VALIDATION_ERROR',
      429: 'RATE_LIMIT_EXCEEDED',
      500: 'INTERNAL_ERROR',
      503: 'SERVICE_UNAVAILABLE',
    };
    return statusMap[status] || 'INTERNAL_ERROR';
  }

  private logError(exception: unknown, request: Request) {
    const isDevelopment = this.configService.get('NODE_ENV') === 'development';
    const { method, url, requestId, userId, ip } = request;

    const errorInfo = {
      timestamp: new Date().toISOString(),
      requestId,
      method,
      url,
      userId: userId || 'anonymous',
      ip,
    };

    if (isDevelopment) {
      console.error('HTTP Exception (DEV):', {
        ...errorInfo,
        error:
          exception instanceof Error
            ? {
                name: exception.name,
                message: exception.message,
                stack: exception.stack,
              }
            : exception,
      });
    } else {
      // Production: minimal logging
      console.error('HTTP Exception:', {
        ...errorInfo,
        errorType: exception instanceof Error ? exception.name : 'Unknown',
        errorCode:
          exception instanceof PrismaClientKnownRequestError
            ? exception.code
            : 'N/A',
      });

      // TODO: Send to monitoring service (Sentry, DataDog, etc.)
      // this.monitoringService.captureException(exception, {
      //   context: 'http',
      //   requestId,
      //   userId,
      //   url,
      // });
    }
  }
}
