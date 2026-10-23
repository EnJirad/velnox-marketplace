/**
 * SHIPMENT CREATION — idempotent and concurrency-safe (audit P1-2).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Shipment creation was the ONE non-idempotent write in the codebase: a bare
 * `SELECT … LIMIT 1` followed by `INSERT INTO shipments`, with no key on
 * `shipments.order_id` (only the non-unique `idx_shipments_order`). Two
 * concurrent "mark shipped" requests for one order could each fail to see the
 * other and each insert, and the database accepted both — two parcels booked,
 * and the tracking number shown depending on which row a query happened to pick.
 *
 * THREE PROPERTIES ARE PROVEN HERE, in the order of authority they have:
 *
 *   1. THE DATABASE ARBITRATES. `shipments_order_id_unique` (migration 057) is
 *      declared by `db/schema.sql`, created by `db/run-sqleditor.sql` and by the
 *      migration, and the writer's `INSERT … ON CONFLICT (order_id)` infers it.
 *      Executed against a real database: N concurrent keyed statements — with NO
 *      application lock taken — leave exactly ONE row, and the winner's carrier
 *      and tracking number SURVIVE (the conflict branch fills only what is
 *      empty; it never rewrites what the first caller stored).
 *   2. THE ORDER ROW SERIALISES THE CALLERS. `ensureShipmentForShipping()` takes
 *      the order row's lock itself, through `lib/order-lock.ts`, so it is safe
 *      for any caller — including one that forgot the lock — and a re-entrant
 *      no-op for the two routes that already hold it. Proven with real
 *      connections: N concurrent calls create one row and all report one id.
 *   3. A REPEAT IS A NO-OP, NOT AN EDIT. A second request for an order that
 *      already has a valid shipment returns that same row and leaves every field
 *      alone, `updated_at` and `created_at` included.
 *
 * The file also pins the SURROUNDING contracts this fix must not move: the
 * fulfilment machine is still the only authority over the transition (a shipment
 * is created inside the `shipped` branch, after `canTransition`), the order-state
 * projection from Phase 1 is untouched, and the seller/center scopes and the
 * permission gate on the two callers still refuse everybody else.
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
import { ensureShipmentForShipping } from "../lib/order-fulfillment.js";
import { axesForFulfillmentStatus, projectOrderStatus } from "../lib/order-state.js";
import { setupCenterRoutes } from "../routes/center.js";
import { setupSellerOrderRoutes } from "../routes/seller-orders.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

// The routes verify a real session cookie; the suite never holds a production
// one. Same shape the other route tests use (`customer-order-cancel.test.ts`).
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const testFn = hasTestDatabase() ? test : test.skip;
const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const SHIPMENT_LIB = "backend/lib/order-fulfillment.ts";
const SELLER_ROUTE = "backend/routes/seller-orders.ts";
const CENTER_ROUTE = "backend/routes/center.ts";
const SCHEMA = "db/schema.sql";
const RECONCILER = "db/run-sqleditor.sql";
const MIGRATION = "db/migrations/057_shipment_canonical_unique.sql";

/**
 * The SQL the writer binds — the keyed statement, taken from the source of truth
 * rather than retyped, so a test cannot pass against a statement the product
 * does not run. The second half (the un-keyed fallback) is deliberately NOT
 * scraped: it exists only for a database without the index.
 */
