# 2026-11-02 — Full ecosystem regression audit

| # | Field | Value |
|---|---|---|
| 1 | Date + time (timezone) | 2026-11-02 12:40–13:25 +07 (05:40–06:25Z) |
| 2 | AI / agent | AndroidHarness (Coding agent) |
| 3 | Git branch | `main` |
| 4 | Commit SHA before | `68dcc64d582cb2dbc2cab9f2ab7f218ec602ea68` |
| 5 | Commit SHA after | docs-only audit commit (handoff §151) |
| 6 | Purpose | Regression audit of all four web apps + backend after the §141–§150 UI work |
| 7 | Inspected | `AI_HANDOFF` §145–§150, `AI_RULES`, route tables (`apps/*/src/main.tsx`), `db/schema.sql`, `db/verify-reconciler.sh`, backend tests, live production endpoints |
| 8 | Files touched | docs only (`.ai/AI_HANDOFF.md`, this record) — **no application code changed** |
| 9 | Added | nothing |
| 10 | Removed | nothing |
| 11 | What changed | nothing functional; audit + evidence recorded |
| 12 | Why | Owner requested a full-system pass |
| 13 | Systems affected | none |
| 14 | Confirmed unaffected | working tree clean before and after; `git diff --stat` empty |
| 15 | Checks run | `git fetch/status/log` · `bun run typecheck` · `bun run build:{velshop,velseller,velcenter,velnox}` · `bunx tsc -p backend` · `i18n-check` · `bun test backend/tests` · production `curl` ×5 · authenticated API matrix via three cookie proxies · VelShop/VelCenter DOM probes at 492 px · announcement CRUD lifecycle |
| 16 | Results | typecheck **4/4 PASS** · builds **4/4 PASS** (8.6/6.4/6.3/4.7 s) · backend tsc **PASS** · i18n **1339 ×3 PASS** · tests **1139 pass / 382 skip / 8 FAIL** (all `test-database-isolation` subprocess probes) · production shop/seller/center/`velnox.vercel.app`/API-health **200**, `velnox.com` **000 (DNS)** · announcement create→order→edit→hide→delete **PASS** · drawer re-measured **PASS** · dropdown (mid trigger) opens upward, inside viewport, `max-height 320px` **PASS** · authz: seller→admin **403**, anonymous→API **401**, seller→seller **200** |
| 17 | Problems found | no new application defects. `db/verify-reconciler.sh` cannot run here (no Postgres; `/tmp` not writable) → **BLOCKED**, not a schema verdict. `velnox.com` does not resolve from this device although `velnox.vercel.app` is 200 |
| 18 | Limitations | **No screenshots** (harness preview surface hidden, §137). Only 492 px could be rendered — 360/390/430/768/1024/1280/1440 **NOT VERIFIED**. Seller shop/orders and all corporate pages failed to finish rendering (document destroyed by the injected script). Checkout, Stripe/PromptPay, chat realtime and R2 confirm were **not executed** (they mutate production). Only presign was verified |
| 19 | Work still open | Real viewport sweep once the preview surface works; checkout/payment E2E in a disposable environment; announcement image PUT/confirm; `velnox.com` DNS |
| 20 | Next agent must know | The owner account `884291e5…` is an **owner/admin** (its customer cookie legitimately returns 200 on `/api/admin/*`); use the seller account `2c29bef6…` for role-denial tests. Audited state: HEAD `68dcc64`, clean. Re-run the same commands; the eight DB-guard failures are environment-only |

## Detailed evidence

**VelShop (492 px, dev + customer cookie → production API)**

| Page | Result |
|---|---|
| `/` | carousel 3 fallback slides (no announcements published), 3 dots, header pill 1, 5 tabs, category link, product cards, `overflow 0` |
| `/products` | header pill **0**, page search + price inputs, shop/sort selects, `ตัวกรอง`, active tab `/products`, `overflow 0` |
| `/products/:id` | no header pill, real price `฿`, cart action present, `overflow 0` |
| `/cart` | authenticated empty state, no header pill, `overflow 0` |

**VelCenter (492 px, center cookie)**

| Check | Result |
|---|---|
| authenticated dashboard | loads with real totals (฿419.3) |
| drawer | `top 64` under a 65 px header, `#center-nav` 458 px, first tab 119, last 531, close button, `overflow 0` |
| dropdown (Audit filter, trigger at 451 px) | opens `side=top`, rect 147–451, `max-height 320px`, `align=start`, inside viewport |
| settings | announcement card + empty state render |

**Announcement lifecycle:** two items created → public order `[A, B]`; edit + reorder → `[B, A (แก้ไข)]`;
hide A → public `[B]` while admin still sees both; delete all → `[]`.

**VelSeller (492 px, seller cookie):** `/seller/goals` renders real seller data (“สวัสดี, Harumii”), `overflow 0`.

**Backend authz:** seller token → `/api/admin/settings|announcements|dashboard` = **403**; anonymous → `/api/admin/settings`, `/api/customer/cart` = **401**; seller → `/api/seller/status` = **200**.

**VelRepeat:** no runtime remnants — only two explanatory comments in `db/run-sqleditor.sql`.
