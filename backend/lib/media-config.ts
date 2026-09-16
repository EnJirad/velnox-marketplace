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
