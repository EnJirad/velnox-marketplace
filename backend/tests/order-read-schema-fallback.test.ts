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
 * Uses `bun:test` module mocking — no real DB, no network.
 */
import { describe, expect, mock, test } from "bun:test";

type QueryFn = (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;

/** Register a mocked `db/index.js` BEFORE importing the readers under test. */
function mockDbIndex(next: QueryFn) {
  mock.module("../db/index.js", () => ({
    query: next,
    withTransaction: async (fn: (c: unknown) => Promise<unknown>) => fn({}),
  }));
}

function schemaGapError(message: string): Error & { code: string } {
  const err = new Error(message) as Error & { code: string };
  err.code = "42703";
  return err;
}

import type { fetchShipmentsForOrder as FetchOrders } from "../lib/order-read.js";
import type { getShipmentForOrder as GetShipmentRepo } from "../lib/tracking/shipment-repo.js";

async function freshModules(): Promise<{
  fetchShipmentsForOrder: FetchOrders;
  getShipmentForOrderRepo: GetShipmentRepo;
}> {
  const orderRead = await import("../lib/order-read.js");
  const repo = await import("../lib/tracking/shipment-repo.js");
  return { fetchShipmentsForOrder: orderRead.fetchShipmentsForOrder, getShipmentForOrderRepo: repo.getShipmentForOrder };
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
    mockDbIndex(async () => ({ rows: [shipRow] }));
    const { fetchShipmentsForOrder } = await freshModules();
    const res = await fetchShipmentsForOrder("o1");
    expect(res).toHaveLength(1);
    expect(res[0]!.carrierCode).toBe("JT");
    expect(res[0]!.lastCheckedAt).toBe("2026-11-08T10:00:00.000Z");
    expect(res[0]!.trackingConfirmed).toBe(true);
  });

  test("schema-gap (42703) on the shipments SELECT falls back to the legacy projection", async () => {
    const calls: string[] = [];
    mockDbIndex(async (sql: string) => {
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
    });
    const { fetchShipmentsForOrder } = await freshModules();
    const res = await fetchShipmentsForOrder("o1");
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
    mockDbIndex(async (sql: string) => {
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
    });
    const { fetchShipmentsForOrder } = await freshModules();
    const res = await fetchShipmentsForOrder("o1");
    expect(res[0]!.events).toHaveLength(1);
    expect(res[0]!.events[0]!.status).toBe("delivered");
    expect(res[0]!.events[0]!.originalStatus).toBeNull();
  });

  test("a NON-schema database error is rethrown — never masked as an empty order", async () => {
    mockDbIndex(async () => {
      const err = new Error("connection refused") as Error & { code?: string };
      err.code = "ECONNREFUSED"; // not a schema-gap code
      throw err;
    });
    const { fetchShipmentsForOrder } = await freshModules();
    await expect(fetchShipmentsForOrder("o1")).rejects.toThrow(/connection refused/);
  });
});

describe("getShipmentForOrder (tracking repo) — schema-gap fallback", () => {
  test("falls back to the legacy projection on 42703 and maps nulls safely", async () => {
    let call = 0;
    mockDbIndex(async () => {
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
    });
    const { getShipmentForOrderRepo } = await freshModules();
    const row = await getShipmentForOrderRepo("o1");
    expect(row).not.toBeNull();
    expect(row!.carrierCode).toBeNull();
    expect(row!.trackingConfirmed).toBe(false);
    expect(row!.status).toBe("created");
  });
});
