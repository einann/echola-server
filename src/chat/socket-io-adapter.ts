import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { INestApplicationContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// src/adapters/redis-io.adapter.ts
export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;

  constructor(
    app: INestApplicationContext,
    private configService: ConfigService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const redisHost = this.configService.get('REDIS_HOST') as string;
    const redisPort = this.configService.get('REDIS_PORT') as number;

    console.log(
      `Attempting to connect to Redis at ${redisHost}:${redisPort}...`,
    );

    const pubClient = createClient({
      socket: {
        host: redisHost,
        port: redisPort,
      },
    });

    const subClient = pubClient.duplicate();

    // Add error handlers BEFORE connecting
    pubClient.on('error', (err) => {
      console.error('❌ Redis Pub Client Error:', err.message);
    });

    subClient.on('error', (err) => {
      console.error('❌ Redis Sub Client Error:', err.message);
    });

    pubClient.on('connect', () => {
      console.log('✅ Redis Pub Client connected');
    });

    subClient.on('connect', () => {
      console.log('✅ Redis Sub Client connected');
    });

    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.adapterConstructor = createAdapter(pubClient, subClient);
      console.log('✅ Socket.IO Redis Adapter connected successfully');
    } catch (error) {
      console.error('❌ Failed to connect Redis adapter:', error.message);
      throw error;
    }
  }

  createIOServer(port: number, options?: ServerOptions): any {
    const server = super.createIOServer(port, options);
    server.adapter(this.adapterConstructor);
    return server;
  }
}
