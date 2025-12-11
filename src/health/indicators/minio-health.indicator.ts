import { Injectable } from '@nestjs/common';
import {
  HealthIndicator,
  HealthIndicatorResult,
  HealthCheckError,
} from '@nestjs/terminus';
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

      // Check if bucket exists (this verifies MinIO connection)
      const exists = await this.storage.getBucketExists(bucketName); // TODO: will look again, maybe only client needed?

      if (!exists) {
        throw new Error(`Bucket '${bucketName}' does not exist`);
      }

      return this.getStatus(key, true, {
        message: 'Storage is healthy',
        bucket: bucketName,
      });
    } catch (error) {
      throw new HealthCheckError(
        'MinIO health check failed',
        this.getStatus(key, false, { message: error.message }),
      );
    }
  }
}
