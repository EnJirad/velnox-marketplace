# Handoff §11 — Media security fixes (TASK 003, 2026-09-24)

*Archived 2026-09-29 from `.ai/AI_HANDOFF.md` for edit headroom, before appending §48 (MEDIUM #9).
Verbatim copy of the section as it stood. Its only still-open item (#7) is restated in the live
handoff, so nothing was lost.*

---

## 11. Media security fixes (TASK 003, 2026-09-24)

Every Task 002 finding is closed except #7's production data cleanup (archived
copy: [`AI_Handoff-2026-09-23-r2-media-verification.md`](./AI_Handoff-2026-09-23-r2-media-verification.md));
its root cause is closed by §13. No DB change (`db/` untouched).

| # | Fix |
|---|---|
| 1 | `PATCH /api/customer/profile-image` **deleted** — no replacement; the canonical `save` route already writes the same reference after HeadObject + media persistence. `api.users.patchUserImage` and its only caller dropped. |
| 2 | Presign `purpose` allowlist (`avatar｜cover｜shop-logo｜shop-cover`); unknown → `400 INVALID_PURPOSE` before any URL is signed; avatar/cover mint `profile/{kind}/{userId}.webp`, shop purposes keep the shop-ownership query. |
| 3 | `ImageUpload.tsx` converts to WebP, presigns with the allowlisted purpose, and confirms with `objectKey` only (server derives the target). Still no screen renders it. |
| 4 | `confirm` and `save` answer `500 IMAGE_SAVE_FAILED` and return before any `users`/`shops` write when the media row cannot be persisted. |
| 5 | `compressImage` hands back the original untouched when the browser cannot encode (never relabels bytes); all three uploaders refuse non-WebP; `confirm`/`save` re-check the **stored** content type against the allowlist. |
| 6 | Both `deleteR2Object` call sites in `backend/routes/products.ts` (product-image delete, variant-image delete) now await. |
| 7 | **OPEN** — production data cleanup, not a code path. |

Server-derived now: `confirm` reads the reference target from the server-minted key
(a body `purpose`/`cdnUrl` can no longer steer which reference is written);
`upload-intent` requires an allowlisted `kind` (no default); `save` derives the
kind from the key.

**Validation:** backend `tsc` clean; `bun test backend/tests` **419 pass / 41
skip / 0 fail**; all four apps typecheck clean; `i18n:check` (th=en=my=1289);
`git diff --check` clean; no DB change. New cases in
`backend/tests/upload-security.test.ts` cover the removed route, the purpose
allowlist, arbitrary namespaces at presign/confirm, and the intent `kind`
allowlist.

**Tooling:** `backend/routes/products.ts` (181 KB) is past the edit tools'
match window, so finding 6 was applied as a `patch -p1` diff and verified with
`git diff`.
