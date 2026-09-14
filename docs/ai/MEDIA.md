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

## Verification

Test presign → PUT → confirm → Neon `media` row + reference update; check `GET /api/health/r2`, CORS, and prod `R2_PUBLIC_DOMAIN`.

Related: `docs/STORAGE.md`, `docs/ai/DATABASE.md`.
