/**
 * Single source of truth for upload limits.
 *
 * The upload routes enforce these, and VelCenter Settings displays them.
 * Keeping them here (instead of inside routes/upload.ts) means the settings
 * screen reads the REAL enforced values — no duplicated constants that can
 * drift apart.
 */

/** Allowed image MIME types (must match the frontend upload components). */
export const ALLOWED_UPLOAD_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
] as const;

/** Maximum accepted upload size (10 MB). */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

/**
 * Server-side size boundary for a stored object.
 *
 * The frontend enforces the same 10 MB cap for UX, but the frontend is never
 * the security boundary: a presigned PUT accepts whatever the client sends,
 * so the limit is checked here against the size HeadObject reports for the
 * object that ACTUALLY exists in R2 — not against a number from the request
 * body. A missing/unknown size does not block: HeadObject always reports
 * ContentLength for real objects, and blocking on absent metadata would turn
 * a storage quirk into a broken upload.
 */
export function isUploadTooLarge(size: unknown): boolean {
  return typeof size === "number" && Number.isFinite(size) && size > MAX_UPLOAD_BYTES;
}
