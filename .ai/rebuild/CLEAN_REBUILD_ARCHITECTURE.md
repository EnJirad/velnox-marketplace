# Velnox Marketplace — Clean Rebuild Architecture
**Version:** 2.0.0  
**Date:** 2026-11-22  
**Status:** AUTHORITATIVE ARCHITECTURAL STANDARD  
**Canonical Reference:** [`docs/architecture/VELNOX_CLEAN_REBUILD_ARCHITECTURE.md`](file:///workspace/quiet-hopper/docs/architecture/VELNOX_CLEAN_REBUILD_ARCHITECTURE.md)

---

## 1. Clean Rebuild Strategy

The project owner has confirmed that there is NO valuable customer data, order history, or financial records that need to be migrated from legacy databases. Therefore, Velnox Marketplace is being rebuilt from the ground up on a clean, modern, Cloudflare-first foundation:

- **Target API:** Cloudflare Workers (TypeScript + Hono) at `api.velnox.live`.
- **Target DB:** Neon PostgreSQL (Clean Schema, Single Source of Truth).
- **Target Storage:** Cloudflare R2 via Native Worker Bindings (`env.R2_BUCKET`).
- **Target Realtime:** Cloudflare Durable Objects (Distributed Stateful WebSockets).
- **Target Background:** Cloudflare Queues (Async tasks, FCM push notifications).
- **Target Frontends:** Cloudflare Pages (4 React SPAs: `velshop`, `velseller`, `velcenter`, `velnox`).

## 2. Legacy Systems Policy

Legacy Express backend (`backend/server.ts`), Render deployment (`velnox-api.onrender.com`), and legacy 62-table schema (`db/schema.sql`) are **REFERENCE ONLY**.
- DO NOT import legacy Express code into Workers.
- DO NOT inherit the legacy schema without redesign.
- DO NOT delete legacy code prematurely; keep Git history intact.
