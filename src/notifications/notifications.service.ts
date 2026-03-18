import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Logger } from 'nestjs-pino';
import * as admin from 'firebase-admin';
import { PrismaService } from '../prisma/prisma.service';
import { EnvironmentVariables } from '../config/env.validation';

export interface PushNotificationPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
  imageUrl?: string;
}

export interface SendNotificationOptions {
  userId: string;
  payload: PushNotificationPayload;
  conversationId?: string;
}

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private firebaseApp: admin.app.App | null = null;
  private isInitialized = false;

  constructor(
    private readonly configService: ConfigService<EnvironmentVariables>,
    private readonly prisma: PrismaService,
    private readonly logger: Logger,
  ) {}

  onModuleInit() {
    this.initializeFirebase();
  }

  onModuleDestroy() {
    if (this.firebaseApp) {
      void this.firebaseApp.delete();
    }
  }

  private initializeFirebase() {
    const projectId = this.configService.get('FIREBASE_PROJECT_ID', { infer: true });
    const privateKey = this.configService.get('FIREBASE_PRIVATE_KEY', { infer: true });
    const clientEmail = this.configService.get('FIREBASE_CLIENT_EMAIL', { infer: true });

    if (!projectId || !privateKey || !clientEmail) {
      this.logger.warn('Firebase credentials not configured. Push notifications disabled.');
      return;
    }

    try {
      // Handle escaped newlines in private key
      const formattedPrivateKey = privateKey.replace(/\\n/g, '\n');

      this.firebaseApp = admin.initializeApp({
        credential: admin.credential.cert({
          projectId,
          privateKey: formattedPrivateKey,
          clientEmail,
        }),
      });

      this.isInitialized = true;
      this.logger.log('Firebase Admin SDK initialized successfully');
    } catch (error) {
      this.logger.error({ error }, 'Failed to initialize Firebase Admin SDK');
    }
  }

  /**
   * Send push notification to a specific user
   * Sends to all devices with FCM tokens registered for that user
   */
  async sendToUser(options: SendNotificationOptions): Promise<void> {
    if (!this.isInitialized || !this.firebaseApp) {
      this.logger.debug('Push notifications not available, skipping');
      return;
    }

    const { userId, payload, conversationId } = options;

    // Check if user has notifications enabled for this conversation
    if (conversationId) {
      const shouldNotify = await this.shouldNotifyUser(userId, conversationId);
      if (!shouldNotify) {
        this.logger.debug({ userId, conversationId }, 'User has muted this conversation');
        return;
      }
    }

    // Get all devices with FCM tokens for this user
    const devices = await this.prisma.device.findMany({
      where: {
        userId,
        fcmToken: { not: null },
      },
      select: {
        id: true,
        fcmToken: true,
        deviceName: true,
      },
    });

    if (devices.length === 0) {
      this.logger.debug({ userId }, 'No devices with FCM tokens found');
      return;
    }

    const tokens = devices.map((d) => d.fcmToken).filter((t): t is string => t !== null);

    if (tokens.length === 0) {
      return;
    }

    // Build the message
    const message: admin.messaging.MulticastMessage = {
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
        imageUrl: payload.imageUrl,
      },
      data: {
        ...payload.data,
        conversationId: conversationId || '',
        timestamp: new Date().toISOString(),
      },
      android: {
        priority: 'high',
        notification: {
          channelId: 'messages',
          priority: 'high',
          defaultSound: true,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'default',
            badge: 1,
          },
        },
      },
    };

    try {
      const response = await admin.messaging(this.firebaseApp).sendEachForMulticast(message);

      // Handle failed tokens (remove invalid ones)
      if (response.failureCount > 0) {
        const failedTokens: string[] = [];
        response.responses.forEach((resp, idx) => {
          if (!resp.success) {
            const errorCode = resp.error?.code;
            // Remove invalid/unregistered tokens
            if (
              errorCode === 'messaging/invalid-registration-token' ||
              errorCode === 'messaging/registration-token-not-registered'
            ) {
              failedTokens.push(tokens[idx]);
            }
          }
        });

        if (failedTokens.length > 0) {
          await this.removeInvalidTokens(failedTokens);
        }
      }

      this.logger.log(
        {
          userId,
          successCount: response.successCount,
          failureCount: response.failureCount,
        },
        'Push notifications sent',
      );
    } catch (error) {
      this.logger.error({ userId, error }, 'Failed to send push notifications');
    }
  }

  /**
   * Send notification for a new message
   */
  async sendNewMessageNotification(params: {
    recipientId: string;
    senderId: string;
    senderName: string;
    conversationId: string;
    conversationName?: string;
    messageContent: string;
    messageType: string;
    isGroup: boolean;
  }): Promise<void> {
    const {
      recipientId,
      senderName,
      conversationId,
      conversationName,
      messageContent,
      messageType,
      isGroup,
    } = params;

    let body: string;
    if (messageType === 'MEDIA') {
      body = `${senderName} sent a media message`;
    } else if (messageType === 'AUDIO') {
      body = `${senderName} sent a voice message`;
    } else {
      body = messageContent.length > 100 ? `${messageContent.substring(0, 97)}...` : messageContent;
    }

    const title = isGroup && conversationName ? `${senderName} in ${conversationName}` : senderName;

    await this.sendToUser({
      userId: recipientId,
      conversationId,
      payload: {
        title,
        body,
        data: {
          type: 'new_message',
          conversationId,
          senderId: params.senderId,
          messageType,
        },
      },
    });
  }

  /**
   * Check if user should receive notifications for a conversation
   */
  private async shouldNotifyUser(userId: string, conversationId: string): Promise<boolean> {
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        userId,
        conversationId,
        leftAt: null,
      },
      select: {
        isMuted: true,
        notifyOnMessage: true,
      },
    });

    if (!participant) {
      return false;
    }

    return !participant.isMuted && participant.notifyOnMessage;
  }

  /**
   * Remove invalid FCM tokens from database
   */
  private async removeInvalidTokens(tokens: string[]): Promise<void> {
    await this.prisma.device.updateMany({
      where: {
        fcmToken: { in: tokens },
      },
      data: {
        fcmToken: null,
      },
    });

    this.logger.log({ count: tokens.length }, 'Removed invalid FCM tokens');
  }

  /**
   * Register or update FCM token for a device
   */
  async registerToken(userId: string, deviceId: string, fcmToken: string): Promise<void> {
    await this.prisma.device.update({
      where: {
        id: deviceId,
        userId,
      },
      data: {
        fcmToken,
      },
    });

    this.logger.log({ userId, deviceId }, 'FCM token registered');
  }

  /**
   * Unregister FCM token for a device
   */
  async unregisterToken(userId: string, deviceId: string): Promise<void> {
    await this.prisma.device.update({
      where: {
        id: deviceId,
        userId,
      },
      data: {
        fcmToken: null,
      },
    });

    this.logger.log({ userId, deviceId }, 'FCM token unregistered');
  }
}
