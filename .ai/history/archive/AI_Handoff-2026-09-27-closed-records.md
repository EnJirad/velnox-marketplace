# Handoff archive — closed records §23–§26 (2026-09-27)

Moved VERBATIM out of [`.ai/AI_HANDOFF.md`](../../AI_HANDOFF.md) on 2026-09-27 to keep
the live handoff editable: this workspace's file-edit tools stop matching a file past
roughly 55 KB, and the handoff had reached it.

Reference only — nothing here is guaranteed to describe the current code. The repository
is authoritative; load [`.ai/AI_HANDOFF.md`](../../AI_HANDOFF.md) first.

The live bullets these records left behind are §22's housekeeping notes and §6's open
items; the code they describe was verified at the time and is unchanged by their move.

---

## 23. Seller application rejected documents it already had — evidence purpose parser fixed (2026-09-27)

**Symptom.** Applicant presigned + uploaded all three identity documents
(`purpose=id_card|id_card_back|selfie_id`, one `INSERT INTO media` each), then
`POST /api/seller/apply` → `400 IDENTITY_EVIDENCE_REQUIRED` — *"Missing required
identity documents: id_card, id_card_back, selfie_id"*.

**Root cause (reproduced with a real DB + HTTP test BEFORE the fix).** Evidence keys are
minted `verification/evidence/{owner}/{purpose}_{Date.now()}.{ext}`, so the purpose is the
filename text before the trailing `_{timestamp}`. Four call sites recovered it with
`filename.split("_")[0]`, which keeps only the first fragment: `id_card_back_1758….jpg` →
`"id"`, `id_card_…` → `"id"`, `selfie_id_…` → `"selfie"`. Submit therefore never saw any
of the three required purposes and rejected a complete application (`id_card_back` was
unreachable by construction). Upload, `media` rows (`uploaded_by`/`key`) and R2 objects
were all correct — OAuth, the DB outage and the confirm flow were not involved.

**Fix (no bypass, no new endpoint, no schema change).** New `backend/lib/evidence-purpose.ts`
— `evidencePurposeFromKey()` parses everything before `_{≥6 digits}` (fallback: leading
segment, the pre-fix behaviour). Wired into `/api/seller/apply`, `GET /api/seller/evidence`,
`GET /api/admin/verifications/seller/:id/evidence` and the reviewer evidence detail in
`seller.ts` (VelCenter document labels resolve again). Validation itself is untouched:
missing or foreign documents are still rejected, including the `media` ownership check.

**Verification (actually run).** New executed suite
`backend/tests/seller-apply-identity-evidence.test.ts` (real disposable PostgreSQL + real
HTTP): **4 fail / 2 pass before** the fix, **6 pass / 0 fail after** — all three documents
uploaded through the real evidence flow → 200, `sellers.status='pending'`,
`sellers.verification_status='pending'`, `seller_verifications.evidence_urls` = the 3 keys;
one document missing → 400 naming exactly `selfie_id`, no seller row created; no documents →
400 naming all three; another account's keys → 403. Full suite **608 pass / 2 skip / 0 fail**
(610 tests, 28 files; was 597/2/0) · backend `tsc` exit 0 · `bun run typecheck` 4/4 exit 0 ·
`git diff --check` clean. The production applicant can resubmit: the failed attempt created
no seller row, and the three existing `media` rows now satisfy submit.

## 24. Seller access = approved application only — tab bar, authorization, revision flow (2026-09-27)

**Rule (unchanged, now enforced in ONE place).** `sellerAccess = true ⇔ sellers.status = 'approved'`.
`users.role` is a cached promotion, never the check; client-supplied `role` / `approved` /
`sellerAccess` / `userId` is never read.

**What was wrong.** velseller rendered its bottom tab bar unconditionally (static
`<MobileTabBar items={SELLER_TABS} />`), so the seller navigation was visible to signed-out users and
to every `pending` / `needs_correction` / `rejected` applicant. `GET /api/seller/profile` and
`PATCH /api/seller/shop` had no status check at all (any account with a `sellers` row could read its
profile and edit its shop), and `GET /api/seller/velrepeat/deliveries`, its delivery PATCH and
`/api/seller/velrepeat/overview` only checked that a `sellers` row existed. Product option
management resolved the seller with no status filter. A `needs_correction` resubmission also started
from an EMPTY form — previous shop data, applicant data and the three identity documents were never
reloaded.

**Changes.** New `backend/middleware/seller.ts` — `resolveSellerAccess(userId)` and
`requireApprovedSeller` (403 `SELLER_NOT_APPROVED`) — applied to `GET /api/seller/profile`,
`PATCH /api/seller/shop`, the three `/api/seller/velrepeat/*` dashboard routes and the
product-options seller lookup. The applicant flow (`apply`, `status`, `evidence*`, `verification`)
stays open by design: it is how an application is created, corrected and resubmitted.
`GET /api/seller/status` now returns a top-level server-computed `sellerAccess` plus `shop{…}` and
`applicantInfo.idNumber` for prefill. Frontend: `packages/shared/src/lib/seller-access.ts`
(fail-closed decision helpers) + `hooks/use-seller-application.ts` (own application from the cookie
session; refetch on focus/visibility so an approval lands without re-login); the velseller tab bar
renders only through `shouldShowSellerTab({sellerAccess, loading, error})` — hidden while loading, on
API error, and for every non-approved status; `RequireRole` prefills the previous application and
hydrates the three documents from `GET /api/seller/evidence` (own rows, matched by purpose), so a
correction resubmits the SAME application with the SAME documents.

