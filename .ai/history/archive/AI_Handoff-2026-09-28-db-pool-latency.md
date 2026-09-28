# Handoff archive — DB latency: the pool idled down to zero (§34)

Verbatim record of `.ai/AI_HANDOFF.md` §34 as it stood on 2026-09-28, before it was replaced by a
stub to keep the live handoff inside this environment's ~55 KB file-edit window (see
`../README.md`). **Reference only — do not load automatically.** The work is closed: the fix is
committed on `main` (`4832750` + docs `bd86d1a`), re-proved by `backend/tests/db-latency.test.ts`
and re-measured in production (numbers below).

---

## 34. DB latency — the pool idled down to zero, so connection establishment landed on the first statement (2026-09-28)

**Reported (production log).** The order-detail `refunds` query (`SELECT id, amount, status,
reason, created_at, refunded_at FROM refunds WHERE order_id = $1 ORDER BY created_at ASC`) at
**1519–1538 ms** and the VelRepeat due-plan scan (`SELECT id FROM velrepeat_plans WHERE status =
'active' AND next_run_at <= NOW() ORDER BY next_run_at ASC LIMIT $1`) at **1515 ms**, while other
statements in the same window ran **205–225 ms**.

**Root cause: connection acquisition — neither query is slow, and neither needs an index.**
`idx_refunds_order (order_id)` matches the refunds predicate exactly;
`idx_velrepeat_plans_due (status, next_run_at) WHERE status = 'active'` (in **both**
`db/schema.sql` and migration `034`) matches the VelRepeat WHERE + ORDER BY exactly. The two slow
statements share no table, index or SQL — the only thing they shared was *being the first
statement to run on an empty pool*. With `max: 20`, `idleTimeoutMillis: 30000` and **no floor**,
this bursty low-traffic workspace left the pool empty for most of every minute, and
`pool.query()` reported checkout **+** execution as ONE number, so the ~1.3 s TCP/TLS/auth
handshake to Neon was logged as if it were query time. The 60 s VelRepeat tick (> the 30 s reap)
paid it once a minute; any request arriving after the pool idled out paid the same cost.

**Proven in production by measurement** (executed read-only from this workspace; three pairs of
`GET /api/shops?cb=…` — a DB-backed route, *not either reported query* — each after 40 s of no
traffic): pair 2 **1.627 s cold → 0.388 / 0.357 s warm**; pair 3 **1.738 s cold → 0.379 / 0.376 s
warm**; `/api/health` (no DB) 0.144–0.193 s throughout; pair 1 landed while the pool was still
warm (0.393 / 0.489 / 0.395 s) — itself consistent with the mechanism. A fixed ~1.3 s that
vanishes on an immediate repeat is connection establishment, and it is the same number as the two
reported queries.

**Fix — `backend/db/index.ts` only** (no schema, no index, no payment code):
- **`min: 1`** warm floor. pg-pool arms its idle-reap timer only while `_clients.length > min`, so
  the last client is never reaped and the next caller (including the scheduler tick) reuses it;
  a burst still trims back to one. No proactive refill: a server-closed client is replaced and kept
  warm again by the next query.
- **`maxLifetimeSeconds: 1800`** bounds that now-persistent connection's age (pg-pool client-side
  timer — no startup parameter) so it cannot outlive a Neon pooler maintenance window.
- **`query()` times the lease and the statement separately** and logs `acquire Xms + execute Yms =
  Zms, layer=pool-connection|statement, pool idle/total/waiting` — the measurement §33 asked for.
  `layer` comes from the new exported `classifySlowQuery()`. Deliberately NOT added: `keepAlive`
  (pg turns it into the `keepalives` startup parameter, which Neon's PgBouncer rejects — the hazard
  that already keeps `statement_timeout` off this pool).

**No index added, on evidence.** `(order_id, created_at)` was the other candidate; the ~1.3 s is
not in the plan, both access paths are already covered, and an index whose cost is dominated by
something else only adds write cost. Owner can re-confirm with `EXPLAIN (ANALYZE, BUFFERS)`
(read-only procedure in `.ai/context/database.md`).

**Verified here.** new `db-latency.test.ts` **12 pass / 2 skip / 0 fail** · full backend suite
**709 pass / 93 skip / 0 fail** (802 tests/38 files; was 697/91/788) · backend `tsc` 0 ·
`typecheck` 4/4 · `build:apps` 4/4 · `i18n:check` 1331 · `git diff --check` clean. Nothing under
`backend/routes/` changed, so the webhook's raw body, signature verification, `payment_events`
idempotency and state machine are as §32–§33 left them — re-proved by re-running that suite.

**After the fix — measured in production, executed** (post-deploy; one `GET /api/shops` after each
idle gap, then an immediate repeat): 5 s → **0.356 / 0.352 s**; 20 s → **0.400 / 0.354 s**; 40 s →
**0.482 / 0.401 s**; 70 s → **0.420 / 0.399 s**. The same 40 s gap that read **1.627 / 1.738 s**
before the fix now reads **0.48 s**, and the penalty stays gone at 70 s — the signature of
`min: 1` (pg-pool arms no reap timer for the last client, so the pool cannot idle down to zero).
One 0.895 s sample taken while the deploy was still settling is exactly why the sweep, not a
single sample, is the evidence. Webhook negatives re-run on the deployed revision: no signature →
**400**, forged signature → **400**. **Deploy proof is behavioral**: `git merge-base --is-ancestor
4832750 origin/main` is true and the GitHub deployments API records `4832750` for the four Vercel
production environments, but Render records nothing there — the latency change itself, plus
`/api/stripe/configured` still exposing §33's `webhookSecretHealth`, is what shows the backend
runs a revision at least as new as this commit.

**Open / owner-side.** (1) The two reported queries can only be re-logged by the owner (the
order-detail route needs a customer session, the VelRepeat tick is internal), but the mechanism
that produced their 1.5 s is the one measured and removed above. (2) New log lines for `refunds` /
the VelRepeat tick should read
`layer=statement` with a small acquire; a line still reading `layer=pool-connection` means
something else is emptying the pool (a Neon-side idle close), and the new line says so directly.
(3) `EXPLAIN (ANALYZE, BUFFERS)` on both queries confirms index scans. (4) The ~1.5 s was never a
Stripe webhook cause; the webhook budget is unchanged.
