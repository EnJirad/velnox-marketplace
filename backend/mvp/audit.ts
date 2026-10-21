/**
 * MVP audit trail — ONE writer for every important MVP action.
 *
 * `db/mvp/schema.sql` declares `audit_logs` with a different shape from the
 * pre-MVP table (`actor_id` / `metadata` instead of `user_id` / `details` /
 * `ip_address`), so the existing `lib/audit-log.ts` cannot be reused here. The
 * *policy* is reused: every approval, suspension, moderation decision, payment
 * settlement and order cancellation goes through this one function, sensitive
 * keys are stripped, and a failure to write the audit row never breaks the
 * business transaction that produced it.
 *
 * `client` is passed by callers that already hold a transaction, so the audit
 * row commits or rolls back WITH the decision it records — an approved seller
 * can never exist without the row that says who approved them.
 */
import type pg from "pg";
import { query } from "../db/index.js";

type Executor = Pick<pg.PoolClient, "query"> | null;

/** Detail keys that must never reach the audit trail. */
const SENSITIVE_KEY = /(password|passwd|secret|token|hash|api[_-]?key|credential|authorization|cookie)/i;

export function sanitizeMetadata(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeMetadata(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY.test(key) ? "[redacted]" : sanitizeMetadata(val, depth + 1);
  }
  return out;
}

export async function writeMvpAudit(
  client: Executor,
  actorId: string | null,
  action: string,
  entityType: string,
  entityId: string | null,
  metadata: Record<string, unknown> = {},
): Promise<void> {
  const sql = `INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata)
               VALUES ($1, $2, $3, $4, $5::jsonb)`;
  const params = [actorId, action, entityType, entityId, JSON.stringify(sanitizeMetadata(metadata))];
  try {
    if (client) {
      await client.query(sql, params);
    } else {
      await query(sql, params);
    }
  } catch (err) {
    // Auditing is required for the decisions that call it (they pass a client so
    // the write is atomic), but a standalone write must not take the process
    // down. Callers inside a transaction get the failure raised — see below.
    console.error("[mvp] audit write failed:", err instanceof Error ? err.message : String(err));
    if (client) throw err;
  }
}
