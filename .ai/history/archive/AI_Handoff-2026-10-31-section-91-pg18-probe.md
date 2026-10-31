# §91. Production schema reconciled + the PG18 probe bug (2026-10-31)

> Archived verbatim from `.ai/AI_HANDOFF.md` on 2026-10-31 to keep the live handoff
> under this environment's ~55 KB edit-tool ceiling. Nothing was discarded.

## §91. Production schema reconciled + the PG18 probe bug (2026-10-31) — COMPLETE

**Starting SHA:** `e03f949` (`HEAD == origin/main`). The five §89 chat objects had been missing from
the production Neon database since that change shipped, and the daily support acknowledgment was
failing there with `42703 column "system_kind" ... does not exist`.

**Migration (authorized by the owner).** The GitHub Actions secret `NEON_PRODUCTION_DATABASE_URL` was
created, then `production-db-migrate.yml` was dispatched: run **`41114242571`, success**. Identity read
BEFORE any write: `database=neondb | schema=public | server=18.6 | user=neondb_owner`; applied with
`--single-transaction` + `ON_ERROR_STOP=1`. Additive only — no DROP TABLE / COLUMN, no TRUNCATE, no DELETE.

| Object | Before | After |
|---|---|---|
| `information_schema.columns` | 657 | **659** |
| `pg_indexes` | 239 | **240** |
| `chat_messages.system_kind` | absent | `text` |
| `chat_messages.ack_day` | absent | `date` |
| `uq_chat_messages_support_daily_ack` | absent | partial UNIQUE, present |
| `chat_messages_sender_role_check` | 3 roles | 4 roles (**+ `system`**) |
| `chat_messages.sender_id` | `NOT NULL` | **nullable** |

**Fingerprints.** `fp_all` `abd4d7bb…` → **`4fafa88b002bbb90375e0c984d4c5914`** = the canonical
`db/schema.sql` value; `fp_indexes` → **`0beed7d02db99d34c3c1b5b63d35a891`** = canonical; the
non-chat columns fingerprint is unchanged. **Zero differences remain.** Data untouched:
`data_fp = 4f3f2aeaaabd7e46a254ceaa318590bd` before and after, all rows preserved.

**Second defect found and fixed (repo change, `055c0ee`).** With the secret finally present,
`production-db-verify.yml` ran against production for the first time and failed with
`ERROR: operator is not unique: text || "char"` — its read-only probe concatenates
`con.confdeltype`. PostgreSQL 18 (production) refuses that operator while PostgreSQL 16 (the disposable
gate) accepts it, so the bug was invisible until now. One display-only cast fixed it; every assertion
stays typed and the job stays read-only. Re-run **`41118089821`: 10/10 PASS**.

**Live production evidence (real user traffic, no synthetic data).** At `19:43:41.960Z` a customer
message was stored, and at `19:43:42.394Z` the daily acknowledgment followed — exactly one row with
`sender_role='system'`, `system_kind='support_daily_ack'` (so the `ON CONFLICT … DO NOTHING` claim and
the Asia/Bangkok day both work against the real schema); a company reply at `19:44:18Z`; no `42703` in
the Render logs after the migration.

**Still unverified in production:** the read receipt (`✓✓`). This database's only conversation was sent
by ONE account on both sides (the same user id is `customer_id` and the sender of all 11 messages), so
`sender_id <> $reader` legitimately matches nothing and `read_at` stays NULL — the logic is correct,
the data simply cannot exercise it. Two distinct accounts are required.

**Tests after the migration:** reconciler contract `21/21` · chat suites `35 pass / 0 fail` ·
full suite `1087 pass / 360 skip / 8 fail` (the 8 are the Termux-only `process.execPath` probes) ·
CI `Tests` on `055c0ee` = **success (1437 pass / 2 skip / 0 fail)**.

---