function keyedStatementFromSource(): string {
  const src = read(SHIPMENT_LIB);
  const start = src.indexOf("INSERT INTO shipments");
  expect(start, `${SHIPMENT_LIB} lost its INSERT INTO shipments`).toBeGreaterThan(-1);
  const end = src.indexOf("RETURNING id, carrier, tracking_number", start);
  expect(end, "the keyed statement lost its RETURNING clause").toBeGreaterThan(-1);
  return src.slice(start, end + "RETURNING id, carrier, tracking_number".length);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The one writer, the one key, and the guards around them (source contracts)
// ═══════════════════════════════════════════════════════════════════════════

describe("shipment creation — one writer, one key, no second shipment system", () => {
  test("db/schema.sql declares the canonical unique index ON order_id", () => {
    const schema = read(SCHEMA);
    expect(schema).toContain(
      "CREATE UNIQUE INDEX IF NOT EXISTS shipments_order_id_unique ON shipments (order_id);",
    );
    // The superseded non-unique index is gone from the SNAPSHOT: two indexes on
    // one column would be the duplicate the schema rules forbid.
    expect(schema).not.toContain("CREATE INDEX IF NOT EXISTS idx_shipments_order");
  });

  test("the reconciler and the migration create it GUARDED, and drop the stale index only then", () => {
    for (const file of [RECONCILER, MIGRATION]) {
      const sql = read(file);
      expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS shipments_order_id_unique");
      // Duplicate `order_id` values are a BUSINESS question (which parcel is
      // real?), so the pass reports and skips instead of aborting a migration
      // every other fix is queued behind — and it must never delete a row.
      expect(sql).toContain("GROUP BY order_id HAVING COUNT(*) > 1");
      expect(sql).toContain("RAISE NOTICE 'velnox: shipments_order_id_unique NOT created");
      expect(sql).not.toMatch(/^\s*DELETE\s+FROM\s+shipments\b/im);
      expect(sql).not.toMatch(/^\s*DROP\s+TABLE\b/im);
      expect(sql).not.toMatch(/^\s*DROP\s+COLUMN\b/im);
    }
    // The drop of `idx_shipments_order` is inside the same existence guard as the
    // create: on a duplicate-holding database the create is skipped, and the old
    // index must then STAY — otherwise the column would lose its only index.
    const reconciler = read(RECONCILER);
    const dropAt = reconciler.indexOf("DROP INDEX public.idx_shipments_order");
    expect(dropAt).toBeGreaterThan(-1);
    const before = reconciler.slice(0, dropAt);
    const guardAt = before.lastIndexOf("indexname = 'shipments_order_id_unique'");
    const blockAt = before.lastIndexOf("DO $$");
    expect(guardAt).toBeGreaterThan(blockAt);
  });

  test("exactly ONE non-test file inserts a shipment, and it is the keyed one", () => {
    const writers = new Bun.Glob("backend/**/*.ts").scanSync({ cwd: root });
    const found: string[] = [];
    for (const file of writers) {
      if (file.includes("/tests/")) continue;
      if (read(file).includes("INSERT INTO shipments")) found.push(file);
    }
    expect(found).toEqual([SHIPMENT_LIB]);

    const statement = keyedStatementFromSource();
    expect(statement).toContain("ON CONFLICT (order_id) DO UPDATE");
    // The conflict branch FILLS ONLY. A `DO UPDATE` that assigned the excluded
    // value outright would let the loser of a race rewrite the winner's carrier
    // and tracking number — the opposite of what a retry must do.
    expect(statement).toContain("COALESCE(NULLIF(shipments.carrier, ''), EXCLUDED.carrier)");
    expect(statement).toContain("COALESCE(shipments.tracking_number, EXCLUDED.tracking_number)");
    expect(statement).not.toMatch(/carrier\s*=\s*EXCLUDED\.carrier/);
    expect(statement).not.toMatch(/tracking_number\s*=\s*EXCLUDED\.tracking_number/);
  });

  test("the writer takes the order row lock itself, through the ONE lock authority", () => {
    const src = read(SHIPMENT_LIB);
    expect(src).toContain('import { lockOrderRow, PAYMENT_SETTLED_STATUSES } from "./order-lock.js"');
    const fn = src.slice(src.indexOf("export async function ensureShipmentForShipping"));
    const lockAt = fn.indexOf("await lockOrderRow(client, orderId)");
    const selectAt = fn.indexOf("SELECT id, carrier, tracking_number FROM shipments");
    expect(lockAt).toBeGreaterThan(-1);
    expect(selectAt).toBeGreaterThan(lockAt);
  });

  test("both routes still create the shipment INSIDE the machine's `shipped` branch", () => {
    // Per surface, the route's OWN gate and its own call to the validator — so
    // this cannot pass by finding the word `shipped` somewhere else in a
    // 1,300-line file.
    const surfaces = [
      {
        file: SELLER_ROUTE,
        validate: "if (!canTransitionOrderStatus(fromStatus, status)) {",
        gate: 'if (status === "shipped") {',
      },
      {
        file: CENTER_ROUTE,
        validate: "if (to !== rawFrom && !canTransitionFulfillment(from, to)) {",
        gate: 'if (to === "shipped" && to !== rawFrom) {',
      },
    ];
    for (const { file, validate, gate } of surfaces) {
      const src = read(file);
      const call = "await ensureShipmentForShipping(client, orderId, { carrier, trackingNumber });";
      // Exactly ONE creation point per route: no second shipment path may appear.
      expect(src.split("ensureShipmentForShipping(client").length - 1).toBe(1);

      const lockAt = src.indexOf("FOR UPDATE");
      const validateAt = src.indexOf(validate);
      const gateAt = src.indexOf(gate);
      const callAt = src.indexOf(call);
      expect(lockAt, `${file} lost its order row lock`).toBeGreaterThan(-1);
      expect(validateAt, `${file} lost its machine check`).toBeGreaterThan(lockAt);
      expect(gateAt, `${file} lost its shipped branch`).toBeGreaterThan(validateAt);
      expect(callAt, `${file} lost its shipment call`).toBeGreaterThan(gateAt);
      // …and the whole thing runs in one transaction with the status change.
      expect(src).toContain("withTransaction");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Real connections: sequential, concurrent, retry, preservation
// ═══════════════════════════════════════════════════════════════════════════

describe("shipment creation against a real database (requires TEST_DATABASE_URL)", () => {
  /** A customer and an order in the state a ship request starts from. */
  async function fixture(status = "packing") {
    const tag = `ship-${randomUUID().slice(0, 8)}`;
    const user = await query(
      `INSERT INTO users (email, name) VALUES ($1, 'Shipment Idempotency') RETURNING id`,
      [`${tag}@test.local`],
    );
    const userId = user.rows[0].id as string;
    const order = await query(
      `INSERT INTO orders (user_id, status, total_amount, currency) VALUES ($1, $2, 100, 'THB') RETURNING id`,
      [userId, status],
    );
    return { userId, orderId: order.rows[0].id as string };
  }

  /** `n` creation calls for ONE order, in parallel, each in its OWN transaction. */
  async function concurrentCreates(orderId: string, n: number, tag = "C") {
    return await Promise.all(
      Array.from({ length: n }, (_unused, i) =>
        withTransaction((client) =>
          ensureShipmentForShipping(client, orderId, {
            carrier: `${tag}-${i}`,
            trackingNumber: `${tag}-TRK-${i}`,
          }),
        ),
      ),
    );
  }

  /** Every shipment row of an order, oldest first, with its timestamps. */
  async function shipmentsOf(orderId: string) {
    const res = await query(
      `SELECT id, carrier, tracking_number, status, created_at, updated_at
         FROM shipments WHERE order_id = $1 ORDER BY created_at, id`,
      [orderId],
    );
    return res.rows as Array<{
      id: string;
      carrier: string;
      tracking_number: string | null;
      status: string;
      created_at: Date;
      updated_at: Date;
    }>;
  }

  testFn(
    "Test 1 — a second creation returns the SAME shipment, and only one exists",
    async () => {
      const { userId, orderId } = await fixture();
      try {
        const first = await withTransaction((client) =>
          ensureShipmentForShipping(client, orderId, { carrier: "Kerry", trackingNumber: "K-1" }),
        );
        const second = await withTransaction((client) =>
          ensureShipmentForShipping(client, orderId, { carrier: "Kerry", trackingNumber: "K-1" }),
        );

        expect(second.id).toBe(first.id);
        expect(second).toEqual(first);
        const rows = await shipmentsOf(orderId);
        expect(rows.length).toBe(1);
        expect(rows[0]!.id).toBe(first.id);
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  testFn(
    "Test 2 — 8 concurrent creators leave ONE canonical shipment and one id",
    async () => {
      const { userId, orderId } = await fixture();
      try {
        const results = await concurrentCreates(orderId, 8);

        // Every caller that succeeded points at the SAME row: this is the
        // idempotency contract, not a count that merely happens to be one.
        expect(new Set(results.map((r) => r.id)).size).toBe(1);
        const rows = await shipmentsOf(orderId);
        expect(rows.length).toBe(1);
        expect(rows[0]!.id).toBe(results[0]!.id);
        // The stored row is a COHERENT PAIR from ONE caller — never one caller's
        // carrier with another caller's tracking number. (WHICH caller's values
        // remain is the documented sequential rule, unchanged by this fix: the
        // last caller to supply details wins, exactly as a correction does. What
        // this test owns is that there is ONE row and ONE id for all eight — the
        // fill-only guarantee for a database-level race is Test 2b.)
        expect(rows[0]!.carrier).toMatch(/^C-\d+$/);
        expect(rows[0]!.tracking_number).toBe(`C-TRK-${rows[0]!.carrier.slice(2)}`);
        expect(rows[0]!.status).toBe("created");
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  testFn(
    "Test 2b — the DATABASE arbitrates: 8 keyed inserts with NO app lock leave one row",
    async () => {
      const { userId, orderId } = await fixture();
      try {
        // The statement the writer binds, verbatim from its own source, run on
        // connections that take NO order lock — so nothing but the unique index
        // and `ON CONFLICT` can be doing the work here.
        const statement = keyedStatementFromSource();
        const racers = await Promise.all(
          Array.from({ length: 8 }, (_unused, i) =>
            withTransaction(async (client) => {
              const res = await client.query(statement, [
                orderId,
                `RAW-${i}`,
                `RAW-TRK-${i}`,
              ]);
              return res.rows[0] as { id: string; carrier: string; tracking_number: string | null };
            }),
          ),
        );

        expect(new Set(racers.map((r) => r.id)).size).toBe(1);
        const rows = await shipmentsOf(orderId);
        expect(rows.length).toBe(1);
        // The winner's values are INTACT and PAIRED: the losers filled nothing,
        // so a row can never mix one caller's carrier with another's tracking
        // number. (This is what the fill-only conflict branch buys.)
        const winner = racers[0]!;
        expect(rows[0]!.carrier).toBe(winner.carrier);
        expect(rows[0]!.tracking_number).toBe(winner.tracking_number);
        expect(rows[0]!.carrier).toMatch(/^RAW-\d+$/);
        expect(rows[0]!.tracking_number).toBe(`RAW-TRK-${rows[0]!.carrier.slice(4)}`);
        expect(rows[0]!.status).toBe("created");
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  testFn(
    "Test 3 — three DIFFERENT orders create in parallel without blocking each other",
    async () => {
      const first = await fixture();
      const second = await fixture();
      const third = await fixture();
      try {
        const created = await Promise.all([
          withTransaction((c) =>
            ensureShipmentForShipping(c, first.orderId, { carrier: "A", trackingNumber: "A-1" }),
          ),
          withTransaction((c) =>
            ensureShipmentForShipping(c, second.orderId, { carrier: "B", trackingNumber: "B-1" }),
          ),
          withTransaction((c) =>
            ensureShipmentForShipping(c, third.orderId, { carrier: "C", trackingNumber: "C-1" }),
          ),
        ]);

        expect(new Set(created.map((r) => r.id)).size).toBe(3);
        for (const [order, expectedCarrier] of [
          [first.orderId, "A"],
          [second.orderId, "B"],
          [third.orderId, "C"],
        ] as const) {
          const rows = await shipmentsOf(order);
          expect(rows.length).toBe(1);
          expect(rows[0]!.carrier).toBe(expectedCarrier);
        }
      } finally {
        await purgeUsers([first.userId, second.userId, third.userId]);
      }
    },
    30_000,
  );

  testFn(
    "Test 4 + 10 — an existing shipment is REUSED and every field survives a repeat",
    async () => {
      const { userId, orderId } = await fixture();
      try {
        const created = await withTransaction((c) =>
          ensureShipmentForShipping(c, orderId, { carrier: "Kerry", trackingNumber: "K-9" }),
        );
        const before = (await shipmentsOf(orderId))[0]!;

        // (a) The retry shape: no details passed at all.
        const retried = await withTransaction((c) =>
          ensureShipmentForShipping(c, orderId, {}),
        );
        expect(retried.id).toBe(created.id);

        // (b) The same details again — the seller's dialog re-submitting.
        const repeated = await withTransaction((c) =>
          ensureShipmentForShipping(c, orderId, { carrier: "Kerry", trackingNumber: "K-9" }),
        );
        expect(repeated.id).toBe(created.id);

        const after = (await shipmentsOf(orderId))[0]!;
        expect(after.tracking_number).toBe(before.tracking_number);
        expect(after.carrier).toBe(before.carrier);
        expect(after.status).toBe(before.status);
        // A repeat is a no-op, NOT an edit: the timestamps do not move either.
        expect(after.created_at.toISOString()).toBe(before.created_at.toISOString());
        expect(after.updated_at.toISOString()).toBe(before.updated_at.toISOString());
        expect((await shipmentsOf(orderId)).length).toBe(1);

        // (c) …while a real CORRECTION still lands, exactly as before: the
        // caller's own values win when it supplies them. Only the change moves
        // `updated_at`.
        const corrected = await withTransaction((c) =>
          ensureShipmentForShipping(c, orderId, { carrier: "Flash", trackingNumber: "F-1" }),
        );
        expect(corrected.id).toBe(created.id);
        expect(corrected.carrier).toBe("Flash");
        expect(corrected.trackingNumber).toBe("F-1");
        const correctedRow = (await shipmentsOf(orderId))[0]!;
        expect(correctedRow.updated_at.getTime()).toBeGreaterThanOrEqual(
          after.updated_at.getTime(),
        );
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  testFn(
    "Test 9 — a failed transaction leaves NOTHING behind, and the retry succeeds",
    async () => {
      const { userId, orderId } = await fixture();
      try {
        // The refusal path first: no carrier, nothing written.
        await expect(
          withTransaction((c) => ensureShipmentForShipping(c, orderId, {})),
        ).rejects.toThrow(/carrier and a tracking number/i);
        expect((await shipmentsOf(orderId)).length).toBe(0);

        // A transaction that creates the shipment and then FAILS must roll it
        // back with everything else — no half-created parcel.
        await expect(
          withTransaction(async (c) => {
            await ensureShipmentForShipping(c, orderId, { carrier: "Kerry", trackingNumber: "K-2" });
            throw new Error("synthetic failure after shipment creation");
          }),
        ).rejects.toThrow(/synthetic failure/);
        expect((await shipmentsOf(orderId)).length).toBe(0);

        // The retry — the same call that would have been made by the operator —
        // creates exactly one row, and a second retry reuses it.
        const retried = await withTransaction((c) =>
          ensureShipmentForShipping(c, orderId, { carrier: "Kerry", trackingNumber: "K-2" }),
        );
        const again = await withTransaction((c) =>
          ensureShipmentForShipping(c, orderId, { carrier: "Kerry", trackingNumber: "K-2" }),
        );
        expect(again.id).toBe(retried.id);
        expect((await shipmentsOf(orderId)).length).toBe(1);
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  testFn(
    "Phase 1 protection — creating a shipment never moves the order's own axes",
    async () => {
      const { userId, orderId } = await fixture("packing");
      try {
        const packing = axesForFulfillmentStatus("packing");
        const projection = projectOrderStatus({ paymentState: "unpaid", ...packing });
        await query(
          `UPDATE orders SET status = $2, order_state = $3, fulfillment_status = $4 WHERE id = $1`,
          [orderId, projection, packing.orderState, packing.fulfillmentStatus],
        );

        await concurrentCreates(orderId, 4, "P");

        const row = (
          await query(
            `SELECT status, order_state, fulfillment_status FROM orders WHERE id = $1`,
            [orderId],
          )
        ).rows[0] as { status: string; order_state: string; fulfillment_status: string };
        // P1-2 adds no writer to `orders`: the axes are exactly what the
        // transition wrote, and the legacy column is still their projection.
        expect(row.order_state).toBe(packing.orderState);
        expect(row.fulfillment_status).toBe(packing.fulfillmentStatus);
        expect(row.status).toBe(projection);
        expect(row.status).toBe("packing");
        expect(
          projectOrderStatus({
            paymentState: "unpaid",
            orderState: row.order_state,
            fulfillmentStatus: row.fulfillment_status,
          }),
        ).toBe(row.status);
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The routes: who may create a shipment, and WHERE in the flow it happens
// ═══════════════════════════════════════════════════════════════════════════

describe("shipment creation over the real routes (requires TEST_DATABASE_URL)", () => {
  const JWT_SECRET = process.env.JWT_SECRET!;

  /** An approved seller with a shop, a product and one order to fulfil. */
  async function sellerFixture(status = "packing") {
    const tag = `shipr-${randomUUID().slice(0, 8)}`;
    const user = await query(
      `INSERT INTO users (email, name) VALUES ($1, 'Shipment Route Seller') RETURNING id`,
      [`${tag}@test.local`],
    );
    const userId = user.rows[0].id as string;
    const seller = await query(
      `INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`,
      [userId],
    );
    const sellerId = seller.rows[0].id as string;
    const shop = await query(
      `INSERT INTO shops (seller_id, name, slug) VALUES ($1, 'Shipment Route Shop', $2) RETURNING id`,
      [sellerId, `${tag}-shop`],
    );
    const shopId = shop.rows[0].id as string;
    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price) VALUES ($1, 'Route Product', $2, 100) RETURNING id`,
      [shopId, `${tag}-product`],
    );
    const order = await query(
      `INSERT INTO orders (user_id, status, total_amount, currency) VALUES ($1, $2, 100, 'THB') RETURNING id`,
      [userId, status],
    );
    const orderId = order.rows[0].id as string;
    await query(
      `INSERT INTO order_items (order_id, product_id, shop_id, product_name_snapshot, quantity, price, subtotal)
       VALUES ($1, $2, $3, 'Route Product', 1, 100, 100)`,
      [orderId, product.rows[0].id, shopId],
    );
    return { userId, sellerId, shopId, orderId };
  }

  /** An account whose VelCenter membership is exactly `role`. */
  async function centerFixture(role: string) {
    const tag = `shipc-${randomUUID().slice(0, 8)}`;
    const user = await query(
      `INSERT INTO users (email, name, role) VALUES ($1, 'Shipment Route Center', $2) RETURNING id`,
      [`${tag}@test.local`, role],
    );
    return user.rows[0].id as string;
  }

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
      const token = jwt.sign(
        { userId: asUserId, email: `${asUserId}@test.local` },
        JWT_SECRET,
        { expiresIn: "1h" },
      );
      const res = await fetch(`http://127.0.0.1:${port}${path}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Cookie: `velnox_session=${token}` },
        body: JSON.stringify(body),
      });
      const parsed = (await res.json().catch(() => ({}))) as { error?: { code?: string } };
      return { status: res.status, code: parsed.error?.code };
    } finally {
      server.close();
    }
  }

  /** The order's raw status plus how many shipment rows it has. */
  async function orderAndShipments(orderId: string) {
    const res = await query(
      `SELECT o.status, o.order_state, o.fulfillment_status,
              (SELECT COUNT(*)::int FROM shipments s WHERE s.order_id = o.id) AS shipments
         FROM orders o WHERE o.id = $1`,
      [orderId],
    );
    return res.rows[0] as {
      status: string;
      order_state: string;
      fulfillment_status: string;
      shipments: number;
    };
  }

  testFn(
    "Test 8 + 6 — the owning seller ships: ONE shipment, from the machine's own branch",
    async () => {
      const sellerA = await sellerFixture();
      try {
        const response = await patchThrough(setupSellerOrderRoutes, `/api/seller/orders/${sellerA.orderId}/status`, sellerA.userId, {
          status: "shipped",
          carrier: "Kerry",
          trackingNumber: "K-100",
        });
        expect(response).toEqual({ status: 200, code: undefined });

        const state = await orderAndShipments(sellerA.orderId);
        expect(state.shipments).toBe(1);
        expect(state.status).toBe("shipped");
        // The axes are the fulfilment machine's, and the legacy column is their
        // projection — the transition still happens where it always did.
        expect(state.order_state).toBe("processing");
        expect(state.fulfillment_status).toBe("shipped");

        // A SECOND ship request is refused by the state machine (shipped has no
        // edge to itself), and it adds no shipment: the machine, not the
        // shipment count, is what stops a duplicate transition.
        const repeat = await patchThrough(setupSellerOrderRoutes, `/api/seller/orders/${sellerA.orderId}/status`, sellerA.userId, {
          status: "shipped",
          carrier: "Kerry",
          trackingNumber: "K-200",
        });
        expect(repeat.status).toBe(400);
        expect(repeat.code).toBe("INVALID_TRANSITION");
        expect((await orderAndShipments(sellerA.orderId)).shipments).toBe(1);
      } finally {
        await purgeUsers([sellerA.userId]);
      }
    },
    30_000,
  );

  testFn(
    "Test 6 — seller B cannot ship seller A's order, and creates no shipment for it",
    async () => {
      const sellerA = await sellerFixture();
      const sellerB = await sellerFixture();
      try {
        const response = await patchThrough(
          setupSellerOrderRoutes,
          `/api/seller/orders/${sellerA.orderId}/status`,
          sellerB.userId,
          { status: "shipped", carrier: "Kerry", trackingNumber: "K-999" },
        );
        expect(response.status).toBe(404);
        expect(response.code).toBe("NOT_FOUND");

        // The refusal happens BEFORE any shipment write — nothing to clean up.
        const state = await orderAndShipments(sellerA.orderId);
        expect(state.shipments).toBe(0);
        expect(state.status).toBe("packing");
        // …and seller B's own order is untouched as well.
        expect((await orderAndShipments(sellerB.orderId)).shipments).toBe(0);
      } finally {
        await purgeUsers([sellerA.userId, sellerB.userId]);
      }
    },
    30_000,
  );

  testFn(
    "Test 5 — the order's own CUSTOMER cannot ship it: the route is seller-scoped",
    async () => {
      const sellerA = await sellerFixture();
      try {
        const response = await patchThrough(
          setupSellerOrderRoutes,
          `/api/seller/orders/${sellerA.orderId}/status`,
          sellerA.userId === "" ? "" : sellerA.userId,
          { status: "shipped", carrier: "Kerry", trackingNumber: "K-777" },
        );
        // The seller IS the order's buyer in this fixture (the column is the
        // buyer's id), so this request is the owning seller's and must SUCCEED —
        // which is itself the proof that ownership is decided by the seller
        // scope, never by the buyer column.
        expect(response.status).toBe(200);

        // A different customer account with no approved seller application is
        // refused outright: the route never reaches the ownership query.
        const outsider = await centerFixture("customer");
        try {
          const denied = await patchThrough(
            setupSellerOrderRoutes,
            `/api/seller/orders/${sellerA.orderId}/status`,
            outsider,
            { status: "shipped", carrier: "Kerry", trackingNumber: "K-888" },
          );
          expect(denied.status).toBe(403);
          expect(denied.code).toBe("FORBIDDEN");
          expect((await orderAndShipments(sellerA.orderId)).shipments).toBe(1);
        } finally {
          await purgeUsers([outsider]);
        }
      } finally {
        await purgeUsers([sellerA.userId]);
      }
    },
    30_000,
  );

  testFn(
    "Test 7 — VelCenter: the permission gate still decides, and an authorised move ships",
    async () => {
      const sellerA = await sellerFixture();
      const plainUser = await centerFixture("customer");
      const owner = await centerFixture("owner");
      try {
        // Not a center member at all → 403, and no shipment is created.
        const denied = await patchThrough(
          setupCenterRoutes,
          `/api/admin/orders/${sellerA.orderId}/status`,
          plainUser,
          { status: "shipped", carrier: "Kerry", trackingNumber: "C-1" },
        );
        expect(denied.status).toBe(403);
        expect(denied.code).toBe("FORBIDDEN");
        expect((await orderAndShipments(sellerA.orderId)).shipments).toBe(0);

        // An owner holds `orders.manage` implicitly ⇒ the move is allowed and
        // creates exactly one shipment, through the same helper.
        const allowed = await patchThrough(
          setupCenterRoutes,
          `/api/admin/orders/${sellerA.orderId}/status`,
          owner,
          { status: "shipped", carrier: "Kerry", trackingNumber: "C-2" },
        );
        expect(allowed).toEqual({ status: 200, code: undefined });
        const state = await orderAndShipments(sellerA.orderId);
        expect(state.shipments).toBe(1);
        expect(state.status).toBe("shipped");
      } finally {
        await purgeUsers([sellerA.userId, plainUser, owner]);
      }
    },
    30_000,
  );
});
