export type FileType = 'image' | 'video' | 'audio' | 'document';

export interface ProcessedUpload {
  mediaUrl: string;
  thumbnailUrl?: string;
  fileSize: number;
  processedFileKey?: string;
  thumbnailFileKey?: string;
}

export interface UploadRequest {
  fileName: string;
  mimeType: string;
  fileType: FileType;
  fileSize: number;
}

export interface UploadConfirmation {
  fileKey: string;
  fileName: string;
  fileType: FileType;
  conversationId: string;
}

export interface DirectUploadData {
  file: Express.Multer.File;
  fileType: FileType;
  conversationId: string;
  userId: string;
}
