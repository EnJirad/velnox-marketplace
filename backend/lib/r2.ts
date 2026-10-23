/**
 * Cloudflare R2 storage helpers — presigned PUT + object inspection.
 *
 * The browser uploads straight to R2 with a short-lived signed URL; the API
 * never proxies a file. Two rules keep that safe:
 *
 *   • the key is minted HERE, from the caller's server-derived user id — a
 *     client can never choose (or overwrite) another user's object;
 *   • the confirm step reads existence, size and content type BACK from
 *     storage, so a client cannot create a media row for an object that does
 *     not exist or claim a size the object does not have.
 */
import { HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Image types a profile upload may declare. */
export const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

/** Hard ceiling for an avatar (the `media.size` CHECK allows up to 10 MB). */
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;

/** Signed PUT lifetime. Long enough for a mobile upload, short enough to leak badly. */
export const PRESIGN_TTL_SECONDS = 300;

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicDomain: string;
}

export function readR2Config(): R2Config {
  return {
    accountId: (process.env.R2_ACCOUNT_ID ?? "").trim(),
    accessKeyId: (process.env.R2_ACCESS_KEY_ID ?? "").trim(),
    secretAccessKey: (process.env.R2_SECRET_ACCESS_KEY ?? "").trim(),
    bucket: (process.env.R2_BUCKET ?? "").trim(),
    publicDomain: (process.env.R2_PUBLIC_DOMAIN ?? "").trim().replace(/\/+$/, ""),
  };
}

/** True when every value a presigned PUT needs is present. */
export function isR2Configured(config: R2Config = readR2Config()): boolean {
  return Boolean(
    config.accountId && config.accessKeyId && config.secretAccessKey && config.bucket,
  );
}

function client(config: R2Config): S3Client {
  return new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
}

/** Public URL for a stored key. Empty when R2_PUBLIC_DOMAIN is not configured. */
export function publicUrlFor(objectKey: string, config: R2Config = readR2Config()): string {
  return config.publicDomain ? `${config.publicDomain}/${objectKey}` : "";
}

export interface PresignedPut {
  uploadUrl: string;
  objectKey: string;
  publicUrl: string;
  expiresIn: number;
}

/**
 * Sign a PUT for one object. `contentType` becomes part of the signature, so
 * the browser must send the same header it declared.
 */
export async function presignImagePut(args: {
  objectKey: string;
  contentType: string;
  config?: R2Config;
}): Promise<PresignedPut> {
  const config = args.config ?? readR2Config();
  if (!isR2Configured(config)) {
    throw new Error("R2_NOT_CONFIGURED");
  }
  const uploadUrl = await getSignedUrl(
    client(config),
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: args.objectKey,
      ContentType: args.contentType,
    }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
  return {
    uploadUrl,
    objectKey: args.objectKey,
    publicUrl: publicUrlFor(args.objectKey, config),
    expiresIn: PRESIGN_TTL_SECONDS,
  };
}

export interface StoredObject {
  found: boolean;
  size: number | null;
  contentType: string | null;
}

/**
 * Read an object's real metadata. Any failure (missing key, unreachable
 * bucket, missing credentials) reports `found: false` — callers must then
 * refuse to persist, which is the fail-safe direction: no object, no media row.
 */
export async function inspectObject(
  objectKey: string,
  config: R2Config = readR2Config(),
): Promise<StoredObject> {
  if (!isR2Configured(config)) return { found: false, size: null, contentType: null };
  try {
    const head = await client(config).send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    );
    return {
      found: true,
      size: typeof head.ContentLength === "number" ? head.ContentLength : null,
      contentType: head.ContentType ?? null,
    };
  } catch {
    return { found: false, size: null, contentType: null };
  }
}
