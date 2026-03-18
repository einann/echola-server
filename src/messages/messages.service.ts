/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { PrismaService } from '../prisma/prisma.service';
import { DeliveryStatus, MessageType, MediaType, Message } from 'generated/prisma/client';
import { CreateMediaMessageDto } from './dto/create-media-message.dto';
import { ConfigService } from '@nestjs/config';
import { EnvironmentVariables } from 'src/config/env.validation';
import { StorageService } from 'src/storage/storage.service';
import { StorageBucket } from 'src/storage/enums';
import { SendMessageDto } from './dto/send-message.dto';
import { ForwardMessageDto } from './dto/forward-message.dto';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService<EnvironmentVariables>,
    private storageService: StorageService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

  // ============================================
  // COMMON INCLUDES
  // ============================================

  private readonly messageInclude = {
    sender: {
      select: {
        id: true,
        displayName: true,
        username: true,
        avatarUrl: true,
      },
    },
    statuses: {
      include: {
        user: {
          select: {
            id: true,
            displayName: true,
          },
        },
      },
    },
    replyTo: {
      include: {
        sender: {
          select: {
            id: true,
            displayName: true,
            username: true,
          },
        },
        attachments: true, // Reply'da da attachment göster
      },
    },
    attachments: true,
  };

  // ============================================
  // SEND TEXT MESSAGE
  // ============================================

  async sendMessage(senderId: string, sendMessageDto: SendMessageDto) {
    const { conversationId, content, replyToId } = sendMessageDto;

    // Verify sender is participant
    await this.verifyParticipant(conversationId, senderId);

    // Validate content
    if (!content?.trim()) {
      throw new BadRequestException('Text messages must have content');
    }

    // Verify reply-to message if specified
    if (replyToId) {
      await this.verifyReplyToMessage(replyToId, conversationId);
    }

    // Get recipients
    const recipients = await this.getRecipients(conversationId, senderId);

    // Create message
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        type: MessageType.TEXT,
        content: content.trim(),
        replyToId,
        statuses: {
          create: recipients.map((recipient) => ({
            userId: recipient.userId,
            status: DeliveryStatus.SENT,
          })),
        },
      },
      include: this.messageInclude,
    });

    // Update conversation timestamp
    await this.touchConversation(conversationId);

    return message;
  }

  // ============================================
  // SEND MEDIA MESSAGE
  // ============================================

  async createMediaMessage(dto: CreateMediaMessageDto) {
    // Verify sender is participant
    await this.verifyParticipant(dto.conversationId, dto.senderId);

    // Verify reply-to if specified
    if (dto.replyToId) {
      await this.verifyReplyToMessage(dto.replyToId, dto.conversationId);
    }

    // Get recipients
    const recipients = await this.getRecipients(dto.conversationId, dto.senderId);

    // Determine media type from mimeType
    const mediaType = this.determineMediaType(dto.media.metadata.mimeType);

    // Create message with attachment
    const message = await this.prisma.message.create({
      data: {
        conversationId: dto.conversationId,
        senderId: dto.senderId,
        type: MessageType.MEDIA,
        content: dto.caption || null,
        replyToId: dto.replyToId,
        statuses: {
          create: recipients.map((recipient) => ({
            userId: recipient.userId,
            status: DeliveryStatus.SENT,
          })),
        },
        attachments: {
          create: {
            mediaType,
            mimeType: dto.media.metadata.mimeType,
            fileKey: dto.media.originalKey,
            bucket: dto.media.bucket || StorageBucket.MEDIA,
            url: dto.media.originalUrl,
            thumbnailKey: dto.media.thumbnailKey,
            thumbnailUrl: dto.media.thumbnailUrl,
            fileName: dto.media.fileName,
            fileSize: dto.media.originalSize,
            width: dto.media.metadata.width,
            height: dto.media.metadata.height,
            duration: dto.media.metadata.duration,
            waveformData: dto.media.waveformData || [],
          },
        },
      },
      include: this.messageInclude,
    });

    // Update conversation timestamp
    await this.touchConversation(dto.conversationId);

    this.logger.log(
      {
        messageId: message.id,
        conversationId: dto.conversationId,
        mediaType,
        fileSize: dto.media.originalSize,
      },
      'Media message created',
    );

    return message;
  }

  // ============================================
  // GET MESSAGES
  // ============================================

  async getMessages(userId: string, conversationId: string, limit = 50, beforeMessageId?: string) {
    await this.verifyParticipant(conversationId, userId);

    const cursor = beforeMessageId ? { id: beforeMessageId } : undefined;

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        isDeleted: false,
      },
      take: limit,
      skip: cursor ? 1 : 0,
      cursor,
      orderBy: { createdAt: 'desc' },
      include: {
        ...this.messageInclude,
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
      },
    });

    return messages.reverse();
  }

  async getMessageById(messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: true,
        ...this.messageInclude,
      },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return message;
  }

  // ============================================
  // MESSAGE STATUS UPDATES
  // ============================================

  async markMessageAsDelivered(userId: string, messageId: string) {
    const messageStatus = await this.prisma.messageStatus.findUnique({
      where: {
        messageId_userId: { messageId, userId },
      },
    });

    if (!messageStatus) {
      throw new NotFoundException('Message status not found');
    }

    if (messageStatus.status === DeliveryStatus.SENT) {
      return this.prisma.messageStatus.update({
        where: {
          messageId_userId: { messageId, userId },
        },
        data: {
          status: DeliveryStatus.DELIVERED,
          deliveredAt: new Date(),
        },
      });
    }

    return messageStatus;
  }

  async markMessageAsRead(userId: string, messageId: string) {
    const messageStatus = await this.prisma.messageStatus.findUnique({
      where: {
        messageId_userId: { messageId, userId },
      },
    });

    if (!messageStatus) {
      throw new NotFoundException('Message status not found');
    }

    return this.prisma.messageStatus.update({
      where: {
        messageId_userId: { messageId, userId },
      },
      data: {
        status: DeliveryStatus.READ,
        readAt: new Date(),
        deliveredAt: messageStatus.deliveredAt || new Date(),
      },
    });
  }

  async markConversationAsRead(userId: string, conversationId: string) {
    const participant = await this.verifyParticipant(conversationId, userId);

    const unreadStatuses = await this.prisma.messageStatus.findMany({
      where: {
        userId,
        status: { not: DeliveryStatus.READ },
        message: { conversationId },
      },
    });

    await this.prisma.messageStatus.updateMany({
      where: {
        id: { in: unreadStatuses.map((s) => s.id) },
      },
      data: {
        status: DeliveryStatus.READ,
        readAt: new Date(),
      },
    });

    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { lastReadAt: new Date() },
    });

    return { markedAsRead: unreadStatuses.length };
  }

  // ============================================
  // EDIT MESSAGE
  // ============================================

  async editMessage(userId: string, messageId: string, newContent: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only edit your own messages');
    }

    if (message.isDeleted) {
      throw new BadRequestException('Cannot edit deleted message');
    }

    // Only TEXT messages can be edited, or caption of MEDIA messages
    if (message.type !== MessageType.TEXT && message.type !== MessageType.MEDIA) {
      throw new BadRequestException('This message type cannot be edited');
    }

    return this.prisma.message.update({
      where: { id: messageId },
      data: {
        content: newContent.trim(),
        isEdited: true,
        editedAt: new Date(),
      },
      include: this.messageInclude,
    });
  }

  // ============================================
  // DELETE MESSAGE
  // ============================================

  async deleteMessage(messageId: string, userId: string, deleteForEveryone = false) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        attachments: true,
        conversation: {
          include: {
            participants: {
              where: { userId },
            },
          },
        },
      },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.isDeleted) {
      throw new NotFoundException('Message has already been deleted');
    }

    const userParticipant = message.conversation.participants[0];

    if (!userParticipant) {
      throw new ForbiddenException('You are not a member of this conversation');
    }

    // Permission checks
    const isSender = message.senderId === userId;
    const isAdmin = userParticipant.role === 'admin';
    const isGroupCreator = message.conversation.createdBy === userId;

    if (deleteForEveryone) {
      if (message.conversation.type === 'GROUP') {
        if (!isAdmin && !isGroupCreator) {
          throw new ForbiddenException('Only admins can delete messages for everyone');
        }
      } else {
        if (!isSender) {
          throw new ForbiddenException('You can only delete your own messages');
        }
      }
    } else {
      if (!isSender) {
        throw new ForbiddenException('You can only delete your own messages');
      }
    }

    // Delete attachments from storage if deleteForEveryone
    if (deleteForEveryone && message.attachments.length > 0) {
      await this.deleteMessageAttachments(message.attachments);
    }

    // Soft delete message
    const deletedMessage = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        type: MessageType.DELETED,
        content: null,
        // Attachment kayıtlarını da temizle (opsiyonel, cascade da yapabilirsin)
        attachments: deleteForEveryone ? { deleteMany: {} } : undefined,
      },
    });

    this.logger.log(
      {
        messageId,
        userId,
        conversationId: message.conversationId,
        deleteForEveryone,
        attachmentsDeleted: message.attachments.length,
      },
      'Message deleted',
    );

    return {
      success: true,
      messageId: deletedMessage.id,
      deletedAt: deletedMessage.deletedAt,
      deleteForEveryone,
    };
  }

  // ============================================
  // ATTACHMENT OPERATIONS
  // ============================================

  private async deleteMessageAttachments(
    attachments: {
      fileKey: string;
      bucket: string;
      thumbnailKey: string | null;
    }[],
  ) {
    const deletePromises: Promise<void>[] = [];

    for (const attachment of attachments) {
      // Delete main file
      deletePromises.push(
        this.storageService
          .delete(attachment.bucket as StorageBucket, attachment.fileKey)
          .catch((err) => {
            this.logger.warn(
              { fileKey: attachment.fileKey, error: err.message },
              'Failed to delete attachment file',
            );
          }),
      );

      // Delete thumbnail if exists
      if (attachment.thumbnailKey) {
        deletePromises.push(
          this.storageService
            .delete(StorageBucket.THUMBNAILS, attachment.thumbnailKey)
            .catch((err) => {
              this.logger.warn(
                { thumbnailKey: attachment.thumbnailKey, error: err.message },
                'Failed to delete thumbnail',
              );
            }),
        );
      }
    }

    await Promise.all(deletePromises);
  }

  // ============================================
  // UNREAD COUNT
  // ============================================

  async getUnreadCount(userId: string, conversationId: string) {
    const count = await this.prisma.messageStatus.count({
      where: {
        userId,
        status: { not: DeliveryStatus.READ },
        message: { conversationId },
      },
    });

    return { unreadCount: count };
  }

  // ============================================
  // FORWARD MESSAGE
  // ============================================

  async forwardMessage(senderId: string, dto: ForwardMessageDto) {
    // Get the original message with attachments
    const originalMessage = await this.prisma.message.findUnique({
      where: { id: dto.messageId },
      include: {
        attachments: true,
        sender: {
          select: {
            id: true,
            displayName: true,
            username: true,
          },
        },
      },
    });

    if (!originalMessage) {
      throw new NotFoundException('Message not found');
    }

    if (originalMessage.isDeleted) {
      throw new BadRequestException('Cannot forward a deleted message');
    }

    // Verify sender can access the original message's conversation
    await this.verifyParticipant(originalMessage.conversationId, senderId);

    // Verify sender is participant in all target conversations
    for (const targetConversationId of dto.targetConversationIds) {
      await this.verifyParticipant(targetConversationId, senderId);
    }

    // Determine the original sender for forwarding metadata
    // If the message was already forwarded, keep the original sender
    const forwardedFromUserId = originalMessage.forwardedFromUserId || originalMessage.senderId;
    const forwardedFromMessageId = originalMessage.forwardedFromMessageId || originalMessage.id;

    const forwardedMessages: Message[] = [];

    // Create forwarded message in each target conversation
    for (const targetConversationId of dto.targetConversationIds) {
      const recipients = await this.getRecipients(targetConversationId, senderId);

      // Create the forwarded message
      const forwardedMessage = await this.prisma.message.create({
        data: {
          conversationId: targetConversationId,
          senderId,
          type: originalMessage.type,
          content: originalMessage.content,
          forwardedFromMessageId,
          forwardedFromUserId,
          statuses: {
            create: recipients.map((recipient) => ({
              userId: recipient.userId,
              status: DeliveryStatus.SENT,
            })),
          },
          // Copy attachments if any
          attachments:
            originalMessage.attachments.length > 0
              ? {
                  create: originalMessage.attachments.map((attachment) => ({
                    mediaType: attachment.mediaType,
                    mimeType: attachment.mimeType,
                    fileKey: attachment.fileKey,
                    bucket: attachment.bucket,
                    url: attachment.url,
                    thumbnailKey: attachment.thumbnailKey,
                    thumbnailUrl: attachment.thumbnailUrl,
                    fileName: attachment.fileName,
                    fileSize: attachment.fileSize,
                    width: attachment.width,
                    height: attachment.height,
                    duration: attachment.duration,
                    waveformData: attachment.waveformData,
                    order: attachment.order,
                  })),
                }
              : undefined,
        },
        include: this.messageInclude,
      });

      await this.touchConversation(targetConversationId);
      forwardedMessages.push(forwardedMessage);
    }

    this.logger.log(
      {
        originalMessageId: dto.messageId,
        forwardedToCount: dto.targetConversationIds.length,
        senderId,
      },
      'Message forwarded',
    );

    return forwardedMessages;
  }

  // ============================================
  // SEARCH MESSAGES
  // ============================================

  async searchMessages(
    userId: string,
    conversationId: string,
    query: string,
    limit = 20,
    offset = 0,
  ) {
    // Verify user is participant
    await this.verifyParticipant(conversationId, userId);

    if (!query || query.trim().length < 2) {
      throw new BadRequestException('Search query must be at least 2 characters');
    }

    const searchTerm = query.trim();

    // Use PostgreSQL full-text search with ts_vector
    const messages = await this.prisma.$queryRaw<
      Array<{
        id: string;
        conversation_id: string;
        sender_id: string;
        type: string;
        content: string;
        created_at: Date;
        is_edited: boolean;
        is_deleted: boolean;
      }>
    >`
      SELECT id, conversation_id, sender_id, type, content, created_at, is_edited, is_deleted
      FROM messages
      WHERE conversation_id = ${conversationId}
        AND is_deleted = false
        AND content IS NOT NULL
        AND to_tsvector('english', content) @@ plainto_tsquery('english', ${searchTerm})
      ORDER BY created_at DESC
      LIMIT ${limit}
      OFFSET ${offset}
    `;

    // Get full message details with relations
    const messageIds = messages.map((m) => m.id);

    if (messageIds.length === 0) {
      return { messages: [], total: 0, query: searchTerm };
    }

    const fullMessages = await this.prisma.message.findMany({
      where: {
        id: { in: messageIds },
      },
      include: {
        ...this.messageInclude,
        reactions: {
          include: {
            user: {
              select: {
                id: true,
                displayName: true,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Get total count
    const totalResult = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*) as count
      FROM messages
      WHERE conversation_id = ${conversationId}
        AND is_deleted = false
        AND content IS NOT NULL
        AND to_tsvector('english', content) @@ plainto_tsquery('english', ${searchTerm})
    `;

    const total = Number(totalResult[0]?.count || 0);

    return {
      messages: fullMessages,
      total,
      query: searchTerm,
    };
  }

  // ============================================
  // HELPER METHODS
  // ============================================

  private async verifyParticipant(conversationId: string, userId: string) {
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
      },
    });

    if (!participant) {
      throw new ForbiddenException('You are not a participant in this conversation');
    }

    return participant;
  }

  private async verifyReplyToMessage(replyToId: string, conversationId: string) {
    const replyToMessage = await this.prisma.message.findUnique({
      where: { id: replyToId },
    });

    if (!replyToMessage || replyToMessage.conversationId !== conversationId) {
      throw new BadRequestException('Reply-to message not found in this conversation');
    }

    return replyToMessage;
  }

  private async getRecipients(conversationId: string, excludeUserId: string) {
    return this.prisma.conversationParticipant.findMany({
      where: {
        conversationId,
        userId: { not: excludeUserId },
        leftAt: null,
      },
    });
  }

  private async touchConversation(conversationId: string) {
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });
  }

  private determineMediaType(mimeType: string): MediaType {
    if (mimeType.startsWith('image/')) return MediaType.IMAGE;
    if (mimeType.startsWith('video/')) return MediaType.VIDEO;
    if (mimeType.startsWith('audio/')) return MediaType.AUDIO;
    return MediaType.DOCUMENT;
  }
}
