import { neon, Pool } from "@neondatabase/serverless";

/**
 * Cloudflare Workers Database Client
 * Neon Serverless PostgreSQL with Fail-Closed Test Guard
 */

export interface DbQueryResult<T = unknown> {
  rows: T[];
  rowCount: number;
}

export interface IDatabaseClient {
  query<T = unknown>(sql: string, params?: unknown[]): Promise<DbQueryResult<T>>;
  transaction<T>(callback: (client: IDatabaseClient) => Promise<T>): Promise<T>;
}

export function isNeonProductionUrl(url?: string): boolean {
  if (!url) return false;
  return url.includes(".neon.tech") || url.includes("neon.tech");
}

export function createNeonClient(databaseUrl: string, environment: string = "development"): IDatabaseClient {
  // Fail-closed test guard: Never run tests against production Neon
  if (environment === "test" && isNeonProductionUrl(databaseUrl) && !process.env.TEST_DATABASE_URL) {
    throw new Error(
      "REFUSING TEST AGAINST PRODUCTION DATABASE: databaseUrl points to Neon in test environment.",
    );
  }

  const client: IDatabaseClient = {
    async query<T = unknown>(text: string, params: unknown[] = []): Promise<DbQueryResult<T>> {
      const pool = new Pool({ connectionString: databaseUrl });
      try {
        const res = await pool.query(text, params as any[]);
        return {
          rows: res.rows as T[],
          rowCount: res.rowCount ?? res.rows.length,
        };
      } finally {
        await pool.end();
      }
    },

    async transaction<T>(callback: (txClient: IDatabaseClient) => Promise<T>): Promise<T> {
      // In serverless, Pool is used for multi-statement atomic transactions over WebSocket
      const pool = new Pool({ connectionString: databaseUrl });
      const conn = await pool.connect();
      try {
        await conn.query("BEGIN");
        const txClient: IDatabaseClient = {
          async query<R = unknown>(qText: string, qParams: unknown[] = []): Promise<DbQueryResult<R>> {
            const res = await conn.query(qText, qParams as any[]);
            return {
              rows: res.rows as R[],
              rowCount: res.rowCount ?? res.rows.length,
            };
          },
          async transaction<SubT>(subCb: (subTx: IDatabaseClient) => Promise<SubT>): Promise<SubT> {
            return subCb(txClient);
          },
        };
        const result = await callback(txClient);
        await conn.query("COMMIT");
        return result;
      } catch (err) {
        await conn.query("ROLLBACK");
        throw err;
      } finally {
        conn.release();
        await pool.end();
      }
    },
  };

  return client;
}
