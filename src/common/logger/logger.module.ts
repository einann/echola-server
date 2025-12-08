/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule } from 'nestjs-pino';
import { ConfigModule, ConfigService } from '@nestjs/config';

@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const isDevelopment = configService.get('NODE_ENV') === 'development';

        return {
          pinoHttp: {
            level: isDevelopment ? 'debug' : 'info',

            // Pretty print in development, JSON in production
            transport: isDevelopment
              ? {
                  target: 'pino-pretty',
                  options: {
                    colorize: true,
                    translateTime: 'HH:MM:ss Z',
                    ignore: 'pid,hostname',
                    singleLine: false,
                    messageFormat:
                      '{req.method} {req.url} {res.statusCode} - {responseTime}ms',
                  },
                }
              : undefined,

            // Custom log level for HTTP requests
            customLogLevel: (req, res, err) => {
              if (res.statusCode >= 500 || err) return 'error';
              if (res.statusCode >= 400) return 'warn';
              return 'info';
            },

            // Custom success message
            customSuccessMessage: (req, res) => {
              return `${req.method} ${req.url} completed`;
            },

            // Custom error message
            customErrorMessage: (req, res, err) => {
              return `${req.method} ${req.url} failed: ${err.message}`;
            },

            // Add custom properties to every log
            customProps: (req, res) => ({
              // @ts-expect-error 'todo'
              requestId: req.requestId,
              // @ts-expect-error 'todo'
              userId: req.userId || 'anonymous',
              // @ts-expect-error 'todo'
              deviceId: req.deviceId,
              userAgent: req.headers['user-agent'],
            }),

            // Customize what gets logged from request/response
            serializers: {
              req: (req) => ({
                id: req.id,
                method: req.method,
                url: req.url,
                // Remove sensitive headers
                headers: {
                  host: req.headers.host,
                  'user-agent': req.headers['user-agent'],
                  // Don't log Authorization header
                },
                remoteAddress: req.remoteAddress,
                remotePort: req.remotePort,
              }),
              res: (res) => ({
                statusCode: res.statusCode,
                headers: {
                  'content-type': res.getHeader('content-type'),
                  'x-request-id': res.getHeader('x-request-id'),
                },
              }),
            },

            // Automatically log all requests
            autoLogging: {
              ignore: (req) => {
                // Don't log health checks (reduces noise)
                return req.url === '/health';
              },
            },
          },
        };
      },
    }),
  ],
})
export class LoggerModule {}
