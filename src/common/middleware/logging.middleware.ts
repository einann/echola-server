import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  constructor(private configService: ConfigService) {}

  use(req: Request, res: Response, next: NextFunction) {
    const { method, originalUrl, ip, requestId } = req;
    const userAgent = req.get('user-agent') || 'Unknown';

    // Log incoming request
    this.logRequest(method, originalUrl, ip ?? '', userAgent, requestId);

    // Capture response
    const originalSend = res.send;
    res.send = function (data) {
      res.send = originalSend;
      return res.send(data);
    };

    // Log response when finished
    res.on('finish', () => {
      const { statusCode } = res;
      const responseTime = Date.now() - req.startTime;

      this.logResponse(
        method,
        originalUrl,
        statusCode,
        responseTime,
        requestId,
        req.userId,
      );
    });

    next();
  }

  private logRequest(
    method: string,
    url: string,
    ip: string,
    userAgent: string,
    requestId: string,
  ) {
    const isDevelopment = this.configService.get('NODE_ENV') === 'development';

    if (isDevelopment) {
      console.log(`[${requestId}] → ${method} ${url}`);
      console.log(`  IP: ${ip} | User-Agent: ${userAgent}`);
    }
  }

  private logResponse(
    method: string,
    url: string,
    statusCode: number,
    responseTime: number,
    requestId: string,
    userId?: string,
  ) {
    const isDevelopment = this.configService.get('NODE_ENV') === 'development';

    // Color code by status in development
    const statusColor = this.getStatusColor(statusCode);
    const statusEmoji = this.getStatusEmoji(statusCode);

    const logMessage = {
      requestId,
      method,
      url,
      statusCode,
      responseTime: `${responseTime}ms`,
      userId: userId || 'anonymous',
      timestamp: new Date().toISOString(),
    };

    if (isDevelopment) {
      console.log(
        `[${requestId}] ${statusEmoji} ${method} ${url} ${statusColor}${statusCode}\x1b[0m ${responseTime}ms ${userId ? `(User: ${userId})` : ''}`,
      );
    } else {
      // In production, use structured logging (JSON format for log aggregation)
      console.log(JSON.stringify(logMessage));
    }

    // Log slow requests (>1000ms)
    if (responseTime > 1000) {
      console.warn(
        `⚠️  SLOW REQUEST [${requestId}]: ${method} ${url} took ${responseTime}ms`,
      );
    }

    // Log errors (5xx status codes)
    if (statusCode >= 500) {
      console.error(
        `❌ ERROR [${requestId}]: ${method} ${url} returned ${statusCode}`,
      );
    }
  }

  private getStatusColor(statusCode: number): string {
    if (statusCode >= 500) return '\x1b[31m'; // Red
    if (statusCode >= 400) return '\x1b[33m'; // Yellow
    if (statusCode >= 300) return '\x1b[36m'; // Cyan
    if (statusCode >= 200) return '\x1b[32m'; // Green
    return '\x1b[0m'; // Reset
  }

  private getStatusEmoji(statusCode: number): string {
    if (statusCode >= 500) return '❌';
    if (statusCode >= 400) return '⚠️';
    if (statusCode >= 300) return '↪️';
    if (statusCode >= 200) return '✅';
    return '📝';
  }
}
