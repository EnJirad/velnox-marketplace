import pg from "pg";
import { resolveConnectionString } from "./test-database.js";

// ─── Connection string resolution ──────────────────────────────────────────
// `resolveConnectionString()` is the single place that decides which database
// this process may reach:
//
//   * outside a test process it returns `DATABASE_URL` (sslmode normalised from
//     the deprecation-prone `require` to the secure `verify-full` default);
//   * inside a test process it returns the validated test database and throws
//     `TestDatabaseRefusedError` when the configured target is production — so
//     `bun test` can never seed the live Neon database (see
//     `backend/db/test-database.ts` for the full root cause).
const connectionString = resolveConnectionString();

// ─── Bounded waits ─────────────────────────────────────────────────────────
// `connectionTimeoutMillis` only bounds ACQUIRING a connection — it says
// nothing about a statement that has already begun. node-postgres, like the
// PostgreSQL driver default, therefore applies no deadline to a query that the
// server never finishes (a Neon compute that scaled to zero, a pooler restart,
// or a blocked row lock all leave the query pending for minutes).
//
// That matters most on `POST /api/payments/stripe/webhook`, whose idempotency
// write, event dispatch and state updates all run BEFORE the HTTP response is
// written. Any DB wait that never returns is therefore also a webhook that
// never answers: the caller gives up first (the Stripe CLI aborts a forwarded
// event after 30s), so an unbounded wait is indistinguishable from a dead
// endpoint even though the process is alive and other routes keep serving.
//
// `query_timeout` closes that hole and is deliberately the ONLY timeout added
// here. It is enforced entirely in this process (a timer around the query), so
// nothing extra is sent to the server. That is what makes it safe on this
// deployment: `DATABASE_URL` may point at Neon's PgBouncer pooler, and a
// startup parameter it does not recognize (node-postgres sends
// `statement_timeout` / `lock_timeout` / `idle_in_transaction_session_timeout`
// in the startup packet) is rejected by PgBouncer with "unsupported startup
// parameter" — which would break EVERY connection rather than harden one route.
// 15s keeps one webhook inside the caller's 30s window
// (connectionTimeoutMillis 5s + query_timeout 15s = 20s worst case) while still
// far exceeding the slowest legitimate query this project runs (~2s).
// ─── Warm floor ────────────────────────────────────────────────────────────
// Measured root cause (2026-09-28): this deployment serves traffic in bursts
// around a 60s scheduler tick, so the pool sat EMPTY for most of every minute
// and the next statement paid a full TCP + TLS + auth handshake to Neon on its
// own critical path. That fixed ~1.3s was billed to whichever statement
// happened to open the connection — which is why two unrelated,
// perfectly-indexed queries logged ~1.5s (`refunds` in the order-detail
// fan-out, and the VelRepeat due-plan scan) while the same statements on an
// already-open connection logged ~0.2s.
//
// `min` is the knob for exactly that: pg-pool only arms its idle-reap timer
// while `_clients.length > min`, so the last client is never reaped, while a
// burst still trims back down to one. It also makes the VelRepeat tick reuse
// one warm connection instead of redialing Neon every 60s. pg-pool performs no
// proactive refill, so a client the server closes is replaced — and kept warm
// again — by the next query.
//
// Deliberately NOT set: `keepAlive`. node-postgres turns it into the
// `keepalives` startup parameter, and Neon's PgBouncer rejects an untracked
// startup parameter ("unsupported startup parameter") — the same hazard that
// keeps `statement_timeout` off this pool.
const pool = new pg.Pool({
  connectionString,
  max: 20,
  min: 1,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  query_timeout: 15000,
  // Bound the age of that now-persistent connection. Client-side timer only
  // (no startup parameter is added), so a warm client cannot outlive a Neon
  // pooler maintenance window indefinitely: after this it is recycled on its
  // next release and the pool dials a fresh one.
  maxLifetimeSeconds: 1800,
});

