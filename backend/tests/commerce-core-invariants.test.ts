/**
 * THE COMMERCE CORE'S INVARIANTS MUST BE ENFORCED BY THE DATABASE, NOT ONLY BY CODE.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The audit (`.ai/rebuild/CURRENT_ARCHITECTURE.md`, findings A1-A19) found the
 * commerce core relying on application code alone for rules that a database can
 * and should guarantee:
 *
 *   • `orders.status` carried payment + order + fulfillment in ONE column, so no
 *     constraint could describe any one lifecycle;
 *   • stock lived in TWO models (`inventory.quantity/reserved` per product,
 *     `product_variants.stock` per variant) and NEITHER had a non-negativity
 *     constraint, so any writer other than the two guarded UPDATEs could go
 *     negative;
 *   • there was no attempt layer, no ledger, no outbox, no retry metadata and no
 *     reconciliation record at all.
 *
 * Migration `db/migrations/056_commerce_core_invariants.sql` adds them. A
 * constraint that is declared but wrong is worse than no constraint, because it
 * reads as protection — so every assertion below EXECUTES the statement the
 * constraint is meant to refuse and checks the SQLSTATE PostgreSQL answered with.
 * Nothing here asserts a constraint exists by name alone; the catalog read is one
 * test of fourteen, and the other thirteen fail if the rule is toothless.
 *
 * The fixtures are built with plain SQL so the test does not depend on any route:
 * a route that quietly stopped writing the axis columns would still be caught,
 * because the constraint is checked against the TABLE.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { query } from "../db/index.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

const testFn = hasTestDatabase() ? test : test.skip;

let userId: string;
let sellerId: string;
let shopId: string;
let productId: string;
let variantId: string;
let orderId: string;
let orderItemId: string;
let paymentId: string;

/** Run a statement that MUST be refused, and return the SQLSTATE it raised. */
async function reject(sql: string, params: unknown[] = []): Promise<string | undefined> {
  try {
    await query(sql, params);
  } catch (err: any) {
    return err?.code as string | undefined;
  }
  return undefined;
}

const NEW_TABLES = [
  "payment_attempts",
  "fulfillment_orders",
  "shipment_items",
  "inventory_movements",
  "ledger_entries",
  "order_returns",
  "outbox_events",
  "reconciliation_runs",
  "reconciliation_findings",
];

beforeAll(async () => {
  if (!hasTestDatabase()) return;

  const u = await query(
    `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
    [`commerce-invariants-${Date.now()}@velnox.test`, "Invariants Fixture"],
  );
  userId = u.rows[0].id;

  const s = await query(
    `INSERT INTO sellers (user_id, status, verification_status) VALUES ($1, 'approved', 'verified') RETURNING id`,
    [userId],
  );
  sellerId = s.rows[0].id;

  const sh = await query(
    `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
    [sellerId, "Invariants Shop", `invariants-shop-${Date.now()}`],
  );
  shopId = sh.rows[0].id;

  const p = await query(
    `INSERT INTO products (shop_id, name, slug, price, status) VALUES ($1, $2, $3, $4, 'published') RETURNING id`,
    [shopId, "Invariants Product", `invariants-product-${Date.now()}`, 100],
  );
  productId = p.rows[0].id;

  await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 10, 0)`, [productId]);

  const v = await query(
    `INSERT INTO product_variants (product_id, name, price, stock) VALUES ($1, $2, $3, $4) RETURNING id`,
    [productId, "Default", 100, 10],
  );
  variantId = v.rows[0].id;

  const o = await query(
    `INSERT INTO orders (user_id, shop_id, status, subtotal, shipping_fee, discount, total_amount, order_state, fulfillment_status)
     VALUES ($1, $2, 'pending', 100, 0, 0, 100, 'pending', 'unfulfilled') RETURNING id`,
    [userId, shopId],
  );
  orderId = o.rows[0].id;

  const oi = await query(
    `INSERT INTO order_items (order_id, product_id, shop_id, quantity, price, subtotal)
     VALUES ($1, $2, $3, 3, 100, 300) RETURNING id`,
    [orderId, productId, shopId],
  );
  orderItemId = oi.rows[0].id;

  const pay = await query(
    `INSERT INTO payments (order_id, amount, currency, method, status, provider) VALUES ($1, 300, 'THB', 'card', 'pending', 'stripe') RETURNING id`,
    [orderId],
  );
  paymentId = pay.rows[0].id;
});

afterAll(async () => {
  if (!hasTestDatabase()) return;
  // Ledger rows are append-only, so a fixture that writes one cannot delete it.
  // The trigger is proven on a row whose FKs are all NULL (no purge needed).
  await purgeUsers([userId]);
});

describe("commerce core — the nine new tables exist", () => {
  testFn("every table the migration declares is present in the catalog", async () => {
    const res = await query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = ANY($1)`,
      [NEW_TABLES],
    );
    const present = res.rows.map((r: any) => r.table_name).sort();
    expect(present).toEqual([...NEW_TABLES].sort());
  });

  testFn("both order axes and both inventory axes exist as real columns", async () => {
    const res = await query(
      `SELECT table_name || '.' || column_name AS col
         FROM information_schema.columns
        WHERE table_schema = 'public'
          AND ((table_name = 'orders' AND column_name IN ('order_state', 'fulfillment_status'))
            OR (table_name = 'inventory' AND column_name IN ('committed', 'fulfilled', 'returned'))
            OR (table_name = 'product_variants' AND column_name IN ('reserved', 'committed', 'fulfilled', 'returned'))
            OR (table_name = 'order_items' AND column_name = 'fulfilled_quantity'))`,
    );
    // 2 order axes + 3 new product counters + 4 variant counters + 1 item axis
    expect(res.rows.length).toBe(10);
  });
});

