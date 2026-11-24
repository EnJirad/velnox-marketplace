export type MediaPurpose =
  | "product_image"
  | "shop_logo"
  | "shop_cover"
  | "avatar"
  | "verification_doc"
  | "chat_attachment"
  | "banner"
  | "category_icon"
  | "announcement"
  | "marketing"
  | "general";

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

export interface GenerateUploadIntentInput {
  userId: string;
  filename: string;
  contentType: string;
  folder?: string;
  purpose?: string;
  referenceId?: string;
  shopId?: string;
  conversationId?: string;
  categoryId?: string;
  origin?: string;
}

export interface UploadIntentResult {
  uploadUrl: string;
  publicUrl: string;
  cdnUrl: string;
  objectKey: string;
}

export interface ConfirmUploadInput {
  userId: string;
  objectKey: string;
  folder?: string;
  referenceId?: string;
  purpose?: string;
}

export const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/svg+xml",
  "image/avif",
  "image/gif",
  "video/mp4",
  "video/webm",
]);

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
