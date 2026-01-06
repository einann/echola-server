import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  MemoryHealthIndicator,
  DiskHealthIndicator,
} from '@nestjs/terminus';
import { PrismaHealthIndicator } from './indicators/prisma-health.indicator';
import { RedisHealthIndicator } from './indicators/redis-health.indicator';
// import { MinioHealthIndicator } from './indicators/minio-health.indicator';

@Controller('health')
export class HealthController {
  constructor(
    private health: HealthCheckService,
    private prismaHealth: PrismaHealthIndicator,
    private redisHealth: RedisHealthIndicator,
    // private minioHealth: MinioHealthIndicator,
    private memory: MemoryHealthIndicator,
    private disk: DiskHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  check() {
    return this.health.check([
      // Database health
      () => this.prismaHealth.isHealthy('database'),

      // Redis health
      () => this.redisHealth.isHealthy('redis'),

      // MinIO/S3 health
      // () => this.minioHealth.isHealthy('storage'),

      // Memory health (heap should not exceed 150MB)
      () => this.memory.checkHeap('memory_heap', 150 * 1024 * 1024),

      // Disk health (should have at least 50GB free)
      () =>
        this.disk.checkStorage('storage_disk', {
          path: '/',
          thresholdPercent: 0.9, // Alert if 90% full
        }),
    ]);
  }

  // Liveness probe (is the app running?)
  @Get('live')
  @HealthCheck()
  checkLive() {
    return this.health.check([
      // Just check if app is running (no external dependencies)
      () => this.memory.checkHeap('memory_heap', 300 * 1024 * 1024),
    ]);
  }

  // Readiness probe (is the app ready to receive traffic?)
  @Get('ready')
  @HealthCheck()
  checkReady() {
    return this.health.check([
      // Check critical dependencies
      () => this.prismaHealth.isHealthy('database'),
      () => this.redisHealth.isHealthy('redis'),
    ]);
  }
}
