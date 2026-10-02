/**
 * VelRepeat V2 — Phase 5: the due-cycle worker.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS IS
 * ────────────
 * The trigger half of the cycle lifecycle. `createCycleSchedule` (in
 * `lib/velrepeat-cycles.ts`) mints the schedule at activation; this job is
 * what notices a cycle has reached its `scheduled_at` and hands it to
 * `processDueCycles`, which creates THAT cycle's order — once, ever.
 *
 * IT IS NOT THE V1 SCHEDULER
 * ──────────────────────────
 * The V1 scheduler (`velrepeat-scheduler.ts`) drives `velrepeat_plans` rows by
 * `next_run_at` and, for a due plan, reprices, creates an order, moves stock,
 * increments `sold_count` and writes a pseudo-COD payment row. All of that is
 * V1 pay-per-run behavior, and none of it is copied here:
 *
 *   • the unit of work is a CYCLE, not a plan;
 *   • no repricing — a cycle delivers its frozen snapshot at the price the
 *     customer already prepaid;
 *   • no `velrepeat_runs` row (decision-closure §9.2 retires the run as the
 *     cycle identity; the execution-attempt model is Phase 7);
 *   • no payment row and no `sold_count` write (decisions Q14 and Q2).
 *
 * The two schedulers can run side by side over the same database without
 * interfering: V1 claims plans by `next_run_at` with `status = 'active'`, this
 * one claims cycles by `scheduled_at` with the cycle's plan also `active`, and
 * the two never write the same row.
 *
 * IDEMPOTENCY IS NOT HERE
 * ───────────────────────
 * This file contains no de-duplication logic and none is needed: every tick
 * re-queries the due set and calls `processDueCycles`, which takes the
 * exactly-once claim per cycle inside the database (`SELECT … FOR UPDATE` plus
 * a guarded `scheduled → processing` transition, backed by the unique index on
 * `(velrepeat_cycle_id, shop_id)`). A tick that runs twice, a process that is
 * restarted, and a second worker on another instance are all the same case and
 * all are answered by the database, not by process-local state.
 *
 * The `running` guard below is therefore NOT an idempotency mechanism. It only
 * stops one process from overlapping its own ticks — a tidiness measure. A
 * guard that claimed otherwise would be a lie: it dies with the process, and
 * it cannot see another instance.
 */
import { processDueCycles } from "../lib/velrepeat-cycles.js";

/** How many due cycles one tick will attempt. Matches the V1 tick's batch. */
const DEFAULT_BATCH = 25;

/** Floor on the poll interval, mirroring the V1 scheduler's 10s. */
const MIN_INTERVAL_MS = 10_000;

/**
 * One pass. Exported so a test, a cron caller or an operator can drive a tick
 * directly instead of waiting for the timer.
 */
export async function runDueCycleTick(
  limit = DEFAULT_BATCH,
): Promise<{ due: number; ordered: number; refused: number; claimed: number }> {
  const report = await processDueCycles({ limit });
  let ordered = 0;
  let refused = 0;
  let claimed = 0;
  for (const cycle of report.processed) {
    if (cycle.outcome === "ordered") ordered += 1;
    else if (
      cycle.outcome === "out_of_stock" ||
      cycle.outcome === "item_unavailable" ||
      cycle.outcome === "snapshot_missing"
    ) {
      refused += 1;
    } else claimed += 1;
  }
  return { due: report.due, ordered, refused, claimed };
}

/**
 * Start polling for due cycles. Returns the interval timer, matching
 * `startVelRepeatScheduler` so `server.ts` wires both the same way.
 */
export function startVelRepeatV2CycleScheduler(intervalMs = 60_000): NodeJS.Timeout {
  const ms = Math.max(
    MIN_INTERVAL_MS,
    Number(process.env.VELREPEAT_V2_CYCLE_INTERVAL_MS) || intervalMs,
  );
  let running = false;
  const tick = async () => {
    if (running) return; // never overlap ticks in one process (tidiness only)
    running = true;
    try {
      const result = await runDueCycleTick();
      if (result.due > 0) {
        console.log(
          `[velrepeat-v2] cycle tick: due=${result.due} ordered=${result.ordered} ` +
            `refused=${result.refused} already-claimed=${result.claimed}`,
        );
      }
    } catch (err) {
      // A tick that throws leaves every cycle it touched in its prior state:
      // each cycle is its own transaction, so a failure is contained to the
      // cycle that caused it and the next tick retries from the same place.
      console.error("[velrepeat-v2] cycle tick error:", err);
    } finally {
      running = false;
    }
  };
  // Fire once shortly after boot to pick up overdue cycles, then poll.
  setTimeout(() => void tick(), 5_000);
  const timer = setInterval(() => void tick(), ms);
  timer.unref?.();
  console.log(`[velrepeat-v2] cycle scheduler started (interval ${ms}ms)`);
  return timer;
}
