# MEDIA — Cloudflare R2

## Purpose

Binary storage for avatars, covers, product images, shop media, and evidence. Neon holds metadata.

## Source Locations

- `backend/routes/upload.ts` — `POST /api/upload/presign`, `POST /api/upload/confirm`, `POST /api/customer/profile-image/upload-intent|save`, `GET /api/health/r2`
- `backend/routes/seller.ts`, `backend/routes/verification.ts` — shop/evidence presign with ownership checks
- `packages/shared/src/components/seller/*` — `ImageUploader.tsx`, `EvidenceUploader.tsx`
- `packages/shared/src/lib/image-optimize.ts` — `optimizedUrl()`
- DB: `media` table

## Data Flow

```
Frontend → POST /api/upload/presign (validated purpose) → presigned PUT URL (short TTL)
→ PUT to R2 (frontend converts to WebP) → POST /api/upload/confirm
→ backend verifies R2 object + creates media record + updates reference
```

Fixed keys: `profile/avatar/{userId}.webp`, `profile/cover/{userId}.webp`, `shop/{shopId}/logo.webp`, `shop/{shopId}/cover.webp`. R2 PUT overwrites same key. Frontend displays with `?v={timestamp}` cache-bust via `optimizedUrl()`.

## Important Rules

- R2 secrets (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`) are backend-only; never in `VITE_*`.
- Validate `Content-Type` (jpeg/png/webp/avif) and size (≤10 MB) before presign; presigned URLs are time-limited.
- Never delete old R2 object before new one is confirmed. Clean up legacy timestamped keys on first fixed-key upload.
- Do not reintroduce Cloudinary; do not treat R2 URL as commerce truth.
- **Bucket CORS must allow every frontend origin.** The browser PUTs straight to
  `https://<accountId>.r2.cloudflarestorage.com`, so the bucket's own CORS policy
  (not the API's `CORS_ORIGINS`) decides whether an upload is permitted. It must
  contain the four production origins
  (`https://velshop|velseller|velcenter|velnox.vercel.app`) plus the dev origins
  `http://localhost:5173..5176` — the same set `backend/server.ts` merges. A
  missing origin makes the preflight fail and looks exactly like "upload is
  broken". Note `velnox.vercel.app` is the real corporate origin;
  `velnox-group.vercel.app` returns 404 and is not a Velnox deployment.

## Verification

`GET /api/health/r2` only proves `ListObjectsV2` succeeds — it does not prove a
presigned PUT is accepted, that the object is publicly readable, or that the
bucket CORS policy permits a browser upload. Use the round-trip tool:

```bash
cd backend && bun run r2:roundtrip              # presign → PUT → verify → public read → CORS
cd backend && bun run r2:roundtrip --fix-cors   # also add any missing CORS origins
cd backend && bun run r2:roundtrip --cors-json  # dump the raw bucket CORS policy
```

`backend/scripts/r2-roundtrip.ts` mirrors `createR2Client()` and the presign
command from `backend/routes/upload.ts` exactly, PUTs ~44 bytes to a temporary
`healthcheck/roundtrip-<uuid>.webp` key, verifies it with the same `HeadObject`
call `/api/upload/confirm` makes, fetches it back over `R2_PUBLIC_DOMAIN` (with
and without the `?v=` cache-bust `optimizedUrl()` appends), checks the bucket
CORS policy against the documented origins, then deletes the temporary object.
It never prints a credential. `--fix-cors` is additive: it appends only the
missing documented origins and keeps the existing methods and headers.

The Neon side — `media` row, `users.avatar` / shop `logo` / `cover` reference —
still needs an authenticated request against the deployed API (it requires a
session cookie, so it cannot be scripted from CI).

Related: `docs/STORAGE.md`, `docs/ai/DATABASE.md`, `backend/server.ts` (API CORS).
