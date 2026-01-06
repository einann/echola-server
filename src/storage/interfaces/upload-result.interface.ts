export interface UploadResult {
  key: string;
  bucket: string;
  url: string;
  size: number;
}

export interface PresignedUrlResult {
  uploadUrl: string;
  fileKey: string;
  expiresAt: Date;
}