describe("order axes — one lifecycle per column", () => {
  testFn("an order_state outside the order vocabulary is refused", async () => {
    expect(await reject(`UPDATE orders SET order_state = 'paid' WHERE id = $1`, [orderId])).toBe("23514");
  });

  testFn("a fulfillment_status outside the fulfillment vocabulary is refused", async () => {
    expect(await reject(`UPDATE orders SET fulfillment_status = 'packing_and_shipping' WHERE id = $1`, [orderId])).toBe("23514");
  });

  testFn("the legacy orders.status CHECK stays exactly as it was (12 values, unchanged)", async () => {
    // Proves the migration did NOT tighten the column the four deployed frontends
    // read: a value the projection can emit is still accepted.
    expect(await reject(`UPDATE orders SET status = 'paid' WHERE id = $1`, [orderId])).toBeUndefined();
    expect(await reject(`UPDATE orders SET status = 'awaiting_stock' WHERE id = $1`, [orderId])).toBe("23514");
    await query(`UPDATE orders SET status = 'pending' WHERE id = $1`, [orderId]);
  });

  testFn("an order cannot be over-fulfilled", async () => {
    expect(await reject(`UPDATE order_items SET fulfilled_quantity = 4 WHERE id = $1`, [orderItemId])).toBe("23514");
    expect(await reject(`UPDATE order_items SET fulfilled_quantity = -1 WHERE id = $1`, [orderItemId])).toBe("23514");
    expect(await reject(`UPDATE order_items SET fulfilled_quantity = 3 WHERE id = $1`, [orderItemId])).toBeUndefined();
    await query(`UPDATE order_items SET fulfilled_quantity = 0 WHERE id = $1`, [orderItemId]);
  });
});

describe("stock — the database refuses an oversell itself", () => {
  testFn("a negative product counter is refused", async () => {
    expect(await reject(`UPDATE inventory SET reserved = -1 WHERE product_id = $1`, [productId])).toBe("23514");
    expect(await reject(`UPDATE inventory SET committed = -1 WHERE product_id = $1`, [productId])).toBe("23514");
    expect(await reject(`UPDATE inventory SET quantity = -1 WHERE product_id = $1`, [productId])).toBe("23514");
  });

  testFn("reserved plus committed can never exceed on-hand", async () => {
    // 10 on hand: 6 reserved + 5 committed is 11 held, which must be impossible
    // even though each counter on its own is within range.
    expect(await reject(`UPDATE inventory SET reserved = 6, committed = 5 WHERE product_id = $1`, [productId])).toBe("23514");
    expect(await reject(`UPDATE inventory SET reserved = 6, committed = 4 WHERE product_id = $1`, [productId])).toBeUndefined();
    await query(`UPDATE inventory SET reserved = 0, committed = 0 WHERE product_id = $1`, [productId]);
  });

  testFn("the same two rules bind the variant axis", async () => {
    expect(await reject(`UPDATE product_variants SET reserved = -1 WHERE id = $1`, [variantId])).toBe("23514");
    expect(await reject(`UPDATE product_variants SET reserved = 6, committed = 5 WHERE id = $1`, [variantId])).toBe("23514");
    expect(await reject(`UPDATE product_variants SET stock = -1 WHERE id = $1`, [variantId])).toBe("23514");
  });

  testFn("an inventory movement must name the level it moved", async () => {
    expect(
      await reject(
        `INSERT INTO inventory_movements (product_id, movement, quantity) VALUES ($1, 'reserve', 1)`,
        [productId],
      ),
    ).toBe("23514");
  });

  testFn("a movement idempotency key cannot be reused", async () => {
    const key = `mv-${Date.now()}`;
    expect(
      await reject(
        `INSERT INTO inventory_movements (inventory_id, product_id, movement, quantity, idempotency_key)
         SELECT id, product_id, 'reserve', 1, $2 FROM inventory WHERE product_id = $1`,
        [productId, key],
      ),
    ).toBeUndefined();
    expect(
      await reject(
        `INSERT INTO inventory_movements (inventory_id, product_id, movement, quantity, idempotency_key)
         SELECT id, product_id, 'reserve', 1, $2 FROM inventory WHERE product_id = $1`,
        [productId, key],
      ),
    ).toBe("23505");
  });
});

