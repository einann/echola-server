import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { HttpModule } from '@nestjs/axios';
import { HealthController } from './health.controller';
import { PrismaHealthIndicator } from './indicators/prisma-health.indicator';
import { RedisHealthIndicator } from './indicators/redis-health.indicator';
import { MinioHealthIndicator } from './indicators/minio-health.indicator';
import { StorageModule } from '../storage/storage.module';

@Module({
  imports: [TerminusModule, HttpModule, StorageModule],
  controllers: [HealthController],
  providers: [PrismaHealthIndicator, RedisHealthIndicator, MinioHealthIndicator],
})
export class HealthModule {}
