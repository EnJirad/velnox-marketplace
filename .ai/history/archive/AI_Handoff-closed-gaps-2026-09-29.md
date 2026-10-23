# Archived handoff gaps — closed records (moved 2026-09-29)

Moved from `.ai/AI_HANDOFF.md` §6 "Remaining gaps / open items" to keep the handoff
small: these items are **CLOSED**, so they are neither current state nor a remaining
gap. The entries are verbatim.

---

- ~~**`PATCH /api/admin/verifications/seller/:id` has no self-action guard.**~~
  **CLOSED.** The approval path now refuses a reviewer who owns the shop under
  review (`403 SELF_ACTION_FORBIDDEN` + `ROLLBACK`, before any write). The rule
  lives in `backend/lib/verification-guard.ts` (`isSelfApproval`) so it is a pure,
  exhaustively testable function, and `isSelfApproval` is the ONLY gate on the
  one write that sets `sellers.verification_status = 'verified'`. Covered by
  `backend/tests/verification-self-approval.test.ts` — the last two of its 12
  cases are the interesting ones: the guard must run *before* the status write,
  and no route may grant the badge with a literal `SET verification_status =
  'verified'`.
- ~~**`GET /api/admin/products/moderation` is still fully unbounded**~~ **CLOSED
  (2026-09-26, §20).** Bounded via `backend/lib/pagination.ts` (default 25 / max 100,
  `p.created_at DESC, p.id DESC`, exact `pagination.total`, fallback count past the
  end); the queue renders one page with previous/next controls, and the executed
  evidence (9 real-DB/HTTP cases + 9 static guards) is in §20.
- ~~**`GET /api/admin/sellers` is unbounded too.**~~ **CLOSED (2026-09-26, §19).**
  The endpoint is bounded (default 25 / max 100, exact `pagination.total`, fallback
  count for a page past the end) and its only consumer — the VelCenter overview
  counter — reads that count instead of measuring a fetched list. Executed:
  `backend/tests/admin-sellers-pagination.test.ts` (8 cases, real DB + real HTTP).
- ~~**`GET /api/admin/verifications` is unpaginated** (`LIMIT 200`).~~ **CLOSED**
  — see §5 (b) 2. It returns `pagination` ({page, limit, total, totalPages,
  hasMore}) and the queue has previous/next controls; `limit=1` is the exact-count
  read.
- ~~**The DB constraint repairs must reach the deployed database.**~~ **CLOSED
  (2026-09-23):** production applied 043 (`under_review` / `needs_correction` on
  `sellers.status`) at 2026-09-16T14:41:27Z and 044 (`item_unavailable` on both
  `velrepeat_plans.status` and `velrepeat_runs.status`) at 14:43:58Z — both
  recorded in the production ledger and both observable in the runner log; 045
  restored the canonical `media` column names in the same window. See §9.
- ~~**Non-idempotent integration fixtures.**~~ **CLOSED** (2026-09-23):
  unique per-seed emails/tags everywhere, FK-ordered cleanup via
  `backend/tests/helpers/purge.ts`, and two consecutive full runs on the same
  database are green — `23505 … users_email_key` and the `23503` teardown
  failures are gone.
- ~~**One corrupted UI string:** `SellerVerificationQueue.tsx:177`~~ **CLOSED
  (2026-09-26, §20).** Now `review.revokeSuccess` — `ระงับและลบร้านค้าแล้ว`
  ("Shop suspended and removed"): the revoke action's own copy names the **shop**
  (`ร้านค้า`), not a transliterated "retailer".
