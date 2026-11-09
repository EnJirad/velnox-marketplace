/**
 * Schema-gap fallback regression tests.
 *
 * The production bug: `fetchShipmentsForOrder()` selected the new tracking
 * columns without a fallback, so on a not-yet-reconciled database PostgreSQL
 * answered 42703 (undefined_column) and the WHOLE order-detail endpoint 500'd
 * → "Failed to fetch order".
 *
 * These tests pin the fix: only a schema-gap error (42703 / 42P01) falls back
 * to the legacy projection; any OTHER database error is rethrown (a genuine
 * failure must never be masked as "success with no data").
 *
 * NO `mock.module` HERE — DELIBERATELY.
 * -------------------------------------
 * The first version of this file replaced `../db/index.js` with a stub. Bun's
 * `mock.module` is PROCESS-GLOBAL and cannot be undone reliably (`mock.restore()`
 * and re-registering the real module both left the stub in place on Bun 1.4.4),
 * and Bun runs every test file in one process. The result was a cascade: every
 * DB-gated file that ran after this one got the stub, so `withTransaction` handed
 * callers `{}` and the far-away symptom was `client.query is not a function`
 * (plus a wave of unexpected 400/422/500 responses) — while each file passed on
 * its own. Reproduced locally: this file followed by
 * `payment-attempt-identity.test.ts` produced exactly those six failures.
 *
 * The readers therefore accept an injected `run` (default: the real `query`), and
 * these tests pass a fake. Nothing global is mutated, so no other file can inherit
 * this file's fixtures.
 */
import { describe, expect, test } from "bun:test";

import { fetchShipmentsForOrder } from "../lib/order-read.js";
import { getShipmentForOrder } from "../lib/tracking/shipment-repo.js";

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

function schemaGapError(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = "42703";
  return err;
}

describe("fetchShipmentsForOrder — schema-gap fallback", () => {
  test("extended projection works on a reconciled schema", async () => {
    const shipRow = {
      id: "s1",
      order_id: "o1",
      carrier: "J&T Express",
      carrier_code: "JT",
      tracking_number: "TH123456789012345",
      status: "in_transit",
      estimated_delivery_date: "2026-11-10",
      original_status: "In Transit",
      last_checked_at: new Date("2026-11-08T10:00:00Z"),
      last_error: null,
      tracking_confirmed: true,
    };
    const run: QueryFn = async () => ({ rows: [shipRow] });
    const res = await fetchShipmentsForOrder("o1", run);
    expect(res).toHaveLength(1);
    expect(res[0]!.carrierCode).toBe("JT");
    expect(res[0]!.lastCheckedAt).toBe("2026-11-08T10:00:00.000Z");
    expect(res[0]!.trackingConfirmed).toBe(true);
  });

  test("schema-gap (42703) on the shipments SELECT falls back to the legacy projection", async () => {
    const calls: string[] = [];
    const run: QueryFn = async (sql: string) => {
      calls.push(sql);
      if (calls.length === 1) throw schemaGapError("column s.carrier_code does not exist");
      if (calls.length === 2) {
        return {
          rows: [
            {
              id: "s1",
              order_id: "o1",
              carrier: "J&T Express",
              tracking_number: "TH123456789012345",
              status: "in_transit",
              estimated_delivery_date: "2026-11-10",
            },
          ],
        };
      }
      return { rows: [] }; // events
    };
    const res = await fetchShipmentsForOrder("o1", run);
    expect(res).toHaveLength(1);
    // Legacy projection: new fields are absent → null/false, never throws.
    expect(res[0]!.carrierCode).toBeNull();
    expect(res[0]!.lastCheckedAt).toBeNull();
    expect(res[0]!.lastError).toBeNull();
    expect(res[0]!.trackingConfirmed).toBe(false);
    expect(calls[0]!.includes("s.carrier_code")).toBe(true);
    expect(calls[1]!.includes("s.carrier_code")).toBe(false); // legacy SQL used
  });

  test("schema-gap (42703) on the events SELECT falls back and still returns events", async () => {
    let call = 0;
    const run: QueryFn = async () => {
      call += 1;
      if (call === 1) {
        return {
          rows: [
            {
              id: "s1",
              order_id: "o1",
              carrier: "TNT Express",
              tracking_number: "856719638",
              status: "delivered",
              estimated_delivery_date: null,
            },
          ],
        };
      }
      if (call === 2) throw schemaGapError("column te.carrier_status does not exist");
      return {
        rows: [
          {
            id: "e1",
            shipment_id: "s1",
            status: "delivered",
            description: "Delivered",
            location: "Bangkok",
            occurred_at: new Date("2026-11-08T10:00:00Z"),
          },
        ],
      };
    };
    const res = await fetchShipmentsForOrder("o1", run);
    expect(res[0]!.events).toHaveLength(1);
    expect(res[0]!.events[0]!.status).toBe("delivered");
    expect(res[0]!.events[0]!.originalStatus).toBeNull();
  });

  test("a NON-schema database error is rethrown — never masked as an empty order", async () => {
    const run: QueryFn = async () => {
      const err = new Error("connection refused") as Error & { code?: string };
      err.code = "ECONNREFUSED"; // not a schema-gap code
      throw err;
    };
    await expect(fetchShipmentsForOrder("o1", run)).rejects.toThrow(/connection refused/);
  });
});

describe("getShipmentForOrder (tracking repo) — schema-gap fallback", () => {
  test("falls back to the legacy projection on 42703 and maps nulls safely", async () => {
    let call = 0;
    const run: QueryFn = async () => {
      call += 1;
      if (call === 1) throw schemaGapError("column carrier_code does not exist");
      return {
        rows: [
          {
            id: "s1",
            order_id: "o1",
            carrier: "Flash Express",
            tracking_number: "1234567890123",
            status: "created",
            estimated_delivery_date: null,
            shipped_at: null,
            delivered_at: null,
            created_at: new Date(),
            updated_at: new Date(),
          },
        ],
      };
    };
    const row = await getShipmentForOrder("o1", run);
    expect(row).not.toBeNull();
    expect(row!.carrierCode).toBeNull();
    expect(row!.trackingConfirmed).toBe(false);
    expect(row!.status).toBe("created");
  });
});
