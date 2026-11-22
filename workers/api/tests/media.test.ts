import { describe, expect, it } from "bun:test";
import { createApplication } from "../src/app.js";
import { signJwt } from "../src/core/security/jwt.js";

const JWT_SECRET = "velnox-default-development-jwt-secret-at-least-32-chars";

async function createAuthHeader(userId: string) {
  const token = await signJwt(
    {
      sub: userId,
      email: "uploader@velnox.live",
      role: "customer",
      type: "access",
      jti: crypto.randomUUID(),
    },
    JWT_SECRET,
    3600,
  );
  return `Bearer ${token}`;
}

describe("Media & Cloudflare R2 Upload Tests", () => {
  const app = createApplication();

  it("POST /api/v1/media/upload uploads valid WebP image", async () => {
    const authHeader = await createAuthHeader("user-media-1");

    // Create a mock image file
    const fileBytes = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50]);
    const file = new File([fileBytes], "test-image.webp", { type: "image/webp" });

    const formData = new FormData();
    formData.append("file", file);
    formData.append("purpose", "product_image");

    const res = await app.request("/api/v1/media/upload", {
      method: "POST",
      headers: {
        Authorization: authHeader,
      },
      body: formData,
    });

    expect(res.status).toBe(201);
    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.id).toBeDefined();
    expect(json.data.purpose).toBe("product_image");
    expect(json.data.contentType).toBe("image/webp");
    expect(json.data.publicUrl).toContain("https://media.velnox.live/product_image/user-media-1/");
    expect(json.data.fileSizeBytes).toBe(fileBytes.length);
  });

  it("POST /api/v1/media/upload rejects unsupported MIME types (e.g. PDF)", async () => {
    const authHeader = await createAuthHeader("user-media-1");

    const file = new File(["dummy pdf content"], "document.pdf", { type: "application/pdf" });
    const formData = new FormData();
    formData.append("file", file);
    formData.append("purpose", "verification_doc");

    const res = await app.request("/api/v1/media/upload", {
      method: "POST",
      headers: {
        Authorization: authHeader,
      },
      body: formData,
    });

    expect(res.status).toBe(500); // Throws unsupported MIME error
    const json = (await res.json()) as any;
    expect(json.success).toBe(false);
  });

  it("POST /api/v1/media/upload rejects missing file", async () => {
    const authHeader = await createAuthHeader("user-media-1");

    const formData = new FormData();
    formData.append("purpose", "product_image");

    const res = await app.request("/api/v1/media/upload", {
      method: "POST",
      headers: {
        Authorization: authHeader,
      },
      body: formData,
    });

    expect(res.status).toBe(400);
    const json = (await res.json()) as any;
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("VALIDATION_ERROR");
  });

  it("GET /api/v1/media/:id returns 404 for unknown media", async () => {
    const authHeader = await createAuthHeader("user-media-1");

    const res = await app.request("/api/v1/media/unknown-id-123", {
      headers: {
        Authorization: authHeader,
      },
    });

    expect(res.status).toBe(404);
    const json = (await res.json()) as any;
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("NOT_FOUND");
  });
});
