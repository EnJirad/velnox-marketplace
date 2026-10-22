/**
 * MVP account profile + profile-photo upload.
 *
 * The original shopper experience had an account page whose photo was uploaded
 * straight to R2 through a presigned PUT and confirmed by the server. That flow
 * is restored here against the canonical `users.avatar_url` and `media` rows
 * (`media.object_key` is the column the schema actually has — the pre-MVP media
 * code's `key` column does not exist).
 *
 * Write rules:
 *   • the key is server-minted from the session's user id, so a client can
 *     neither choose another user's namespace nor overwrite it;
 *   • the confirm step reads back existence, size and content type from R2;
 *   • only the signed-in user's own row is ever updated — no user id in the body.
 */
import crypto from "node:crypto";
import type { Express, Request, Response } from "express";
import { query } from "../db/index.js";
import {
  ALLOWED_IMAGE_TYPES,
  MAX_AVATAR_BYTES,
  inspectObject,
  isR2Configured,
  presignImagePut,
} from "../lib/r2.js";
import {
  ApiError,
  badRequest,
  ok,
  optionalString,
  requireActiveUser,
  requireInt,
  requireString,
  route,
} from "./http.js";

/** `image/jpeg` → `jpg`, etc. Keeps a key's extension honest. */
const EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

interface ProfileRow {
  id: string;
  email: string;
  name: string;
  phone: string | null;
  avatar_url: string | null;
  role: string;
  created_at: string;
}

function profilePayload(row: ProfileRow) {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    phone: row.phone,
    avatarUrl: row.avatar_url,
    role: row.role,
    createdAt: row.created_at,
  };
}

const AVATAR_PREFIX = (userId: string) => `profile/avatar/${userId}/`;

export function setupMvpProfileRoutes(app: Express): void {
  // ── Read own profile ─────────────────────────────────────────────────────
  app.get(
    "/api/mvp/profile",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const result = await query(
        `SELECT id, email, name, phone, avatar_url, role, created_at
           FROM users WHERE id = $1`,
        [req.sessionUser!.id],
      );
      const row = result.rows[0] as ProfileRow | undefined;
      if (!row) throw new ApiError(404, "PROFILE_NOT_FOUND", "Profile not found");
      ok(res, { profile: profilePayload(row) });
    }),
  );

  // ── Update name / phone ──────────────────────────────────────────────────
  app.patch(
    "/api/mvp/profile",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const name = requireString(body.name, "name", { min: 1, max: 120 });
      const phone = optionalString(body.phone, "phone", { max: 32 });

      const updated = await query(
        `UPDATE users SET name = $1, phone = $2, updated_at = NOW()
          WHERE id = $3
          RETURNING id, email, name, phone, avatar_url, role, created_at`,
        [name, phone, req.sessionUser!.id],
      );
      const row = updated.rows[0] as ProfileRow | undefined;
      if (!row) throw new ApiError(404, "PROFILE_NOT_FOUND", "Profile not found");
      ok(res, { profile: profilePayload(row) });
    }),
  );

  // ── Presign an avatar PUT ────────────────────────────────────────────────
  app.post(
    "/api/mvp/profile/avatar/presign",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const contentType = requireString(body.contentType, "contentType", { max: 100 });
      if (!(ALLOWED_IMAGE_TYPES as readonly string[]).includes(contentType)) {
        throw badRequest(
          "UNSUPPORTED_IMAGE_TYPE",
          `Allowed image types: ${ALLOWED_IMAGE_TYPES.join(", ")}`,
        );
      }
      const size = requireInt(body.size, "size", { min: 1, max: MAX_AVATAR_BYTES });

      if (!isR2Configured()) {
        throw new ApiError(
          503,
          "UPLOAD_NOT_CONFIGURED",
          "Image storage is not configured (R2_* environment variables are missing)",
        );
      }

      const objectKey = `${AVATAR_PREFIX(req.sessionUser!.id)}${crypto.randomUUID()}.${EXTENSION[contentType]}`;
      const signed = await presignImagePut({ objectKey, contentType });
      ok(
        res,
        {
          uploadUrl: signed.uploadUrl,
          objectKey: signed.objectKey,
          publicUrl: signed.publicUrl,
          expiresIn: signed.expiresIn,
          contentType,
          maxBytes: MAX_AVATAR_BYTES,
          declaredSize: size,
        },
        201,
      );
    }),
  );

  // ── Confirm the upload and point the account at it ───────────────────────
  app.post(
    "/api/mvp/profile/avatar/confirm",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const userId = req.sessionUser!.id;
      const objectKey = requireString((req.body ?? {}).objectKey, "objectKey", { max: 512 });

      if (!objectKey.startsWith(AVATAR_PREFIX(userId))) {
        throw new ApiError(403, "OBJECT_NOT_OWNED", "This upload does not belong to your account");
      }
      if (objectKey.slice(AVATAR_PREFIX(userId).length).includes("/")) {
        throw badRequest("INVALID_OBJECT_KEY", "objectKey must be a single object");
      }

      const object = await inspectObject(objectKey);
      if (!object.found) {
        throw badRequest("UPLOAD_NOT_FOUND", "The image was not found in storage");
      }
      if (object.size !== null && object.size > MAX_AVATAR_BYTES) {
        throw badRequest("UPLOAD_TOO_LARGE", `Images must be at most ${MAX_AVATAR_BYTES} bytes`);
      }
      if (object.contentType && !(ALLOWED_IMAGE_TYPES as readonly string[]).includes(object.contentType)) {
        throw badRequest("UNSUPPORTED_IMAGE_TYPE", "The stored object is not a supported image");
      }

      const publicDomain = (process.env.R2_PUBLIC_DOMAIN ?? "").trim().replace(/\/+$/, "");
      if (!publicDomain) {
        throw new ApiError(503, "UPLOAD_NOT_CONFIGURED", "R2_PUBLIC_DOMAIN is not configured");
      }
      const url = `${publicDomain}/${objectKey}`;
      const contentType = object.contentType ?? "image/webp";
      const size = object.size ?? 1;

      await query(
        `INSERT INTO media (object_key, url, content_type, size, uploaded_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (object_key) DO UPDATE
           SET url = EXCLUDED.url,
               content_type = EXCLUDED.content_type,
               size = EXCLUDED.size,
               uploaded_by = EXCLUDED.uploaded_by`,
        [objectKey, url, contentType, size, userId],
      );
      const updated = await query(
        `UPDATE users SET avatar_url = $1, updated_at = NOW()
          WHERE id = $2
          RETURNING avatar_url`,
        [url, userId],
      );

      ok(res, {
        avatarUrl: (updated.rows[0] as { avatar_url: string } | undefined)?.avatar_url ?? url,
        objectKey,
      });
    }),
  );

  // ── Remove the photo (the object stays; the account stops pointing at it) ─
  app.delete(
    "/api/mvp/profile/avatar",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      await query(`UPDATE users SET avatar_url = NULL, updated_at = NOW() WHERE id = $1`, [
        req.sessionUser!.id,
      ]);
      ok(res, { avatarUrl: null });
    }),
  );
}
