import { Injectable } from '@nestjs/common';
import { HealthIndicator, HealthIndicatorResult, HealthCheckError } from '@nestjs/terminus';
import { StorageService } from '../../storage/storage.service';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from 'src/config/env.validation';

@Injectable()
export class MinioHealthIndicator extends HealthIndicator {
  constructor(
    private storage: StorageService,
    private config: ConfigService<EnvironmentVariables>,
  ) {
    super();
  }

  async isHealthy(key: string): Promise<HealthIndicatorResult> {
    try {
      const bucketName = this.config.get('S3_BUCKET_NAME', { infer: true })!;

      await this.storage.checkHealth();

      return this.getStatus(key, true, {
        message: 'Storage is healthy',
        bucket: bucketName,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new HealthCheckError(
        'MinIO health check failed',
        this.getStatus(key, false, { message }),
      );
    }
  }
}