**Verification (actually run).** New `backend/tests/seller-access-authorization.test.ts` (15 cases;
real disposable PostgreSQL + real HTTP): `sellerAccess` false for no-application / pending /
under_review / needs_correction / rejected / suspended, true only for approved; `GET /api/seller/profile`
and `PATCH /api/seller/shop` → 403 `SELLER_NOT_APPROVED` for every non-approved status (the shop is
provably unmodified) and 200 for approved; a pending applicant injecting
`role`/`approved`/`sellerAccess`/`status`/`userId=<approved account>` in the body still gets 403;
ownership isolation (an applicant cannot read the approved account's status, shop slug or documents —
the evidence list only ever returns the caller's rows). Full suite **624 pass / 2 skip / 0 fail**
(626 tests, 29 files; was 610/2/0) · backend `tsc` exit 0 · `bun run typecheck` 4/4 exit 0 ·
`bun run build:apps` 4/4 exit 0 · `git diff --check` clean · **no schema change** (`db/` untouched,
no new field: `sellers.status` was already authoritative).

**Deliberately not changed.** No new endpoint, no new realtime channel (the WS client is chat-only;
the tab refetches on focus/visibility instead), and no change to the applicant-side endpoints. A
rejected applicant still re-applies with prefilled data (existing business rule); a suspended seller
simply loses the tab and the seller APIs. Stripe TEST E2E and browser/OAuth E2E remain BLOCKED
(§6, §22).

## 25. Verification queue: new vs resubmitted + realtime state sync (2026-09-27)

1. **Queue separates new from resubmitted (server-side).** `GET /api/admin/verifications` now returns
   `application_type` (`new|resubmitted`) and `resubmission_count`, counted in the SAME query from
   `seller_review_history` (`COUNT(*) … WHERE action = 'resubmitted'`, `LEFT JOIN LATERAL`) — per seller,
   never from the request, the page, or local state. `resubmission_count = 0 ⇒ "new"`; the brief's
   example (submitted → needs_correction → resubmitted ×2) reports **2** and can never fall back to "new".
2. **The history now records the truth.** `POST /api/seller/verification` wrote `submitted` on every
   submit, so a resubmit through MyShop was invisible; it now writes `resubmitted` whenever the seller
   already has review history (`POST /api/seller/apply` already did). Rejection → re-apply counts too.
3. **Missing broadcasts wired.** `POST /api/seller/apply` and `POST /api/seller/verification` emit
   `CHANNELS.SELLER_UPDATED` / `seller:status-changed` after COMMIT (`routes/seller.ts` imported
   `broadcast` but never called it), so an open VelCenter refetches the queue the moment an applicant
   submits or resubmits.
4. **ROOT CAUSE of "toast says done, UI unchanged": the shared GET cache.** `packages/shared/src/lib/api-routes.ts`
   caches every `apiGet` for 60 s but only `apiPost` invalidated it — `apiPatch`/`apiPut`/`apiDelete`
   left the stale body in place, so the refetch each mutation already performed replayed PRE-write data
   (category on/off toggle, review decisions, seller status, settings). All four mutation helpers now
   clear the cache before their request, and mounted `useQuery` readers re-run through a mutation
   invalidation bus — no new fetch layer, no optimistic UI, server stays the source of truth.
5. **UI.** VelCenter queue rows show a type chip (existing `review.actionSubmitted` /
   `review.actionResubmitted` ×N — all three locales, no new copy needed) next to the status badge;
   `useSellerApplication` also listens to `notification:created` on the EXISTING per-user chat socket and
   refetches on `seller*` notifications, so a reviewer decision reaches an open seller session without
   logout/login (still one socket per app; VelCenter still owns the only one in velcenter).

**Tests (executed, disposable PostgreSQL + real routes).** New `backend/tests/seller-resubmission-queue.test.ts`
(8 cases: new=0, resubmitted=1/2 through the REAL submit → needs_correction → submit cycle, per-seller
isolation, rejection → re-apply = 1, reviewer-only 403, no `evidence_urls` leak) and
`backend/tests/center-seller-state-sync.test.ts` (15 cases: executed cache test proving GET→PATCH→GET
hits the network again and returns the post-mutation body, failed mutation still reconciles, plus the
broadcast/event-bus/refetch wiring contracts and “one socket per app”). Full suite **647 pass / 2 skip /
0 fail** (649 tests, 31 files; was 624/2/0) · backend `tsc` exit 0 · `bun run typecheck` 4/4 exit 0 ·
`bun run build:apps` 4/4 exit 0 · `i18n:check` th=en=my=1319 · `git diff --check` clean.

**No new system:** no endpoint, no channel, no table, no schema change (`db/` untouched), no mock data.
**Still not verified:** no browser/preview run and no paid-provider E2E — Stripe TEST + DNS blockers
(§6) are unchanged.

## 26. Approval = ONE decision: seller access + reviewer badge (2026-09-27)

**Root cause of both reported symptoms (a single cause).** The two VelCenter Approve
buttons each wrote HALF of the same decision:

- `PATCH /api/admin/verifications/seller/:id` (`action=approve`) set
  `seller_verifications.status='verified'` + `sellers.verification_status='verified'`
  and left **`sellers.status='pending'`** — the authoritative field
  (`GET /api/seller/status` → `data.status`; `sellerAccess = status==='approved'`;
  `RequireRole` gates on it). An approved applicant therefore still got `pending`: the
  "รอตรวจสอบ 1–3 วัน" screen (VelSeller workspace blocked) and a seller the badge kept
  counting.
- `PATCH /api/admin/sellers/:id/status` → `approved` left the verification record
  `pending`, so the verification queue/badge kept a row a reviewer had decided.

Copy, JWT claims, in-memory auth state and Next/React caches were NOT the bug — the
database said `pending`.

**Fix (state, not text).** (1) the verification-queue approve now writes BOTH sides in
one transaction — `sellers.status='approved'`, `verification_status='verified'`,
`verified_at`, plus the same `users.role='seller'` promotion the account path does —
and refuses to approve a `rejected`/`suspended` ACCOUNT (400 `INVALID_TRANSITION`)
before any write. (2) the account approve resolves the verification record
(`status='verified'`), gated on `status IN ('pending','unverified')` AND
`jsonb_array_length(evidence_urls) > 0` (no V without proof) and parameterised, so the
"no literal grant" guard still holds. (3) The sidebar badge is the reviewer-work
COUNT: `pendingReviewSellers = COUNT(*) WHERE status IN ('pending','under_review')`,
added to the EXISTING `/api/admin/dashboard/counts`; `approved` is excluded by the
query itself and the page reads that field instead of a fetched list — no frontend
decrement, no new endpoint. (4) The queue raises the existing center-events "sellers"
signal after a confirmed decision and the Center page re-reads its counters, so the
badge drops immediately in the acting tab as well as in other tabs (`seller:updated`).

**Tests (executed; disposable PostgreSQL + real routes).** New
`backend/tests/seller-approval-access.test.ts` (10 cases): pending → `sellerAccess:false`
+ 403 `SELLER_NOT_APPROVED`; verification-queue approve → DB both-sides approved +
`role='seller'`, `sellerAccess:true`, `GET /api/seller/profile` **200**, reviewer-work
count −1, queue row gone; `needs_correction`/`rejected` → 403; suspended account
unapprovable (400, nothing written); account approve resolves the verification record;
the count excludes approved/rejected/needs_correction and equals the DB's
`IN ('pending','under_review')` count; badge wiring guards. Updated:
`verification-self-approval.test.ts` (two guarded, evidence-gated badge paths, still no
literal grant), `admin-queue-pagination.test.ts`,
`center-seller-state-sync.test.ts`. Full suite **658 pass / 2 skip / 0 fail** (660 tests,
32 files; was 647/2/0) · backend `tsc` exit 0 · `bun run typecheck` 4/4 ·
`build:apps` 4/4 · `i18n:check` th=en=my=1319 · `git diff --check` clean · no schema
change, no new endpoint/table/socket.

**Notes.** No browser run here (no browser/test account), so the UI change is verified
at typecheck + build + the executed API/DB layer, not visually. Applicants approved by
the OLD code still have `sellers.status='pending'` (their verification record is
`verified`): re-approving once — from either button — converges the state.

---

## 27 (archived verbatim 2026-09-27 by §31)

## 27. Stripe Sandbox/Test-Mode audit (2026-09-27) — archived; configuration since COMPLETED

**Archived verbatim** → [`history/archive/AI_Handoff-2026-09-27-stripe-sandbox-audit.md`](history/archive/AI_Handoff-2026-09-27-stripe-sandbox-audit.md)
(the audit table, credential-gate proof, executed-evidence log incl. CI run `36305688863`, the
env-var documentation change, and the Connect finding). Moved 2026-09-27 by §28 to keep this
file under the edit-tool ceiling.

- **Outcome of that pass: audit PASS, no code changed, sandbox E2E BLOCKED.**
- **Configuration is now DONE (owner).** §28 re-probed production read-only:
  `{configured:true, mode:"test", webhookConfigured:true}`, `/api/payments/methods` →
  **CARD + PROMPTPAY enabled**, COD disabled. Still **no live credential anywhere**.
- **Still BLOCKED:** no agent-driven sandbox round trip (PaymentIntent / PromptPay QR /
  webhook delivery / refund) has ever run, from here or anywhere else.
- **Stripe Connect: MISSING** — `CHECKOUT READY` must never be read as `MARKETPLACE PAYOUT READY`.
- `INSTALLATION.md` §4, `docs/ENVIRONMENT.md`: env names documented. **`.env.example` still
  lacks them** — protected from agent edits, so it stays an owner edit.

---
