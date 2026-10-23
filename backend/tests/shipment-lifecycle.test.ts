/**
 * SHIPMENT LIFECYCLE — the states, the moves, and who may make them (Phase 3).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE GAP THIS FILE CLOSES
 * ------------------------
 * The repository already had a canonical shipment vocabulary and no way to MOVE
 * a shipment through it. `ensureShipmentForShipping()` (`lib/order-fulfillment.ts`)
 * was the only writer that ever touched `shipments.status`, and it only ever
 * wrote `created`. `picked_up`, `in_transit`, `out_for_delivery` and `delivered`
 * were declared by the database and reachable by nothing.
 *
 * Phase 3 adds ONE transition helper (`lib/order-shipment.ts`) plus the state
 * machine it reads (`lib/order-shipment-states.ts`), and this file pins what it
 * must and must not do:
 *
 *   1. THE VOCABULARY IS THE DATABASE'S. Not invented here: the nine statuses
 *      are compared against `shipments_status_check` as declared in the
 *      migration, the canonical schema AND the SQL-Editor bootstrap. A divergent
 *      copy fails the suite instead of production (the failure class
 *      `schema-drift.test.ts` was written for).
 *   2. THE TRANSITIONS ARE THE DECLARED EDGES. The happy path walks end to end;
 *      every backward move, every forward SKIP, every move out of a terminal
 *      state, and any move into `returned` (the returns/RMA flow's value) is
 *      refused.
 *   3. ONE HELPER, ONE WRITER. Both surfaces call the same helper, no route
 *      writes `shipments` inline, and the helper never writes `orders.status`
 *      itself — the order moves only through the order-state authority.
 *   4. THE COLUMNS EXIST. Every `shipments` column the helper touches is read out
 *      of its own source and checked against the canonical schema, so the
 *      "column … does not exist" drift cannot come back through this feature.
 *
 * Sections 5-9 need a real database (`TEST_DATABASE_URL`) and SKIP without one —
 * including the concurrency proof, which is only ever a real two-transaction race
 * and never an in-memory imitation.
 */
import { describe, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Express } from "express";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";

import { query, withTransaction } from "../db/index.js";
import { FulfillmentError } from "../lib/order-fulfillment.js";
import { axesForFulfillmentStatus, projectOrderStatus } from "../lib/order-state.js";
import {
  SHIPMENT_STATUSES,
  SHIPMENT_TRANSITIONS,
  TERMINAL_SHIPMENT_STATUSES,
  canTransitionShipment,
  isShipmentStatus,
  isTerminalShipmentStatus,
  type ShipmentStatus,
} from "../lib/order-shipment-states.js";
import { transitionShipment } from "../lib/order-shipment.js";
import { setupCenterRoutes } from "../routes/center.js";
import { setupSellerOrderRoutes } from "../routes/seller-orders.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const testFn = hasTestDatabase() ? test : test.skip;
const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const SHIPMENT_STATES_LIB = "backend/lib/order-shipment-states.ts";
const SHIPMENT_LIB = "backend/lib/order-shipment.ts";
const ORDER_STATE_LIB = "backend/lib/order-state.ts";
const SELLER_ROUTE = "backend/routes/seller-orders.ts";
const CENTER_ROUTE = "backend/routes/center.ts";
const SCHEMA = "db/schema.sql";
const RECONCILER = "db/run-sqleditor.sql";
const MIGRATION_056 = "db/migrations/056_commerce_core_invariants.sql";

/**
 * The statuses the database accepts, scraped from the CHECK constraint as each
 * of the three SQL files declares it — so a change to any one copy is visible
 * here rather than at runtime.
 */
function declaredStatuses(sql: string): string[] {
  // Anchored to the CONSTRAINT ITSELF (`shipments_status_check`), not to the
  // first `CHECK (status IN …)` in the file — several tables in this schema have
  // a column called `status`, and a loose pattern happily matches a payment one.
  const match = sql.match(
    /ALTER TABLE shipments ADD CONSTRAINT shipments_status_check\s+CHECK \(status IN \(([^)]*)\)\)/,
  );
  expect(match, "the shipments_status_check vocabulary was not found").not.toBeNull();
  return [...match![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]!);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The vocabulary is the database's own — and does not drift
// ═══════════════════════════════════════════════════════════════════════════

