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
  const prefix = PUBLIC_DOMAIN.replace(/\/+$/, "");
  if (url.startsWith(prefix + "/")) {
    return url.slice(prefix.length + 1);
  }
  if (!url.startsWith("http")) return url;
  return null;
}

// ─── Helper: validate objectKey prefix to prevent user from overwriting others ──

function validateObjectKeyOwnership(objectKey: string, userId: string): boolean {
  const parts = objectKey.split("/");
  // Fixed keys:   profile/{kind}/{userId}.webp  → parts = ["profile", kind, "userId.webp"]
  // Old keys:     profile/{kind}/{userId}/{ts}.webp → parts = ["profile", kind, userId, "ts.webp"]
  if (parts.length >= 3 && parts[0] === "profile") {
    const candidate = parts[2];
    // Old scheme: parts[2] is bare userId
    if (candidate === userId) return true;
    // Fixed scheme: parts[2] is "userId.webp" — strip extension for comparison
    const candidateBase = candidate?.split(".")[0];
    if (candidateBase === userId) return true;
  }
  return false;
}

/**
 * Clean up old timestamped R2 objects for a user + kind.
 * When we switch to fixed keys, old objects like profile/cover/userId/123.webp
 * remain in R2. This removes them.
 */
async function cleanupOldTimestampedObjects(userId: string, kind: string): Promise<void> {
  const prefix = `profile/${kind}/${userId}/`;
  try {
    const listed = await R2.send(
      new ListObjectsV2Command({ Bucket: BUCKET, Prefix: prefix, MaxKeys: 100 })
    );
    const objects = listed.Contents || [];
    if (objects.length === 0) return;

    r2Log("cleanup_old_timestamped", {
      kind,
      count: objects.length,
      status: "started",
    });

    for (const obj of objects) {
      if (obj.Key) {
        await deleteR2Object(obj.Key);
      }
    }

    r2Log("cleanup_old_timestamped", { kind, status: "done" });
  } catch (err) {
    r2Log("cleanup_old_timestamped", { kind, status: "failed", error: String(err) });
  }
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
 * Clean up old timestamped R2 objects left over from the old key scheme.
 * Called once per user+kind on their first upload with the new fixed-key system.
 */
async function cleanupLegacyObjects(userId: string, kind: string): Promise<void> {
  // Check if old timestamped objects exist under prefix profile/{kind}/{userId}/
  try {
    const listed = await R2.send(
      new ListObjectsV2Command({
        Bucket: BUCKET,
        Prefix: `profile/${kind}/${userId}/`,
        MaxKeys: 1,
      })
    );
    if ((listed.KeyCount ?? 0) > 0) {
      await cleanupOldTimestampedObjects(userId, kind);
    }
  } catch {
    // Non-fatal — old objects are harmless but wasteful
  }
}

/**
 * Clean up stale media records for the same user + kind.
 * Since we now use a fixed key, only 1 media record should exist per user+kind.
 */
async function cleanupStaleMediaRecords(userId: string, kind: string, keepKey: string): Promise<void> {
  try {
    const result = await query(
      `DELETE FROM media
       WHERE uploaded_by = $1
         AND key LIKE $2
         AND key != $3`,
      [userId, `profile/${kind}/${userId}%`, keepKey]
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

      const userId = req.user!.userId;
      // Fixed key — R2 PUT overwrites automatically
      const objectKey = `${purpose}/${userId}.webp`;

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

      try {
        await query(
          `INSERT INTO media (url, key, content_type, size, uploaded_by, created_at)
           VALUES ($1, $2, 'image/webp', 0, $3, NOW())
           ON CONFLICT (key) DO UPDATE
             SET url = EXCLUDED.url,
                 content_type = EXCLUDED.content_type`,
          [publicUrl, objectKey, userId]
        );
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

      invalidateCachedProfile(userId);

      // Cleanup stale media records
      await cleanupStaleMediaRecords(userId, purpose, objectKey).catch(() => {});

      res.json({
        success: true,
        data: { id: null, url: publicUrl },
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

      // Fixed key — R2 PUT overwrites automatically
      const objectKey = `profile/${kind}/${userId}.webp`;

      r2Log("intent", { step: "presign", kind, objectKey, mimeType, bucket: !!BUCKET });

      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
        ContentType: mimeType,
      });

      const uploadUrl = await getSignedUrl(R2, command, { expiresIn: 300 });
      const cdnUrl = PUBLIC_DOMAIN ? `${PUBLIC_DOMAIN}/${objectKey}` : objectKey;

      r2Log("intent", { step: "presign", status: "success" });

      // Cleanup any old timestamped objects from the legacy key scheme
      cleanupLegacyObjects(userId, kind).catch(() => {});

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

      // ── Database save ────────────────────────────────────────────────

      // 1. Upsert media record (audit trail)
      // ON CONFLICT: fixed key means 2nd+ upload hits UNIQUE constraint — upsert instead
      try {
        await query(
          `INSERT INTO media (url, key, content_type, size, uploaded_by, created_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (key) DO UPDATE
             SET url = EXCLUDED.url,
                 content_type = EXCLUDED.content_type,
                 size = EXCLUDED.size`,
          [url, objectKey, `image/${format || "jpeg"}`, bytes || 0, userId]
        );
        r2Log("save", { step: "media_record", status: "upserted", key: objectKey });
      } catch (mediaErr: any) {
        r2Log("save", { step: "media_record", status: "failed", error: mediaErr?.code || String(mediaErr) });
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
        r2Log("save", { step: "save_neon", status: "failed", error: String(profileErr) });
        res.status(500).json({ success: false, error: { code: "IMAGE_SAVE_FAILED", message: "Failed to save image metadata" } });
        return;
      }

      // 3. DB save succeeded — invalidate cache
      invalidateCachedProfile(userId);

      // 4. Cleanup stale media records for same user+kind
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

      const coverUrl = kind === "cover"
        ? (u?.cover_url || url)
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
      await R2.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1 }));
      res.json({ configured: true, bucket: true, verify: true });
    } catch {
      res.json({ configured: true, bucket: false, verify: false });
    }
  });
}
