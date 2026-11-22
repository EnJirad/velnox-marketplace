import type { Bindings } from "../../types.js";
import type { MediaObject, MediaPurpose, UploadFileInput } from "./types.js";
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "./types.js";
import type { IDatabaseClient } from "../../core/database/db-client.js";

export class MediaService {
  private inMemoryObjects: Map<string, MediaObject> = new Map();

  constructor(
    private readonly env?: Bindings,
    private readonly db?: IDatabaseClient,
  ) {}

  async uploadImage(input: UploadFileInput): Promise<MediaObject> {
    const { userId, purpose, fileBuffer, contentType, fileName } = input;

    // 1. Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      throw new Error(`Unsupported file type: ${contentType}. Only JPEG, PNG, and WebP are allowed.`);
    }

    // 2. Validate file size
    const fileSizeBytes = fileBuffer.byteLength;
    if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File size ${fileSizeBytes} bytes exceeds maximum limit of 5 MB.`);
    }

    if (fileSizeBytes === 0) {
      throw new Error("Cannot upload empty file.");
    }

    // 3. Determine file extension
    const ext = contentType === "image/webp" ? "webp" : contentType === "image/png" ? "png" : "jpg";
    const randomId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const timestamp = Date.now();
    const r2Key = `${purpose}/${userId}/${timestamp}-${randomId}.${ext}`;

    // 4. Upload to Cloudflare R2 if available
    if (this.env?.R2_BUCKET) {
      await this.env.R2_BUCKET.put(r2Key, fileBuffer, {
        httpMetadata: {
          contentType,
        },
        customMetadata: {
          uploadedBy: userId,
          purpose,
          originalName: fileName || "unnamed",
        },
      });
    }

    // 5. Build public URL
    const publicUrlPrefix = this.env?.R2_PUBLIC_URL_PREFIX?.replace(/\/$/, "") || "https://media.velnox.live";
    const publicUrl = `${publicUrlPrefix}/${r2Key}`;

    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    const mediaObj: MediaObject = {
      id,
      userId,
      purpose,
      r2Key,
      contentType,
      fileSizeBytes,
      publicUrl,
      createdAt: now,
    };

    // 6. Persist metadata to database or in-memory
    if (this.db) {
      try {
        await this.db.query(
          `INSERT INTO media_objects (id, user_id, purpose, r2_key, content_type, file_size_bytes, public_url, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, userId, purpose, r2Key, contentType, fileSizeBytes, publicUrl, now],
        );
      } catch (err) {
        // Fallback to in-memory if db query fails in mock environment
        this.inMemoryObjects.set(id, mediaObj);
      }
    } else {
      this.inMemoryObjects.set(id, mediaObj);
    }

    return mediaObj;
  }

  async getMediaById(id: string): Promise<MediaObject | null> {
    if (this.db) {
      const res = await this.db.query<any>(
        `SELECT id, user_id as "userId", purpose, r2_key as "r2Key", content_type as "contentType",
                file_size_bytes as "fileSizeBytes", public_url as "publicUrl", created_at as "createdAt"
         FROM media_objects WHERE id = $1`,
        [id],
      );
      if (res.rows.length > 0) return res.rows[0];
    }
    return this.inMemoryObjects.get(id) || null;
  }
}
