/**
 * One-time consumption for pre-authentication proofs.
 *
 * ── Why this exists ──────────────────────────────────────────────────────────
 *
 * The pre-auth proof (see `preauth-proof.ts`) is an HMAC-signed cookie. Clearing
 * the cookie after reading it stops a REPLAY in the same browser, but it does
 * nothing about a captured cookie value used concurrently from two requests, or
 * against a second backend instance that never saw the first request. A signed
 * cookie alone is a bearer token with a TTL, not a one-time token.
 *
 * This module makes the nonce genuinely single-use, atomically, across
 * instances.
 *
 * ── Store selection (and why it is Postgres) ─────────────────────────────────
 *
 * This deployment has NO Redis / Upstash / Key Value instance: `package.json`
 * carries no redis client, and `middleware/rate-limit.ts` documents the same
 * gap ("the backend runs on Render with no shared store"). The one store every
 * backend instance already shares, and that every request already depends on,
 * is Postgres.
 *
 *   • PRIMARY — Postgres. Consumption is a single `DELETE … RETURNING`, which
 *     is atomic in the database: exactly one concurrent caller can receive the
 *     row, whichever instance it runs on.
 *   • FALLBACK — an in-process Map, and ONLY outside production. It exists so
 *     unit tests can exercise the logic without a database. It is never used
 *     when NODE_ENV=production.
 *   • PRODUCTION WITHOUT A STORE — `unavailable`, which the caller must treat
 *     as a rejection. There is no silent "assume unused" path.
 *
 * Only the SHA-256 of the nonce is ever written. The raw nonce never leaves the
 * signed cookie, and no token, nonce or secret is logged by this module.
 */

import crypto from "crypto";
import { query } from "../db/index.js";

export type ConsumeOutcome = "ok" | "replayed" | "expired" | "unavailable";

/** Rows are removed on use; this sweep only collects proofs that were never used. */
const SWEEP_PROBABILITY = 0.05;

interface MemoryRow {
  expiresAt: number;
}

const memory = new Map<string, MemoryRow>();

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * In-memory is allowed only outside production. In production a missing store
 * must fail closed, never degrade to per-process state (two instances would
 * each accept the same nonce).
 */
function memoryAllowed(): boolean {
  return !isProduction();
}

function hashNonce(scope: string, nonce: string): string {
  // Scope keeps namespaces apart without storing either value.
  return crypto.createHash("sha256").update(`${scope}:${nonce}`, "utf8").digest("hex");
}

function memorySweep(now: number): void {
  for (const [key, row] of memory) {
    if (row.expiresAt <= now) memory.delete(key);
  }
}

/** Test seam — clears the in-memory store. */
export function resetNonceStoreForTests(): void {
  memory.clear();
}

/**
 * Record a nonce as unused. Returns false when the nonce could not be recorded,
 * in which case the caller MUST NOT issue a proof — a proof that cannot be
 * consumed once is a replayable bearer token.
 */
export async function recordNonce(
  scope: string,
  nonce: string,
  ttlMs: number,
  now: number = Date.now(),
): Promise<boolean> {
  const key = hashNonce(scope, nonce);

  try {
    await query(
      `INSERT INTO preauth_nonces (nonce_hash, expires_at)
       VALUES ($1, NOW() + ($2::bigint * INTERVAL '1 millisecond'))
       ON CONFLICT (nonce_hash) DO NOTHING`,
      [key, ttlMs],
    );

    // Opportunistic sweep: only unused proofs accumulate, and the table stays
    // tiny (one row per sign-in attempt that never completed).
    if (Math.random() < SWEEP_PROBABILITY) {
      void query("DELETE FROM preauth_nonces WHERE expires_at < NOW()").catch(() => {});
    }
    return true;
  } catch {
    if (!memoryAllowed()) return false;
    memorySweep(now);
    if (!memory.has(key)) memory.set(key, { expiresAt: now + ttlMs });
    return true;
  }
}

/**
 * Consume a nonce exactly once.
 *
 * The Postgres path is one statement — `DELETE … RETURNING expires_at` — so two
 * simultaneous callers (same or different instances) cannot both receive the
 * row: the loser deletes nothing and is told `replayed`.
 */
export async function consumeNonce(
  scope: string,
  nonce: string,
  now: number = Date.now(),
): Promise<ConsumeOutcome> {
  const key = hashNonce(scope, nonce);

  try {
    const result = await query(
      "DELETE FROM preauth_nonces WHERE nonce_hash = $1 RETURNING expires_at",
      [key],
    );
    if (result.rows.length === 0) return "replayed";
    const expiresAt = result.rows[0]?.expires_at;
    const expiry = expiresAt instanceof Date ? expiresAt.getTime() : new Date(String(expiresAt)).getTime();
    if (!Number.isFinite(expiry) || expiry <= now) return "expired";
    return "ok";
  } catch {
    if (!memoryAllowed()) return "unavailable";
    // Read BEFORE any sweep: an expired-but-present row must report `expired`,
    // not `replayed`, exactly like the Postgres path's RETURNING row does.
    const row = memory.get(key);
    if (!row) return "replayed";
    memory.delete(key);
    if (row.expiresAt <= now) return "expired";
    return "ok";
  }
}
