import type { Express, Request, Response } from "express";
import { S3Client, PutObjectCommand, DeleteObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";
import { ALLOWED_UPLOAD_TYPES, isUploadTooLarge } from "../lib/media-config.js";
import { headR2Object } from "../lib/r2-objects.js";
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

// ─── Allowed MIME types + size limit come from lib/media-config.ts ──────────

const ALLOWED_TYPES: string[] = [...ALLOWED_UPLOAD_TYPES];

// ─── Canonical upload purposes ──────────────────────────────────────────────
// The purpose decides which bucket namespace a signed PUT may write into, so it
// is an allowlist and never free text. Every namespace it can produce must be
// one `validateObjectKeyOwnership` accepts at confirm time — otherwise the PUT
// succeeds and the confirm can only ever answer 403. An unknown purpose is
// refused before any URL is signed (same contract as the evidence flow in
// routes/verification.ts).

const UPLOAD_PURPOSES = ["avatar", "cover", "shop-logo", "shop-cover"] as const;
type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];

const PROFILE_IMAGE_KINDS = ["avatar", "cover"] as const;
type ProfileImageKind = (typeof PROFILE_IMAGE_KINDS)[number];

/** The type a fixed `.webp` key holds. Producers convert before uploading. */
const CANONICAL_IMAGE_TYPE = "image/webp";

function isUploadPurpose(value: unknown): value is UploadPurpose {
  return typeof value === "string" && (UPLOAD_PURPOSES as readonly string[]).includes(value);
}

function isProfileImageKind(value: unknown): value is ProfileImageKind {
  return typeof value === "string" && (PROFILE_IMAGE_KINDS as readonly string[]).includes(value);
}

/**
 * The purpose implied by the object key the server itself minted at presign.
 * Server-derived on purpose: a body value must never decide which reference
 * (avatar / cover / shop logo / shop cover) gets written.
 */
function purposeFromObjectKey(objectKey: string): UploadPurpose | null {
  const parts = objectKey.split("/");
  if (parts[0] === "profile") {
    return isProfileImageKind(parts[1]) ? parts[1] : null;
  }
  if (parts[0] === "shop") {
    if (parts[2] === "logo.webp") return "shop-logo";
    if (parts[2] === "cover.webp") return "shop-cover";
  }
  return null;
}

/** Profile-image kind implied by a key (fixed and legacy key shapes). */
function profileKindFromObjectKey(objectKey: string): ProfileImageKind | null {
  const parts = objectKey.split("/");
  if (parts[0] !== "profile") return null;
  return isProfileImageKind(parts[1]) ? parts[1] : null;
}

/**
 * A stored object is only a valid upload when its ACTUAL content type — read
 * back from R2, never taken from the body — is one of the allowed image types.
 * A missing type falls back to the canonical one so a storage quirk cannot
 * break an otherwise valid image (the key is fixed, so the format is known).
 */
function isStoredContentTypeAllowed(contentType: string | null | undefined): boolean {
  if (!contentType) return true;
  return ALLOWED_TYPES.includes(contentType);
}

// ─── Safe logging (no secrets) ──────────────────────────────────────────────

function r2Log(step: string, data: Record<string, unknown>) {
  console.log(`[R2 UPLOAD] step=${step}`, JSON.stringify(data));
}

// ─── R2 Object Verification ─────────────────────────────────────────────────

