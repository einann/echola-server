import { plainToInstance } from 'class-transformer';
import {
  IsString,
  IsNumber,
  IsEnum,
  IsBoolean,
  IsUrl,
  validateSync,
  Min,
} from 'class-validator';

enum Environment {
  Development = 'development',
  Production = 'production',
  Test = 'test',
}

export class EnvironmentVariables {
  // ============================================
  // App Configuration
  // ============================================
  @IsEnum(Environment)
  NODE_ENV: Environment;

  @IsNumber()
  @Min(1)
  PORT: number;

  @IsUrl({ require_tld: false })
  FRONTEND_URL: string;

  // ============================================
  // Database Configuration
  // ============================================
  @IsString()
  DATABASE_URL: string;

  @IsString()
  POSTGRES_USER: string;

  @IsString()
  POSTGRES_PASSWORD: string;

  @IsString()
  POSTGRES_DB: string;

  // ============================================
  // Redis Configuration
  // ============================================
  @IsString()
  REDIS_HOST: string;

  @IsNumber()
  @Min(1)
  REDIS_PORT: number;

  // ============================================
  // JWT Configuration
  // ============================================
  @IsString()
  JWT_ACCESS_SECRET: string;

  @IsString()
  JWT_REFRESH_SECRET: string;

  @IsString()
  JWT_ACCESS_EXPIRATION: string; // e.g., "15m", "1h"

  @IsString()
  JWT_REFRESH_EXPIRATION: string; // e.g., "7d", "30d"

  // ============================================
  // S3/MinIO Configuration
  // ============================================
  @IsString()
  S3_ENDPOINT: string;

  @IsString()
  S3_REGION: string;

  @IsString()
  S3_ACCESS_KEY: string;

  @IsString()
  S3_SECRET_KEY: string;

  @IsString()
  S3_BUCKET_NAME: string;

  @IsBoolean()
  S3_USE_SSL: boolean;

  @IsString()
  MINIO_ROOT_USER: string;

  @IsString()
  MINIO_ROOT_PASSWORD: string;

  // ============================================
  // File Upload Limits (in bytes)
  // ============================================
  @IsNumber()
  @Min(1)
  MAX_IMAGE_SIZE: number;

  @IsNumber()
  @Min(1)
  MAX_VIDEO_SIZE: number;

  @IsNumber()
  @Min(1)
  MAX_DOCUMENT_SIZE: number;
}

export function validate(config: Record<string, unknown>) {
  const validatedConfig = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true, // Converts strings to numbers/booleans
  });

  const errors = validateSync(validatedConfig, {
    skipMissingProperties: false, // Fail if any property is missing
  });

  if (errors.length > 0) {
    // Format error messages nicely
    const formattedErrors = errors
      .map((error) => {
        const constraints = Object.values(error.constraints || {});
        return `  ❌ ${error.property}: ${constraints.join(', ')}`;
      })
      .join('\n');

    throw new Error(
      `\n🔴 Environment validation failed:\n${formattedErrors}\n\nPlease check your .env file and ensure all required variables are set.\n`,
    );
  }

  return validatedConfig;
}
