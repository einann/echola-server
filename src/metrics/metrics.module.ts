import { Module } from '@nestjs/common';
import {
  PrometheusModule,
  makeCounterProvider,
  makeGaugeProvider,
} from '@willsoto/nestjs-prometheus';

@Module({
  imports: [
    PrometheusModule.register({
      path: '/metrics',
      defaultMetrics: {
        enabled: true,
      },
    }),
  ],
  providers: [
    // HTTP request metrics
    makeCounterProvider({
      name: 'http_requests_total',
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'path', 'status'],
    }),

    // WebSocket connection metrics
    makeGaugeProvider({
      name: 'websocket_connections_active',
      help: 'Number of active WebSocket connections',
    }),

    // WebSocket event metrics
    makeCounterProvider({
      name: 'websocket_messages_total',
      help: 'Total number of WebSocket messages sent',
      labelNames: ['event'],
    }),

    // Message metrics
    makeCounterProvider({
      name: 'messages_sent_total',
      help: 'Total number of messages sent',
      labelNames: ['type'],
    }),

    // Authentication metrics
    makeCounterProvider({
      name: 'auth_attempts_total',
      help: 'Total number of authentication attempts',
      labelNames: ['result'],
    }),
  ],
  exports: [PrometheusModule],
})
export class MetricsModule {}
