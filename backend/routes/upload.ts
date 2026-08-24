import type { Express, Request, Response } from "express";
import { S3Client, PutObjectCommand, HeadObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";
import { invalidateCachedProfile } from "./auth.js";

// ─── R2 Client ──────────────────────────────────────────────────────────────

function getR2Config() {
  return {
    accountId: process.env.R2_ACCOUNT_ID || "",
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    bucket: process.env.R2_BUCKET || "",
    publicDomain: process.env.R2_PUBLIC_DOMAIN || "",
  };
}

function createR2Client() {
  const cfg = getR2Config();
  return new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: cfg.accessKeyId,
      secretAccessKey: cfg.secretAccessKey,
    },
  });
}

const R2 = createR2Client();
const BUCKET = getR2Config().bucket;
const PUBLIC_DOMAIN = getR2Config().publicDomain;

// ─── Allowed MIME types (must match frontend ProfileImageUpload.tsx) ─────────

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_SIZE = 10 * 1024 * 1024; // 10 MB

// ─── Safe logging (no secrets) ──────────────────────────────────────────────

function r2Log(step: string, data: Record<string, unknown>) {
  console.log(`[R2 UPLOAD] step=${step}`, JSON.stringify(data));
}

// ─── R2 Object Verification ─────────────────────────────────────────────────

async function verifyR2Object(key: string): Promise<boolean> {
  try {
    await R2.send(
      new HeadObjectCommand({ Bucket: BUCKET, Key: key })
    );
    r2Log("verify", { key, status: "found" });
    return true;
  } catch {
    r2Log("verify", { key, status: "not_found" });
    return false;
  }
}

// ─── R2 Object Deletion ─────────────────────────────────────────────────────

async function deleteR2Object(key: string): Promise<boolean> {
  try {
    await R2.send(
      new DeleteObjectCommand({ Bucket: BUCKET, Key: key })
    );
    r2Log("cleanup", { key, status: "deleted" });
    return true;
  } catch (err) {
    r2Log("cleanup", { key, status: "failed", error: String(err) });
    return false;
  }
}

// ─── Extract R2 objectKey from public URL ───────────────────────────────────

function objectKeyFromUrl(url: string): string | null {
  if (!url || !PUBLIC_DOMAIN) return null;
  // URLs look like: https://pub-xxx.r2.dev/profile/avatar/userId/123.webp
  // or: https://custom-domain.com/profile/avatar/userId/123.webp
  const prefix = PUBLIC_DOMAIN.replace(/\/+$/, "");
  if (url.startsWith(prefix + "/")) {
    return url.slice(prefix.length + 1);
  }
  // If URL is just the object key (no domain prefix)
  if (!url.startsWith("http")) return url;
  return null;
}

// ─── Helper: validate objectKey prefix to prevent user from overwriting others ──

function validateObjectKeyOwnership(objectKey: string, userId: string): boolean {
  const parts = objectKey.split("/");
  // Profile keys: profile/{kind}/{userId}/{timestamp}.{ext}
  // Generic keys:  {purpose}/{userId}/{timestamp}.{ext}
  if (parts.length >= 4 && parts[0] === "profile") {
    return parts[2] === userId;
  }
  if (parts.length >= 3) {
    return parts[1] === userId;
  }
  return false;
}

/**
 * Get the current image URL for a user + kind from the database.
 */
