# Handoff — boot-time DB identity, PART 8 shape assertions, and the reproduced incident (2026-10-04)

**Moved verbatim from `.ai/AI_HANDOFF.md` on 2026-10-04** (edit-headroom housekeeping, done
while adding the payment-integrity section). All three bodies of work are COMPLETE and their
contracts are maintained in [`.ai/context/database.md`](../../context/database.md); only the
narrative is unique to this file.

---

## Boot-time database identity — the four incidents' real lesson (2026-10-04)

`42P01 checkout_groups` → `42703 order_items.checkout_group_id` → `42703 payments.checkout_group_id`.
All three were diagnosed by **reasoning about the connection string** instead of asking the server
which database was connected, and all three produced a wrong conclusion.

`describeDatabaseIdentity()` in `backend/db/index.ts`, called once from `server.ts` at boot, now
answers it directly and read-only (a `SELECT`, never DDL — startup must not migrate):

```
[db] ✅ payment schema complete (database=neondb server=16.2)
[db] ❌ PAYMENT SCHEMA INCOMPLETE (database=neondb server=16.2) — missing: public.payments.checkout_group_id
```

It reports `current_database()`, the server version, and the live state of
`PAYMENT_CRITICAL_SCHEMA_OBJECTS` (`checkout_groups`, both group columns **with their type**,
the payments FK, the payments index). `safeDatabaseLabel()` reduces a connection string to the
database **name** only — never the host, user, password or `?sslmode=…`, because a Neon URL
embeds a password. Pinned by `backend/tests/db-identity.test.ts` (7 tests, incl. redaction and a
SELECT-only assertion on the probe body).

## PART 8 asserts the SHAPE, not just the names (2026-10-04)

`db/run-sqleditor.sql` PART 7/8 previously proved *existence*. Existence is the least a
reconciler may claim: `ADD COLUMN IF NOT EXISTS <name> <type>` is a **no-op when a column of
that name already exists under a different type**, so a wrong-typed column passes a name check
and then fails at runtime as `42804`. A foreign key is likewise never dropped by a name check.

PART 8 now also requires: both group columns `udt_name='uuid'`; each of the three group indexes
to actually contain `(checkout_group_id)`; and both group foreign keys to resolve to
`checkout_groups` with `confdeltype='n'` (**SET NULL** — the architecture's rule that a deleted
group must not take its payment rows with it). PART 7 reports `table | column | data_type` and
each FK's target and delete action. Verified non-vacuous by `db/verify-reconciler.sh` scenario I:
a wrong-typed column and a `CASCADE` foreign key are each rejected and **named**, exit 3.

## The reported incident, reproduced end to end (2026-10-04)

`db/verify-reconciler.sh` gained two scenarios (9 total, all PASS):

* **H — the reported incident.** A reconciled database holding a real `payments` row with
  Stripe provider ids, then `payments.checkout_group_id` removed. The production statement,
  verbatim, raises **42703 before** and **resolves the group after**; the payment row, its
  provider ids and its `paid` status are unchanged; a single-order payment is not re-pointed at
  the group; and a group payment is then resolved correctly.
* **I — the assertion is not vacuous** (above).

**BLOCKER, owner action.** Production `payments` still has no `checkout_group_id`. Run
`db/run-sqleditor.sql` against the database Render's `DATABASE_URL` actually points at (Neon SQL
Editor, correct project/branch). It is additive, rerunnable, and **now raises** if the column,
its type, its index or its foreign key is still wrong when it finishes. Confirm first with
`.github/workflows/production-db-verify.yml`, which prints the database identity, a row-count
fingerprint, and every critical column/index/FK with its type — a `FAIL` there is the
confirmation, from the right database.

> **Update 2026-10-04 (payment-integrity task).** Scenario H is now also pinned in
> `backend/tests/payment-webhook-schema-lag.test.ts`, and the consequence of the 42703 — that
> NO Stripe settlement could run in production — has been fixed in code: the group-routing read
> no longer names the column as a column, so it cannot raise on a database without it. The owner
> action above is still required, and is still what keeps multi-shop checkout payable.
