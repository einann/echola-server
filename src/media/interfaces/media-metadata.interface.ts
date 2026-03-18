export interface MediaMetadata {
  width?: number;
  height?: number;
  duration?: number; // video/audio için saniye
  mimeType: string;
  size: number;
  waveformData?: number[]; // Audio waveform peaks (0-1 normalized)
}

export interface ProcessedMedia {
  originalKey: string;
  originalUrl: string;
  originalSize: number;
  thumbnailKey?: string;
  thumbnailUrl?: string;
  metadata: MediaMetadata;
  waveformData?: number[];
}
