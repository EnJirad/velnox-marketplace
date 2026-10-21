/**
 * MVP expiry scheduler — the FAIL-CLOSED half.
 *
 * The sweep itself is covered where it belongs (`admin.test.ts` drives the
 * endpoint against a real database). What matters here is that the background
 * worker cannot be created in an environment that has not opted into the MVP
 * tree, because a worker is the one thing a production service would run without
 * anyone clicking anything.
 *
 * These assertions need no database: they only inspect what the starter does
 * with its environment.
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  runMvpExpiryTick,
  startMvpOrderExpiryScheduler,
} from "../../jobs/mvp-order-expiry-scheduler.js";

const ORIGINAL_FLAG = process.env.MVP_API_ENABLED;
const ORIGINAL_OFF = process.env.MVP_ORDER_EXPIRY_SCHEDULER;

function restore() {
  if (ORIGINAL_FLAG === undefined) delete process.env.MVP_API_ENABLED;
  else process.env.MVP_API_ENABLED = ORIGINAL_FLAG;
  if (ORIGINAL_OFF === undefined) delete process.env.MVP_ORDER_EXPIRY_SCHEDULER;
  else process.env.MVP_ORDER_EXPIRY_SCHEDULER = ORIGINAL_OFF;
}

afterEach(restore);

describe("MVP expiry scheduler", () => {
  test("does not start when MVP_API_ENABLED is unset or not exactly 'true'", () => {
    for (const value of [undefined, "", "false", "1", "TRUE ", "yes"]) {
      if (value === undefined) delete process.env.MVP_API_ENABLED;
      else process.env.MVP_API_ENABLED = value;
      expect(startMvpOrderExpiryScheduler(60_000), `MVP_API_ENABLED=${value ?? "<unset>"}`).toBeNull();
    }
  });

  test("starts nothing when the operator disables it explicitly", () => {
    process.env.MVP_API_ENABLED = "true";
    process.env.MVP_ORDER_EXPIRY_SCHEDULER = "off";
    expect(startMvpOrderExpiryScheduler(60_000)).toBeNull();
  });

  test("the tick and the starter are both exported for a cron/manual caller", () => {
    expect(typeof runMvpExpiryTick).toBe("function");
    expect(typeof startMvpOrderExpiryScheduler).toBe("function");
  });
});
