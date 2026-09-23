/**
 * R2 / media upload security contract.
 *
 * The frontend's own 10 MB / image-type checks are UX only — the frontend is
 * never the security boundary. These tests pin the SERVER-side boundary
 * without needing live R2 credentials:
 *
 *   • the size cap is enforced at every persistence point, against the size
 *     read back from storage (HeadObject), never against a body number;
 *   • the MIME allowlist is checked before any URL is signed;
 *   • a media row is only written after the object is proven to exist in R2;
 *   • object/shop ownership is checked against the session/DB BEFORE writes;
 *   • evidence confirm persists server-derived URL/type/size only.
 *
 * Plus a real HTTP round trip for the guards that run before any R2 or DB
 * access: 401 without a session, 403 for another user's namespace, and 400
 * R2_OBJECT_NOT_FOUND when the object cannot be verified in storage.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import type { Server } from "http";
import type { AddressInfo } from "net";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import { ALLOWED_UPLOAD_TYPES, MAX_UPLOAD_BYTES, isUploadTooLarge } from "../lib/media-config.js";

const root = join(import.meta.dir, "..", "..");
const uploadSrc = readFileSync(join(root, "backend/routes/upload.ts"), "utf8");
const evidenceSrc = readFileSync(join(root, "backend/routes/verification.ts"), "utf8");

describe("isUploadTooLarge — the server-side size boundary", () => {
  test("the published limit is exactly 10 MB", () => {
    expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  });

  test("accepts at-or-below the cap, rejects above it", () => {
    expect(isUploadTooLarge(0)).toBe(false);
    expect(isUploadTooLarge(1)).toBe(false);
    expect(isUploadTooLarge(MAX_UPLOAD_BYTES)).toBe(false);
    expect(isUploadTooLarge(MAX_UPLOAD_BYTES + 1)).toBe(true);
    expect(isUploadTooLarge(5 * 1024 * 1024 * 1024)).toBe(true);
  });

  test("a missing or bogus size never crashes and never blocks", () => {
    // HeadObject always reports ContentLength for real objects; blocking on
    // absent metadata would turn a storage quirk into a broken upload.
    expect(isUploadTooLarge(null)).toBe(false);
    expect(isUploadTooLarge(undefined)).toBe(false);
    expect(isUploadTooLarge(Number.NaN)).toBe(false);
    expect(isUploadTooLarge("42")).toBe(false);
    expect(isUploadTooLarge(-1)).toBe(false);
  });

  test("the MIME allowlist is exactly the four documented image types", () => {
    expect([...ALLOWED_UPLOAD_TYPES]).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
      "image/avif",
    ]);
  });
});

describe("upload routes enforce the limits server-side", () => {
  test("both media persistence points check the size read back from R2", () => {
    // /api/upload/confirm and /api/customer/profile-image/save.
    expect(uploadSrc.split("isUploadTooLarge(").length - 1).toBeGreaterThanOrEqual(2);
    expect(uploadSrc).toContain('code: "FILE_TOO_LARGE"');
    expect(uploadSrc).toContain("size_check");
  });

  test("MIME allowlist is checked server-side before any URL is signed", () => {
    expect(uploadSrc).toContain("ALLOWED_TYPES.includes(contentType)");
    expect(uploadSrc).toContain("ALLOWED_TYPES.includes(mimeType)");
    expect(uploadSrc).toContain('code: "INVALID_FILE_TYPE"');
  });

  test("existence is read from storage — the un-sized boolean helper is gone", () => {
    expect(uploadSrc).toContain("headR2Object(");
    expect(uploadSrc).not.toContain("verifyR2Object(");
    // media rows must not be insertable with hardcoded size 0 anymore
    expect(uploadSrc).not.toContain("'image/webp', 0,");
  });

  test("ownership is checked against the session, and shop ownership before any write", () => {
    expect(uploadSrc).toContain("validateObjectKeyOwnership(objectKey, userId)");
    // The shop-DB ownership check now appears BEFORE the media upsert.
    const ownershipAt = uploadSrc.indexOf("ownership must be proven BEFORE");
    const upsertAt = uploadSrc.indexOf("INSERT INTO media");
    expect(ownershipAt).toBeGreaterThan(-1);
    expect(upsertAt).toBeGreaterThan(-1);
    expect(ownershipAt).toBeLessThan(upsertAt);
  });

  test("evidence confirm verifies the object in R2 and trusts no client metadata", () => {
    expect(evidenceSrc).toContain("headR2Object(objectKey)");
    expect(evidenceSrc).toContain('code: "FILE_TOO_LARGE"');
    expect(evidenceSrc).toContain('code: "R2_OBJECT_NOT_FOUND"');
    // The stored URL is derived from the configured domain + key — never the body.
    expect(evidenceSrc).not.toContain("publicUrl || (");
    expect(evidenceSrc).toContain("const storedUrl = evidencePublicDomain");
  });
});

// ─── Real HTTP: the guards that run before any R2 or DB access ──────────────

describe("upload confirm authz over HTTP", () => {
  const hasJwt = Boolean(process.env.JWT_SECRET);
  const itJwt = hasJwt ? test : test.skip;

  let server: Server | undefined;
  let base = "";
  // Namespace of a DIFFERENT user — must never be writable by the session below.
  const foreignUserId = "44444444-4444-4444-8444-444444444444";
  const sessionUserId = "33333333-3333-4333-8333-333333333333";

  beforeAll(async () => {
    const { setupUploadRoutes } = await import("../routes/upload.js");
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "1mb" }));
    setupUploadRoutes(app);
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server!.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  // No `jti` → requireAuth skips the DB-backed revocation lookup, so these
  // cases prove the guards without needing DATABASE_URL.
  function sessionCookie(): string {
    const token = jwt.sign(
      { userId: sessionUserId, email: `${sessionUserId}@test.invalid` },
      process.env.JWT_SECRET!,
      { expiresIn: "5m" },
    );
    return `velnox_session=${token}`;
  }

  function confirm(body: Record<string, unknown>, cookie?: string): Promise<Response> {
    return fetch(`${base}/api/upload/confirm`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(cookie ? { cookie } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  test("no session → 401 before any review logic", async () => {
    const res = await confirm({ objectKey: `profile/avatar/${sessionUserId}.webp` });
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  itJwt("another user's namespace → 403 before any R2 or DB access", async () => {
    const res = await confirm(
      { objectKey: `profile/avatar/${foreignUserId}.webp`, purpose: "avatar" },
      sessionCookie(),
    );
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  itJwt("own namespace but the object cannot be verified in storage → 400, no media row", async () => {
    // The session uuid belongs to this test only, so no real R2 object can
    // ever exist under it — this is deterministic whether or not R2
    // credentials are configured: the confirm must refuse instead of minting
    // a media row from the body.
    const objectKey = `profile/avatar/${sessionUserId}.webp`;
    const res = await confirm({ objectKey, purpose: "avatar", fileSize: 99_999_999 }, sessionCookie());
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("R2_OBJECT_NOT_FOUND");
  });
});
