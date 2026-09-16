/**
 * Append-only audit logging for VelCenter staff actions (spec §44).
 *
 * ONE audit system: every writer goes through this helper so the shape of
 * `audit_logs` rows stays consistent (actor, action, entity, details, ip).
 * Writes are best-effort — an audit failure must never break the business
 * transaction that produced it.
 *
 * Secrets are never logged: `details` is sanitized before it is persisted.
 */

import type { Request } from "express";
import { query } from "../db/index.js";

/** Detail keys that must never reach the audit trail. */
const SENSITIVE_KEY = /(password|passwd|secret|token|hash|api[_-]?key|credential|authorization|cookie)/i;

/** Recursively drop sensitive keys from an audit payload. */
export function sanitizeAuditDetails(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[truncated]";
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeAuditDetails(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = "[redacted]";
      continue;
    }
    out[key] = sanitizeAuditDetails(val, depth + 1);
  }
  return out;
}

/** Client IP for the audit row (proxy-aware, no secrets involved). */
export function auditClientIp(req: Request): string | null {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.trim().length > 0) {
    return forwarded.split(",")[0]!.trim() || null;
  }
  if (Array.isArray(forwarded) && forwarded[0]) return forwarded[0];
  return req.ip ?? null;
}

/**
 * Persist one audit event.
 *
 * @param actorUserId  `users.id` of the staff member who performed the action
 * @param action       stable UPPER_SNAKE action code (e.g. `SETTINGS_UPDATE`)
 * @param entityType   what the action targeted (`product`, `seller`, `employee`, `setting`, ...)
 * @param entityId     target row id, or null for settings/system events
 * @param details      structured context — include `from`/`to` for changes
 * @param ip           request IP when the action came from an HTTP request
 */
export async function writeAuditLog(
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string | null,
  details: Record<string, unknown> = {},
  ip: string | null = null,
): Promise<void> {
  try {
    await query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        actorUserId,
        action,
        entityType,
        entityId,
        JSON.stringify(sanitizeAuditDetails(details)),
        ip,
      ],
    );
  } catch (err) {
    console.error("[audit] audit log write failed:", err);
  }
}
