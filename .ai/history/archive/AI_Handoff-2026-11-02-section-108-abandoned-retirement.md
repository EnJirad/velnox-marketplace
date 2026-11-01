# §108. Abandoned payment retirement (2026-11-01)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-11-02 for edit headroom. Nothing discarded.

## §108. Abandoned payment attempts retire safely (2026-11-01)

**SHA:** `3e2afff` → this commit. **Report:**
[`.ai/history/2026-11-01-abandoned-payment-recovery.md`](./history/2026-11-01-abandoned-payment-recovery.md).

Retirement now happens only for a session that can never be paid — `expired`, or `complete` **without**
`payment_status = "paid"`. A COMPLETE + PAID session is deliberately left alone (the webhook is the only
authority on `paid`), so cleanup cannot downgrade money during a webhook race. The UPDATE stays
`status IN ('pending','requires_action')` (idempotent, no deletes) and the new rail then proceeds.
`payment-abandonment` 8 pass + checkout/UX suites 58 tests 0 fail; full suite 8 Termux-only fails;
backend tsc clean, typecheck 4/4, build 4/4.

---
