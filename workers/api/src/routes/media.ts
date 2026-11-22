import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { createNeonClient } from "../core/database/db-client.js";
import { MediaService } from "../modules/media/media-service.js";
import type { MediaPurpose } from "../modules/media/types.js";
import type { Bindings, Variables } from "../types.js";

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

// Protected route
mediaRoutes.use("*", authMiddleware);

/**
 * POST /api/v1/media/upload
 * Multipart form-data: file, purpose
 */
mediaRoutes.post("/upload", async (c) => {
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
 * Retrieve media metadata
 */
mediaRoutes.get("/:id", async (c) => {
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
