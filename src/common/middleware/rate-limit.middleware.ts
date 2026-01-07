import { Injectable, NestMiddleware, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  constructor(private redisService: RedisService) {}

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      const path = this.getCleanPath(req.originalUrl);

      // Get rate limit config based on route
      const config = this.getRateLimitConfig(path);

      // Skip rate limiting for health checks
      if (path === '/health' || path === '/') {
        return next();
      }

      const identifier = this.getIdentifier(req);
      const key = `ratelimit:http:${identifier}:${this.getRouteKey(path)}`;

      // Check rate limit
      const current = await this.checkRateLimit(key, config.windowMs);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', config.maxRequests);
      res.setHeader('X-RateLimit-Remaining', Math.max(0, config.maxRequests - current));
      res.setHeader('X-RateLimit-Reset', Date.now() + config.windowMs);

      if (current > config.maxRequests) {
        const retryAfter = Math.ceil(config.windowMs / 1000);
        res.setHeader('Retry-After', retryAfter);

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: config.message,
            retryAfter,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      next();
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      // If Redis fails, allow request (fail open)
      console.error('Rate limit middleware error:', error);
      next();
    }
  }

  private getCleanPath(originalUrl: string): string {
    // Remove query string if present
    // /auth/login?redirect=/dashboard -> /auth/login
    return originalUrl.split('?')[0];
  }

  private getRateLimitConfig(path: string) {
    // Stricter limits for auth endpoints
    if (path.includes('/auth/login') || path.includes('/auth/register')) {
      return {
        windowMs: 15 * 60 * 1000, // 15 minutes
        maxRequests: 5,
        message: 'Too many authentication attempts, please try again later',
      };
    }

    // Moderate limits for file uploads
    if (path.includes('/storage/upload') || path.includes('/storage/presigned-url')) {
      return {
        windowMs: 60 * 60 * 1000, // 1 hour
        maxRequests: 50,
        message: 'Upload limit reached, please try again later',
      };
    }

    // Default limits for all other endpoints
    return {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 100,
      message: 'Too many requests, please try again later',
    };
  }

  private getIdentifier(req: Request): string {
    // Prefer userId for authenticated requests
    if (req.userId) {
      return `user:${req.userId}`;
    }

    // Fall back to IP for unauthenticated requests
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return `ip:${ip}`;
  }

  private getRouteKey(path: string): string {
    // Normalize route (remove dynamic params)
    // /conversations/123/messages -> /conversations/:id/messages
    return path
      .split('/')
      .map((segment) => (segment.match(/^[0-9a-f]{8}-[0-9a-f]{4}-/i) ? ':id' : segment))
      .join('/');
  }

  private async checkRateLimit(key: string, windowMs: number): Promise<number> {
    const redis = this.redisService.getClient();

    // Increment counter
    const current = await redis.incr(key);

    // Set expiry on first request
    if (current === 1) {
      await redis.pexpire(key, windowMs);
    }

    return current;
  }
}
