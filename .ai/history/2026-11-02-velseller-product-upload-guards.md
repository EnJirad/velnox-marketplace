# 2026-11-02 — Velseller product management finalization (upload guards)

| # | Field | Value |
|---|---|---|
| 1 | Date + time (timezone) | 2026-11-02 19:20–20:05 +07 (12:20–13:05Z) |
| 2 | AI / agent | AndroidHarness (Coding agent) |
| 3 | Git branch | `main` |
| 4 | Commit SHA before | `68dd37218396a1da3e38c9a6773aeb3aaa9f7720` (in sync with origin) |
| 5 | Commit SHA after | local commit created by this pass (**not pushed**) |
| 6 | Purpose | Finish the product-management hardening: verify the two earlier image fixes still hold, then close the upload-path and stored-size gaps found while tracing create → upload → save → edit |
| 7 | Inspected | `product-images.ts`, `ProductFormDialog.tsx`, `backend/routes/products.ts` (`draft-upload-intent`, `image-upload-intent`, `save-image`, `DELETE images/:id`), `lib/media-config.ts`, `lib/upload-paths.ts` (new), live seller API |
| 8 | Files touched | `backend/lib/upload-paths.ts` (new), `backend/routes/products.ts`, `backend/tests/product-upload-guards.test.ts` (new) + docs |
| 9 | Added | `sanitiseSegment` / `sanitiseSubfolder`; `isUploadTooLarge` enforcement at `save-image`; 7 guard tests |
| 10 | Removed | the raw `const safeSubfolder = subfolder || "preview"` interpolation and the discarded `HeadObject` metadata |
| 11 | What changed | draft upload keys can only be built from safe segments; `save-image` now rejects an object larger than 10 MB using the size read back from R2 |
| 12 | Why | a seller could send `subfolder="../../products/<id>"` and have a presigned PUT minted outside their draft prefix; and any object size was accepted because the head response was thrown away |
| 13 | Systems affected | seller product upload routes only; response codes/contracts unchanged (`INVALID_FILE_TYPE`, `R2_OBJECT_NOT_FOUND`, plus the existing documented `FILE_TOO_LARGE`) |
| 14 | Confirmed unaffected | no schema, auth, ownership or R2 configuration change; `image-upload-intent` already derives its key server-side; all apps typecheck, velseller builds, i18n unchanged |
| 15 | Checks run | `bun run typecheck` · `bun run build:velseller` · `bunx tsc -p backend` · `bun test backend/tests` · `bun test backend/tests/product-upload-guards.test.ts` · `bun test backend/tests/product-image-state.test.ts` · `i18n-check` · `git diff --check` |
| 16 | Results | guard tests **7 pass / 0 fail** · image-state tests **9 pass / 0 fail** · full suite **1139 pass / 382 skip / 8 fail (env)** across 82 files (1545 tests) · typecheck 4/4 · build 11.56 s · backend tsc 0 · i18n 1346×3 · `diff --check` 0 |
| 17 | Problems found | (a) client-controlled path segments in the draft-upload key; (b) no server-side size cap at `save-image`; (c) the editor copy is still Thai-only (reported, not changed); (d) create/edit/add/remove cannot be executed safely in this environment |
| 18 | Limitations | every mutation path (create product, upload, add/remove image, text save, reopen) runs against the live shop → **NOT VERIFIED**; viewports other than 492 px **NOT VERIFIED**; no screenshots (§137) |
| 19 | Work still open | run the mutation matrix on a disposable seller/database; migrate the product form copy to `th/en/my` |
| 20 | Next agent must know | draft uploads must always go through `sanitiseSegment`/`sanitiseSubfolder`; `save-image` rejects objects over `MAX_UPLOAD_BYTES`; the earlier image-state helpers (`seedGalleries`, `pendingUploads`) stay the only source of editor image state |

## Bugs found this round

| Bug | Root cause | Fix | Evidence |
|---|---|---|---|
| Presigned PUT could be minted outside the seller's draft prefix | `subfolder` and `draftId` interpolated verbatim into the R2 key | allowlist segments (≤3, `[A-Za-z0-9_-]`, no dots), fallback otherwise | `product-upload-guards.test.ts` (traversal table + source assertions) |
| Oversized product images accepted | `HeadObject` response discarded, so `ContentLength` was never compared to `MAX_UPLOAD_BYTES` | keep the head result and reject with `FILE_TOO_LARGE` | same test file asserts the wiring; `backend tsc` 0 |

## Verification of the earlier fixes (read-only)

- Existing images still seed the editor: live dialog rendered **4/4** stored images (`naturalWidth 1280`).
- `seedGalleries` ordering / id retention / gallery-detail split: **9 unit tests pass**.
- Repeat-save duplication: `pendingUploads` skips ids; the re-seed test proves a second save has nothing to upload.

## Not verified

Create product, upload image, add image, remove image, text-only save, reopen-after-save (all write to
production), 7 viewport widths, screenshots, TH/EN/MY rendering of the product form.
