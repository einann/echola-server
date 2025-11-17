import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SendMessageDto } from '../conversations/dto/send-message.dto';
import { DeliveryStatus } from '@prisma/client';

@Injectable()
export class MessagesService {
  constructor(private prisma: PrismaService) {}

  async sendMessage(senderId: string, sendMessageDto: SendMessageDto) {
    const {
      conversationId,
      content,
      contentType,
      mediaUrl,
      thumbnailUrl,
      fileName,
      fileSize,
      replyToId,
    } = sendMessageDto;

    // Verify sender is participant in the conversation
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId: senderId,
        leftAt: null,
      },
    });

    if (!participant) {
      throw new ForbiddenException(
        'You are not a participant in this conversation',
      );
    }

    // Validate content exists for text messages
    if (contentType === 'text' && !content) {
      throw new BadRequestException('Text messages must have content');
    }

    // Verify reply-to message exists if specified
    if (replyToId) {
      const replyToMessage = await this.prisma.message.findUnique({
        where: { id: replyToId },
      });

      if (!replyToMessage || replyToMessage.conversationId !== conversationId) {
        throw new BadRequestException(
          'Reply-to message not found in this conversation',
        );
      }
    }

    // Get all other participants (recipients)
    const recipients = await this.prisma.conversationParticipant.findMany({
      where: {
        conversationId,
        userId: { not: senderId },
        leftAt: null,
      },
    });

    // Create message with delivery statuses for all recipients
    const message = await this.prisma.message.create({
      data: {
        conversationId,
        senderId,
        content,
        contentType: contentType || 'text',
        mediaUrl,
        thumbnailUrl,
        fileName,
        fileSize,
        replyToId,
        statuses: {
          create: recipients.map((recipient) => ({
            userId: recipient.userId,
            status: DeliveryStatus.SENT,
          })),
        },
      },
      include: {
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
          },
        },
      },
    });

    // Update conversation's updatedAt timestamp
    await this.prisma.conversation.update({
      where: { id: conversationId },
      data: { updatedAt: new Date() },
    });

    return message;
  }

  async getMessages(
    userId: string,
    conversationId: string,
    limit = 50,
    beforeMessageId?: string,
  ) {
    // Verify user is participant
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
      },
    });

    if (!participant) {
      throw new ForbiddenException(
        'You are not a participant in this conversation',
      );
    }

    // Build pagination cursor
    const cursor = beforeMessageId ? { id: beforeMessageId } : undefined;

    const messages = await this.prisma.message.findMany({
      where: {
        conversationId,
        isDeleted: false,
      },
      take: limit,
      skip: cursor ? 1 : 0, // Skip the cursor message itself
      cursor,
      orderBy: { createdAt: 'desc' },
      include: {
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
          },
        },
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

    // Reverse to get chronological order (oldest first)
    return messages.reverse();
  }

  async markMessageAsDelivered(userId: string, messageId: string) {
    const messageStatus = await this.prisma.messageStatus.findUnique({
      where: {
        messageId_userId: {
          messageId,
          userId,
        },
      },
    });

    if (!messageStatus) {
      throw new NotFoundException('Message status not found');
    }

    // Only update if not already delivered
    if (messageStatus.status === DeliveryStatus.SENT) {
      return await this.prisma.messageStatus.update({
        where: {
          messageId_userId: {
            messageId,
            userId,
          },
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
        messageId_userId: {
          messageId,
          userId,
        },
      },
    });

    if (!messageStatus) {
      throw new NotFoundException('Message status not found');
    }

    return await this.prisma.messageStatus.update({
      where: {
        messageId_userId: {
          messageId,
          userId,
        },
      },
      data: {
        status: DeliveryStatus.READ,
        readAt: new Date(),
        // Also mark as delivered if it wasn't already
        deliveredAt: messageStatus.deliveredAt || new Date(),
      },
    });
  }

  async markConversationAsRead(userId: string, conversationId: string) {
    // Verify user is participant
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId,
        userId,
        leftAt: null,
      },
    });

    if (!participant) {
      throw new ForbiddenException(
        'You are not a participant in this conversation',
      );
    }

    // Get all unread message statuses for this user in this conversation
    const unreadStatuses = await this.prisma.messageStatus.findMany({
      where: {
        userId,
        status: { not: DeliveryStatus.READ },
        message: {
          conversationId,
        },
      },
    });

    // Mark all as read
    await this.prisma.messageStatus.updateMany({
      where: {
        id: { in: unreadStatuses.map((s) => s.id) },
      },
      data: {
        status: DeliveryStatus.READ,
        readAt: new Date(),
      },
    });

    // Update participant's lastReadAt
    await this.prisma.conversationParticipant.update({
      where: { id: participant.id },
      data: { lastReadAt: new Date() },
    });

    return { markedAsRead: unreadStatuses.length };
  }

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

    return await this.prisma.message.update({
      where: { id: messageId },
      data: {
        content: newContent,
        isEdited: true,
        editedAt: new Date(),
      },
      include: {
        sender: {
          select: {
            id: true,
            displayName: true,
            username: true,
            avatarUrl: true,
          },
        },
      },
    });
  }

  async deleteMessage(userId: string, messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
    });

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    if (message.senderId !== userId) {
      throw new ForbiddenException('You can only delete your own messages');
    }

    // Soft delete
    return await this.prisma.message.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        content: null, // Clear content
      },
    });
  }

  async getUnreadCount(userId: string, conversationId: string) {
    const count = await this.prisma.messageStatus.count({
      where: {
        userId,
        status: { not: DeliveryStatus.READ },
        message: {
          conversationId,
        },
      },
    });

    return { unreadCount: count };
  }
}