describe("the shipment vocabulary comes from the database, not from this module", () => {
  test("every SQL copy declares the SAME nine statuses", () => {
    const fromMigration = declaredStatuses(read(MIGRATION_056));
    const fromSchema = declaredStatuses(read(SCHEMA));
    const fromReconciler = declaredStatuses(read(RECONCILER));

    expect(fromMigration.length).toBeGreaterThan(0);
    expect(fromSchema).toEqual(fromMigration);
    expect(fromReconciler).toEqual(fromMigration);
  });

  test("the state machine's vocabulary IS that list, and nothing else", () => {
    const declared = declaredStatuses(read(MIGRATION_056));
    // Set equality both ways: no status in the code the database would reject
    // (`23514` at write time), and no status the database accepts that the
    // machine cannot name.
    expect([...SHIPMENT_STATUSES].sort()).toEqual([...declared].sort());
    for (const status of declared) expect(isShipmentStatus(status)).toBe(true);
    expect(isShipmentStatus("packed")).toBe(false);
    expect(isShipmentStatus("ready_to_ship")).toBe(false);
    expect(isShipmentStatus("")).toBe(false);
    expect(isShipmentStatus(null)).toBe(false);
  });

  test("each terminal status is terminal, and no other status is", () => {
    for (const status of SHIPMENT_STATUSES) {
      const terminal = (TERMINAL_SHIPMENT_STATUSES as readonly string[]).includes(status);
      expect(isTerminalShipmentStatus(status), status).toBe(terminal);
      // Terminal ⇔ no outgoing edge. A terminal status WITH an edge, or a
      // non-terminal one WITHOUT any, is a machine that lies about itself.
      expect(SHIPMENT_TRANSITIONS[status].length === 0, status).toBe(terminal);
    }
    expect([...TERMINAL_SHIPMENT_STATUSES].sort()).toEqual([
      "cancelled",
      "delivered",
      "lost",
      "returned",
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The transitions — valid, invalid, backward, terminal
// ═══════════════════════════════════════════════════════════════════════════

describe("the shipment lifecycle rules", () => {
  /** The forward-only chain the machine declares, walked end to end. */
  const CHAIN = [
    "pending",
    "created",
    "picked_up",
    "in_transit",
    "out_for_delivery",
    "delivered",
  ] as const;

  test("every FORWARD step (and only those) is valid transit", () => {
    for (let i = 0; i < CHAIN.length - 1; i += 1) {
      const from = CHAIN[i]!;
      const to = CHAIN[i + 1]!;
      expect(canTransitionShipment(from, to), `${from} → ${to}`).toBe(true);
      // …and it is not valid backwards.
      expect(canTransitionShipment(to, from), `${to} → ${from}`).toBe(false);
    }
  });

  test("a forward SKIP is refused (no state may be jumped over)", () => {
    expect(canTransitionShipment("created", "in_transit")).toBe(false);
    expect(canTransitionShipment("created", "delivered")).toBe(false);
    expect(canTransitionShipment("pending", "picked_up")).toBe(false);
    expect(canTransitionShipment("picked_up", "delivered")).toBe(false);
  });

  test("no move leaves a terminal state — the backward moves that matter most", () => {
    expect(canTransitionShipment("delivered", "created")).toBe(false);
    expect(canTransitionShipment("delivered", "shipped")).toBe(false);
    expect(canTransitionShipment("delivered", "in_transit")).toBe(false);
    expect(canTransitionShipment("delivered", "delivered")).toBe(false);
    expect(canTransitionShipment("cancelled", "created")).toBe(false);
    expect(canTransitionShipment("lost", "in_transit")).toBe(false);
    expect(canTransitionShipment("returned", "delivered")).toBe(false);
  });

  test("a repeat is NOT a machine edge (the helper answers it as an idempotent success)", () => {
    // A self-edge would make `delivered → delivered` a state change and re-stamp
    // a timestamp; the table deliberately has none, and the helper checks
    // equality BEFORE consulting it.
    for (const status of SHIPMENT_STATUSES) {
      expect(canTransitionShipment(status, status)).toBe(false);
    }
  });

  test("a parcel can be abandoned or lost at any point BEFORE it is delivered", () => {
    for (const from of ["pending", "created", "picked_up", "in_transit", "out_for_delivery"] as const) {
      expect(canTransitionShipment(from, "cancelled"), `${from} → cancelled`).toBe(true);
      expect(canTransitionShipment(from, "lost"), `${from} → lost`).toBe(true);
      // …but never when there is nothing left to abandon.
      expect(canTransitionShipment(from, "returned"), `${from} → returned`).toBe(false);
    }
    expect(canTransitionShipment("delivered", "cancelled")).toBe(false);
  });

  test("`returned` is unreachable: the returns/RMA flow owns it, not this machine", () => {
    for (const from of SHIPMENT_STATUSES) {
      expect(canTransitionShipment(from, "returned"), `${from} → returned`).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. One helper, one writer, no duplicate state machine, no invented columns
// ═══════════════════════════════════════════════════════════════════════════

/** Every column the canonical `shipments` table really has. */
function canonicalShipmentColumns(): Set<string> {
  const schema = read(SCHEMA);
  const columns = new Set<string>();
  const start = schema.indexOf("CREATE TABLE IF NOT EXISTS shipments");
  const block = schema.slice(start, schema.indexOf(");", start));
  for (const line of block.split("\n").slice(1)) {
    const name = line.trim().split(/\s+/)[0];
    if (name && /^[a-z_]+$/.test(name)) columns.add(name);
  }
  for (const m of schema.matchAll(/ALTER TABLE shipments ADD COLUMN IF NOT EXISTS ([a-z_]+)/g)) {
    columns.add(m[1]!);
  }
  expect(columns.size).toBeGreaterThan(5);
  return columns;
}

describe("one helper, one writer, no duplicate machine", () => {
  test("both surfaces import the SAME helper and write no shipment SQL of their own", () => {
    for (const file of [SELLER_ROUTE, CENTER_ROUTE]) {
      const src = read(file);
      expect(src, `${file} must call the transition helper`).toContain(
        "from \"../lib/order-shipment.js\"",
      );
      // A route that ran its own UPDATE/INSERT against `shipments` would be a
      // second shipment system — exactly what Phase 3 must not create.
      const shipmentWrites = [...src.matchAll(/\b(?:INSERT INTO|UPDATE)\s+shipments\b/g)];
      expect(shipmentWrites.length, `${file} writes shipments directly`).toBe(0);
    }
  });

  test("the helper never writes `orders.status` on its own — the axis writer does", () => {
    const src = read(SHIPMENT_LIB);
    // No direct order write anywhere in the transition path…
    expect([...src.matchAll(/\bUPDATE\s+orders\b/g)].length).toBe(0);
    // …it asks the order-state authority instead (Phase-1 authority preserved).
    expect(src).toContain("advanceOrderFulfillmentAxis");
    const stateLib = read(ORDER_STATE_LIB);
    // …and that writer decides with the CANONICAL fulfilment machine and records
    // with the CANONICAL projection, rather than re-implementing either.
    expect(stateLib).toContain("canTransitionFulfillment");
    expect(stateLib).toContain("projectOrderStatus");
    expect(stateLib).toContain("axesForFulfillmentStatus");
  });

  test("the helper reuses the ONE existing creation path (Phase-2 invariant intact)", () => {
    const src = read(SHIPMENT_LIB);
    expect(src).toContain("ensureShipmentForShipping");
    // The row is created by that function alone, so `shipments_order_id_unique`
    // and its `ON CONFLICT (order_id)` arbitration still arbitrate. (`\s*\(`
    // so a sentence ABOUT the statement is not mistaken for the statement.)
    expect([...src.matchAll(/INSERT INTO shipments\s*\(/g)].length).toBe(0);
    // …and the Phase-2 arbitration that writer infers is still declared.
    expect(read(SCHEMA)).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS shipments_order_id_unique ON shipments (order_id);",
    );
  });

  test("every shipments column the helper touches EXISTS in the canonical schema", () => {
    const src = read(SHIPMENT_LIB);
    const selectStart = src.indexOf("SELECT id, carrier");
    expect(selectStart, "the helper's shipment read was not found").toBeGreaterThan(-1);
    const selectCols = src
      .slice(selectStart, src.indexOf("FROM shipments", selectStart))
      .replace("SELECT", "")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean);
    // The UPDATE's assignments come from `add(...)` callbacks, so read them off
    // the source the same way: `col = COALESCE(...)`, `col = NOW()`, `col = $n`.
    const updateCols = [...src.matchAll(/([a-z_]+)\s*=\s*(?:COALESCE\(|NOW\(\)|\$\d)/g)].map(
      (m) => m[1]!,
    );

    expect(selectCols.length).toBeGreaterThan(0);
    expect(updateCols.length).toBeGreaterThan(0);
    // Non-vacuous: the migration's own two timestamps must be in the set.
    expect([...selectCols, ...updateCols]).toContain("shipped_at");
    expect([...selectCols, ...updateCols]).toContain("delivered_at");

    const canonical = canonicalShipmentColumns();
    const missing = [...selectCols, ...updateCols].filter((c) => !canonical.has(c));
    expect(missing, `columns absent from db/schema.sql: ${missing.join(", ")}`).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4-9. Real database (requires TEST_DATABASE_URL)
// ═══════════════════════════════════════════════════════════════════════════

describe("the shipment lifecycle against a real database (requires TEST_DATABASE_URL)", () => {
  /** A customer, an order in `status`, and nothing else. */
  async function orderFixture(status = "packing") {
    const tag = `shiplc-${randomUUID().slice(0, 8)}`;
    const user = await query(
      `INSERT INTO users (email, name) VALUES ($1, 'Shipment Lifecycle') RETURNING id`,
      [`${tag}@test.local`],
    );
    const userId = user.rows[0].id as string;
    const order = await query(
      `INSERT INTO orders (user_id, status, total_amount, currency) VALUES ($1, $2, 100, 'THB') RETURNING id`,
      [userId, status],
    );
    return { userId, orderId: order.rows[0].id as string };
  }

  /** Write an order the way a real transition would: axes, then the projection. */
  async function setOrderFulfillment(orderId: string, status: string, paymentState = "paid") {
    const axes = axesForFulfillmentStatus(status as never);
    const projection = projectOrderStatus({ paymentState, ...axes });
    await query(
      `UPDATE orders SET status = $2, order_state = $3, fulfillment_status = $4 WHERE id = $1`,
      [orderId, projection, axes.orderState, axes.fulfillmentStatus],
    );
  }

  async function shipmentRow(orderId: string) {
    const res = await query(
      `SELECT id, carrier, tracking_number, status, shipped_at, delivered_at
         FROM shipments WHERE order_id = $1`,
      [orderId],
    );
    return res.rows as Array<{
      id: string;
      carrier: string;
      tracking_number: string | null;
      status: string;
      shipped_at: Date | null;
      delivered_at: Date | null;
    }>;
  }

  async function orderRow(orderId: string) {
    const res = await query(
      `SELECT status, order_state, fulfillment_status FROM orders WHERE id = $1`,
      [orderId],
    );
    return res.rows[0] as { status: string; order_state: string; fulfillment_status: string };
  }

  const drive = (orderId: string, to: ShipmentStatus, input?: Record<string, unknown>) =>
    withTransaction((client) => transitionShipment(client, orderId, to, input));

  /** The refusal a call produced, or null when it succeeded. */
  async function refusal(promise: Promise<unknown>) {
    try {
      await promise;
      return null;
    } catch (err) {
      if (err instanceof FulfillmentError) return { status: err.status, code: err.code };
      throw err;
    }
  }

  // ── 4. Creation through the EXISTING writer, and idempotency ─────────────

  testFn(
    "Test 1 — `created` materialises the parcel through the existing writer, and a repeat is a no-op",
    async () => {
      const { userId, orderId } = await orderFixture("packing");
      try {
        // No carrier/tracking → the existing creation refusal, and nothing written.
        expect(await refusal(drive(orderId, "created"))).toEqual({
          status: 400,
          code: "SHIPMENT_REQUIRED",
        });
        expect((await shipmentRow(orderId)).length).toBe(0);

        const first = await drive(orderId, "created", {
          carrier: "Kerry",
          trackingNumber: "K-1",
        });
        expect(first).toMatchObject({ from: "created", to: "created", moved: false });
        expect((await shipmentRow(orderId)).length).toBe(1);

        // The repeat: same status, no write, no timestamp movement.
        const before = (await shipmentRow(orderId))[0]!;
        const repeat = await drive(orderId, "created", {
          carrier: "Flash",
          trackingNumber: "F-9",
        });
        expect(repeat.moved).toBe(false);
        const after = (await shipmentRow(orderId))[0]!;
        expect(after.id).toBe(before.id);
        expect(after.carrier).toBe("Kerry");
        expect(after.tracking_number).toBe("K-1");
        expect((await shipmentRow(orderId)).length).toBe(1);
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  // ── 5. The whole chain, timestamps, and tracking preservation ────────────

  testFn(
    "Test 2 — the chain walks end to end; timestamps are stamped ONCE and tracking survives every step",
    async () => {
      const { userId, orderId } = await orderFixture("packing");
      try {
        await drive(orderId, "created", { carrier: "Kerry", trackingNumber: "K-100" });

        const pickedUp = await drive(orderId, "picked_up");
        expect(pickedUp.moved).toBe(true);
        const afterPickup = (await shipmentRow(orderId))[0]!;
        expect(afterPickup.status).toBe("picked_up");
        expect(afterPickup.shipped_at).not.toBeNull();
        expect(afterPickup.delivered_at).toBeNull();

        for (const step of ["in_transit", "out_for_delivery"] as const) {
          await drive(orderId, step);
        }
        const delivered = await drive(orderId, "delivered");
        expect(delivered.moved).toBe(true);

        const final = (await shipmentRow(orderId))[0]!;
        expect(final.status).toBe("delivered");
        expect(final.delivered_at).not.toBeNull();
        // `shipped_at` is NOT re-stamped by the later steps — it is the moment of
        // handoff, and nothing after it may move it.
        expect(final.shipped_at!.toISOString()).toBe(afterPickup.shipped_at!.toISOString());
        // The tracking data survived every transition, unchanged.
        expect(final.carrier).toBe("Kerry");
        expect(final.tracking_number).toBe("K-100");
        expect((await shipmentRow(orderId)).length).toBe(1);
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  testFn(
    "Test 3 — a later transition cannot overwrite the carrier or the tracking number",
    async () => {
      const { userId, orderId } = await orderFixture("packing");
      try {
        await drive(orderId, "created", { carrier: "Kerry", trackingNumber: "K-100" });
        const stampedShippedAt = (await drive(orderId, "picked_up")).shipment.shippedAt!;

        // A caller that supplies DIFFERENT details mid-flight: the stored pair wins.
        await drive(orderId, "in_transit", { carrier: "Flash", trackingNumber: "F-1" });
        const row = (await shipmentRow(orderId))[0]!;
        expect(row.carrier).toBe("Kerry");
        expect(row.tracking_number).toBe("K-100");
        expect(row.shipped_at!.toISOString()).toBe(stampedShippedAt.toISOString());

        // …and a repeat of the arrival cannot re-stamp `delivered_at`.
        await drive(orderId, "out_for_delivery");
        const firstDelivery = await drive(orderId, "delivered");
        const replay = await drive(orderId, "delivered");
        expect(replay.moved).toBe(false);
        const after = (await shipmentRow(orderId))[0]!;
        expect(after.delivered_at!.toISOString()).toBe(
          firstDelivery.shipment.deliveredAt!.toISOString(),
        );
        expect(after.shipped_at!.toISOString()).toBe(stampedShippedAt.toISOString());
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  testFn(
    "Test 4 — a shipment cannot be handed over without a carrier and a tracking number",
    async () => {
      const { userId, orderId } = await orderFixture("packing");
      try {
        // A legacy row with a carrier but NO tracking number.
        await query(
          `INSERT INTO shipments (order_id, carrier, tracking_number, status)
           VALUES ($1, 'Kerry', NULL, 'created')`,
          [orderId],
        );
        expect(await refusal(drive(orderId, "picked_up"))).toEqual({
          status: 400,
          code: "SHIPMENT_REQUIRED",
        });
        const refusedRow = (await shipmentRow(orderId))[0]!;
        expect(refusedRow.status).toBe("created");
        expect(refusedRow.shipped_at).toBeNull();

        // Supplying the missing half IN the handoff request satisfies it — the
        // request fills the gap rather than the operator needing two calls.
        const handedOver = await drive(orderId, "picked_up", { trackingNumber: "K-500" });
        expect(handedOver.moved).toBe(true);
        const row = (await shipmentRow(orderId))[0]!;
        expect(row.status).toBe("picked_up");
        expect(row.tracking_number).toBe("K-500");
        expect(row.carrier).toBe("Kerry");
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  testFn(
    "Test 5 — invalid, backward and terminal transitions are REFUSED with the project's own error",
    async () => {
      const { userId, orderId } = await orderFixture("packing");
      try {
        await drive(orderId, "created", { carrier: "Kerry", trackingNumber: "K-1" });

        // A forward skip.
        expect(await refusal(drive(orderId, "delivered"))).toEqual({
          status: 409,
          code: "INVALID_SHIPMENT_TRANSITION",
        });
        // `returned` is not this machine's edge.
        expect(await refusal(drive(orderId, "returned"))).toEqual({
          status: 409,
          code: "INVALID_SHIPMENT_TRANSITION",
        });
        expect((await shipmentRow(orderId))[0]!.status).toBe("created");

        await drive(orderId, "picked_up");
        await drive(orderId, "in_transit");
        await drive(orderId, "out_for_delivery");
        await drive(orderId, "delivered");

        // Backward, from a terminal state.
        expect(await refusal(drive(orderId, "created"))).toEqual({
          status: 409,
          code: "INVALID_SHIPMENT_TRANSITION",
        });
        expect(await refusal(drive(orderId, "in_transit"))).toEqual({
          status: 409,
          code: "INVALID_SHIPMENT_TRANSITION",
        });
        const row = (await shipmentRow(orderId))[0]!;
        expect(row.status).toBe("delivered");
        expect(row.delivered_at).not.toBeNull();

        // An order that has no parcel at all cannot be moved into the middle of
        // the lifecycle either.
        const empty = await orderFixture("packing");
        try {
          expect(await refusal(drive(empty.orderId, "picked_up"))).toEqual({
            status: 404,
            code: "SHIPMENT_NOT_FOUND",
          });
          // …and an order that does not exist is a 404 from the lock itself.
          expect(await refusal(drive(randomUUID(), "created", { carrier: "A", trackingNumber: "B" }))).toEqual(
            { status: 404, code: "NOT_FOUND" },
          );
        } finally {
          await purgeUsers([empty.userId]);
        }
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  // ── 6. Order fulfilment integration ─────────────────────────────────────

  testFn(
    "Test 6 — the handoff and the arrival move the ORDER through its own machine, and only then",
    async () => {
      const { userId, orderId } = await orderFixture("packing");
      try {
        await setOrderFulfillment(orderId, "packing");
        await drive(orderId, "created", { carrier: "Kerry", trackingNumber: "K-1" });

        // `pending`/`created` are NOT an order fact: the order stays where it was.
        expect(await orderRow(orderId)).toMatchObject({ fulfillment_status: "packing" });

        // The handoff IS the order's `shipped`.
        const handoff = await drive(orderId, "picked_up");
        expect(handoff.orderAdvanced).toBe(true);
        const shipped = await orderRow(orderId);
        expect(shipped.fulfillment_status).toBe("shipped");
        expect(shipped.order_state).toBe("processing");
        // …and the legacy column is still the PROJECTION of the axes, not a
        // fourth opinion written by the shipment code.
        expect(shipped.status).toBe("shipped");
        expect(
          projectOrderStatus({
            paymentState: "paid",
            orderState: shipped.order_state,
            fulfillmentStatus: shipped.fulfillment_status,
          }),
        ).toBe(shipped.status);

        // The intermediate parcel hops imply nothing new — the order is already
        // there, so they advance nothing and are still accepted.
        for (const step of ["in_transit", "out_for_delivery"] as const) {
          const hop = await drive(orderId, step);
          expect(hop.orderAdvanced).toBe(false);
        }

        // The arrival IS the order's `delivered`.
        const arrival = await drive(orderId, "delivered");
        expect(arrival.orderAdvanced).toBe(true);
        const delivered = await orderRow(orderId);
        expect(delivered.fulfillment_status).toBe("delivered");
        expect(delivered.status).toBe("delivered");
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  testFn(
    "Test 7 — a parcel move the ORDER has no edge for is refused: the systems cannot diverge",
    async () => {
      const { userId, orderId } = await orderFixture("confirmed");
      try {
        await setOrderFulfillment(orderId, "confirmed");
        await drive(orderId, "created", { carrier: "Kerry", trackingNumber: "K-1" });

        // `confirmed → shipped` is not a legal ORDER move (the machine requires
        // `packing` first), so the handoff is refused — the payment/fulfilment
        // gates of the order-status route cannot be bypassed through this one.
        expect(await refusal(drive(orderId, "picked_up"))).toEqual({
          status: 409,
          code: "ORDER_NOT_READY",
        });
        // …and the whole transaction rolled back: the parcel did not move either.
        const row = (await shipmentRow(orderId))[0]!;
        expect(row.status).toBe("created");
        expect(row.shipped_at).toBeNull();
        expect(await orderRow(orderId)).toMatchObject({
          fulfillment_status: "ready",
        });

        // Once the order reaches `packing`, the same move succeeds.
        await setOrderFulfillment(orderId, "packing");
        expect((await drive(orderId, "picked_up")).orderAdvanced).toBe(true);
        expect(await orderRow(orderId)).toMatchObject({ fulfillment_status: "shipped" });
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  testFn(
    "Test 8 — a cancelled order is not resurrected by a parcel move",
    async () => {
      const { userId, orderId } = await orderFixture("cancelled");
      try {
        await setOrderFulfillment(orderId, "cancelled");
        await drive(orderId, "created", { carrier: "Kerry", trackingNumber: "K-1" });

        expect(await refusal(drive(orderId, "picked_up"))).toEqual({
          status: 409,
          code: "ORDER_NOT_READY",
        });
        const row = await orderRow(orderId);
        expect(row.fulfillment_status).toBe("cancelled");
        expect(row.order_state).toBe("cancelled");
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  // ── 7. Concurrency: a REAL two-transaction race on one parcel ───────────

  testFn(
    "Test 9 — 8 concurrent handoffs produce ONE move, ONE timestamp and a legal final state",
    async () => {
      const { userId, orderId } = await orderFixture("packing");
      try {
        await setOrderFulfillment(orderId, "packing");
        await drive(orderId, "created", { carrier: "Kerry", trackingNumber: "K-1" });

        // Eight SEPARATE transactions (a real pool connection each), all asking
        // for the same transition at once. Nothing here is simulated in memory:
        // if the guard were a read-then-write without the order lock, more than
        // one of these would report a real move.
        const results = await Promise.all(
          Array.from({ length: 8 }, () => drive(orderId, "picked_up")),
        );

        expect(results.filter((r) => r.moved).length).toBe(1);
        expect(new Set(results.map((r) => r.to)).size).toBe(1);
        expect(results.every((r) => r.shipment.status === "picked_up")).toBe(true);
        // The order axis advanced exactly once, not once per caller.
        expect(results.filter((r) => r.orderAdvanced).length).toBe(1);

        const rows = await shipmentRow(orderId);
        expect(rows.length).toBe(1);
        expect(rows[0]!.status).toBe("picked_up");
        expect(rows[0]!.shipped_at).not.toBeNull();
        expect(rows[0]!.carrier).toBe("Kerry");
        expect(rows[0]!.tracking_number).toBe("K-1");
        expect(await orderRow(orderId)).toMatchObject({ fulfillment_status: "shipped" });
      } finally {
        await purgeUsers([userId]);
      }
    },
    60_000,
  );

  testFn(
    "Test 10 — a race that CANNOT all be legal: the skip never sneaks in, and the side effects happen once",
    async () => {
      const { userId, orderId } = await orderFixture("packing");
      try {
        await setOrderFulfillment(orderId, "packing");
        await drive(orderId, "created", { carrier: "Kerry", trackingNumber: "K-1" });

        // `delivered` is unreachable from `created` (a forward skip) AND stays
        // unreachable from `picked_up` — so those two calls must be refused no
        // matter which order the transactions acquire the lock in, while the two
        // `picked_up` calls are one real move plus one idempotent repeat. Under a
        // read-then-write without the order lock, `delivered` could have won.
        const attempts = await Promise.allSettled([
          drive(orderId, "picked_up"),
          drive(orderId, "delivered"),
          drive(orderId, "picked_up"),
          drive(orderId, "delivered"),
        ]);
        const fulfilled = attempts.filter(
          (a): a is PromiseFulfilledResult<Awaited<ReturnType<typeof drive>>> =>
            a.status === "fulfilled",
        );
        const refused = attempts.filter((a) => a.status === "rejected");

        expect(fulfilled.length).toBe(2);
        expect(refused.length).toBe(2);
        for (const r of refused as PromiseRejectedResult[]) {
          expect(r.reason).toBeInstanceOf(FulfillmentError);
          expect((r.reason as FulfillmentError).code).toBe("INVALID_SHIPMENT_TRANSITION");
        }
        // Exactly ONE of the four actually moved the parcel…
        expect(fulfilled.filter((f) => f.value.moved).length).toBe(1);
        // …and the order axis advanced exactly once with it, never once per caller.
        expect(fulfilled.filter((f) => f.value.orderAdvanced).length).toBe(1);

        const rows = await shipmentRow(orderId);
        expect(rows.length).toBe(1);
        expect(rows[0]!.status).toBe("picked_up");
        expect(rows[0]!.delivered_at).toBeNull();
        expect(rows[0]!.shipped_at).not.toBeNull();
        expect(rows[0]!.carrier).toBe("Kerry");
        expect(rows[0]!.tracking_number).toBe("K-1");
        expect(await orderRow(orderId)).toMatchObject({ fulfillment_status: "shipped" });
      } finally {
        await purgeUsers([userId]);
      }
    },
    60_000,
  );

  testFn(
    "Test 10b — a burst of legal moves settles on ONE legal state, never a mixture",
    async () => {
      const { userId, orderId } = await orderFixture("packing");
      try {
        await setOrderFulfillment(orderId, "packing");
        await drive(orderId, "created", { carrier: "Kerry", trackingNumber: "K-1" });
        await drive(orderId, "picked_up");

        // From `picked_up` several moves are individually legal (`in_transit`,
        // `lost`, and — once `in_transit` has won — `out_for_delivery`), so the
        // contract here is NOT "exactly one succeeds": it is that every caller is
        // judged against the state the previous one COMMITTED, that no caller is
        // ever answered with a transport/DB error, and that the row ends in one
        // status the machine can actually hold.
        const attempts = await Promise.allSettled([
          drive(orderId, "in_transit"),
          drive(orderId, "out_for_delivery"),
          drive(orderId, "delivered"),
          drive(orderId, "lost"),
        ]);
        for (const r of attempts as PromiseRejectedResult[]) {
          if (r.status !== "rejected") continue;
          expect(r.reason).toBeInstanceOf(FulfillmentError);
          expect((r.reason as FulfillmentError).code).toBe("INVALID_SHIPMENT_TRANSITION");
        }
        const succeeded = attempts
          .filter((a) => a.status === "fulfilled")
          .map((a) => (a as PromiseFulfilledResult<{ to: ShipmentStatus }>).value.to);
        expect(succeeded.length).toBeGreaterThan(0);

        const rows = await shipmentRow(orderId);
        expect(rows.length).toBe(1);
        const final = rows[0]!.status as ShipmentStatus;
        expect(SHIPMENT_STATUSES).toContain(final);
        expect(final).not.toBe("picked_up");
        expect(final).not.toBe("pending");
        expect(final).not.toBe("created");
        // The row's state is one a caller actually asked for and was told it got.
        expect(succeeded).toContain(final);
        expect(rows[0]!.carrier).toBe("Kerry");
        expect(rows[0]!.tracking_number).toBe("K-1");

        // The order followed the parcel through its OWN machine, and its axes
        // still project to the legacy status (no fourth opinion was written).
        const order = await orderRow(orderId);
        expect(
          projectOrderStatus({
            paymentState: "paid",
            orderState: order.order_state,
            fulfillmentStatus: order.fulfillment_status,
          }),
        ).toBe(order.status);
        expect(["shipped", "delivered", "cancelled"]).toContain(order.fulfillment_status);
      } finally {
        await purgeUsers([userId]);
      }
    },
    60_000,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 10. Authorization over the real routes (requires TEST_DATABASE_URL)
// ═══════════════════════════════════════════════════════════════════════════

describe("who may move a shipment (requires TEST_DATABASE_URL)", () => {
  /** An approved seller with a shop, a product and one order to fulfil. */
  async function sellerFixture(status = "packing") {
    const tag = `shiplc-s-${randomUUID().slice(0, 8)}`;
    const user = await query(
      `INSERT INTO users (email, name) VALUES ($1, 'Shipment Lifecycle Seller') RETURNING id`,
      [`${tag}@test.local`],
    );
    const userId = user.rows[0].id as string;
    const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [
      userId,
    ]);
    const shop = await query(
      `INSERT INTO shops (seller_id, name, slug) VALUES ($1, 'Lifecycle Shop', $2) RETURNING id`,
      [seller.rows[0].id, `${tag}-shop`],
    );
    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price) VALUES ($1, 'Lifecycle Product', $2, 100) RETURNING id`,
      [shop.rows[0].id, `${tag}-product`],
    );
    const order = await query(
      `INSERT INTO orders (user_id, status, total_amount, currency) VALUES ($1, $2, 100, 'THB') RETURNING id`,
      [userId, status],
    );
    const orderId = order.rows[0].id as string;
    await query(
      `INSERT INTO order_items (order_id, product_id, shop_id, product_name_snapshot, quantity, price, subtotal)
       VALUES ($1, $2, $3, 'Lifecycle Product', 1, 100, 100)`,
      [orderId, product.rows[0].id, shop.rows[0].id],
    );
    await query(`UPDATE orders SET order_state = 'processing', fulfillment_status = 'packing' WHERE id = $1`, [
      orderId,
    ]);
    return { userId, orderId };
  }

  /** An account whose VelCenter membership is exactly `role`. */
  async function centerFixture(role: string) {
    const tag = `shiplc-c-${randomUUID().slice(0, 8)}`;
    const user = await query(
      `INSERT INTO users (email, name, role) VALUES ($1, 'Shipment Lifecycle Center', $2) RETURNING id`,
      [`${tag}@test.local`, role],
    );
    return user.rows[0].id as string;
  }

  const JWT_SECRET = process.env.JWT_SECRET!;

  /** Drive ONE route module the way the frontends do: a real session cookie. */
  async function patchThrough(
    setup: (app: Express) => void,
    path: string,
    asUserId: string,
    body: unknown,
  ) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    setup(app);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const token = jwt.sign({ userId: asUserId, email: `${asUserId}@test.local` }, JWT_SECRET, {
        expiresIn: "1h",
      });
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: `velnox_session=${token}` },
        body: JSON.stringify(body),
      });
      const parsed = (await res.json().catch(() => ({}))) as {
        error?: { code?: string };
        data?: Record<string, unknown>;
      };
      return { status: res.status, code: parsed.error?.code, data: parsed.data };
    } finally {
      server.close();
    }
  }

  async function shipmentOf(orderId: string) {
    const res = await query(
      `SELECT id, status, carrier, tracking_number, shipped_at FROM shipments WHERE order_id = $1`,
      [orderId],
    );
    return res.rows as Array<{
      id: string;
      status: string;
      carrier: string;
      tracking_number: string | null;
      shipped_at: Date | null;
    }>;
  }

  testFn(
    "Test 11 — the owning seller drives the parcel, and the whole chain is reachable through the route",
    async () => {
      const seller = await sellerFixture();
      try {
        const created = await patchThrough(
          setupSellerOrderRoutes,
          `/api/seller/orders/${seller.orderId}/shipment`,
          seller.userId,
          { status: "created", carrier: "Kerry", trackingNumber: "K-1" },
        );
        expect(created.status).toBe(200);
        expect((await shipmentOf(seller.orderId)).length).toBe(1);

        for (const step of ["picked_up", "in_transit", "out_for_delivery", "delivered"]) {
          const res = await patchThrough(
            setupSellerOrderRoutes,
            `/api/seller/orders/${seller.orderId}/shipment`,
            seller.userId,
            { status: step },
          );
          expect(res.status, `seller → ${step}`).toBe(200);
          expect(res.data?.status).toBe(step);
        }

        const rows = await shipmentOf(seller.orderId);
        expect(rows.length).toBe(1);
        expect(rows[0]!.status).toBe("delivered");
        expect(rows[0]!.carrier).toBe("Kerry");
        expect(rows[0]!.tracking_number).toBe("K-1");
        expect(rows[0]!.shipped_at).not.toBeNull();

        // A repeat over HTTP is a success, not a conflict.
        const replay = await patchThrough(
          setupSellerOrderRoutes,
          `/api/seller/orders/${seller.orderId}/shipment`,
          seller.userId,
          { status: "delivered" },
        );
        expect(replay.status).toBe(200);
        expect(replay.data?.moved).toBe(false);
        expect((await shipmentOf(seller.orderId)).length).toBe(1);
      } finally {
        await purgeUsers([seller.userId]);
      }
    },
    30_000,
  );

  testFn(
    "Test 12 — another seller, a plain customer, and an unprivileged operator are all refused",
    async () => {
      const sellerA = await sellerFixture();
      const sellerB = await sellerFixture();
      const customer = await centerFixture("customer");
      try {
        const foreign = await patchThrough(
          setupSellerOrderRoutes,
          `/api/seller/orders/${sellerA.orderId}/shipment`,
          sellerB.userId,
          { status: "created", carrier: "Kerry", trackingNumber: "K-999" },
        );
        expect(foreign).toMatchObject({ status: 404, code: "NOT_FOUND" });
        expect((await shipmentOf(sellerA.orderId)).length).toBe(0);

        const notASeller = await patchThrough(
          setupSellerOrderRoutes,
          `/api/seller/orders/${sellerA.orderId}/shipment`,
          customer,
          { status: "created", carrier: "Kerry", trackingNumber: "K-888" },
        );
        expect(notASeller).toMatchObject({ status: 403, code: "FORBIDDEN" });

        // VelCenter: not a member at all ⇒ 403, and nothing is read or written.
        const notCenter = await patchThrough(
          setupCenterRoutes,
          `/api/admin/orders/${sellerA.orderId}/shipment`,
          customer,
          { status: "created", carrier: "Kerry", trackingNumber: "C-1" },
        );
        expect(notCenter).toMatchObject({ status: 403, code: "FORBIDDEN" });

        expect((await shipmentOf(sellerA.orderId)).length).toBe(0);
        // …and seller B's own parcel was never created either.
        expect((await shipmentOf(sellerB.orderId)).length).toBe(0);
      } finally {
        await purgeUsers([sellerA.userId, sellerB.userId, customer]);
      }
    },
    30_000,
  );

  testFn(
    "Test 13 — an authorised operator (`owner` ⇒ orders.manage) drives the parcel, and the refusal codes are the project's own",
    async () => {
      const seller = await sellerFixture();
      const owner = await centerFixture("owner");
      try {
        const bad = await patchThrough(
          setupCenterRoutes,
          `/api/admin/orders/${seller.orderId}/shipment`,
          owner,
          { status: "somewhere" },
        );
        expect(bad).toMatchObject({ status: 400, code: "VALIDATION_ERROR" });

        const created = await patchThrough(
          setupCenterRoutes,
          `/api/admin/orders/${seller.orderId}/shipment`,
          owner,
          { status: "created", carrier: "Kerry", trackingNumber: "C-1" },
        );
        expect(created.status).toBe(200);

        // A skip is refused with the machine's own code over the route too.
        const skip = await patchThrough(
          setupCenterRoutes,
          `/api/admin/orders/${seller.orderId}/shipment`,
          owner,
          { status: "delivered" },
        );
        expect(skip).toMatchObject({ status: 409, code: "INVALID_SHIPMENT_TRANSITION" });

        const handoff = await patchThrough(
          setupCenterRoutes,
          `/api/admin/orders/${seller.orderId}/shipment`,
          owner,
          { status: "picked_up" },
        );
        expect(handoff.status).toBe(200);
        expect(handoff.data?.orderAdvanced).toBe(true);
        expect((await shipmentOf(seller.orderId))[0]!.status).toBe("picked_up");
      } finally {
        await purgeUsers([seller.userId, owner]);
      }
    },
    30_000,
  );
});