describe("payment attempts — the attempt layer is durable", () => {
  testFn("an attempt idempotency key is unique", async () => {
    const key = `att-${Date.now()}`;
    const insert = `INSERT INTO payment_attempts (payment_id, attempt_number, status, amount_minor, idempotency_key)
                    VALUES ($1, $2, 'created', 30000, $3)`;
    expect(await reject(insert, [paymentId, 1, key])).toBeUndefined();
    expect(await reject(insert, [paymentId, 2, key])).toBe("23505");
  });

  testFn("only one live attempt may exist per payment", async () => {
    await query(`UPDATE payment_attempts SET status = 'processing' WHERE payment_id = $1 AND attempt_number = 1`, [paymentId]);
    expect(
      await reject(
        `INSERT INTO payment_attempts (payment_id, attempt_number, status, amount_minor, idempotency_key)
         VALUES ($1, 3, 'requires_action', 30000, $2)`,
        [paymentId, `att-live-${Date.now()}`],
      ),
    ).toBe("23505");
    await query(`UPDATE payment_attempts SET status = 'failed' WHERE payment_id = $1 AND attempt_number = 1`, [paymentId]);
  });

  testFn("settlement cannot precede confirmation", async () => {
    expect(
      await reject(
        `INSERT INTO payment_attempts (payment_id, attempt_number, status, amount_minor, idempotency_key, settled_at)
         VALUES ($1, 4, 'succeeded', 30000, $2, NOW())`,
        [paymentId, `att-settled-${Date.now()}`],
      ),
    ).toBe("23514");
  });

  testFn("one provider session cannot back two attempts", async () => {
    const session = `cs_test_${Date.now()}`;
    expect(
      await reject(
        `INSERT INTO payment_attempts (payment_id, attempt_number, status, amount_minor, idempotency_key, provider_session_id)
         VALUES ($1, 5, 'created', 30000, $2, $3)`,
        [paymentId, `att-s1-${Date.now()}`, session],
      ),
    ).toBeUndefined();
    expect(
      await reject(
        `INSERT INTO payment_attempts (payment_id, attempt_number, status, amount_minor, idempotency_key, provider_session_id)
         VALUES ($1, 6, 'created', 30000, $2, $3)`,
        [paymentId, `att-s2-${Date.now()}`, session],
      ),
    ).toBe("23505");
  });

  testFn("the payment vocabulary gained authorized and expired", async () => {
    expect(await reject(`UPDATE payments SET status = 'authorized' WHERE id = $1`, [paymentId])).toBeUndefined();
    expect(await reject(`UPDATE payments SET status = 'expired' WHERE id = $1`, [paymentId])).toBeUndefined();
    expect(await reject(`UPDATE payments SET status = 'held' WHERE id = $1`, [paymentId])).toBe("23514");
    await query(`UPDATE payments SET status = 'pending' WHERE id = $1`, [paymentId]);
  });

  testFn("a payment can never be refunded beyond what was captured", async () => {
    expect(await reject(`UPDATE payments SET refunded_amount = 301 WHERE id = $1`, [paymentId])).toBe("23514");
    expect(await reject(`UPDATE payments SET refunded_amount = -1 WHERE id = $1`, [paymentId])).toBe("23514");
    expect(await reject(`UPDATE payments SET refunded_amount = 300 WHERE id = $1`, [paymentId])).toBeUndefined();
    await query(`UPDATE payments SET refunded_amount = 0 WHERE id = $1`, [paymentId]);
  });

  testFn("a refund of nothing is refused, and its idempotency key is unique", async () => {
    expect(await reject(`INSERT INTO refunds (order_id, payment_id, amount, status) VALUES ($1, $2, 0, 'pending')`, [orderId, paymentId])).toBe("23514");
    const key = `rf-${Date.now()}`;
    expect(
      await reject(`INSERT INTO refunds (order_id, payment_id, amount, status, idempotency_key) VALUES ($1, $2, 10, 'pending', $3)`, [orderId, paymentId, key]),
    ).toBeUndefined();
    expect(
      await reject(`INSERT INTO refunds (order_id, payment_id, amount, status, idempotency_key) VALUES ($1, $2, 10, 'pending', $3)`, [orderId, paymentId, key]),
    ).toBe("23505");
  });
});

