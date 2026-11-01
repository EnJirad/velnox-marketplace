# §110. Production marketplace audit (2026-11-02)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom. Nothing discarded.

## §110. Production marketplace audit (2026-11-02) — PARTIAL, no critical defect

**SHA:** `5965598`. **Report:**
[`.ai/history/2026-11-02-production-marketplace-e2e-audit.md`](./history/2026-11-02-production-marketplace-e2e-audit.md).

Four domains 200 except `velnox.com` (unresolved; project is on `velnox-theta.vercel.app`). Payment invariants
verified on live evidence: signed webhook only, `event_id` UNIQUE + `ON CONFLICT` (0 unprocessed), one-active
unique per order **and** group, request idempotency, retire guard that cannot touch `complete+paid`, no
deletes. Data: `paid 2 / cancelled 3`, 0 paid orders without a paid payment, 0 stale attempts. Typecheck 4/4 ·
builds 4/4 · 8 Termux-only fails · CI disposable PG 1489/0. **NOT TESTED:** card browser flow, refund,
webhook resend, delayed webhook, role UI walk. Next: refund + replay harness in CI.

---
