import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from './env.validation';

export function initializeSentry(
  configService: ConfigService<EnvironmentVariables>,
) {
  const dsn = configService.get('SENTRY_DSN', { infer: true });
  const environment = configService.get<string>('NODE_ENV', { infer: true });

  // Only initialize if DSN is provided
  if (!dsn) {
    console.log('⚠️  Sentry DSN not provided - error tracking disabled');
    return;
  }

  Sentry.init({
    dsn,
    environment,

    // Set tracesSampleRate to 1.0 to capture 100% of transactions for performance monitoring.
    // We recommend adjusting this value in production
    tracesSampleRate: environment === 'production' ? 0.1 : 1.0,

    // Set profilesSampleRate to 1.0 to profile every transaction.
    // Since profilesSampleRate is relative to tracesSampleRate,
    // the final profiling rate can be computed as tracesSampleRate * profilesSampleRate
    profilesSampleRate: 1.0,

    integrations: [nodeProfilingIntegration()],

    // Don't send errors in development (optional)
    enabled: environment !== 'development',

    // Add custom tags
    initialScope: {
      tags: {
        service: 'echola-backend',
      },
    },

    // Filter out sensitive data
    beforeSend(event) {
      // Remove sensitive headers
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    },
  });

  console.log('✅ Sentry initialized for error tracking');
}
