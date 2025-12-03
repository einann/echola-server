import {
  Injectable,
  NestMiddleware,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { RedisService } from '../../redis/redis.service';

interface RateLimitConfig {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Max requests per window
  message?: string;
  skipSuccessfulRequests?: boolean;
}

@Injectable()
export class RateLimitMiddleware implements NestMiddleware {
  private config: RateLimitConfig;

  constructor(private redisService: RedisService) {
    // Default configuration
    this.config = {
      windowMs: 60 * 1000, // 1 minute
      maxRequests: 100, // 100 requests per minute
      message: 'Too many requests, please try again later',
      skipSuccessfulRequests: false,
    };
  }

  // Allow configuration per route
  configure(config: Partial<RateLimitConfig>) {
    this.config = { ...this.config, ...config };
    return this;
  }

  async use(req: Request, res: Response, next: NextFunction) {
    try {
      // Use IP + userId (if authenticated) as the key
      const identifier = this.getIdentifier(req);
      const key = `ratelimit:http:${identifier}`;

      // Use sliding window algorithm with Redis
      const current = await this.checkRateLimit(key);

      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', this.config.maxRequests);
      res.setHeader(
        'X-RateLimit-Remaining',
        Math.max(0, this.config.maxRequests - current),
      );
      res.setHeader('X-RateLimit-Reset', Date.now() + this.config.windowMs);

      if (current > this.config.maxRequests) {
        const retryAfter = Math.ceil(this.config.windowMs / 1000);
        res.setHeader('Retry-After', retryAfter);

        throw new HttpException(
          {
            statusCode: HttpStatus.TOO_MANY_REQUESTS,
            message: this.config.message,
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

  private getIdentifier(req: Request): string {
    // Prefer userId for authenticated requests
    if (req.userId) {
      return `user:${req.userId}`;
    }

    // Fall back to IP for unauthenticated requests
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    return `ip:${ip}`;
  }

  private async checkRateLimit(key: string): Promise<number> {
    const redis = this.redisService.getClient();

    // Increment counter
    const current = await redis.incr(key);

    // Set expiry on first request
    if (current === 1) {
      await redis.pexpire(key, this.config.windowMs);
    }

    return current;
  }
}

// Factory function for different rate limits per route
export function createRateLimitMiddleware(
  redisService: RedisService,
  config: Partial<RateLimitConfig>,
): NestMiddleware {
  const middleware = new RateLimitMiddleware(redisService);
  middleware.configure(config);
  return middleware;
}
