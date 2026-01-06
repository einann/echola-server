export interface MediaMetadata {
  width?: number;
  height?: number;
  duration?: number; // video/audio için saniye
  mimeType: string;
  size: number;
}

export interface ProcessedMedia {
  originalKey: string;
  originalUrl: string;
  originalSize: number;
  thumbnailKey?: string;
  thumbnailUrl?: string;
  metadata: MediaMetadata;
}
