/**
 * MVP pending-order expiry — the background half of `expireStaleOrders`.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS
 * ───────────────
 * A checkout reserves stock for `PAYMENT_WINDOW_MINUTES` (30). If the buyer
 * never pays, `checkout.ts#expireStaleOrders` cancels the order and releases the
 * reservation — but only when something ASKS it to. Phase 3 exposed it as an
 * admin endpoint and documented that scheduling was still the owner's job; Phase
 * 3b makes staging self-driving by reusing the pattern this repository already
 * uses for its other workers (`backend/jobs/*.ts`: one module, one exported tick,
 * one `setInterval`, started from `server.ts`). No second scheduler system.
 *
 * WHY IT RUNS BY DEFAULT
 * ─────────────────────────────────────────────
 * The MVP API is the only API, so the sweeper that frees reserved stock starts
 * with the service; an environment that does not want it sets
 * `MVP_ORDER_EXPIRY_SCHEDULER=off` and drives the admin endpoint instead.
 *
 * IDEMPOTENCY IS THE DATABASE'S
 * ─────────────────────────────
 * `expireStaleOrders` claims each candidate in a transaction with
 * `FOR UPDATE SKIP LOCKED` and cancels through the ONE cancellation authority, so
 * two overlapping ticks — or two instances — cannot double-release stock. The
 * `running` guard below is only there to stop one process overlapping itself; it
 * is not a correctness mechanism.
 */
import { expireStaleOrders } from "../mvp/checkout.js";

/** Floor on the poll interval; the payment window is 30 minutes, not 30 seconds. */
const MIN_INTERVAL_MS = 30_000;

/** How many expired orders one tick will release. */
const DEFAULT_BATCH = 100;

/**
 * One pass. Exported so a test, a cron caller or an operator can drive a tick
 * directly instead of waiting for the timer.
 */
export async function runMvpExpiryTick(limit = DEFAULT_BATCH): Promise<number> {
  return expireStaleOrders(limit);
}

/**
 * Has the operator opted the background sweep OUT?
 *
 * Only the exact word `off` (trimmed, case-insensitive) means "no": a typo or a
 * half-set variable must never silently stop reserved stock from coming back.
 * Pure, so the rule can be asserted without creating a timer.
 */
export function isMvpExpiryDisabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (env.MVP_ORDER_EXPIRY_SCHEDULER ?? "").trim().toLowerCase() === "off";
}

/**
 * Start polling for expired pending orders.
 *
 * Returns `null` (and starts nothing) when the operator has opted out with
 * `MVP_ORDER_EXPIRY_SCHEDULER=off`; otherwise the sweep runs with the service.
 */
export function startMvpOrderExpiryScheduler(intervalMs = 60_000): NodeJS.Timeout | null {
  if (isMvpExpiryDisabled()) {
    console.log("[mvp-expiry] disabled by MVP_ORDER_EXPIRY_SCHEDULER=off (use the admin endpoint)");
    return null;
  }

  const ms = Math.max(
    MIN_INTERVAL_MS,
    Number(process.env.MVP_ORDER_EXPIRY_INTERVAL_MS) || intervalMs,
  );

  let running = false;
  const tick = async () => {
    if (running) return; // tidiness only — correctness is in the transaction
    running = true;
    try {
      const expired = await runMvpExpiryTick();
      if (expired > 0) console.log(`[mvp-expiry] released stock for ${expired} expired order(s)`);
    } catch (err) {
      // Each order is its own transaction, so a failure is contained to the order
      // that caused it and the next tick retries from the same place.
      console.error("[mvp-expiry] tick error:", {
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      running = false;
    }
  };

  // Fire once shortly after boot to pick up orders that expired while the
  // service was asleep, then poll.
  setTimeout(() => void tick(), 5_000);
  const timer = setInterval(() => void tick(), ms);
  timer.unref?.();
  console.log(`[mvp-expiry] scheduler started (interval ${ms}ms)`);
  return timer;
}