// An IDLE client erroring is routine with a managed provider: Neon closes idle
// connections on compute scale-to-zero, on a pooler restart and on maintenance.
// node-postgres drops that client from the pool and the next query opens a new
// one, so this is recoverable. `process.exit(-1)` here turned it into a full
// service restart that killed every in-flight request — including a Stripe
// webhook midway through its writes — which is the other way this endpoint could
// stop responding without crashing. Log it with the same safe fields as a
// failed query (never the connection string, credentials, or parameters) and
// let the pool replace the client.
pool.on("error", (err) => {
  const pgErr = err as { code?: string; severity?: string; message?: string } | null;
  console.error("[DB] idle client error (client discarded; pool continues):", {
    code: pgErr?.code ?? null,
    severity: pgErr?.severity ?? null,
    message: pgErr?.message ?? (err instanceof Error ? err.message : String(err)),
  });
});

// ─── Safe database failure logging ─────────────────────────────────────────
// Diagnosis aid only. Logs the operation, the statement's leading keyword, and
// the PostgreSQL error code/severity/message — never the connection string,
// credentials, cookies, or query parameters (which may carry PII).
function logDbFailure(operation: string, sql: string | null, err: unknown): void {
  const pgErr = err as { code?: string; severity?: string; message?: string } | null;
  console.error("[DB] operation failed:", {
    operation,
    statement: sql ? sql.trim().split(/\s+/)[0] : null,
    code: pgErr?.code ?? null,
    severity: pgErr?.severity ?? null,
    message: pgErr?.message ?? (err instanceof Error ? err.message : String(err)),
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query(text: string, params?: unknown[]): Promise<pg.QueryResult<any>> {
  // The pool lease and the statement are timed SEPARATELY. `pool.query()`
  // reported a single number that merged two costs with opposite fixes —
  // checkout (waiting for / establishing a connection) and execution (the
  // statement itself) — so a cold pool looked exactly like a bad query plan.
  // Keeping them apart is what makes a slow-query log line name its own layer.
  // Checkout goes through getClient() so a refused connection is logged with
  // the same safe fields as every other caller, and the "one lease path" guard
  // in db-client-release.test.ts keeps holding.
  const startedAt = Date.now();
  const client = await getClient();
  const acquireMs = Date.now() - startedAt;

  let result: pg.QueryResult<any>;
  let execMs = 0;
  try {
    result = await client.query(text, params);
    execMs = Date.now() - startedAt - acquireMs;
  } catch (err) {
    logDbFailure("query", text, err);
    throw err;
  } finally {
    client.release();
  }
  const totalMs = acquireMs + execMs;

  if (totalMs > SLOW_QUERY_MS) {
    const queryPreview = text.replace(/\s+/g, ' ').substring(0, 150);
    console.warn(
      `[DB] slow query (acquire ${acquireMs}ms + execute ${execMs}ms = ${totalMs}ms, layer=${classifySlowQuery(acquireMs, execMs)}, pool idle=${pool.idleCount} total=${pool.totalCount} waiting=${pool.waitingCount}):`,
      queryPreview,
    );
  }

  return result;
}

/** A statement is reported when acquire + execute exceeds this. */
export const SLOW_QUERY_MS = 150;

/**
 * Which layer a slow statement's time actually went to.
 *
 * On this deployment a WARM round trip is ~0.2s, so the absolute number alone
 * cannot tell an operator whether to look at Neon's plan or at the pool: two
 * unrelated queries that both logged ~1.5s shared no SQL, table or index, only
 * the fact that each was the first statement to run on an empty pool. The
 * acquire/execute split separates those cases — a large acquire with a small
 * execute means connection checkout, a small acquire with a large execute means
 * the statement or the database.
 */
export function classifySlowQuery(acquireMs: number, execMs: number): "pool-connection" | "statement" {
  return acquireMs > execMs ? "pool-connection" : "statement";
}

export async function getClient(): Promise<pg.PoolClient> {
  try {
    return await pool.connect();
  } catch (err) {
    // A refused connection (quota, suspension, network) is logged here with the
    // same safe fields as a failed query.
    logDbFailure("connect", null, err);
    throw err;
  }
}

/**
 * Execute a callback inside a database transaction.
 * The client is automatically released (rolled back on error, committed on success).
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getClient();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export default pool;
