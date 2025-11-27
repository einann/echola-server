import { Message } from 'generated/prisma/client';

// Pub/Sub event types
export interface RedisConversationEvent {
  type:
    | 'new_message'
    | 'reaction_added'
    | 'reaction_removed'
    | 'member_added'
    | 'member_removed'
    | 'member_left'
    | 'role_updated'
    | 'info_updated';
  message?: Message;
  messageId?: string;
  reaction?: any;
  emoji?: string;
  userId?: string;
  senderId?: string;
  members?: any[];
  addedBy?: string;
  removedBy?: string;
  newRole?: string;
  updates?: any;
  updatedBy?: string;
  conversationId?: string;
}

// Queued message type (what goes in inbox)
export interface QueuedMessage {
  id: string;
  conversationId: string;
  senderId: string;
  content: string | null;
  contentType: string;
  mediaUrl: string | null;
  thumbnailUrl: string | null;
  fileName: string | null;
  fileSize: number | null;
  replyToId: string | null;
  isEdited: boolean;
  isDeleted: boolean;
  createdAt: Date;
  updatedAt: Date;
  editedAt: Date | null;
  deletedAt: Date | null;
}

// File upload metadata (cached temporarily)
export interface UploadMetadata {
  fileName: string;
  fileType: 'image' | 'video' | 'audio' | 'document';
  conversationId: string;
  fileSize: number;
}
