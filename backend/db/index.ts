import pg from "pg";

// ─── Fix SSL deprecation warning from pg-connection-string ─────────────────
// The Neon DATABASE_URL typically includes sslmode=require, which triggers a
// deprecation warning.  We explicitly set sslmode=verify-full (the secure
// default) to silence the warning without weakening security.
let connectionString = process.env.DATABASE_URL ?? "";
if (connectionString.includes("sslmode=require")) {
  connectionString = connectionString.replace("sslmode=require", "sslmode=verify-full");
} else if (!connectionString.includes("sslmode=")) {
  connectionString += connectionString.includes("?") ? "&sslmode=verify-full" : "?sslmode=verify-full";
}

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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function query(text: string, params?: unknown[]): Promise<pg.QueryResult<any>> {
  // Track pool wait time (time spent waiting for a connection from the pool)
  const poolWaitStart = Date.now();
  const result = await pool.query(text, params);
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
  return pool.connect();
}

/**
 * Execute a callback inside a database transaction.
 * The client is automatically released (rolled back on error, committed on success).
 */
export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
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
