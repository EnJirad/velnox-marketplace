# 2026-11-02 — Deployment recovery + real R2 announcement image verification

| # | Field | Value |
|---|---|---|
| 1 | Date + time (timezone) | 2026-11-02 13:00–14:05 +07 (06:00–07:05Z) |
| 2 | AI / agent | AndroidHarness (Coding agent) |
| 3 | Git branch | `main` |
| 4 | Commit SHA before | `804d2c6745f1c48b0fc9f14cf1360ea81ee13d0f` (actual remote state; the brief’s `68dcc64` was already superseded) |
| 5 | Commit SHA after | the fix commit and the follow-up docs commit; `git log -1` is authoritative |
| 6 | Purpose | Close the open items from the ecosystem audit: confirm Vercel deployment reality, test the real R2 announcement image lifecycle end to end, re-check the UI |
| 7 | Inspected | Vercel API for all four projects (deployments, states, commits), `backend/routes/upload.ts`, `backend/routes/announcements.ts`, `AnnouncementCarousel.tsx`, production endpoints |
| 8 | Files touched | `apps/velshop/src/components/shop/AnnouncementCarousel.tsx` (1 line) + docs |
| 9 | Added | `loading={i === index ? "eager" : "lazy"}` so the visible slide’s image is fetched immediately |
| 10 | Removed | the blanket `loading="lazy"` on announcement artwork |
| 11 | What changed | only the active carousel slide’s hero image is eager; other slides stay lazy |
| 12 | Why | with `loading="lazy"` the visible slide never requested its image in the harness (and is poor practice for above-the-fold art) |
| 13 | Systems affected | VelShop announcement carousel image loading |
| 14 | Confirmed unaffected | typecheck 4/4, velshop build, i18n 1339×3, `diff --check` all pass; diff is one line |
| 15 | Checks run | Vercel `list_projects`/`list_deployments` (4 projects) · presign→PUT→confirm→public GET via authenticated proxy · invalid type, missing object, foreign-owner, seller-permission cases · announcement save/publish/delete · VelShop DOM probe · `bun run typecheck` · `bun run build:velshop` · `i18n-check` · `git diff --check` |
| 16 | Results | deployments **READY** (details below) · R2 flow **PASS** end to end incl. image rendering after the fix · failure cases **400/400/403/403** as designed · cleanup **PASS** for the announcement, **object remains** (no delete API) |
| 17 | Problems found | (a) `loading="lazy"` blocked the hero image; (b) no API to delete an uploaded object, so a 70-byte probe object stays public; (c) iframes are blocked in this WebView, so no non-492 px viewport can be rendered; (d) chrome-devtools MCP still cannot install on android/arm64 |
| 18 | Limitations | Responsive matrix beyond 492 px **NOT VERIFIED**; no screenshots (§137); checkout/Stripe/chat not exercised |
| 19 | Work still open | Delete the probe object `announcements/884291e5…/<uuid>.webp` from R2 when a delete path exists; real viewport sweep; payment E2E in a disposable env |
| 20 | Next agent must know | Deployment “failures with build-rate-limit” could not be reproduced — all four projects have READY production deployments; velseller simply has no build newer than `dc90ba9` because the app did not change afterwards. The two test announcements were removed; `shop_announcements` is `[]` |

## Vercel evidence (no state other than READY in the queried window)

| Project | Latest production deployment | Commit | State |
|---|---|---|---|
| velshop | `dpl_41Wkvbfv…` | `804d2c6` | READY |
| velcenter | `dpl_9kvTU6kV…` | `804d2c6` | READY |
| velnox (corporate) | `dpl_FaFuLNU3…` | `804d2c6` | READY |
| velseller | `dpl_5zVewDuC…` | `dc90ba9` | READY (no newer build; app unchanged since) |

Production URLs all answer 200 (shop / seller / center / `velnox.vercel.app` / `/api/health`); `velnox.com`
does not resolve from this device (DNS).

## R2 announcement image — every stage

| Stage | Result |
|---|---|
| invalid file type (`image/gif`) | **400 INVALID_FILE_TYPE** |
| presign (`image/png`, purpose `announcement`) | **200**, key under `announcements/{ownerId}/…` |
| PUT 70-byte PNG to R2 | **200** |
| confirm | **200** + public URL |
| public GET of the URL | **200** |
| announcement saved with `imageUrl` | **200**, public API returned it |
| VelShop carousel | `<img>` present, correct R2 host — but `naturalWidth 0` with `loading="lazy"` |
| after the eager fix | `loading: "eager"`, `complete: true`, `natural 1×1` — image really rendered |
| confirm missing object | **400** |
| confirm key owned by another user | **403** |
| seller presign for `announcement` | **403 `settings.manage permission required`** (checked against the API directly; the local proxy returned 404 for that one call) |
| announcement without image | renders text-only slide (fallback slides observed earlier) |
| update / hide / reorder / delete | **PASS** (verified in the same run and in §151) |
| cleanup | announcements `[]`; **uploaded probe object still public** — no delete endpoint exists |

## Responsive

Only **492 px** renderable. `mcp__chrome_devtools__*` fails (“Cannot download a binary for the provided
platform: android (arm64)”) and iframes get no document even same-origin, so 360 / 390 / 430 / 768 / 1024 /
1280 / 1440 remain **NOT VERIFIED**.
