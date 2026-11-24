# 2026-11-24: VelCenter Realtime Reconnecting Banner & Media Upload Resolution

## 1. Context & Objectives
User reported two issues occurring in VelCenter (`apps/velcenter`):
1. Realtime indicator stuck on "กำลังเชื่อมต่อเรียลไทม์ใหม่..." (Reconnecting realtime...).
2. Image and file upload failing in VelCenter (categories custom icon, marketing banners, chat, evidence).

## 2. Root Cause Analysis
1. **Realtime WebSocket 404 Route Mismatch:**
   - In `workers/api/src/app.ts`: `app.route("/ws", realtimeRoutes)` with `realtimeRoutes.get("/ws", ...)` caused the route to mount at `/ws/ws` rather than `/ws`.
   - The browser WebSocket client connects to `/ws`, receiving a `404 Route GET /ws not found` response.
   - Cross-domain cookie partitioning could also prevent session cookies from attaching to browser WebSockets.
2. **Media Presign & Direct Upload Endpoints Missing in Workers API:**
   - VelCenter (`CategoriesManagement.tsx`, `MarketingBanners.tsx`) expects `/api/upload/presign`, `/api/upload/confirm`, and a raw PUT upload URL.
   - Workers API only had `/api/v1/media/upload` (multipart) and lacked presign/confirm routes, returning 404.
   - Neon PostgreSQL `media_objects` table had a strict check constraint that excluded `banner`, `category_icon`, and `announcement`.

## 3. Changes Implemented
1. **Realtime WebSocket Fix:**
   - Mounted `app.get("/ws", handleWebSocketRequest)` and `app.get("/api/ws", handleWebSocketRequest)` directly on `app`.
   - Exposed `realtimeRoutes.get("/", handleWebSocketRequest)` and `realtimeRoutes.get("/ws", handleWebSocketRequest)`.
   - Made header check case-insensitive.
   - Updated `packages/shared/src/lib/chat-socket.ts` to include `?token=${token}` from `getStoredAccessToken()`.
   - Updated `apps/velcenter/src/pages/Center.tsx` state check to `(realtimeState === "connecting" || realtimeState === "reconnecting")`.
2. **Media Upload Fix:**
   - Added `generateUploadIntent`, `saveRawUpload`, and `confirmUpload` to `workers/api/src/modules/media/media-service.ts`.
   - Added `POST /presign`, `POST /upload-intent`, `PUT /raw/:key{.+}`, and `POST /confirm` to `workers/api/src/routes/media.ts`.
   - Mounted `/api/upload`, `/upload`, `/api/v1/upload`, `/api/seller/evidence`, `/api/seller/products` in `workers/api/src/app.ts`.
   - Altered Neon DB `media_objects_purpose_check` constraint to support all media purposes.
   - Synchronized `db/schema.sql` and `db/run-sqleditor.sql` with `media_objects` and `media` tables.
   - Added unit and flow tests in `workers/api/tests/media.test.ts`.

## 4. Verification Results
- `bun --filter @velnox/api test`: 103/103 PASS
- `bun run typecheck:all`: 0 errors
- `bun run build:velcenter`: PASS
- `bun run worker:build`: PASS
- `git diff --check`: clean
