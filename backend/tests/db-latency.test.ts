/**
 * DB latency attribution guard — static + unit (always runs) and DB-gated.
 *
 * Root cause this protects (2026-09-28): production logged the order-detail
 * `refunds` query (~1519–1538ms) and the VelRepeat due-plan scan (~1515ms) as
 * slow queries, while other statements in the same window ran ~205–225ms.
 * Neither statement was slow. Both already own the index their access path
 * needs — `idx_refunds_order (order_id)` and
 * `idx_velrepeat_plans_due (status, next_run_at) WHERE status = 'active'` —
 * they share no table, and a third, unrelated query reproduced the same fixed
 * ~1.3s penalty in production whenever it happened to be the first statement
 * after the pool had idled out (measured: 1.63s / 1.74s cold, 0.36–0.38s on an
 * immediate repeat). `pool.query()` reported lease + statement as ONE number,
 * so a Neon connection handshake was indistinguishable from a bad plan.
 *
 * Three properties are pinned here, because each is what made that
 * misdiagnosis possible:
 *
 *   1. the pool keeps a warm connection, so connection establishment stops
 *      landing on the first statement of the minute;
 *   2. `query()` keeps checkout and execution timed apart, so a slow-query log
 *      line names its own layer and cannot silently regress to the merged
 *      number that produced this investigation;
 *   3. `classifySlowQuery()` attributes those two cases correctly.
 *
 * The runtime case is skipped unless `TEST_DATABASE_URL` points at a validated
 * test database (see helpers/test-db.ts) — never at production.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pool, { classifySlowQuery, SLOW_QUERY_MS, query } from "../db/index.js";
import { hasTestDatabase } from "./helpers/test-db.js";

const dbSrc = readFileSync(fileURLToPath(new URL("../db/index.ts", import.meta.url)), "utf8");

/** Comments removed, so a guard matches CODE rather than its explanation. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** The `new pg.Pool({...})` call only. */
function poolConfigBlock(src: string): string {
  const start = src.indexOf("new pg.Pool({");
  const end = src.indexOf('pool.on("error"', start);
  return start === -1 || end === -1 ? "" : src.slice(start, end);
}

/** The `export async function query(...)` body only. */
function queryBlock(src: string): string {
  const start = src.indexOf("export async function query(");
  const end = src.indexOf("export async function getClient", start);
  return start === -1 ? "" : src.slice(start, end === -1 ? undefined : end);
}

const config = stripComments(poolConfigBlock(dbSrc));
const queryFn = stripComments(queryBlock(dbSrc));

describe("the pool keeps a warm connection (no database needed)", () => {
  test("the pool declares a warm floor, so the pool cannot idle down to zero", () => {
    // Without this, the last client is reaped 30s after the previous query and
    // the next statement pays the whole TCP + TLS + auth handshake to Neon.
    expect(config).toContain("min:");
    expect(pool.options.min).toBe(1);
  });

  test("the floor is below the ceiling, so a burst is still allowed to grow", () => {
    expect(pool.options.min).toBeLessThan(pool.options.max);
    expect(pool.options.max).toBe(20);
  });

  test("the age of the now-persistent connection is bounded", () => {
    // `min` makes one client long-lived; an unbounded connection could outlive
    // a Neon pooler maintenance window and be the one request that hits a dead
    // socket. pg-pool expires it client-side, so no startup parameter is added.
    expect(config).toContain("maxLifetimeSeconds");
    expect(Number(pool.options.maxLifetimeSeconds)).toBeGreaterThan(0);
  });

  test("no new startup parameter is sent (Neon's PgBouncer rejects unknown ones)", () => {
    // The same hazard that keeps statement_timeout off this pool: pg turns
    // `keepAlive` into the `keepalives` startup parameter. A rejected parameter
    // breaks EVERY connection, not one route.
    expect(config).not.toContain("keepAlive");
    expect(config).not.toContain("statement_timeout");
    expect(config).not.toContain("lock_timeout");
    expect(config).not.toContain("idle_in_transaction_session_timeout");
  });
});

describe("slow-query logging names the layer, not just the total", () => {
  test("query() times the pool lease separately from the statement", () => {
    expect(queryFn).toContain("acquireMs");
    expect(queryFn).toContain("execMs");
    // The statement is measured before the client is handed back.
    const acquireAt = queryFn.indexOf("acquireMs = Date.now()");
    const execAt = queryFn.indexOf("execMs = Date.now()");
    expect(acquireAt).toBeGreaterThan(-1);
    expect(execAt).toBeGreaterThan(acquireAt);
  });

  test("query() no longer reports the merged pool.query() measurement", () => {
    // `pool.query()` merges checkout and execution into one number, which is
    // exactly what made a 1.3s handshake look like a bad query plan.
    expect(queryFn).not.toContain("pool.query(");
  });

  test("the slow-query line carries the split, the layer and the pool state", () => {
    expect(queryFn).toContain("layer=${classifySlowQuery(");
    expect(queryFn).toContain("acquire ${acquireMs}ms");
    expect(queryFn).toContain("execute ${execMs}ms");
    expect(queryFn).toContain("pool idle=${pool.idleCount}");
    expect(queryFn).toContain("waiting=${pool.waitingCount}");
    expect(SLOW_QUERY_MS).toBe(150);
  });

  test("a leased client is always released — the lease cannot leak", () => {
    expect(queryFn).toMatch(/finally\s*{\s*client\.release\(\);\s*}/);
  });

  test("the new log line can leak neither the connection string nor parameters", () => {
    const logLines = dbSrc.split("\n").filter((line) => line.includes("console."));
    expect(logLines.length).toBeGreaterThan(0);
    for (const line of logLines) {
      expect(line).not.toContain("connectionString");
      expect(line).not.toContain("params");
    }
  });
});

describe("classifySlowQuery attributes the two failure modes", () => {
  test("a long checkout with a fast statement is a pool problem", () => {
    // The production shape: ~1.3s handshake, ~0.03s statement.
    expect(classifySlowQuery(1310, 30)).toBe("pool-connection");
  });

  test("a fast checkout with a long statement is a statement/database problem", () => {
    // The shape that would justify an index or a plan change.
    expect(classifySlowQuery(2, 1500)).toBe("statement");
  });

  test("a statement is never reported as a pool problem merely for being slow", () => {
    expect(classifySlowQuery(0, 400)).toBe("statement");
    expect(classifySlowQuery(150, 150)).toBe("statement");
  });
});

// ─── Runtime proof (needs a test database) ──────────────────────────────────

const itDb = hasTestDatabase() ? test : test.skip;

describe("the warm floor holds against a real pool", () => {
  itDb("an idle client is retained after a query instead of being reaped", async () => {
    await query("SELECT 1");
    // With `min: 1` pg-pool arms no reap timer for the last client, so the
    // connection that just ran the statement is still there for the next
    // caller — which is what removes the handshake from the request path.
    expect(pool.idleCount).toBeGreaterThanOrEqual(1);
  });

  itDb("the next statement is served from that retained connection", async () => {
    await query("SELECT 1");
    const before = pool.totalCount;
    const startedAt = Date.now();
    await query("SELECT 1");
    // No new client was dialled, so nothing but the statement was measured.
    expect(pool.totalCount).toBe(before);
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});
