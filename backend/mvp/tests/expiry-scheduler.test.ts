/**
 * MVP expiry scheduler — the operator's half.
 *
 * The sweep itself is covered where it belongs (`admin.test.ts` drives the
 * endpoint against a real database). What matters here is that the background
 * worker honours its opt-out, because a worker is the one thing a production
 * service runs without anyone clicking anything — and that a mistyped value
 * does NOT opt out, or reserved stock would quietly stop coming back.
 *
 * These assertions need no database and start no timer: the gate is a pure
 * predicate precisely so it can be tested without creating a worker.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  isMvpExpiryDisabled,
  runMvpExpiryTick,
  startMvpOrderExpiryScheduler,
} from "../../jobs/mvp-order-expiry-scheduler.js";

const ORIGINAL_OFF = process.env.MVP_ORDER_EXPIRY_SCHEDULER;

function restore() {
  if (ORIGINAL_OFF === undefined) delete process.env.MVP_ORDER_EXPIRY_SCHEDULER;
  else process.env.MVP_ORDER_EXPIRY_SCHEDULER = ORIGINAL_OFF;
}

afterEach(restore);

describe("MVP expiry scheduler", () => {
  test("only the exact value 'off' opts the sweep out", () => {
    expect(isMvpExpiryDisabled({})).toBe(false);
    expect(isMvpExpiryDisabled({ MVP_ORDER_EXPIRY_SCHEDULER: "off" })).toBe(true);
    expect(isMvpExpiryDisabled({ MVP_ORDER_EXPIRY_SCHEDULER: "  OFF  " })).toBe(true);
    // Everything else keeps the sweeper running: stock must not be stranded
    // because someone wrote `0`, `false` or `off!`.
    for (const value of ["", "0", "false", "nope", "off-duty"]) {
      expect(
        isMvpExpiryDisabled({ MVP_ORDER_EXPIRY_SCHEDULER: value }),
        JSON.stringify(value),
      ).toBe(false);
    }
  });

  test("the starter starts nothing once the operator has opted out", () => {
    process.env.MVP_ORDER_EXPIRY_SCHEDULER = "off";
    expect(startMvpOrderExpiryScheduler(60_000)).toBeNull();
  });

  test("the tick and the starter are both exported for a cron/manual caller", () => {
    expect(typeof runMvpExpiryTick).toBe("function");
    expect(typeof startMvpOrderExpiryScheduler).toBe("function");
    expect(typeof isMvpExpiryDisabled).toBe("function");
  });
});
