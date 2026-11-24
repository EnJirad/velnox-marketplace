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
    expect(json.data.publicUrl).toContain("https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev/product_image/user-media-1/");
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

  it("POST /api/upload/presign, PUT /raw, POST /confirm flow succeeds for categories and banners", async () => {
    const authHeader = await createAuthHeader("user-media-admin");

    // 1. Presign for category icon
    const presignRes = await app.request("/api/upload/presign", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        filename: "electronics-icon.svg",
        contentType: "image/svg+xml",
        folder: "categories",
        referenceId: "cat-123",
      }),
    });

    expect(presignRes.status).toBe(200);
    const presignJson = (await presignRes.json()) as any;
    expect(presignJson.success).toBe(true);
    expect(presignJson.data.objectKey).toBe("categories/cat-123/icon.svg");
    expect(presignJson.data.uploadUrl).toContain("/api/upload/raw/categories/cat-123/icon.svg");
    expect(presignJson.data.publicUrl).toContain("https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev/categories/cat-123/icon.svg");

    // 2. Direct binary upload via PUT /raw
    const svgBytes = new TextEncoder().encode("<svg><circle r='10'/></svg>");
    const rawRes = await app.request(`/api/upload/raw/${presignJson.data.objectKey}`, {
      method: "PUT",
      headers: {
        "Content-Type": "image/svg+xml",
      },
      body: svgBytes,
    });

    expect(rawRes.status).toBe(200);
    const rawJson = (await rawRes.json()) as any;
    expect(rawJson.success).toBe(true);
    expect(rawJson.data.objectKey).toBe(presignJson.data.objectKey);
    expect(rawJson.data.size).toBe(svgBytes.length);

    // 3. Confirm upload
    const confirmRes = await app.request("/api/upload/confirm", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader,
      },
      body: JSON.stringify({
        objectKey: presignJson.data.objectKey,
        folder: "categories",
        referenceId: "cat-123",
      }),
    });

    expect(confirmRes.status).toBe(200);
    const confirmJson = (await confirmRes.json()) as any;
    expect(confirmJson.success).toBe(true);
    expect(confirmJson.data.objectKey).toBe(presignJson.data.objectKey);
    expect(confirmJson.data.publicUrl).toBe(presignJson.data.publicUrl);
  });

  it("GET /ws route is properly mounted and returns 426 when not upgraded", async () => {
    const res = await app.request("/ws", {
      method: "GET",
    });

    expect(res.status).toBe(426);
    const text = await res.text();
    expect(text).toContain("Expected Upgrade: websocket");
  });
});
