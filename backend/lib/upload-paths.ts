/**
 * Path safety for seller draft uploads.
 *
 * `POST /api/seller/products/draft-upload-intent` interpolates a client-supplied
 * draft id and subfolder into an R2 object key. Without validation a seller could
 * send `../../<other namespace>` and mint a presigned PUT for a key outside their
 * own `draft-uploads/{sellerId}/…` prefix.
 */

/** One path segment: letters, digits, dash, underscore. No dots, no slashes. */
const SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;

/** Subfolders currently produced by the seller UI: preview | details | options/… */
const MAX_SUBFOLDER_DEPTH = 3;

export const DEFAULT_SUBFOLDER = "preview";

export function isSafePathSegment(value: string): boolean {
  return SEGMENT.test(value) && value !== "." && value !== "..";
}

/** A single safe segment, otherwise `fallback`. */
export function sanitiseSegment(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return isSafePathSegment(trimmed) ? trimmed : fallback;
}

/**
 * Up to three safe segments joined by `/`, otherwise the default subfolder.
 * Rejects `..`, absolute paths, empty segments and anything with characters
 * outside the seller UI's vocabulary.
 */
export function sanitiseSubfolder(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_SUBFOLDER;
  const segments = value.trim().split("/").filter(Boolean);
  if (segments.length === 0 || segments.length > MAX_SUBFOLDER_DEPTH) return DEFAULT_SUBFOLDER;
  if (!segments.every(isSafePathSegment)) return DEFAULT_SUBFOLDER;
  return segments.join("/");
}
