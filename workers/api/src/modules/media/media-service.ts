import type { Bindings } from "../../types.js";
import type {
  ConfirmUploadInput,
  GenerateUploadIntentInput,
  MediaObject,
  MediaPurpose,
  UploadFileInput,
  UploadIntentResult,
} from "./types.js";
import { ALLOWED_MIME_TYPES, MAX_FILE_SIZE_BYTES } from "./types.js";
import type { IDatabaseClient } from "../../core/database/db-client.js";

export class MediaService {
  private inMemoryObjects: Map<string, MediaObject> = new Map();
  private inMemoryRawFiles: Map<string, { buffer: ArrayBuffer; contentType: string; size: number }> = new Map();

  constructor(
    private readonly env?: Bindings,
    private readonly db?: IDatabaseClient,
  ) {}

  async uploadImage(input: UploadFileInput): Promise<MediaObject> {
    const { userId, purpose, fileBuffer, contentType, fileName } = input;

    // 1. Validate MIME type
    if (!ALLOWED_MIME_TYPES.has(contentType)) {
      throw new Error(`Unsupported file type: ${contentType}. Allowed types include JPEG, PNG, WebP, SVG, AVIF, and Video.`);
    }

    // 2. Validate file size
    const fileSizeBytes = fileBuffer.byteLength;
    if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
      throw new Error(`File size ${fileSizeBytes} bytes exceeds maximum limit of 10 MB.`);
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
    const publicUrlPrefix = this.env?.R2_PUBLIC_URL_PREFIX?.replace(/\/$/, "") || "https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev";
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
      } catch {
        this.inMemoryObjects.set(id, mediaObj);
      }