async function inspectR2Object(key: string) {
  // Existence, ACTUAL size and content type are read back from R2 — the size
  // cap is enforced against storage, never against a client-supplied number.
  const meta = await headR2Object(key);
  r2Log("verify", { key, status: meta.found ? "found" : "not_found", size: meta.size });
  return meta;
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
  // Shop keys: shop/{shopId}/logo.webp or shop/{shopId}/cover.webp
  if (parts.length >= 3 && parts[0] === "shop") {
    return true; // allow presign; confirm handler validates ownership via DB
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

      if (!isUploadPurpose(purpose)) {
        r2Log("presign", { step: "purpose", status: "rejected" });
        res.status(400).json({ success: false, error: { code: "INVALID_PURPOSE", message: `Unknown upload purpose. Allowed: ${UPLOAD_PURPOSES.join(", ")}` } });
        return;
      }

      const userId = req.user!.userId;
      // Fixed key — R2 PUT overwrites automatically
      let objectKey: string;
      if (purpose === "shop-logo" || purpose === "shop-cover") {
        const { shopId } = req.body;
        if (!shopId) {
          res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "shopId required for shop uploads" } });
          return;
        }
        // Verify ownership via DB
        const ownership = await query(
          `SELECT sh.id FROM shops sh JOIN sellers s ON s.id = sh.seller_id
           WHERE sh.id = $1 AND s.user_id = $2`,
          [shopId, userId]
        );
        if (ownership.rows.length === 0) {
          res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Cannot upload to another seller's shop" } });
          return;
        }
        const kind = purpose === "shop-logo" ? "logo" : "cover";
        objectKey = `shop/${shopId}/${kind}.webp`;
      } else {
        // avatar / cover live in the `profile/{kind}/{userId}.webp` namespace
        // that validateObjectKeyOwnership verifies. The old
        // `<purpose>/<userId>.webp` shape let a client invent a bucket
        // namespace the backend never validates, and no non-shop namespace it
        // produced could ever pass the confirm step.
        objectKey = `profile/${purpose}/${userId}.webp`;
      }

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
      const { objectKey } = req.body;
      const userId = req.user!.userId;

      if (!objectKey) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "objectKey required" } });
        return;
      }

      // Derived from the key, not the body: `purpose: "avatar"` with a cover
      // key used to overwrite users.avatar with the cover URL.
      const purpose = purposeFromObjectKey(objectKey);
      if (!purpose) {
        r2Log("confirm", { step: "purpose", status: "rejected", objectKey });
        res.status(400).json({ success: false, error: { code: "INVALID_PURPOSE", message: "Object key does not match a known upload namespace" } });
        return;
      }

      if (!validateObjectKeyOwnership(objectKey, userId)) {
        r2Log("confirm", { step: "verify_ownership", status: "denied", objectKey });
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Cannot upload to another user's path" } });
        return;
      }

      const obj = await inspectR2Object(objectKey);
      if (!obj.found) {
        r2Log("confirm", { step: "verify_object", status: "failed", objectKey });
        res.status(400).json({ success: false, error: { code: "R2_OBJECT_NOT_FOUND", message: "Upload not found in storage. Please try again." } });
        return;
      }
      if (isUploadTooLarge(obj.size)) {
        r2Log("confirm", { step: "size_check", status: "rejected", objectKey, size: obj.size });
        res.status(400).json({ success: false, error: { code: "FILE_TOO_LARGE", message: "File exceeds the maximum allowed size" } });
        return;
      }
      if (!isStoredContentTypeAllowed(obj.contentType)) {
        r2Log("confirm", { step: "mime_check", status: "rejected", objectKey, contentType: obj.contentType });
        res.status(400).json({ success: false, error: { code: "INVALID_FILE_TYPE", message: "Stored object is not an allowed image type" } });
        return;
      }

      // Shop uploads: ownership must be proven BEFORE any write below — the
      // 403 used to land after the media upsert, leaving a written row behind
      // a refused request.
      if (purpose === "shop-logo" || purpose === "shop-cover") {
        const earlyShop = objectKey.split("/")[1] || "";
        const ownership = await query(
          `SELECT sh.id FROM shops sh JOIN sellers s ON s.id = sh.seller_id
           WHERE sh.id = $1 AND s.user_id = $2`,
          [earlyShop, userId],
        );
        if (ownership.rows.length === 0) {
          res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Cannot upload to another seller's shop" } });
          return;
        }
      }

      const publicUrl = PUBLIC_DOMAIN ? `${PUBLIC_DOMAIN}/${objectKey}` : objectKey;

      try {
        await query(          `INSERT INTO media (url, key, content_type, size, uploaded_by, created_at)
             VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (key) DO UPDATE
             SET url = EXCLUDED.url,
                 content_type = EXCLUDED.content_type,
                 size = EXCLUDED.size`,
          [publicUrl, objectKey, obj.contentType || CANONICAL_IMAGE_TYPE, obj.size ?? 0, userId]
        );
      } catch (mediaErr: any) {
        // Media persistence gates the reference write: if the row cannot be
        // written, no avatar / cover / shop reference may move and the client
        // must not be told the upload succeeded.
        r2Log("confirm", { step: "media_record", status: "failed", error: mediaErr?.code || String(mediaErr) });
        res.status(500).json({ success: false, error: { code: "IMAGE_SAVE_FAILED", message: "Failed to save upload" } });
        return;
      }

      if (purpose === "avatar") {
        await query("UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2", [publicUrl, userId]);
      } else if (purpose === "cover") {
        try {
          await query("UPDATE users SET cover_url = $1, updated_at = NOW() WHERE id = $2", [publicUrl, userId]);
        } catch (coverErr: any) {
          if (coverErr?.code !== "42703") throw coverErr;
        }
      } else {
        // shop-logo / shop-cover — ownership was proven before the media row
        // was written, so the reference can move now.
        // Extract shopId from objectKey: shop/{shopId}/logo.webp or shop/{shopId}/cover.webp
        const shopParts = objectKey.split("/");
        const shopId = shopParts[1];
        if (shopId) {
          const col = purpose === "shop-logo" ? "logo" : "cover";
          await query(`UPDATE shops SET ${col} = $1, updated_at = NOW() WHERE id = $2`, [publicUrl, shopId]);
        }
      }

      invalidateCachedProfile(userId);
      // Also invalidate the /api/customer/profile cache (routes/index.ts) so
      // the profile page never serves a stale avatar/cover for up to 30s.
      try {
        const { invalidateCustomerProfileCache } = await import("./index.js");
        invalidateCustomerProfileCache(userId);
      } catch { /* non-fatal */ }

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
      // `kind` is required and allowlisted: it selects the key namespace, so
      // it used to mint `profile/<anything>/<userId>.webp` from a client
      // string. No default — a missing kind is denied rather than assumed.
      const { kind, filename, mimeType } = req.body;
      const userId = req.user!.userId;

      if (!isProfileImageKind(kind)) {
        r2Log("intent", { step: "kind", status: "rejected" });
        res.status(400).json({ success: false, error: { code: "INVALID_PURPOSE", message: "kind must be avatar or cover" } });
        return;
      }

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
      const { objectKey } = req.body;
      const userId = req.user!.userId;

      if (!objectKey) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "objectKey required" } });
        return;
      }

      // `kind` comes from the key, never the body — `kind: "cover"` with an
      // avatar key used to write cover_url onto the avatar object. The stored
      // URL is derived from the configured public domain + the verified key;
      // a body `cdnUrl` is never persisted.
      const kind = profileKindFromObjectKey(objectKey);
      if (!kind) {
        r2Log("save", { step: "kind", status: "rejected", objectKey });
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "objectKey must be profile/{avatar|cover}/{userId}.webp" } });
        return;
      }

      const url = PUBLIC_DOMAIN ? `${PUBLIC_DOMAIN}/${objectKey}` : objectKey;

      r2Log("save", { step: "verify_ownership", userId, kind });
      if (!validateObjectKeyOwnership(objectKey, userId)) {
        r2Log("save", { step: "verify_ownership", status: "denied", userId, objectKey });
        res.status(403).json({ success: false, error: { code: "PROFILE_IMAGE_OWNERSHIP_DENIED", message: "Cannot save to another user's path" } });
        return;
      }
      r2Log("save", { step: "verify_ownership", status: "passed", userId, kind });

      const obj = await inspectR2Object(objectKey);
      if (!obj.found) {
        r2Log("save", { step: "verify_object", status: "failed", objectKey });
        res.status(400).json({ success: false, error: { code: "R2_OBJECT_NOT_FOUND", message: "Image not found in storage. Please try uploading again." } });
        return;
      }
      if (isUploadTooLarge(obj.size)) {
        r2Log("save", { step: "size_check", status: "rejected", objectKey, size: obj.size });
        res.status(400).json({ success: false, error: { code: "FILE_TOO_LARGE", message: "File exceeds the maximum allowed size" } });
        return;
      }
      if (!isStoredContentTypeAllowed(obj.contentType)) {
        r2Log("save", { step: "mime_check", status: "rejected", objectKey, contentType: obj.contentType });
        res.status(400).json({ success: false, error: { code: "INVALID_FILE_TYPE", message: "Stored object is not an allowed image type" } });
        return;
      }

      r2Log("save", { step: "save_neon", kind, objectKey, size: obj.size ?? 0 });

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
          [url, objectKey, obj.contentType || CANONICAL_IMAGE_TYPE, obj.size ?? 0, userId]
        );
        r2Log("save", { step: "media_record", status: "upserted", key: objectKey });
      } catch (mediaErr: any) {
        // The user reference may only move once the media row exists —
        // otherwise users.avatar can point at an object with no canonical
        // media record while the client is told the save succeeded.
        r2Log("save", { step: "media_record", status: "failed", error: mediaErr?.code || String(mediaErr) });
        res.status(500).json({ success: false, error: { code: "IMAGE_SAVE_FAILED", message: "Failed to save image metadata" } });
        return;
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

      // 3. DB save succeeded — invalidate caches
      invalidateCachedProfile(userId);
      try {
        const { invalidateCustomerProfileCache } = await import("./index.js");
        invalidateCustomerProfileCache(userId);
      } catch { /* non-fatal */ }

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

  // NOTE: `PATCH /api/customer/profile-image` was removed here. It wrote
  // `users.avatar` straight from `req.body.image` — an authenticated client
  // could point the avatar at any URL with no presign, no R2 object and no
  // media row, i.e. a full bypass of the verified upload flow. The canonical
  // `POST /api/customer/profile-image/save` already writes that same reference
  // after the object has been verified in storage, so nothing replaced it.

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
