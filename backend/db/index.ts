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
  const start = Date.now();
  const result = await pool.query(text, params);
  const duration = Date.now() - start;

  if (duration > 500) {
    // Log slow queries (>500ms) with timing breakdown hint
    const queryPreview = text.substring(0, 120);
    console.warn(`[DB] Slow query (${duration}ms) — possibly Neon cold start or missing index:`, queryPreview);
  }

  return result;
}

export async function getClient(): Promise<pg.PoolClient> {
  return pool.connect();
}

export default pool;
