import { IoAdapter } from '@nestjs/platform-socket.io';
import { ServerOptions, Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';
import { INestApplicationContext, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export class RedisIoAdapter extends IoAdapter {
  private adapterConstructor: ReturnType<typeof createAdapter>;
  private readonly logger = new Logger(RedisIoAdapter.name);

  constructor(
    private readonly app: INestApplicationContext,
    private readonly configService: ConfigService,
  ) {
    super(app);
  }

  async connectToRedis(): Promise<void> {
    const host = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port = this.configService.get<number>('REDIS_PORT', 6379);

    this.logger.log(`Attempting to connect to Redis at ${host}:${port}...`);

    const pubClient = createClient({
      socket: { host, port },
    });

    const subClient = pubClient.duplicate();

    const handleRedisError = (clientName: string, err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`❌ Redis ${clientName} Client Error: ${message}`);
    };

    pubClient.on('error', (err) => handleRedisError('Pub', err));
    subClient.on('error', (err) => handleRedisError('Sub', err));

    pubClient.on('connect', () => {
      this.logger.log('✅ Redis Pub Client connected');
    });

    subClient.on('connect', () => {
      this.logger.log('✅ Redis Sub Client connected');
    });

    try {
      await Promise.all([pubClient.connect(), subClient.connect()]);
      this.adapterConstructor = createAdapter(pubClient, subClient);
      this.logger.log('✅ Socket.IO Redis Adapter connected successfully');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`❌ Failed to connect Redis adapter: ${message}`);
      // Bağlantı başarısızsa uygulamanın çökmesi mi gerekiyor yoksa devam mı etmeli?
      // Genelde Redis yoksa socket çalışmayacağı için throw etmek mantıklıdır.
      throw error;
    }
  }

  createIOServer(port: number, options?: ServerOptions): Server {
    const server = super.createIOServer(port, options) as Server;

    server.adapter(this.adapterConstructor);

    return server;
  }
}
