export type MediaPurpose =
  | "product_image"
  | "shop_logo"
  | "shop_cover"
  | "avatar"
  | "verification_doc"
  | "chat_attachment";

export interface MediaObject {
  id: string;
  userId: string;
  purpose: MediaPurpose;
  r2Key: string;
  contentType: string;
  fileSizeBytes: number;
  publicUrl: string;
  createdAt: string;
}

export interface UploadFileInput {
  userId: string;
  purpose: MediaPurpose;
  fileBuffer: ArrayBuffer;
  contentType: string;
  fileName?: string;
}

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB
