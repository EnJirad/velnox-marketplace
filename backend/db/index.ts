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

const pool = new pg.Pool({
  connectionString,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
});

pool.on("error", (err) => {
  console.error("Unexpected database error:", err);
  process.exit(-1);
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
  // Track pool wait time (time spent waiting for a connection from the pool)
  const poolWaitStart = Date.now();
  let result: pg.QueryResult<any>;
  try {
    result = await pool.query(text, params);
  } catch (err) {
    logDbFailure("query", text, err);
    throw err;
  }
  const totalMs = Date.now() - poolWaitStart;

  // The pg library does not expose pool wait vs execution separately.
  // However, since Neon proxies all queries through a single connection pool,
  // the totalMs includes: network RTT to Neon proxy + proxy query + network RTT back.
  // For performance monitoring we log slow queries.
  if (totalMs > 150) {
    const queryPreview = text.replace(/\s+/g, ' ').substring(0, 150);
    console.warn(`[DB] query (${totalMs}ms):`, queryPreview);
  }

  return result;
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
