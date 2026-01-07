import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { RedisService } from '../../redis/redis.service';

@Injectable()
export class RedisHealthIndicator extends HealthIndicator {
  constructor(private redis: RedisService) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const client = this.redis.getClient();

      // Ping Redis
      const result = await client.ping();

      if (result !== 'PONG') {
        throw new Error('Redis ping failed');
      }

      return this.getStatus(key, true, { message: 'Redis is healthy' });
    } catch (error) {
      throw new HealthCheckError(
        'Redis health check failed',
        this.getStatus(key, false, { message: error.message }),
      );
    }
  }
}
