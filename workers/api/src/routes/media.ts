import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { parseCookies } from "../core/security/cookies.js";
import { verifyJwt } from "../core/security/jwt.js";
import { createNeonClient } from "../core/database/db-client.js";
import { MediaService } from "../modules/media/media-service.js";
import type { MediaPurpose } from "../modules/media/types.js";
import type { Bindings, Variables } from "../types.js";
import { SESSION_COOKIE_NAME } from "@velnox/config";

export const mediaRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

let mediaServiceInstance: MediaService | null = null;

function getMediaService(c: any): MediaService {
  if (mediaServiceInstance) return mediaServiceInstance;

  const env = c.env as Bindings;
  let db;
  if (env?.DATABASE_URL) {
    db = createNeonClient(env.DATABASE_URL, env.ENVIRONMENT);
  }

  mediaServiceInstance = new MediaService(env, db);
  return mediaServiceInstance;
}

export function setTestMediaService(service: MediaService | null) {
  mediaServiceInstance = service;
}

/**
 * Helper to optionally resolve user ID from Bearer token or session cookie
 */
async function getUserIdOrFallback(c: any): Promise<string> {
  const existingUser = c.get("user");
  if (existingUser?.sub) return existingUser.sub;

  const secret = c.env?.JWT_SECRET || "velnox-default-development-jwt-secret-at-least-32-chars";
  let token: string | null = null;
  const authHeader = c.req.header("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  }
  if (!token) {
    const cookies = parseCookies(c.req.header("Cookie"));
    token = cookies[SESSION_COOKIE_NAME] || null;
  }

  if (token) {
    try {
      const payload = await verifyJwt(token, secret);
      return payload.sub || "system";
    } catch {
      // Invalid token fallback
    }
  }

  return "system";
}

/**
 * POST /api/upload/presign & POST /api/v1/media/presign & POST /upload-intent
 * Generates direct R2 upload URL and object key
 */
const handlePresign = async (c: any) => {
  const userId = await getUserIdOrFallback(c);
  const body = (await c.req.json().catch(() => null)) as any;

  if (!body) {
    return c.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Missing request body" },
      },
      400,
    );
  }

  const filename = body.filename || body.fileName || "file.webp";
  const contentType = body.contentType || body.mimeType || "image/webp";
  const folder = body.folder;
  const purpose = body.purpose;
  const referenceId = body.referenceId;
  const shopId = body.shopId;
  const conversationId = body.conversationId;
  const categoryId = body.categoryId;

  const reqUrl = new URL(c.req.url);
  const origin = reqUrl.origin;

  const service = getMediaService(c);
  const intent = await service.generateUploadIntent({
    userId,
    filename,
    contentType,
    folder,
    purpose,
    referenceId,
    shopId,
    conversationId,
    categoryId,
    origin,
  });

  return c.json({
    success: true,
    data: intent,
  });
};

mediaRoutes.post("/presign", handlePresign);
mediaRoutes.post("/upload-intent", handlePresign);
mediaRoutes.post("/image-upload-intent", handlePresign);

/**
 * PUT /api/upload/raw/:key{.*}
 * Receives raw binary file body and writes directly to Cloudflare R2
 */
mediaRoutes.put("/raw/:key{.+}", async (c) => {
  const key = c.req.param("key");
  const contentType = c.req.header("Content-Type") || "application/octet-stream";
  const buffer = await c.req.raw.arrayBuffer();

  const service = getMediaService(c);
  const result = await service.saveRawUpload(key, buffer, contentType);

  return c.json({
    success: true,
    data: result,
  });
});

/**
 * POST /api/upload/confirm
 * Confirms uploaded R2 object and persists metadata
 */
mediaRoutes.post("/confirm", async (c) => {
  const userId = await getUserIdOrFallback(c);
  const body = (await c.req.json().catch(() => null)) as any;

  if (!body || !body.objectKey) {
    return c.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "objectKey required" },
      },
      400,
    );
  }

  const service = getMediaService(c);
  const result = await service.confirmUpload({
    userId,
    objectKey: body.objectKey,
    folder: body.folder,
    referenceId: body.referenceId,
    purpose: body.purpose,
  });

  return c.json({
    success: true,
    data: result,
  });
});

/**
 * POST /api/v1/media/upload
 * Multipart form-data: file, purpose (requires auth)
 */
mediaRoutes.post("/upload", authMiddleware, async (c) => {
  const user = c.get("user");
  const body = await c.req.parseBody().catch(() => null);

  if (!body || !body.file) {
    return c.json(
      {
        success: false,
        error: {
          code: "VALIDATION_ERROR",
          message: "No file provided in form-data ('file' field required)",
        },
      },
      400,
    );
  }

  const file = body.file as File;
  const purpose = (body.purpose as MediaPurpose) || "product_image";

  const buffer = await file.arrayBuffer();
  const service = getMediaService(c);

  const mediaObj = await service.uploadImage({
    userId: user.sub,
    purpose,
    fileBuffer: buffer,
    contentType: file.type || "application/octet-stream",
    fileName: file.name,
  });

  return c.json(
    {
      success: true,
      data: mediaObj,
    },
    201,
  );
});

/**
 * GET /api/v1/media/:id
 * Retrieve media metadata (requires auth)
 */
mediaRoutes.get("/:id", authMiddleware, async (c) => {
  const id = c.req.param("id");
  const service = getMediaService(c);
  const media = await service.getMediaById(id);

  if (!media) {
    return c.json(
      {
        success: false,
        error: {
          code: "NOT_FOUND",
          message: "Media not found",
        },
      },
      404,
    );
  }

  return c.json({
    success: true,
    data: media,
  });
});