describe("shipments, outbox and reconciliation — the new vocabulary is real", () => {
  testFn("a shipment status outside the transit vocabulary is refused", async () => {
    const s = await query(`INSERT INTO shipments (order_id, carrier, tracking_number, status) VALUES ($1, 'TH Post', 'TH123', 'created') RETURNING id`, [orderId]);
    expect(await reject(`UPDATE shipments SET status = 'somewhere' WHERE id = $1`, [s.rows[0].id])).toBe("23514");
    expect(await reject(`UPDATE shipments SET status = 'out_for_delivery' WHERE id = $1`, [s.rows[0].id])).toBeUndefined();
  });

  testFn("an outbox event id is unique and its retry counter cannot go negative", async () => {
    const eventId = crypto.randomUUID();
    const insert = `INSERT INTO outbox_events (event_id, aggregate_type, aggregate_id, event_type) VALUES ($1, 'order', $2, 'OrderCreated')`;
    expect(await reject(insert, [eventId, orderId])).toBeUndefined();
    expect(await reject(insert, [eventId, orderId])).toBe("23505");
    expect(
      await reject(`UPDATE outbox_events SET attempt_count = -1 WHERE event_id = $1`, [eventId]),
    ).toBe("23514");
    expect(await reject(`UPDATE outbox_events SET status = 'lost' WHERE event_id = $1`, [eventId])).toBe("23514");
  });

  testFn("one open finding per real drift (the fingerprint upsert is unique)", async () => {
    const fingerprint = `fp-${Date.now()}`;
    const insert = `INSERT INTO reconciliation_findings (kind, entity_type, entity_id, fingerprint) VALUES ('inventory', 'inventory', $1, $2)`;
    expect(await reject(insert, [productId, fingerprint])).toBeUndefined();
    expect(await reject(insert, [productId, fingerprint])).toBe("23505");
  });
});

describe("the ledger is append-only", () => {
  testFn("an entry can be written, and can never be changed or removed", async () => {
    // No FKs are set, so this row is not a dependency of any fixture and the
    // append-only trigger is proven on a row that never needs cleanup.
    const key = `lg-${Date.now()}`;
    const inserted = await query(
      `INSERT INTO ledger_entries (entry_type, account, direction, amount_minor, idempotency_key)
       VALUES ('charge', 'platform_cash', 'debit', 10000, $1) RETURNING id`,
      [key],
    );
    const id = inserted.rows[0].id;

    // The trigger raises a plain exception (P0001), which is what an accountant
    // must see instead of a silent rewrite.
    let updateCode: string | undefined;
    try {
      await query(`UPDATE ledger_entries SET amount_minor = 1 WHERE id = $1`, [id]);
    } catch (err: any) {
      updateCode = err?.code;
    }
    expect(updateCode).toBe("P0001");

    let deleteCode: string | undefined;
    try {
      await query(`DELETE FROM ledger_entries WHERE id = $1`, [id]);
    } catch (err: any) {
      deleteCode = err?.code;
    }
    expect(deleteCode).toBe("P0001");

    // The unique key makes a retried write a no-op rather than a double charge.
    expect(
      await reject(
        `INSERT INTO ledger_entries (entry_type, account, direction, amount_minor, idempotency_key)
         VALUES ('charge', 'platform_cash', 'debit', 10000, $1)`,
        [key],
      ),
    ).toBe("23505");
  });

  testFn("an amount of nothing cannot be recorded as money", async () => {
    expect(
      await reject(
        `INSERT INTO ledger_entries (entry_type, account, direction, amount_minor, idempotency_key)
         VALUES ('charge', 'platform_cash', 'debit', 0, $1)`,
        [`lg-zero-${Date.now()}`],
      ),
    ).toBe("23514");
  });
});
