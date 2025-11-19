import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly client: Redis;
  private readonly pubClient: Redis;
  private readonly subClient: Redis;

  constructor(private configService: ConfigService) {
    const redisConfig = {
      host: this.configService.get('REDIS_HOST') as string,
      port: this.configService.get('REDIS_PORT') as number,
    };

    this.client = new Redis(redisConfig);
    this.pubClient = new Redis(redisConfig);
    this.subClient = new Redis(redisConfig);
  }

  onModuleInit() {
    this.client.on('error', (err) => console.error('Redis Client Error:', err));
    this.pubClient.on('error', (err) =>
      console.error('Redis Pub Client Error:', err),
    );
    this.subClient.on('error', (err) =>
      console.error('Redis Sub Client Error:', err),
    );
  }

  // ============================================
  // Basic Key-Value Operations
  // ============================================

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    if (ttlSeconds) {
      await this.client.setex(key, ttlSeconds, value);
    } else {
      await this.client.set(key, value);
    }
  }

  async get(key: string): Promise<string | null> {
    return await this.client.get(key);
  }

  async del(key: string): Promise<void> {
    await this.client.del(key);
  }

  async exists(key: string): Promise<boolean> {
    const result = await this.client.exists(key);
    return result === 1;
  }

  // ============================================
  // User Presence Management
  // ============================================

  async setUserOnline(userId: string, socketId: string): Promise<void> {
    const key = `user:${userId}:online`;
    await this.client.set(key, socketId);
    await this.client.sadd('online:users', userId);
  }

  async setUserOffline(userId: string): Promise<void> {
    const key = `user:${userId}:online`;
    await this.client.del(key);
    await this.client.srem('online:users', userId);
  }

  async isUserOnline(userId: string): Promise<boolean> {
    const key = `user:${userId}:online`;
    return await this.exists(key);
  }

  async getUserSocketId(userId: string): Promise<string | null> {
    const key = `user:${userId}:online`;
    return await this.client.get(key);
  }

  async getOnlineUsers(): Promise<string[]> {
    return await this.client.smembers('online:users');
  }

  // ============================================
  // Undelivered Message Inbox (ZSET)
  // ============================================

  async addToInbox(userId: string, message: any): Promise<void> {
    const key = `inbox:${userId}`;
    const score = Date.now(); // timestamp as score
    await this.client.zadd(key, score, JSON.stringify(message));
    // Set 7-day expiry on inbox
    await this.client.expire(key, 7 * 24 * 60 * 60);
  }

  async getInboxMessages(userId: string, limit = 100): Promise<any[]> {
    const key = `inbox:${userId}`;
    const messages = await this.client.zrange(key, 0, limit - 1);
    return messages.map((msg) => JSON.parse(msg));
  }

  async removeFromInbox(userId: string, messageId: string): Promise<void> {
    const key = `inbox:${userId}`;
    const messages = await this.client.zrange(key, 0, -1);

    for (const msg of messages) {
      const parsed = JSON.parse(msg);
      if (parsed.id === messageId) {
        await this.client.zrem(key, msg);
        break;
      }
    }
  }

  async clearInbox(userId: string): Promise<void> {
    const key = `inbox:${userId}`;
    await this.client.del(key);
  }

  // ============================================
  // Message Caching
  // ============================================

  async cacheConversationMessages(
    conversationId: string,
    messages: any[],
    ttl = 3600,
  ): Promise<void> {
    const key = `conversation:${conversationId}:messages`;
    await this.client.setex(key, ttl, JSON.stringify(messages));
  }

  async getCachedMessages(conversationId: string): Promise<any[] | null> {
    const key = `conversation:${conversationId}:messages`;
    const cached = await this.client.get(key);
    return cached ? JSON.parse(cached) : null;
  }

  async invalidateConversationCache(conversationId: string): Promise<void> {
    const key = `conversation:${conversationId}:messages`;
    await this.client.del(key);
  }

  // ============================================
  // Typing Indicators (5-second TTL)
  // ============================================

  async setTyping(conversationId: string, userId: string): Promise<void> {
    const key = `typing:${conversationId}:${userId}`;
    await this.client.setex(key, 5, 'typing'); // 5-second TTL
  }

  async getTypingUsers(conversationId: string): Promise<string[]> {
    const pattern = `typing:${conversationId}:*`;
    const keys = await this.client.keys(pattern);
    return keys.map((key) => key.split(':')[2]);
  }

  // ============================================
  // Pub/Sub for Multi-Server Communication
  // ============================================

  getPubClient(): Redis {
    return this.pubClient;
  }

  getSubClient(): Redis {
    return this.subClient;
  }

  async publish(channel: string, message: any): Promise<void> {
    await this.pubClient.publish(channel, JSON.stringify(message));
  }

  async subscribe(
    channel: string,
    callback: (message: any) => void,
  ): Promise<void> {
    await this.subClient.subscribe(channel);
    this.subClient.on('message', (chan, msg) => {
      if (chan === channel) {
        callback(JSON.parse(msg));
      }
    });
  }

  // ============================================
  // Cleanup
  // ============================================

  onModuleDestroy() {
    this.client.disconnect();
    this.pubClient.disconnect();
    this.subClient.disconnect();
  }
}
