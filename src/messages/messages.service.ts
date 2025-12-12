import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  Inject,
} from '@nestjs/common';
import { Logger } from 'nestjs-pino';

import { PrismaService } from '../prisma/prisma.service';
import { SendMessageDto } from '../conversations/dto/send-message.dto';
import { DeliveryStatus } from 'generated/prisma/client';
// import { StorageService } from 'src/storage/storage.service';

@Injectable()
export class MessagesService {
  constructor(
    private prisma: PrismaService,
    // private storageService: StorageService,
    @Inject(Logger) private readonly logger: Logger,
  ) {}

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

  async getMessageById(messageId: string) {
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
        conversation: true,
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

    if (!message) {
      throw new NotFoundException('Message not found');
    }

    return message;
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

  /**
   * Delete a message (soft delete)
   * - Sender can always delete their own messages
   * - Group admins can delete any message in their groups
   */
  async deleteMessage(
    messageId: string,
    userId: string,
    deleteForEveryone = false,
  ) {
    // Fetch message with conversation details
    const message = await this.prisma.message.findUnique({
      where: { id: messageId },
      include: {
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

    // Check if message is already deleted
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

    // For "delete for everyone"
    if (deleteForEveryone) {
      // Only admins or creator can delete for everyone in groups
      if (message.conversation.type === 'GROUP') {
        if (!isAdmin && !isGroupCreator) {
          throw new ForbiddenException(
            'Only admins can delete messages for everyone',
          );
        }
      } else {
        // In direct chats, only sender can delete
        if (!isSender) {
          throw new ForbiddenException('You can only delete your own messages');
        }
      }
    } else {
      // Regular delete - only sender can delete
      if (!isSender) {
        throw new ForbiddenException('You can only delete your own messages');
      }
    }

    // Perform soft delete
    const deletedMessage = await this.prisma.message.update({
      where: { id: messageId },
      data: {
        isDeleted: true,
        deletedAt: new Date(),
        content: null, // Clear content for privacy
        mediaUrl: null, // Clear media URL
        thumbnailUrl: null,
        fileName: null,
        fileSize: null,
      },
    });

    this.logger.log(
      {
        messageId,
        userId,
        conversationId: message.conversationId,
        deleteForEveryone,
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

  /**
   * Permanently delete message files from storage
   */
  // async deleteMessageFiles(messageId: string) {
  //   const message = await this.prisma.message.findUnique({
  //     where: { id: messageId },
  //   });

  //   if (!message || !message.mediaUrl) {
  //     return;
  //   }

  //   // Extract file key from URL
  //   // Assuming mediaUrl is like: http://localhost:9000/echola-media/messages/file.jpg
  //   const urlParts = message.mediaUrl.split('/');
  //   const fileKey = urlParts.slice(-2).join('/'); // "messages/file.jpg"

  //   await this.storageService.deleteFile(fileKey);

  //   this.logger.log(
  //     { messageId, fileKey },
  //     'Message files deleted from storage',
  //   );
  // }

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
