# AI Handoff — the `42703 checkout_group_id` correction (2026-10-04)

**Archived 2026-10-05** from `.ai/AI_HANDOFF.md`. The section below is superseded by §66, §67 and
§68; it is kept verbatim because the error it retracts is the one most likely to be re-made.

---

## `42703 checkout_group_id` — CORRECTION: the earlier verdict here was WRONG (2026-10-04)

**The section this replaces concluded "the schema was never wrong, therefore the running build
is not `main`". That inference is disproven. Production `payments` genuinely lacks
`checkout_group_id`, and the failing statement is `main`'s own, correctly scoped.**

**The error that was made.** It read: *"A 42703 naming a bare column means no relation in that
statement's FROM/JOIN scope owns it."* Measured against PostgreSQL, that is false. The message
is emitted in **two** indistinguishable cases:

| case | statement | message |
|---|---|---|
| (a) | the column exists, but **no relation in scope** owns it | `column "checkout_group_id" does not exist` |
| (b) | the relation **IS in scope** — `FROM payments` — and **the table itself lacks the column** | `column "checkout_group_id" does not exist` |

Byte-identical. PostgreSQL does not qualify the column with the relation it failed against, so
the error text alone **cannot** distinguish "wrong query" from "column absent". Every earlier
conclusion rested on assuming it could. Reproduced live in
`backend/tests/checkout-group-sql-scope.test.ts` steps 4b and 4c.

**So the reported failure is case (b).** `checkoutGroupIdForAttempt` (`backend/routes/stripe.ts`)
has `payments` in its FROM list, its scope is correct, and it is `main`'s own statement since
`d4ac063`. The build is current; the **database** is behind. Same root cause as §66: every
migration and every reconciler run in this repo reached a **different Neon** than Render's
`DATABASE_URL`. Production therefore never received migration 054, which is what adds
`payments.checkout_group_id`.

**What is still true from the retired section** (the SQL-scope work stands): every backend SQL
string mentioning `checkout_group_id` resolves in its own scope — 14 statements, all valid — and
`logDbFailure` now logs the redacted statement plus its relation scope. What is **retracted** is
the claim that a 42703 therefore proves a stale build.
