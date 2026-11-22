/**
 * Chat image attachments — the ONE client upload path for all three apps.
 *
 * Flow (mirrors what the backend already enforces):
 *   1. the browser validates type + size BEFORE any network call;
 *   2. `POST /api/upload/presign` with `purpose: "chat"` mints a SERVER-side key
 *      under `chat/{conversation}/{sender}/…` — the server proves membership;
 *   3. the bytes are PUT straight to R2 with the declared content type;
 *   4. the returned `objectKey` is what the message API receives.
 *
 * The key is only ever used after the PUT succeeded, so a failed upload can never
 * create a message pointing at an object that does not exist.
 */
import { apiBaseUrl } from "./sites";

/** Mirrors `MAX_UPLOAD_BYTES` on the server (50 MB). */
export const CHAT_IMAGE_MAX_BYTES = 50 * 1024 * 1024;

/** Mirrors `ALLOWED_UPLOAD_TYPES`; the server re-checks the stored type anyway. */
export const CHAT_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "video/mp4",
  "video/webm",
  "video/quicktime",
] as const;

/** `null` when the file is acceptable, otherwise a human-readable reason. */
export function validateChatImage(file: File): string | null {
  if (!file) return "No file selected";
  if (!CHAT_IMAGE_TYPES.includes(file.type as (typeof CHAT_IMAGE_TYPES)[number])) {
    return "Only JPEG, PNG, WebP, AVIF images or MP4, WebM videos can be sent";
  }
  if (file.size > CHAT_IMAGE_MAX_BYTES) {
    return "File is larger than 50 MB";
  }
  if (file.size === 0) return "File is empty";
  return null;
}

export interface UploadChatImageOptions {
  /** 0-100 while the PUT is in flight (XHR gives real progress; fetch does not). */
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * Upload one image or video for a conversation and resolve with the server-minted key.
 * Rejects with an Error whose message is safe to show to the user.
 */
export async function uploadChatImage(
  conversationId: string,
  file: File,
  options: UploadChatImageOptions = {},
): Promise<string> {
  const invalid = validateChatImage(file);
  if (invalid) throw new Error(invalid);

  // 1. Try presign + direct PUT to cloud storage
  try {
    const presign = await fetch(`${apiBaseUrl}/upload/presign`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name,
        contentType: file.type,
        purpose: "chat",
        conversationId,
      }),
      signal: options.signal,
    });
    if (presign.ok) {
      const body = (await presign.json()) as { data?: { uploadUrl?: string; objectKey?: string } };
      const uploadUrl = body.data?.uploadUrl;
      const objectKey = body.data?.objectKey;
      if (uploadUrl && objectKey) {
        let putSuccess = false;
        try {
          await new Promise<void>((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("PUT", uploadUrl, true);
            xhr.setRequestHeader("Content-Type", file.type);
            xhr.upload.onprogress = (event) => {
              if (event.lengthComputable && options.onProgress) {
                options.onProgress(Math.round((event.loaded / event.total) * 100));
              }
            };
            xhr.onload = () => {
              if (xhr.status >= 200 && xhr.status < 300) {
                options.onProgress?.(100);
                putSuccess = true;
                resolve();
                return;
              }
              reject(new Error(`Storage PUT failed with status ${xhr.status}`));
            };
            xhr.onerror = () => reject(new Error("Storage PUT network error"));
            xhr.onabort = () => reject(new Error("Upload cancelled"));
            if (options.signal) {
              options.signal.addEventListener("abort", () => xhr.abort(), { once: true });
            }
            xhr.send(file);
          });
          if (putSuccess) return objectKey;
        } catch {
          // Cloud PUT failed (e.g. 401 Unauthorized) -> fall through to direct upload fallback
        }
      }
    }
  } catch {
    // Presign call failed -> fall through to direct upload fallback
  }

  // 2. Fallback: Direct server upload to /api/upload/direct
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Could not read file"));
    reader.readAsDataURL(file);
  });

  const directRes = await fetch(`${apiBaseUrl}/upload/direct`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      conversationId,
      filename: file.name,
      contentType: file.type,
      dataUrl,
    }),
    signal: options.signal,
  });

  if (!directRes.ok) {
    const errBody = (await directRes.json().catch(() => ({}))) as any;
    throw new Error(errBody?.error?.message || "Upload failed. Please check server storage connection.");
  }

  const directData = (await directRes.json()) as { data?: { objectKey?: string } };
  const directKey = directData.data?.objectKey;
  if (!directKey) throw new Error("Upload was not authorized");
  options.onProgress?.(100);
  return directKey;
}
