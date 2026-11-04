# Project context — shared brief for both agents

This is the **entry point** for any two-agent session on `velnox-marketplace`.
It points at the real documentation; it does not restate it. If this file and the
source disagree, the source wins — then fix this file.

## The project in one paragraph

Multi-vendor marketplace. Four Vercel frontends (`velshop`, `velseller`,
`velcenter`, `velnox`) talk HTTPS + httpOnly cookies to one Render backend
(Express + WebSocket), which is the only gateway to Neon PostgreSQL (source of
truth) and Cloudflare R2 (binary storage). Google OAuth + JWT. Languages:
`th`, `en`, `my`.

## Authority chain — read in this order

| # | File | Why |
|---|------|-----|
| 1 | `.ai/office/QUICK_START.md` | new single-page startup entry point |
| 2 | `.ai/AI_RULES.md` | §0 remote sync, §14 commit/push, §19 history record |
| 3 | `.ai/AI_HANDOFF.md` | current state + remaining gaps (compact) |
| 4 | `.ai/context/project-map.md` | where anything lives |
| 5 | `.ai/context/<subsystem>.md` | only the subsystem being touched |
| 6 | the actual source | authoritative implementation |

Do not read the whole `.ai/` tree. Pick the subsystem.

| Task touches | Read |
|---|---|
| catalog / product cards | `.ai/context/products.md` |
| category tree | `.ai/context/categories.md` + `.ai/context/seller.md` |
| login / session | `.ai/context/security.md` |
| uploads / R2 | `.ai/context/media.md` |
| checkout / orders | `.ai/context/checkout.md` |
| payments / Stripe / COD | `.ai/context/payment.md` |
| seller verification / badge | `.ai/context/verification.md` |
| schema / queries | `.ai/context/database.md` |
| API / authz / audit | `.ai/context/backend.md` |
| WebSocket | `.ai/context/realtime.md` |
| styling / theme / mobile | `.ai/context/frontend.md` |

## Hard invariants (violating these is a blocking review finding)

1. **Flow is one-directional:** `Neon → Backend API → Frontend`. A frontend never
   touches Neon or holds a server secret.
2. **Schema changes are double-booked:** update `db/schema.sql` **and**
   `db/run-sqleditor.sql`. Never recreate `db/run-update.sql`.
3. **No invention:** no fake data, mock APIs or invented schemas unless the user
   explicitly asks for a mock.
4. **No duplicates:** reuse the existing table, route or component. Do not add a
   second one with a new name.
5. **Remote is truth:** `git fetch` and compare before any editing (`§0`).

## Commands that actually exist

```bash
bun install
bun run dev:velshop | dev:velseller | dev:velcenter | dev:velnox
bun run api:dev
bun run typecheck                       # the 4 apps only
bun --filter @velnox/backend typecheck  # backend (CI runs this separately)
bun run test                            # backend/tests; needs TEST_DATABASE_URL for DB tests
bun run i18n:check                      # th/en/my parity
bun run build:apps                      # or build:velshop / build:velseller / build:velcenter / build:velnox
```

`bun run lint` and `bun run format` are **placeholders** that print "not yet
configured". They are not evidence of anything.

## Environment facts that bite subagents

- `TEST_DATABASE_URL` is the only database a test run may write to.
  `DATABASE_URL` in this repo is the **production** Neon string.
  `backend/db/test-database.ts` refuses it — do not try to work around the guard.
- Tests gated on `TEST_DATABASE_URL` **skip** (not fail) when it is unset.
- On this Android/Termux host, `process.execPath` is the linker, not bun; the
  `test-database-isolation` end-to-end probes fail for that reason alone.
  See `.ai/automation-reports/daily-health-report.md`.
