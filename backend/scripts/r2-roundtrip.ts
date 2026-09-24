/**
 * R2 round-trip verification — exercises the real media pipeline end to end.
 *
 * WHY THIS EXISTS
 * ---------------
 * `docs/ai/MEDIA.md` documents the media contract as
 * "presign → PUT to R2 → confirm → persist `media` record → update reference",
 * and its Verification section asks for exactly this: a presign → PUT → confirm
 * round-trip, plus `GET /api/health/r2`, CORS, and the production
 * `R2_PUBLIC_DOMAIN`.
 *
 * `GET /api/health/r2` only proves `ListObjectsV2` succeeds. It does NOT prove
 * that a presigned PUT is accepted, that the object becomes publicly readable on
 * `R2_PUBLIC_DOMAIN`, or that the bucket's CORS policy lets a browser upload
 * from the Vercel origins — the three things that actually break image upload.
 *
 * USAGE
 * -----
 *   cd backend && bun run r2:roundtrip              # verify
 *   cd backend && bun run r2:roundtrip --fix-cors   # verify + repair the bucket CORS origins
 *   cd backend && bun run r2:roundtrip --cors-json  # dump the raw CORS policy
 *
 * WHAT IT DOES
 * ------------
 * 1. Mirrors `createR2Client()` and the presign command from
 *    `backend/routes/upload.ts` exactly (`PutObjectCommand` + `getSignedUrl`,
 *    300s expiry).
 * 2. PUTs ~60 bytes to a temporary `healthcheck/roundtrip-<uuid>.webp` key.
 *    This is the only write; the object is deleted again before the script
 *    exits, on both the success and the failure path.
 * 3. Verifies the object with `HeadObjectCommand` — the same call
 *    `verifyR2Object()` makes during `/api/upload/confirm`.
 * 4. Fetches it back over the public domain, with and without the `?v=`
 *    cache-bust that `optimizedUrl()` appends.
 * 5. Reads the bucket CORS policy and checks every deployment origin is
 *    allowed. `--fix-cors` adds any that are missing — additively, keeping the
 *    existing methods and headers, so an origin that works today cannot break.
 * 6. Deletes the temporary object and confirms it is gone.
 *
 * Never prints a credential. The public domain is not a secret — it is already
 * embedded in every served image URL.
 */

import {
  DeleteObjectCommand,
  GetBucketCorsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  PutBucketCorsCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import type { CORSRule } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "node:crypto";

// ─── Config (mirrors getR2Config() in routes/upload.ts) ─────────────────────

const cfg = {
  accountId: process.env.R2_ACCOUNT_ID ?? "",
  accessKeyId: process.env.R2_ACCESS_KEY_ID ?? "",
  secretAccessKey: process.env.R2_SECRET_ACCESS_KEY ?? "",
  bucket: process.env.R2_BUCKET ?? "",
  publicDomain: (process.env.R2_PUBLIC_DOMAIN ?? "").replace(/\/+$/, ""),
};

/** 1×1 transparent WebP — a real image, so the stored bytes are plausible. */
const TINY_WEBP = Uint8Array.from(
  atob("UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEAAUAmJaQAA3AA/vuUAAA="),
  (c) => c.charCodeAt(0),
);

/**
 * The frontends' live origins. Every one of these was confirmed by HTTP 200 and
 * the Velnox page title; the same four are listed in `README.md`,
 * `docs/DEPLOYMENT.md` and `INSTALLATION.md`.
 */
const PRODUCTION_ORIGINS = [
  "https://velshop.vercel.app",
  "https://velseller.vercel.app",
  "https://velcenter.vercel.app",
  "https://velnox.vercel.app",
];

/** Same dev origins the API's own CORS allowlist merges in (`backend/server.ts`). */
const DEV_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:5175",
  "http://localhost:5176",
];

const REQUIRED_ORIGINS = [...PRODUCTION_ORIGINS, ...DEV_ORIGINS];

const fixCors = process.argv.includes("--fix-cors");
const dumpCors = process.argv.includes("--cors-json");