async function getCurrentImageUrl(userId: string, kind: string): Promise<string | null> {
  try {
    if (kind === "avatar") {
      const result = await query("SELECT avatar FROM users WHERE id = $1", [userId]);
      return result.rows[0]?.avatar || null;
    } else if (kind === "cover") {
      try {
        const result = await query("SELECT cover_url FROM users WHERE id = $1", [userId]);
        return result.rows[0]?.cover_url || null;
      } catch (err: any) {
        if (err?.code === "42703") return null;
        throw err;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Safely clean up old R2 objects when a new image replaces the current one.
 * Includes race-condition protection: re-checks DB before deleting.
 */
async function cleanupOldImage(userId: string, kind: string, oldUrl: string): Promise<void> {
  const oldKey = objectKeyFromUrl(oldUrl);
  if (!oldKey) {
    r2Log("cleanup_old", { kind, status: "skipped", reason: "cannot_extract_object_key" });
    return;
  }

  if (!validateObjectKeyOwnership(oldKey, userId)) {
    r2Log("cleanup_old", { kind, status: "skipped", reason: "not_owned_by_user" });
    return;
  }

  // Race-condition protection: re-verify that the DB still points to this URL.
  // If another upload happened between our read and this cleanup, the DB now
  // points to a newer URL and we must NOT delete what the DB is currently using.
  const currentUrl = await getCurrentImageUrl(userId, kind);
  if (currentUrl && currentUrl !== oldUrl) {
    r2Log("cleanup_old", {
      kind,
      status: "skipped",
      reason: "db_changed_since_read",
    });
    return;
  }

  await deleteR2Object(oldKey);
}

/**
 * Clean up stale media records for the same user + kind.
 * Keeps only the most recent record; deletes older ones.
 */
async function cleanupStaleMediaRecords(userId: string, kind: string, keepKey: string): Promise<void> {
  try {
    // Delete all media records for this user + kind EXCEPT the one we just created
    const result = await query(
      `DELETE FROM media
       WHERE uploaded_by = $1
         AND key LIKE $2
         AND key != $3`,
      [userId, `profile/${kind}/${userId}/%`, keepKey]
    );
    const deleted = result.rowCount ?? 0;
    if (deleted > 0) {
      r2Log("cleanup_media", { kind, status: "deleted", count: deleted });
    }
  } catch (err) {
    r2Log("cleanup_media", { kind, status: "failed", error: String(err) });
  }
}

/**
 * If a newly uploaded R2 object is orphaned (DB save failed), delete it.
 */
async function cleanupOrphanR2Object(userId: string, kind: string, objectKey: string): Promise<void> {
  if (!validateObjectKeyOwnership(objectKey, userId)) return;
  await deleteR2Object(objectKey);
}

/**
 * Register upload routes.
 */
export function setupUploadRoutes(app: Express): void {
  // ─── Generic presign endpoint (used by ImageUpload.tsx) ──────────────────
  app.post("/api/upload/presign", requireAuth, async (req: Request, res: Response) => {
    try {
      const { filename, contentType, purpose = "avatar" } = req.body;

      if (!filename || !contentType) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "filename and contentType required" } });
        return;
      }

      if (!ALLOWED_TYPES.includes(contentType)) {
        res.status(400).json({ success: false, error: { code: "INVALID_FILE_TYPE", message: "File type not allowed. Allowed: jpeg, png, webp, avif" } });
        return;
      }

      const ext = filename.split(".").pop() || "jpg";
      const userId = req.user!.userId;
      const timestamp = Date.now();
      const objectKey = `${purpose}/${userId}/${timestamp}.${ext}`;

      r2Log("presign", { step: "presign", purpose, objectKey, mimeType: contentType });

      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
        ContentType: contentType,
      });

      const uploadUrl = await getSignedUrl(R2, command, { expiresIn: 300 });
      const publicUrl = PUBLIC_DOMAIN ? `${PUBLIC_DOMAIN}/${objectKey}` : "";

      r2Log("presign", { step: "presign", status: "success", bucket: !!BUCKET, hasPublicDomain: !!PUBLIC_DOMAIN });

      res.json({
        success: true,
        data: { uploadUrl, objectKey, publicUrl },
      });
    } catch (err) {
      r2Log("presign", { step: "presign", status: "failed", error: String(err) });
      res.status(500).json({ success: false, error: { code: "R2_PRESIGN_FAILED", message: "Failed to generate upload URL" } });
    }
  });

  // ─── Generic confirm endpoint (used by ImageUpload.tsx) ──────────────────
  app.post("/api/upload/confirm", requireAuth, async (req: Request, res: Response) => {
    try {
      const { objectKey, purpose = "avatar", entityId } = req.body;
      const userId = req.user!.userId;

      if (!objectKey) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "objectKey required" } });
        return;
      }

      if (!validateObjectKeyOwnership(objectKey, userId)) {
        r2Log("confirm", { step: "verify_ownership", status: "denied", objectKey });
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Cannot upload to another user's path" } });
        return;
      }

      const exists = await verifyR2Object(objectKey);
      if (!exists) {
        r2Log("confirm", { step: "verify_object", status: "failed", objectKey });
        res.status(400).json({ success: false, error: { code: "R2_OBJECT_NOT_FOUND", message: "Upload not found in storage. Please try again." } });
        return;
      }

      const publicUrl = PUBLIC_DOMAIN ? `${PUBLIC_DOMAIN}/${objectKey}` : objectKey;
      const oldUrl = await getCurrentImageUrl(userId, purpose);

      let mediaId: string | null = null;
      try {
        const mediaResult = await query(
          `INSERT INTO media (url, key, content_type, size, uploaded_by, created_at)
           VALUES ($1, $2, 'image', 0, $3, NOW())
           RETURNING id`,
          [publicUrl, objectKey, userId]
        );
        mediaId = mediaResult.rows[0]?.id ?? null;
      } catch (mediaErr: any) {
        r2Log("confirm", { step: "media_record", status: "skipped", error: mediaErr?.code || String(mediaErr) });
      }

      if (purpose === "avatar") {
        await query("UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2", [publicUrl, userId]);
      } else if (purpose === "cover") {
        try {
          await query("UPDATE users SET cover_url = $1, updated_at = NOW() WHERE id = $2", [publicUrl, userId]);
        } catch (coverErr: any) {
          if (coverErr?.code !== "42703") throw coverErr;
        }
      }

      // Invalidate auth/me profile cache so next request returns fresh data
      invalidateCachedProfile(userId);

      // Cleanup old R2 object + stale media records
      if (oldUrl && oldUrl !== publicUrl) {
        await cleanupOldImage(userId, purpose, oldUrl).catch(() => {});
      }
      await cleanupStaleMediaRecords(userId, purpose, objectKey).catch(() => {});

      res.json({
        success: true,
        data: { id: mediaId, url: publicUrl },
      });
    } catch (err) {
      r2Log("confirm", { step: "confirm", status: "failed", error: String(err) });
      res.status(500).json({ success: false, error: { code: "IMAGE_SAVE_FAILED", message: "Failed to save upload" } });
    }
  });

  // ─── Profile image presign (consumed by ProfileImageUpload.tsx) ──────────
  app.post("/api/customer/profile-image/upload-intent", requireAuth, async (req: Request, res: Response) => {
    try {
      const { kind = "avatar", filename, mimeType } = req.body;
      const userId = req.user!.userId;

      if (!ALLOWED_TYPES.includes(mimeType)) {
        res.status(400).json({ success: false, error: { code: "INVALID_FILE_TYPE", message: "File type not allowed. Allowed: jpeg, png, webp, avif" } });
        return;
      }

      const ext = (filename || "image.jpg").split(".").pop() || "jpg";
      const timestamp = Date.now();
      const objectKey = `profile/${kind}/${userId}/${timestamp}.${ext}`;

      r2Log("intent", { step: "presign", kind, objectKey, mimeType, bucket: !!BUCKET });

      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
        ContentType: mimeType,
      });

      const uploadUrl = await getSignedUrl(R2, command, { expiresIn: 300 });
      const cdnUrl = PUBLIC_DOMAIN ? `${PUBLIC_DOMAIN}/${objectKey}` : objectKey;

      r2Log("intent", { step: "presign", status: "success" });

      res.json({
        success: true,
        data: {
          kind,
          uploadUrl,
          objectKey,
          cdnUrl,
          expiresAt: Date.now() + 300_000,
        },
      });
    } catch (err) {
      r2Log("intent", { step: "presign", status: "failed", error: String(err) });
      res.status(500).json({ success: false, error: { code: "R2_PRESIGN_FAILED", message: "Failed to generate upload URL" } });
    }
  });

  // ─── Profile image save (verify R2 + persist to Neon) ───────────────────
  app.post("/api/customer/profile-image/save", requireAuth, async (req: Request, res: Response) => {
    try {
      const { kind = "avatar", objectKey, cdnUrl, format, bytes } = req.body;
      const userId = req.user!.userId;
      const url = cdnUrl || (PUBLIC_DOMAIN ? `${PUBLIC_DOMAIN}/${objectKey}` : objectKey);

      if (!objectKey) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "objectKey required" } });
        return;
      }

      r2Log("save", { step: "verify_ownership", userId, kind });
      if (!validateObjectKeyOwnership(objectKey, userId)) {
        r2Log("save", { step: "verify_ownership", status: "denied", userId, objectKey });
        res.status(403).json({ success: false, error: { code: "PROFILE_IMAGE_OWNERSHIP_DENIED", message: "Cannot save to another user's path" } });
        return;
      }
      r2Log("save", { step: "verify_ownership", status: "passed", userId, kind });

      const exists = await verifyR2Object(objectKey);
      if (!exists) {
        r2Log("save", { step: "verify_object", status: "failed", objectKey });
        res.status(400).json({ success: false, error: { code: "R2_OBJECT_NOT_FOUND", message: "Image not found in storage. Please try uploading again." } });
        return;
      }

      r2Log("save", { step: "save_neon", kind, objectKey, size: bytes || 0 });

      // Read current URL BEFORE updating — used for cleanup after success
      const oldUrl = await getCurrentImageUrl(userId, kind);

      // ── Database save ────────────────────────────────────────────────
      let dbSaveFailed = false;

      // 1. Insert media record (audit trail)
      try {
        await query(
          `INSERT INTO media (url, key, content_type, size, uploaded_by, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())`,
          [url, objectKey, `image/${format || "jpeg"}`, bytes || 0, userId]
        );
      } catch (mediaErr: any) {
        r2Log("save", { step: "media_record", status: "skipped", error: mediaErr?.code || String(mediaErr) });
      }

      // 2. Update user profile reference
      try {
        if (kind === "avatar") {
          await query("UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2", [url, userId]);
        } else if (kind === "cover") {
          try {
            await query("UPDATE users SET cover_url = $1, updated_at = NOW() WHERE id = $2", [url, userId]);
          } catch (coverErr: any) {
            if (coverErr?.code !== "42703") throw coverErr;
          }
        }
      } catch (profileErr) {
        dbSaveFailed = true;
        r2Log("save", { step: "save_neon", status: "failed", error: String(profileErr) });

        // DB save failed — clean up the newly uploaded R2 object (orphan prevention)
        await cleanupOrphanR2Object(userId, kind, objectKey).catch(() => {});

        res.status(500).json({ success: false, error: { code: "IMAGE_SAVE_FAILED", message: "Failed to save image metadata" } });
        return;
      }

      // 3. DB save succeeded — invalidate cache
      invalidateCachedProfile(userId);

      // 4. Cleanup old R2 object + stale media records (after DB is safely updated)
      if (oldUrl && oldUrl !== url) {
        r2Log("save", { step: "cleanup_old", kind, status: "started" });
        await cleanupOldImage(userId, kind, oldUrl).catch((err) => {
          r2Log("save", { step: "cleanup_old", kind, status: "failed", error: String(err) });
        });
      }

      // Cleanup stale media records for same user+kind
      await cleanupStaleMediaRecords(userId, kind, objectKey).catch(() => {});

      r2Log("save", { step: "save_neon", status: "success" });

      // ── Build response ──────────────────────────────────────────────
      let result;
      try {
        result = await query(
          "SELECT id, email, name, avatar, cover_url FROM users WHERE id = $1",
          [userId]
        );
      } catch (queryErr: any) {
        if (queryErr?.code === "42703") {
          result = await query(
            "SELECT id, email, name, avatar FROM users WHERE id = $1",
            [userId]
          );
        } else {
          throw queryErr;
        }
      }
      const u = result.rows[0];

      // Return the URL we already computed — don't rely solely on the DB
      // re-query, because the cover_url column may not exist yet (migration
      // pending).  For avatar the re-query is fine; for cover we fall back to
      // the URL we just uploaded.
      const coverUrl = kind === "cover"
        ? (u?.cover_url || url)   // column may be missing — use the fresh URL
        : (u?.cover_url || null);

      res.json({
        success: true,
        data: {
          avatarUrl: kind === "avatar" ? (u?.avatar || url) : (u?.avatar || null),
          coverUrl,
        },
      });
    } catch (err) {
      r2Log("save", { step: "save_neon", status: "failed", error: String(err) });
      res.status(500).json({ success: false, error: { code: "IMAGE_SAVE_FAILED", message: "Failed to save image" } });
    }
  });

  // ─── Profile image patch (direct avatar URL update) ──────────────────────
  app.patch("/api/customer/profile-image", requireAuth, async (req: Request, res: Response) => {
    try {
      const { image } = req.body;
      const userId = req.user!.userId;

      await query("UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2", [image, userId]);
      invalidateCachedProfile(userId);

      res.json({ success: true, data: { avatar: image } });
    } catch (err) {
      console.error("[R2 UPLOAD] step=patch status=failed error=", err);
      res.status(500).json({ success: false, error: { code: "IMAGE_SAVE_FAILED", message: "Failed to update image" } });
    }
  });

  // ─── R2 Health Check (admin-safe, no credentials exposed) ────────────────
  app.get("/api/health/r2", async (_req: Request, res: Response) => {
    const cfg = getR2Config();
    const configured = !!(cfg.accountId && cfg.accessKeyId && cfg.secretAccessKey && cfg.bucket);

    if (!configured) {
      res.json({ configured: false, bucket: false, verify: false });
      return;
    }

    try {
      const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      await R2.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1 }));
      res.json({ configured: true, bucket: true, verify: true });
    } catch {
      res.json({ configured: true, bucket: false, verify: false });
    }
  });
}
