# Archived: handoff §2 — "Verification — exactly ONE system"

Moved out of `.ai/AI_HANDOFF.md` on 2026-09-26 (TASK 007) to keep the live handoff
under this environment's ~55 KB file-edit limit. **The live copy of this content is
now `.ai/context/verification.md`** — that file, not this archive, is what an agent
should read. This record is kept verbatim for provenance.

The text below is unchanged from `.ai/AI_HANDOFF.md` §2 as it stood before the move.

---

## 2. Verification — exactly ONE system

Velnox has one verification system: **SELLER / SHOP identity verification**. There
is no product verification.

### The V rule

```
seller.verification_status = 'verified'
        ↓
EVERY product owned by that seller
        ↓
the single green V badge
```

No `products.is_v`, no per-product verification state. `verified` is the canonical
value (the brief's "approved" maps to it). `sellers.status` (`approved`) is the
**account** lifecycle; `sellers.verification_status` (`verified`) is the **trust
badge** — deliberately different columns. The V means only "this shop passed
Velnox identity verification" — not product quality, authenticity or warranty.
`VBadge` resolves V from the seller alone; the catalog exposes
`sellerVerificationStatus` via an `EXISTS (SELECT 1 FROM sellers …)` subquery (no
N+1).

### Lifecycle

```
Seller (VelSeller)
  RequireRole onboarding: Store → Applicant → Identity documents → Review → Submit
        │  (each document: presign → R2 PUT → evidence confirm → media row in Neon)
        ↓
  seller_verifications row (status=pending) + sellers.verification_status='pending'
        ↓
VelCenter
  Sellers → การยืนยันร้านค้า (Verification) tab → All/Pending/Verified/Rejected/Suspended + search
        ↓
  VerificationReviewDialog (applicant · store · address · signed docs · checklist · history)
        ↓
  Approve | Request correction | Reject | Suspend   (reason code REQUIRED unless approving)
        ↓
  notification → applicant sees reason → edit & resubmit → pending again
```

`sellers.status` state machine (enforced in `backend/routes/seller.ts`):

```
pending          → under_review, rejected
under_review     → approved, needs_correction, rejected, suspended
needs_correction → under_review, rejected
approved         → suspended
rejected         → pending      (re-application)
suspended        → pending      (re-activation)
```

Anything else → `400 INVALID_TRANSITION`. Self-approval → `403
SELF_ACTION_FORBIDDEN`. Approval requires a persisted verification record with at
least one evidence file.

### Submission integrity (hard rule)

`NO SUCCESSFUL EVIDENCE PERSISTENCE = NO PENDING VERIFICATION`

`POST /api/seller/apply` runs in ONE transaction: validate auth → validate seller
ownership → validate required fields → validate the three identity documents exist
as `media` rows owned by the caller → upsert shop → upsert `seller_settings`
(durable R2 **object keys**, never `File` objects or blob URLs) → upsert
`seller_verifications` (pending, with evidence) → **then** set
`sellers.verification_status='pending'` → append `seller_review_history` →
`COMMIT`. Any failure rolls everything back; nothing shows "pending" that the
backend did not persist.

### Structured review reasons

Canonical vocabulary: `packages/shared/src/lib/verification-reasons.ts` (mirrored
in the backend; `backend/tests/product-lifecycle.test.ts` asserts parity). Codes:
`id_card_unclear`, `id_card_incomplete`, `selfie_unclear`, `selfie_missing_id`,
`document_expired`, `applicant_mismatch`, `store_incomplete`, `contact_incomplete`,
`address_incomplete`, `duplicate_account`, `policy_violation`, `other`.

Corrections / rejections / suspensions require a valid code or the backend returns
`400 REASON_REQUIRED`. Internal reviewer notes live in `review_note` and are never
shown to the applicant; the applicant-visible reason is stored in
`seller_settings.{rejectionReason,correctionReason}` plus the matching
`…ReasonCode`.

### Review history

`seller_review_history` (seller_id, application_id, previous_status, new_status,
action, reason_code, reason, note, reviewer_id, created_at). Actions: `submitted`
| `resubmitted` | `under_review` | `needs_correction` | `approved` | `rejected` |
`suspended`. Written on every applicant submission and every reviewer decision.

### Identity evidence security

- Identity documents are never returned as public bucket URLs.
  - `GET /api/admin/verifications/seller/:id/evidence` and
    `GET /api/admin/sellers/:id/application` require `owner|admin|staff` and return
    **5-minute signed R2 GET URLs** generated server-side.
  - `GET /api/seller/evidence` signs URLs for the caller's own uploads only.
  - `GET /api/shops/:shopId/verification` is public and returns status +
    `verifiedAt` only.
- The applicant's own status payload exposes only an evidence **count**.
- The admin list strips `evidence_urls`.
- Ownership is enforced twice: `verification/evidence/{owner}/…` keys must match
  the caller, and every submitted key must exist as a `media` row with
  `uploaded_by = <caller>`.

### Self-action guard (reviewer ≠ applicant)

A VelCenter reviewer (`owner|admin|staff` with `sellers.manage`) may also own a
shop, and `PATCH /api/admin/verifications/seller/:id` with `approve` is the ONLY
write in the backend that sets `sellers.verification_status = 'verified'` — i.e.
the only way to earn the V. That decision is therefore refused when the reviewer
IS the applicant: `403 SELF_ACTION_FORBIDDEN`, rolled back before any write.

- Rule: `backend/lib/verification-guard.ts` → `isSelfApproval(action, actorUserId,
  sellerUserId)`. Pure and action-aware; ids are string-compared so a driver type
  change cannot silently disable it.
- Scope: **only `approve`**. `reject` / `suspend` / `needs_correction` can only
  lower the reviewer's own standing, so they stay allowed. The seller-application
  route (`PATCH /api/admin/seller-applications/:id`) keeps its own broader
  self-action check for `approved` / `rejected`.
- Ownership is resolved from the DB (`SELECT s.user_id FROM sellers s WHERE s.id
  = $1`), never from the request body; the actor id is always the session's.
- Tests: `backend/tests/verification-self-approval.test.ts` — 13 always-on cases
  (the rule exhaustively, wiring contracts that the guard runs BEFORE the status
  write, and an HTTP round trip proving the harness reaches the real route) plus
  2 DB-gated cases that drive `PATCH` for real: the owner gets 403 with nothing
  written, and a different reviewer gets 200 on the same record — the negative
  control that stops a broken fixture from passing as a fix. The DB cases need
  `DATABASE_URL` + `JWT_SECRET`, and the database must be bootstrapped with
  `db/run-sqleditor.sql` first.

### Verification API surface

| Method | Path | Who | Purpose |
|---|---|---|---|
| GET | `/api/seller/verification` | seller | own status (count only, no URLs) |
| POST | `/api/seller/verification` | seller | submit / resubmit (evidence required) |
| POST | `/api/seller/apply` | user | seller application (3 identity docs required) |
| GET | `/api/seller/status` | user | status + reasons + history |
| POST | `/api/seller/evidence/upload-intent` | user | presigned PUT (onboarding-safe) |
| POST | `/api/seller/evidence/confirm` | user | persist media row |
| GET | `/api/seller/evidence` | user | own evidence (signed URLs) |
| GET | `/api/admin/verifications?status=&q=&page=&limit=` | reviewer | seller queue (`all` supported; paginated, `pagination.total` is exact) |
| GET | `/api/admin/verifications/seller/:id/evidence` | reviewer | signed evidence |
| GET | `/api/admin/verifications/seller/:id/history` | reviewer | review history |
| PATCH | `/api/admin/verifications/seller/:id` | reviewer | approve/reject/suspend/needs_correction (self-approval → 403) |
| GET | `/api/admin/sellers?status=&q=` | reviewer | seller list (search + filter) |
| GET | `/api/admin/sellers/:id/application` | reviewer | full application + signed docs |
| PATCH | `/api/admin/sellers/:id/status` | owner/admin | account lifecycle status |
| GET | `/api/shops/:shopId/verification` | public | status only |

One live-content correction made during the move: the DB-gated note in the
self-action section said the cases need `DATABASE_URL`; since TASK 004A they need a
`TEST_DATABASE_URL` database (`.ai/context/testing.md`). The live copy
(`.ai/context/verification.md`) carries the corrected wording.
