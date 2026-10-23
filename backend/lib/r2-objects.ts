/**
 * Shared server-side R2 object inspection.
 *
 * Both persistence points that write `media` rows — `POST /api/upload/confirm`
 * (plus `/api/customer/profile-image/save`) and `POST /api/seller/evidence/confirm`
 * — must read existence, size and content type BACK from storage instead of
 * trusting the request body. A confirm that never talks to R2 lets a client
 * create media rows for objects that do not exist, with any size it claims.
 *
 * The HeadObject result is the authority for `isUploadTooLarge` (see
 * `lib/media-config.ts`): the presigned PUT carries no size condition, so the
 * only server-enforceable size boundary is the stored object itself.
 */
import { S3Client, HeadObjectCommand } from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID || "";
const accessKeyId = process.env.R2_ACCESS_KEY_ID || "";
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || "";

export const R2_BUCKET = process.env.R2_BUCKET || "";
export const R2_PUBLIC_DOMAIN = (process.env.R2_PUBLIC_DOMAIN || "").replace(/\/+$/, "");

const R2 = new S3Client({
  region: "auto",
  endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId, secretAccessKey },
});

export interface R2ObjectMeta {
  found: boolean;
  /** Actual stored size in bytes, or null when storage did not report one. */
  size: number | null;
  /** Content type as stored (what the presigned PUT declared), or null. */
  contentType: string | null;
}

/**
 * Head an object. Any failure (missing key, unreachable bucket, missing
 * credentials) reports `found: false` — callers must then refuse to persist,
 * which is exactly the fail-safe direction: no object, no media row.
 */
export async function headR2Object(key: string): Promise<R2ObjectMeta> {
  try {
    const res = await R2.send(new HeadObjectCommand({ Bucket: R2_BUCKET, Key: key }));
    return {
      found: true,
      size: typeof res.ContentLength === "number" ? res.ContentLength : null,
      contentType: res.ContentType ?? null,
    };
  } catch {
    return { found: false, size: null, contentType: null };
  }
}
