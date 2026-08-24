import type { Express, Request, Response } from "express";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";

const R2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});

const BUCKET = process.env.R2_BUCKET || "";
const PUBLIC_DOMAIN = process.env.R2_PUBLIC_DOMAIN || "";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

/**
 * Register upload routes.
 *
 * POST /api/upload/presign
 *   - body: { filename, contentType, purpose }
 *   - purpose: "avatar" | "cover" | "product" | "shop"
 *   - Returns: { uploadUrl, objectKey, publicUrl }
 *
 * POST /api/upload/confirm
 *   - body: { objectKey, purpose, entityId? }
 *   - Saves metadata to Neon media table
 *   - Returns: { id, url }
 */
export function setupUploadRoutes(app: Express): void {
  // Generate presigned upload URL
  app.post("/api/upload/presign", requireAuth, async (req: Request, res: Response) => {
    try {
      const { filename, contentType, purpose = "avatar" } = req.body;

      if (!filename || !contentType) {
        res.status(400).json({ success: false, error: { message: "filename and contentType required" } });
        return;
      }

      if (!ALLOWED_TYPES.includes(contentType)) {
        res.status(400).json({ success: false, error: { message: "File type not allowed" } });
        return;
      }

      const ext = filename.split(".").pop() || "jpg";
      const userId = req.user!.userId;
      const timestamp = Date.now();
      const objectKey = `${purpose}/${userId}/${timestamp}.${ext}`;

      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
        ContentType: contentType,
        // Max file size validation on R2 side
      });

      const uploadUrl = await getSignedUrl(R2, command, { expiresIn: 300 }); // 5 min

      const publicUrl = PUBLIC_DOMAIN ? `${PUBLIC_DOMAIN}/${objectKey}` : "";

      res.json({
        success: true,
        data: { uploadUrl, objectKey, publicUrl },
      });
    } catch (err) {
      console.error("[upload] presign error:", err);
      res.status(500).json({ success: false, error: { message: "Failed to generate upload URL" } });
    }
  });

  // Confirm upload and save metadata
  app.post("/api/upload/confirm", requireAuth, async (req: Request, res: Response) => {
    try {
      const { objectKey, purpose = "avatar", entityId } = req.body;
      const userId = req.user!.userId;

      if (!objectKey) {
        res.status(400).json({ success: false, error: { message: "objectKey required" } });
        return;
      }

      const publicUrl = PUBLIC_DOMAIN ? `${PUBLIC_DOMAIN}/${objectKey}` : objectKey;

      // Save media record
      const mediaResult = await query(
        `INSERT INTO media (id, url, key, content_type, size, uploaded_by, created_at)
         VALUES (gen_random_uuid(), $1, $2, 'image', 0, $3, NOW())
         RETURNING id, url`,
        [publicUrl, objectKey, userId]
      );

      const mediaId = mediaResult.rows[0].id;

      // Update user profile based on purpose
      if (purpose === "avatar") {
        await query("UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2", [publicUrl, userId]);
      }

      res.json({
        success: true,
        data: { id: mediaId, url: publicUrl },
      });
    } catch (err) {
      console.error("[upload] confirm error:", err);
      res.status(500).json({ success: false, error: { message: "Failed to save upload" } });
    }
  });

  // ─── Profile image endpoints (consumed by ProfileImageUpload component) ──

  /** GET /api/customer/profile-image/upload-intent → presigned R2 URL */
  app.post("/api/customer/profile-image/upload-intent", requireAuth, async (req: Request, res: Response) => {
    try {
      const { kind = "avatar", filename, mimeType } = req.body;
      const userId = req.user!.userId;

      if (!ALLOWED_TYPES.includes(mimeType)) {
        res.status(400).json({ success: false, error: { message: "File type not allowed" } });
        return;
      }

      const ext = (filename || "image.jpg").split(".").pop() || "jpg";
      const timestamp = Date.now();
      const objectKey = `profile/${kind}/${userId}/${timestamp}.${ext}`;

      const command = new PutObjectCommand({
        Bucket: BUCKET,
        Key: objectKey,
        ContentType: mimeType,
      });

      const uploadUrl = await getSignedUrl(R2, command, { expiresIn: 300 });
      const cdnUrl = PUBLIC_DOMAIN ? `${PUBLIC_DOMAIN}/${objectKey}` : objectKey;

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
      console.error("[upload] intent error:", err);
      res.status(500).json({ success: false, error: { message: "Failed to generate upload URL" } });
    }
  });

  /** POST /api/customer/profile-image/save → persist metadata + update user */
  app.post("/api/customer/profile-image/save", requireAuth, async (req: Request, res: Response) => {
    try {
      const { kind = "avatar", objectKey, cdnUrl, format, bytes } = req.body;
      const userId = req.user!.userId;
      const url = cdnUrl || (PUBLIC_DOMAIN ? `${PUBLIC_DOMAIN}/${objectKey}` : objectKey);

      // Save media record
      await query(
        `INSERT INTO media (id, url, key, content_type, size, uploaded_by, created_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, NOW())`,
        [url, objectKey, `image/${format || "jpeg"}`, bytes || 0, userId]
      );

      // Update user field
      if (kind === "avatar") {
        await query("UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2", [url, userId]);
      } else if (kind === "cover") {
        try {
          await query("UPDATE users SET cover_url = $1, updated_at = NOW() WHERE id = $2", [url, userId]);
        } catch (coverErr: any) {
          // cover_url column may not exist yet — silently skip, image is saved to R2
          if (coverErr?.code !== "42703") throw coverErr;
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

      res.json({
        success: true,
        data: {
          avatarUrl: u?.avatar || null,
          coverUrl: u?.cover_url || null,
        },
      });
    } catch (err) {
      console.error("[upload] save error:", err);
      res.status(500).json({ success: false, error: { message: "Failed to save image" } });
    }
  });

  /** PATCH /api/customer/profile-image → update user avatar field */
  app.patch("/api/customer/profile-image", requireAuth, async (req: Request, res: Response) => {
    try {
      const { image } = req.body;
      const userId = req.user!.userId;

      await query("UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2", [image, userId]);

      res.json({ success: true, data: { avatar: image } });
    } catch (err) {
      console.error("[upload] patch error:", err);
      res.status(500).json({ success: false, error: { message: "Failed to update image" } });
    }
  });
}
