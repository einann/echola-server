import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Inject,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { PrismaClientKnownRequestError } from '@prisma/client/runtime/library';
import { Logger } from 'nestjs-pino';
import { EnvironmentVariables } from 'src/config/env.validation';

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
  constructor(
    private configService: ConfigService<EnvironmentVariables>,
    @Inject(Logger) private readonly logger?: Logger,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const errorResponse = this.buildErrorResponse(exception, request);
    const status = this.getStatus(exception);

    // Log error server-side
    this.logError(exception, request, status);

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

  private logError(exception: unknown, request: Request, status: number) {
    const { method, originalUrl, requestId, userId, ip } = request;

    const errorContext = {
      requestId,
      method,
      url: originalUrl,
      userId: userId || 'anonymous',
      ip,
      statusCode: status,
    };

    if (exception instanceof Error) {
      // Log with stack trace
      this.logger?.error(
        {
          ...errorContext,
          err: exception, // Pino automatically serializes Error objects
          errorType: exception.name,
        },
        exception.message,
      );
    } else if (exception instanceof PrismaClientKnownRequestError) {
      this.logger?.error(
        {
          ...errorContext,
          prismaCode: exception.code,
          prismaMessage: exception.message,
        },
        'Prisma database error',
      );
    } else {
      this.logger?.error(
        {
          ...errorContext,
          exception,
        },
        'Unknown exception occurred',
      );
    }
  }
}
