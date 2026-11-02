# 2026-11-02 — Velseller: product editor image lifecycle fix

| # | Field | Value |
|---|---|---|
| 1 | Date + time (timezone) | 2026-11-02 17:20–18:10 +07 (10:20–11:10Z) |
| 2 | AI / agent | AndroidHarness (Coding agent) |
| 3 | Git branch | `main` |
| 4 | Commit SHA before | `1c39a203d9bc7342a84e74e001a463e78b8ccd1a` on the remote; local HEAD was `b11779f` (ahead 1, unpushed) |
| 5 | Commit SHA after | local commit created by this pass (**not pushed**) |
| 6 | Purpose | Fix the product editor losing existing images and being unable to show/persist newly added ones |
| 7 | Inspected | `MyShop.tsx` list/edit wiring, `ProductFormDialog` state and save paths, `GET /api/seller/products`, `formatProduct`, `POST /api/seller/products/save-image`, `DELETE /api/seller/products/images/:imageId`, `/api/products/:id` |
| 8 | Files touched | `packages/shared/src/components/seller/ProductFormDialog.tsx` + docs |
| 9 | Root cause (evidence) | `galleryImages`/`detailImages` started empty and were never seeded from `product.images`; edit rendered `current.images` while uploads appended to the local arrays, so a new image was invisible and never persisted (edit save looped only `detailImages`); existing images had no remove control and `DraftImage` carried no database id |
| 10 | Added | seeding from `product.images` (gallery + detail), `id` on `DraftImage`, delete-on-remove via the existing ownership-checked endpoint, persistence of new images with their real `imageType`, product re-fetch after save, eager thumbnail loading, 24 px remove buttons |
| 11 | Removed | the `isEdit` branches that rendered `current.images`/`current.detailImages` and hid the remove buttons |
| 12 | What changed | one state source for both modes: seeded from the server, removable, extendable, saved back through the existing endpoints |
| 13 | Systems affected | Velseller product editor only (`ProductFormDialog` is imported only by `MyShop`) |
| 14 | Confirmed unaffected | no API contract, schema, auth, ownership, R2 flow or other app changed; product PATCH payload untouched; create flow still uses the same arrays |
| 15 | Checks run | `bun run typecheck` · `bun run build:velseller` · `i18n-check` · `bun test backend/tests` · `git diff --check` · live seller session at 492 px (shop → edit dialog) + direct API inspection |
| 16 | Results | edit dialog shows **4/4** existing images loaded (`naturalWidth 1280`, `complete: true`, R2 host), counter `4 / 10`; typecheck 4/4 **PASS**; build **PASS** (6.75 s); i18n **1346×3**; backend suite 1139/382/8 (env); `diff --check` clean |
| 17 | Problems found | API itself is correct (4 gallery rows with ids + https URLs) — the defect was frontend-only; product images load from the R2 host with a browser UA (python-urllib gets a Cloudflare 1010 client-signature block, not a broken object) |
| 18 | Limitations | add/remove/save against the live shop **NOT executed** (would mutate production data); those paths are code-verified only. Viewports other than 492 px **NOT VERIFIED**; no screenshots (§137) |
| 19 | Work still open | exercise add/remove/save on a disposable seller account; viewport sweep |
| 20 | Next agent must know | the editor's image arrays are the single source of truth in both modes and start from the server product; any future image UI must go through `galleryImages`/`detailImages` and use `/api/seller/products/save-image` + `DELETE /api/seller/products/images/:id` (server enforces seller ownership and blocks suspended/archived products) |

## Verified matrix (read-only, production data)

| Scenario | Result | Evidence |
|---|---|---|
| Existing images appear on edit | **PASS** | dialog contains 4 `<img>`, all `naturalWidth 1280`, `complete: true` |
| Counter reflects stored images | **PASS** | gallery `4 / 10`, detail `0 / 10` |
| API returns images to the editor | **PASS** | `GET /api/seller/products` → 4 rows with `id`, `url` (https), `imageType: gallery`, `storageKey` |
| Image URLs reachable | **PASS** | `200` per image with a browser UA |
| Add image, keep old, order, no duplicates | **NOT VERIFIED** | would write to the production shop |
| Remove one image, others preserved | **NOT VERIFIED** | same reason (delete path now calls the ownership-checked endpoint) |
| Edit text only, images unchanged | **NOT VERIFIED** | save path no longer touches existing image rows by design |
| Reopen editor after save | **NOT VERIFIED** | requires a write |

## Related observations (not changed)

- Product list thumbnails already load (same R2 host); no fallback added, no URL rewritten.
- Create flow unchanged apart from sharing the same seeded arrays.