const results: { check: string; ok: boolean; detail: string }[] = [];
function record(check: string, ok: boolean, detail: string): void {
  results.push({ check, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${check.padEnd(34)} ${detail}`);
}

function heading(title: string): void {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

// ─── Preconditions ──────────────────────────────────────────────────────────

const missing = [
  ["R2_ACCOUNT_ID", cfg.accountId],
  ["R2_ACCESS_KEY_ID", cfg.accessKeyId],
  ["R2_SECRET_ACCESS_KEY", cfg.secretAccessKey],
  ["R2_BUCKET", cfg.bucket],
  ["R2_PUBLIC_DOMAIN", cfg.publicDomain],
]
  .filter(([, value]) => !value)
  .map(([name]) => name);

if (missing.length > 0) {
  console.error(`Not configured — missing: ${missing.join(", ")}`);
  process.exit(1);
}

const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
  credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
});

const key = `healthcheck/roundtrip-${randomUUID()}.webp`;
const contentType = "image/webp";

console.log("Velnox R2 round-trip verification");
console.log(`Bucket        : ${cfg.bucket}`);
console.log(`Public domain : ${cfg.publicDomain}`);
console.log(`Temp key      : ${key}`);

let uploaded = false;

async function cleanup(): Promise<void> {
  if (!uploaded) return;
  try {
    await r2.send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
    console.log(`\nCleaned up ${key}`);
  } catch (err) {
    console.error(`\nFAILED to clean up ${key}: ${String(err)}`);
  }
}

// ─── 1. Credentials + bucket (same call as GET /api/health/r2) ──────────────

heading("1. Credentials and bucket");
try {
  await r2.send(new ListObjectsV2Command({ Bucket: cfg.bucket, MaxKeys: 1 }));
  record("ListObjectsV2 (creds + bucket)", true, "authorized");
} catch (err) {
  record("ListObjectsV2 (creds + bucket)", false, String(err));
}

// ─── 2. Presign exactly like POST /api/upload/presign ───────────────────────

heading("2. Presign");
let uploadUrl = "";
try {
  uploadUrl = await getSignedUrl(
    r2,
    new PutObjectCommand({ Bucket: cfg.bucket, Key: key, ContentType: contentType }),
    { expiresIn: 300 },
  );
  record("getSignedUrl (PutObject)", true, `expiresIn=300s`);
} catch (err) {
  record("getSignedUrl (PutObject)", false, String(err));
}

// ─── 3. PUT the signed URL (what the browser does) ──────────────────────────

heading("3. Upload via presigned URL");
if (uploadUrl) {
  try {
    const res = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": contentType },
      body: TINY_WEBP,
    });
    uploaded = res.ok;
    record("PUT presigned URL", res.ok, `HTTP ${res.status} (${TINY_WEBP.byteLength} bytes)`);
    if (!res.ok) console.error(`       body: ${(await res.text()).slice(0, 400)}`);
  } catch (err) {
    record("PUT presigned URL", false, String(err));
  }
} else {
  record("PUT presigned URL", false, "skipped — no presigned URL");
}

// ─── 4. HeadObject (what /api/upload/confirm calls) ────────────────────────

heading("4. Verify object (confirm step)");
try {
  const head = await r2.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
  record("HeadObject", true, `Content-Type=${head.ContentType ?? "?"} size=${head.ContentLength ?? "?"}`);
} catch (err) {
  record("HeadObject", false, String(err));
}

// ─── 5. Public read (what every browser does) ──────────────────────────────

heading("5. Public read on R2_PUBLIC_DOMAIN");
for (const [label, suffix] of [
  ["clean URL", ""],
  ["cache-busted ?v=", "?v=1789341304619"],
] as const) {
  try {
    const res = await fetch(`${cfg.publicDomain}/${key}${suffix}`);
    const body = new Uint8Array(await res.arrayBuffer());
    const same = body.byteLength === TINY_WEBP.byteLength;
    record(`GET ${label}`, res.ok && same, `HTTP ${res.status}, ${body.byteLength} bytes`);
  } catch (err) {
    record(`GET ${label}`, false, String(err));
  }
}

// An asset that is already live in production, to prove the domain serves real media.
try {
  const res = await fetch(
    "https://pub-01da4cea98c140f98d0c20ec14acb608.r2.dev/shop/5d56f6f8-2e1f-4da1-94e9-03574e66d713/logo.webp",
    { method: "HEAD" },
  );
  record("GET existing production asset", res.ok, `HTTP ${res.status}`);
} catch (err) {
  record("GET existing production asset", false, String(err));
}

// ─── 6. Bucket CORS (browser PUTs need it) ─────────────────────────────────

heading("6. Bucket CORS policy");
try {
  const cors = await r2.send(new GetBucketCorsCommand({ Bucket: cfg.bucket }));
  const rules = cors.CORSRules ?? [];
  if (dumpCors) console.log(JSON.stringify(rules, null, 2));

  const allowed = new Set<string>();
  let allowsPut = false;
  for (const rule of rules) {
    for (const origin of rule.AllowedOrigins ?? []) allowed.add(origin);
    if ((rule.AllowedMethods ?? []).some((m) => m.toUpperCase() === "PUT")) allowsPut = true;
  }
  const wildcard = allowed.has("*");
  const missingOrigins = REQUIRED_ORIGINS.filter((o) => !wildcard && !allowed.has(o));
  const undocumented = [...allowed].filter((o) => o !== "*" && !REQUIRED_ORIGINS.includes(o));

  record(
    "CORS rules present",
    rules.length > 0,
    `${rules.length} rule(s): ${[...allowed].join(", ") || "none"}`,
  );
  record("CORS allows PUT", allowsPut, allowsPut ? "yes" : "no PUT method allowed");
  if (undocumented.length > 0) {
    console.log(`  note  origins outside the documented set (kept): ${undocumented.join(", ")}`);
  }

  if (missingOrigins.length > 0 && !wildcard && !fixCors) {
    record("CORS covers frontend origins", false, `missing: ${missingOrigins.join(", ")}`);
    console.log("        Re-run with --fix-cors to add them (additively).");
  } else if (missingOrigins.length > 0 && !wildcard) {
    // Additive only: keep every existing origin, method, header and exposure
    // exactly as-is so nothing that works today can regress. Only the missing
    // documented origins are appended.
    const base: CORSRule = rules.at(0) ?? { AllowedMethods: ["GET", "PUT", "HEAD"], AllowedOrigins: [] };
    const methods: string[] = base.AllowedMethods ?? ["GET", "PUT", "HEAD"];
    const fixed: CORSRule = {
      AllowedOrigins: [...new Set([...(base.AllowedOrigins ?? []), ...REQUIRED_ORIGINS])],
      AllowedMethods: methods,
      AllowedHeaders: base.AllowedHeaders ?? ["*"],
      ExposeHeaders: base.ExposeHeaders ?? ["ETag"],
      MaxAgeSeconds: base.MaxAgeSeconds ?? 3600,
    };
    await r2.send(
      new PutBucketCorsCommand({
        Bucket: cfg.bucket,
        CORSConfiguration: { CORSRules: [fixed, ...rules.slice(1)] },
      }),
    );
    record("PutBucketCors", true, `added ${missingOrigins.length} origin(s) — kept ${methods.join("/")}`);

    const after = await r2.send(new GetBucketCorsCommand({ Bucket: cfg.bucket }));
    const now = new Set((after.CORSRules ?? []).flatMap((r) => r.AllowedOrigins ?? []));
    const allowedNow = REQUIRED_ORIGINS.filter((o) => now.has(o));
    record(
      "CORS covers frontend origins",
      allowedNow.length === REQUIRED_ORIGINS.length,
      `repaired — ${allowedNow.length}/${REQUIRED_ORIGINS.length} origins allowed`,
    );
  } else {
    record(
      "CORS covers frontend origins",
      true,
      wildcard ? "wildcard" : `all ${REQUIRED_ORIGINS.length} origins allowed`,
    );
  }
} catch (err) {
  record("GetBucketCors", false, `${String(err).slice(0, 160)}`);
}

// ─── 7. Cleanup ────────────────────────────────────────────────────────────

heading("7. Cleanup");
await cleanup();
try {
  await r2.send(new HeadObjectCommand({ Bucket: cfg.bucket, Key: key }));
  record("Temp object removed", false, "object still present");
} catch {
  record("Temp object removed", true, "gone");
}

// ─── Summary ───────────────────────────────────────────────────────────────

const failed = results.filter((r) => !r.ok);
heading("Summary");
console.log(`  ${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  for (const f of failed) console.log(`  FAILED  ${f.check}: ${f.detail}`);
  process.exit(1);
}
console.log("  result: PASS — presign → PUT → verify → public read all work");
