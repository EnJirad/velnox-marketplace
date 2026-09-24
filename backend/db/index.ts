import pg from "pg";
import { resolveApplicationDatabaseUrl } from "./database-guard.js";

/**
 * Single PostgreSQL pool for the backend.
 *
 * Connection selection goes through `database-guard.ts`:
 *   • application runtime → `DATABASE_URL` (unchanged)
 *   • test process       → `TEST_DATABASE_URL` only, validated as disposable;
 *                          the application DATABASE_URL is never used there.
 * Any other test-process database access is refused instead of connecting, so
 * the test suite can never write fixtures into production.
 */
const resolution = resolveApplicationDatabaseUrl();

if (resolution.blocked) {
  console.warn(`[db] test isolation guard: ${resolution.reason}`);
}

// ─── Fix SSL deprecation warning from pg-connection-string ─────────────────
// The Neon DATABASE_URL typically includes sslmode=require, which triggers a
// deprecation warning.  We explicitly set sslmode=verify-full (the secure
// default) to silence the warning without weakening security.
// A disposable local test database has no TLS, so its URL is used verbatim.
function withSecureSsl(raw: string): string {
  if (!raw.includes("sslmode=")) {
    return raw + (raw.includes("?") ? "&sslmode=verify-full" : "?sslmode=verify-full");
  }
  return raw.replace("sslmode=require", "sslmode=verify-full");
}

const connectionString = resolution.blocked
  ? ""
  : resolution.testDatabase
    ? resolution.url
    : withSecureSsl(resolution.url);

const pool: pg.Pool | null = resolution.blocked
  ? null
  : new pg.Pool({
      connectionString,
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

pool?.on("error", (err) => {
  console.error("Unexpected database error:", err);
  process.exit(-1);
});

/** Throws instead of connecting when the test isolation guard blocked access. */
function activePool(): pg.Pool {
  if (!pool) throw new Error(`[db] ${resolution.reason}`);
  return pool;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query(text: string, params?: unknown[]): Promise<pg.QueryResult<any>> {
  // Track pool wait time (time spent waiting for a connection from the pool)
  const poolWaitStart = Date.now();
  const result = await activePool().query(text, params);
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
  return activePool().connect();
}

/**
 * Execute a callback inside a database transaction.
 * The client is automatically released (rolled back on error, committed on success).
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await activePool().connect();
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
