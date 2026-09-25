# Archived — Production R2 / media read-only verification (TASK 002, 2026-09-23)

**Reference only.** Moved out of [`.ai/AI_HANDOFF.md`](../../AI_HANDOFF.md) on
2026-09-25 to keep the live handoff small. It was the `§10` section there; the
section number below is the original one.

Two things retired the *live* copy: every finding except #7 was fixed in `§11`
(TASK 003, 2026-09-24), and #7 — integration fixture shops visible through the
public `/api/shops` — had its **root cause** closed by TASK 004A (2026-09-25),
which made a test process unable to reach a production database at all. The
remaining half of #7 is production *data* cleanup, an owner action that needs no
code; it is tracked in `.ai/AI_HANDOFF.md` §13, not here.

The repository is authoritative. Confirm against source before relying on any of
this.

---

## 10. Production R2 / media — read-only verification (TASK 002, 2026-09-23)

**READ-ONLY.** No file uploaded, no production row touched, no secret printed
(public CDN domain + key only). No safe production test account exists here, so
the authenticated half could not run — see the blocker at the end.

**Production evidence (live, GETs only):**

- `GET /api/health` → 200 on `velnox-api.onrender.com` (the documented
  production API). `INSTALLATION.md:319/398` still names `velnx-api.onrender.com`
  — that host returns **404**; the live one is in `docs/DEPLOYMENT.md:16`.
- `GET /api/health/r2` → `{configured:true, bucket:true, verify:true}` — the
  handler does a real `ListObjectsV2` against the production bucket.
- `GET /api/shops` → 200 production rows, `imageUrl` =
  `https://pub-…r2.dev/<key>` → `R2_PUBLIC_DOMAIN` is set and is what builds
  stored references.
- object read: a real `shop/<shopId>/logo.webp` → **200 `image/jpeg`, 998 886 B**;
  a non-existent key → **404**.
- auth boundary: `POST /api/upload/presign|confirm`,
  `/api/customer/profile-image/upload-intent`, `/api/seller/evidence/upload-intent`
  → **401 UNAUTHORIZED** with no cookie; `GET` on the POST-only confirm → 404.
- `backend/tests/upload-security.test.ts` run here: **10 pass / 2 skip / 0 fail**
  — the two skips are the JWT-gated HTTP cases (403 foreign namespace, 400
  `R2_OBJECT_NOT_FOUND`), which need `JWT_SECRET` this workspace cannot provide.

**Findings (Task 002 was verification-only) — fixed in §11 except #7:**

1. Unvalidated `PATCH /api/customer/profile-image` wrote `users.avatar` from `req.body.image`.
2. Open presign `purpose` chose the bucket namespace.
3. Dead `ImageUpload` namespace mismatch (`avatar/<id>.webp` vs `profile/<kind>/…`).
4. confirm swallowed a failed media INSERT yet still moved the reference.
5. JPEG bytes stored under a forced `.webp` key.
6. `deleteR2Object(...)` unawaited in the product-image delete.
7. **OPEN** — integration fixture shops visible via public `/api/shops`
   (`so-test-*`, `inv-*`, `inv-cancel-*`, `inv-paid-*`).

**Blocker:** no safe production test account → Flows A–F, the failed-upload
path, the 10 MB boundary, replace/delete and the UI check are **CODE VERIFIED
only**. Next: provision a dedicated production test account, then re-run Task
002.
