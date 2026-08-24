import type { Express, Request, Response } from "express";
import { S3Client, PutObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";

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

      const uploadUrl = await getSignedUrl(R2, command, { expiresIn: 300 }); // 5 min
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

      // Verify ownership
      if (!validateObjectKeyOwnership(objectKey, userId)) {
        r2Log("confirm", { step: "verify_ownership", status: "denied", objectKey });
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Cannot upload to another user's path" } });
        return;
      }

      // Verify object exists in R2
      const exists = await verifyR2Object(objectKey);
      if (!exists) {
        r2Log("confirm", { step: "verify_object", status: "failed", objectKey });
        res.status(400).json({ success: false, error: { code: "R2_OBJECT_NOT_FOUND", message: "Upload not found in storage. Please try again." } });
        return;
      }

      const publicUrl = PUBLIC_DOMAIN ? `${PUBLIC_DOMAIN}/${objectKey}` : objectKey;

      // Save media record (use correct schema columns)
      const mediaResult = await query(
        `INSERT INTO media (owner_id, object_key, cdn_url, mime_type, file_size, status, created_at)
         VALUES ($1, $2, $3, 'image', 0, 'active', NOW())
         RETURNING id, cdn_url`,
        [userId, objectKey, publicUrl]
      );

      const mediaId = mediaResult.rows[0].id;

      // Update user profile based on purpose
      if (purpose === "avatar") {
        await query("UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2", [publicUrl, userId]);
      } else if (purpose === "cover") {
        try {
          await query("UPDATE users SET cover_url = $1, updated_at = NOW() WHERE id = $2", [publicUrl, userId]);
        } catch (coverErr: any) {
          if (coverErr?.code !== "42703") throw coverErr; // column doesn't exist yet
        }
      }

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

      const uploadUrl = await getSignedUrl(R2, command, { expiresIn: 300 }); // 5 min
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

      // Verify ownership — user can only save to their own path
      r2Log("save", { step: "verify_ownership", userId, objectKey });
      if (!validateObjectKeyOwnership(objectKey, userId)) {
        r2Log("save", { step: "verify_ownership", status: "denied", userId, objectKey });
        res.status(403).json({ success: false, error: { code: "PROFILE_IMAGE_OWNERSHIP_DENIED", message: "Cannot save to another user's path" } });
        return;
      }
      r2Log("save", { step: "verify_ownership", status: "passed", userId, kind });

      // CRITICAL: Verify object exists in R2 before saving to Neon
      const exists = await verifyR2Object(objectKey);
      if (!exists) {
        r2Log("save", { step: "verify_object", status: "failed", objectKey });
        res.status(400).json({ success: false, error: { code: "R2_OBJECT_NOT_FOUND", message: "Image not found in storage. Please try uploading again." } });
        return;
      }

      r2Log("save", { step: "save_neon", kind, objectKey, mimeType: `image/${format || "jpeg"}`, size: bytes || 0 });

      // Save media record (use correct schema columns)
      await query(
        `INSERT INTO media (owner_id, object_key, cdn_url, mime_type, file_size, status, created_at)
         VALUES ($1, $2, $3, $4, $5, 'active', NOW())`,
        [userId, objectKey, url, `image/${format || "jpeg"}`, bytes || 0]
      );

      // Update user field
      if (kind === "avatar") {
        await query("UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2", [url, userId]);
      } else if (kind === "cover") {
        try {
          await query("UPDATE users SET cover_url = $1, updated_at = NOW() WHERE id = $2", [url, userId]);
        } catch (coverErr: any) {
          if (coverErr?.code !== "42703") throw coverErr; // column doesn't exist yet
        }
      }

      // Return updated profile
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

      r2Log("save", { step: "save_neon", status: "success" });

      res.json({
        success: true,
        data: {
          avatarUrl: u?.avatar || null,
          coverUrl: u?.cover_url || null,
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
      // Try to list objects with max 1 to verify bucket access
      const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      await R2.send(new ListObjectsV2Command({ Bucket: BUCKET, MaxKeys: 1 }));

      res.json({ configured: true, bucket: true, verify: true });
    } catch {
      res.json({ configured: true, bucket: false, verify: false });
    }
  });
}