      try {
        await this.db.query(
          `INSERT INTO media (id, url, key, content_type, size, uploaded_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (key) DO UPDATE SET url = EXCLUDED.url`,
          [id, publicUrl, r2Key, contentType, fileSizeBytes, userId, now],
        );
      } catch {
        // Ignore if media table does not exist or fails
      }
    } else {
      this.inMemoryObjects.set(id, mediaObj);
    }

    return mediaObj;
  }

  async generateUploadIntent(input: GenerateUploadIntentInput): Promise<UploadIntentResult> {
    const { userId, filename, contentType, folder, purpose, referenceId, shopId, conversationId, categoryId, origin } = input;

    // Determine extension
    let ext = "webp";
    const extMatch = filename?.match(/\.([a-zA-Z0-9]+)$/);
    if (extMatch) {
      ext = extMatch[1].toLowerCase();
    } else if (contentType === "image/svg+xml") {
      ext = "svg";
    } else if (contentType === "image/png") {
      ext = "png";
    } else if (contentType === "image/jpeg") {
      ext = "jpg";
    } else if (contentType === "video/mp4") {
      ext = "mp4";
    } else if (contentType === "video/webm") {
      ext = "webm";
    } else if (contentType === "application/pdf") {
      ext = "pdf";
    }

    const randomId = crypto.randomUUID().replace(/-/g, "").slice(0, 12);
    const timestamp = Date.now();
    let objectKey: string;

    const targetFolder = (folder || "").toLowerCase();
    const targetPurpose = (purpose || "").toLowerCase();

    if (targetFolder === "categories" || targetPurpose === "category-icon" || targetPurpose === "category_icon") {
      const catId = referenceId || categoryId || randomId;
      objectKey = `categories/${catId}/icon.${ext}`;
    } else if (
      targetFolder === "banners" ||
      targetPurpose === "announcement" ||
      targetPurpose === "banner" ||
      targetPurpose === "marketing"
    ) {
      objectKey = `announcements/${userId}/${timestamp}-${randomId}.${ext}`;
    } else if (targetPurpose === "chat" || targetPurpose === "chat_attachment") {
      const convId = conversationId || "general";
      objectKey = `chat/${convId}/${userId}/${timestamp}-${randomId}.${ext}`;
    } else if (targetPurpose === "shop-logo" || targetPurpose === "shop_logo") {
      const sId = shopId || userId;
      objectKey = `shop/${sId}/logo.${ext}`;
    } else if (targetPurpose === "shop-cover" || targetPurpose === "shop_cover") {
      const sId = shopId || userId;
      objectKey = `shop/${sId}/cover.${ext}`;
    } else if (targetPurpose === "verification_doc" || targetPurpose === "evidence") {
      objectKey = `evidence/${userId}/${timestamp}-${randomId}.${ext}`;
    } else if (targetPurpose === "product_image") {
      objectKey = `products/${userId}/${timestamp}-${randomId}.${ext}`;
    } else if (targetPurpose === "avatar") {
      objectKey = `profile/avatar/${userId}.${ext}`;
    } else {
      const prefix = folder || purpose || "uploads";
      objectKey = `${prefix}/${userId}/${timestamp}-${randomId}.${ext}`;
    }

    const publicUrlPrefix = this.env?.R2_PUBLIC_URL_PREFIX?.replace(/\/$/, "") || "https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev";
    const publicUrl = `${publicUrlPrefix}/${objectKey}`;
    const baseOrigin = origin || "https://api.velnox.live";
    const uploadUrl = `${baseOrigin}/api/upload/raw/${objectKey}`;

    return {
      uploadUrl,
      publicUrl,
      cdnUrl: publicUrl,
      objectKey,
    };
  }

  async saveRawUpload(
    objectKey: string,
    fileBuffer: ArrayBuffer,
    contentType: string,
  ): Promise<{ success: boolean; objectKey: string; size: number }> {
    if (this.env?.R2_BUCKET) {
      await this.env.R2_BUCKET.put(objectKey, fileBuffer, {
        httpMetadata: { contentType },
        customMetadata: { uploadedAt: Date.now().toString() },
      });
    }

    this.inMemoryRawFiles.set(objectKey, {
      buffer: fileBuffer,
      contentType,
      size: fileBuffer.byteLength,
    });

    return {
      success: true,
      objectKey,
      size: fileBuffer.byteLength,
    };
  }

  async confirmUpload(input: ConfirmUploadInput): Promise<{ url: string; publicUrl: string; cdnUrl: string; objectKey: string }> {
    const publicUrlPrefix = this.env?.R2_PUBLIC_URL_PREFIX?.replace(/\/$/, "") || "https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev";
    const publicUrl = `${publicUrlPrefix}/${input.objectKey}`;

    const raw = this.inMemoryRawFiles.get(input.objectKey);
    const contentType = raw?.contentType || "image/webp";
    const size = raw?.size || 0;

    // Update categories table if referenceId exists and folder is categories
    if (this.db && (input.folder === "categories" || input.purpose === "category-icon" || input.purpose === "category_icon") && input.referenceId) {
      try {
        await this.db.query(
          `UPDATE categories SET image_url = $1, icon = $1, updated_at = NOW() WHERE id = $2`,
          [publicUrl, input.referenceId],
        );
      } catch (err) {
        console.warn("Could not update category icon/image_url:", err);
      }
    }

    // Persist to media_objects and media in DB
    if (this.db) {
      const id = crypto.randomUUID();
      const safePurpose = (input.purpose || input.folder || "general").replace(/-/g, "_");
      try {
        await this.db.query(
          `INSERT INTO media_objects (id, user_id, purpose, r2_key, content_type, file_size_bytes, public_url, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
           ON CONFLICT (r2_key) DO UPDATE SET public_url = EXCLUDED.public_url`,
          [id, input.userId, safePurpose, input.objectKey, contentType, size, publicUrl],
        );
      } catch (err) {
        console.warn("Could not insert into media_objects:", err);
      }

      try {
        await this.db.query(
          `INSERT INTO media (id, url, key, content_type, size, uploaded_by, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())
           ON CONFLICT (key) DO UPDATE SET url = EXCLUDED.url`,
          [id, publicUrl, input.objectKey, contentType, size, input.userId],
        );
      } catch {
        // Ignore if media table does not exist
      }
    }

    return {
      url: publicUrl,
      publicUrl,
      cdnUrl: publicUrl,
      objectKey: input.objectKey,
    };
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
