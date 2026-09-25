# Production Neon — read-only verification, closed evidence (TASK 001, 2026-09-23)

**Archived 2026-09-25** out of `.ai/AI_HANDOFF.md` §9 to keep the live handoff
small. The **open items** (§9.4 Still NOT VERIFIED, §9.5 Next action, §9.6 Safety
notes) stay live in `.ai/AI_HANDOFF.md` §9; only the closed method/ledger/evidence
tables moved here. Content below is verbatim.

**READ-ONLY.** No source, schema, migration, workflow or data change; nothing
was connected to from this workspace (no database credentials are readable here,
by platform design). Every fact below is the **production database's own
response**, captured from the production migration runner (`migrate-neon.yml`,
secret `NEON_DATABASE_URL` — documented as the production DB in
`context/database.md`) — not a filename check, not a local/test database.

### 9.1 Method

Everything came from `gh run view <id> --log` on `.github/workflows/migrate-neon.yml`
(the production runner, secret `NEON_DATABASE_URL`), grepped for the NOTICEs psql
returns from production, then `diff` of the ledger names against
`db/migrations/*.sql`. `gh workflow run diag-neon-schema.yml` → `403`.

### 9.2 Migration ledger

- `diff` of the production `schema_migrations` names against
  `db/migrations/*.sql` on `main` → **identical**: 49 rows, 49 files, none
  missing, none orphaned, nothing pending. Newest: `046_staff_must_change_password`
  @ 2026-09-18T00:05:39Z.
- A recorded row is **transactional proof**, not a list entry: the runner applies
  each file with `ON_ERROR_STOP=1 --single-transaction` and inserts the row only
  on exit 0. Observed live on the same database: `044 … ERROR: relation
  "velrepeat_plan_runs" does not exist` → `❌ FAILED`, and 044 stayed unrecorded
  until the retargeted file ran at 14:43:58Z.
- Rows 001–035 all carry one 2026-09-15 15:33–15:35 timestamp with a matching
  `already exists, skipping` NOTICE: the runner's first pass was a **backfill**
  over objects that already existed. Treat those timestamps as *not* creation
  dates — the NOTICEs are the existence evidence.

### 9.3 Verified in the production database (live responses)

| Item | Evidence |
|---|---|
| `sellers.status` admits `under_review` / `needs_correction` | 043 @ 2026-09-16T14:41:27Z — `UPDATE 0` + 4×`ALTER TABLE` + `CREATE TABLE` + `CREATE INDEX`, recorded |
| `seller_verifications.review_reason_code` / `review_note`, `seller_review_history` | same 043 run |
| `seller_verifications` + `idx_seller_verifications_seller` / `_pending` | NOTICE `already exists` (040) |
| `item_unavailable` on `velrepeat_plans.status` **and** `velrepeat_runs.status` | 044 @ 14:43:56Z, 4×`ALTER TABLE`, recorded 14:43:58Z |
| `media` canonical columns `uploaded_by`/`key`/`url`/`content_type`/`size` | 045 @ 14:44:00Z — five `V0045: media.<old> renamed to <new>` NOTICEs |
| `idx_media_owner_key` | **EXISTS** — NOTICE `relation "idx_media_owner_key" already exists, skipping` (041 @ 14:41:17Z); it indexed the owner/key columns before 045 renamed them, and Postgres carries an index across `RENAME COLUMN` |
| `notifications` + `body` / `metadata` + `idx_notifications_unread` | NOTICEs (003, 016) |
| `audit_logs` + `idx_audit_logs_entity` + `idx_audit_logs_created` | NOTICEs (005) |
| `products`, `shops`, `orders`, `moderation_records`, `platform_settings`, `revoked_tokens`, `product_images.variant_id`, `product_variant_images` (+indexes) | NOTICEs across 001–037 |
| `users.must_change_password` | 046 @ 2026-09-18T00:05:39Z — `ALTER TABLE` |
