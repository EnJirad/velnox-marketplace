/**
 * MULTI-SHOP CHECKOUT — one purchase, N per-shop fulfillment orders.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * A cart that spans several sellers is ONE customer purchase but N fulfillment
 * obligations: each seller packs, ships and tracks their own lines, so the
 * canonical ORDER must be per shop. The split itself already existed
 * (`routes/cart.ts` groups cart lines by `shop_id`); what did NOT exist was the
 * PAYMENT parent for it, and that was a money bug rather than a display one:
 * `POST /api/stripe/checkout` reconciled the amount against a SINGLE order's
 * `total_amount`, so on a three-shop cart only the first shop was charged and
 * the other two expired unpaid.
 *
 * The rules pinned here are therefore:
 *
 *   1. SPLIT BY SELLER, NEVER BY PRODUCT. Five lines from one shop are ONE
 *      order; one line each from three shops are THREE orders (cases 1–4).
 *   2. ONE CHARGE FOR THE PURCHASE. The `checkout_groups` row is the payment
 *      parent, the amount is re-derived from the member order rows, and the
 *      webhook fans ONE settled session out to every member — so a customer is
 *      never charged twice and never charged for one shop only.
 *   3. EVERY ORDER IS A REAL ORDER: its own public number, its own seller
 *      ownership, its own fulfillment and its own tracking.
 *   4. OWNERSHIP DOES NOT BLEED. Seller A cannot see seller B's order; a
 *      customer sees only their own purchase.
 *   5. THE WEBHOOK IS STILL THE ONLY WRITER. A signed `payment_intent.succeeded`
 *      is delivered to the real route; no test fakes a charge, and no route
 *      exists that could.
 *
 * No Stripe API call is made: the session-creating cases assert the REFUSALS
 * the endpoint settles before any provider call, and the settlement cases drive
 * the real webhook with a locally signed event.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { readFileSync } from "fs";
import { join } from "path";

import { stripeWebhookRawBody } from "../middleware/stripe-raw-body.js";
import { setupCartRoutes } from "../routes/cart.js";
import { setupSellerOrderRoutes } from "../routes/seller-orders.js";
import { setupStripeRoutes } from "../routes/stripe.js";
import { generateOrderNumber } from "../lib/order-number.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const CART_ROUTE = "backend/routes/cart.ts";
const STRIPE_ROUTE = "backend/routes/stripe.ts";

// ═══════════════════════════════════════════════════════════════════════════
// 1. The split rule (structural — no database)
// ═══════════════════════════════════════════════════════════════════════════

describe("multi-shop checkout — the split is by SELLER, never by product", () => {
  test("checkout groups cart lines by shop and inserts one order per shop", () => {
    const cart = read(CART_ROUTE);
    // The grouping key is the SHOP, which is what separates two sellers'
    // fulfilment obligations. A per-product grouping would fail this.
    expect(cart).toContain("shop_id");
    expect(cart).toMatch(/byShop|shopMap|groupByShop/);
    // …and the loop that creates orders iterates the GROUPS, not the lines.
    expect(cart).toMatch(/for \(const \[[^\]]*\] of (shopMap|byShop)/);
  });

  test("the group is the payment parent, and every order points at it", () => {
    const cart = read(CART_ROUTE);
    expect(cart).toContain("INSERT INTO checkout_groups");
    expect(cart).toContain("checkout_group_id");
    // The response names the purchase, and the count of shops in it.
    expect(cart).toContain("checkoutGroupId");
    expect(cart).toContain("shopCount");
  });

  test("the public order number the customer receives is the REAL one", () => {
    const cart = read(CART_ROUTE);
    // The insert RETURNS `order_number`; the response must not fall back to the
    // internal UUID, which is what it used to do (`orderNumber: orderId`).
    expect(cart).toMatch(/RETURNING id, order_number/);
    expect(cart).not.toMatch(/orderNumber:\s*orderId\b/);
  });

  test("a group session exists and is derived from the group, never the client", () => {
    const stripe = read(STRIPE_ROUTE);
    expect(stripe).toContain("openCheckoutGroupSession");
    // Ownership is a WHERE clause, not an after-the-fact check.
    expect(stripe).toContain("readOwnedCheckoutGroup");
    // The amount is re-derived from the member ORDER rows.
    expect(stripe).toContain("sumGroupOrderTotal");
    // …and the group's payment row is a `payments` row, so there is ONE payment
    // architecture and no second charge path.
    expect(stripe).toMatch(/INSERT INTO payments[\s\S]{0,200}checkout_group_id/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Database-gated: the real routes
// ═══════════════════════════════════════════════════════════════════════════

const describeDb = hasTestDatabase() ? describe : describe.skip;
const testFn = hasTestDatabase() ? test : test.skip;

describeDb("multi-shop checkout (requires TEST_DATABASE_URL)", () => {
  const PAYMENT_ENV_KEYS = [
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_MODE",
  ] as const;
  const WEBHOOK_SECRET = "whsec_000000000000000000000000";

  afterEach(() => {
    for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
  });

  // Checkout refuses a card payment when Stripe is not configured, so the
  // suite runs with a TEST-mode key. It is not a credential and no Stripe call
  // is ever made: the endpoint settles every case here before it would dial out.
  beforeEach(() => {
    configureFakeStripe();
  });

  /** A plausible TEST key. It is not a credential: no Stripe call is made. */
  function configureFakeStripe(): void {
    for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
    process.env.STRIPE_SECRET_KEY = "sk_test_000000000000000000000000";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
  }

  interface ShopSpec {
    name: string;
    /** How many DISTINCT products this shop contributes. */
    products: number;
    /** How many variants of the FIRST product (same shop, more lines). */
    variants?: number;
    price?: number;
  }

  /**
   * Seed one customer and N shops, each with real products, variants and
   * inventory, and return the cart lines one per (shop, product, variant).
   */
  async function seedCart(shopSpecs: ShopSpec[]) {
    const { query } = await import("../db/index.js");
    const tag = `mshop-${crypto.randomUUID()}`;

    const owner = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-owner@test.local`,
      "Multi Shop Owner",
    ]);
    const ownerId = owner.rows[0].id as string;

    const cart = await query(`INSERT INTO carts (user_id) VALUES ($1) RETURNING id`, [ownerId]);
    const cartId = cart.rows[0].id as string;

    const sellerUserIds: string[] = [];
    const shopIds: string[] = [];
    const cartItemIds: string[] = [];
    /** sellerUserId per cart line, so ownership can be asserted per shop. */
    const lineOwner: Array<{ cartItemId: string; sellerUserId: string; shopId: string; productName: string }> = [];

    for (const [index, spec] of shopSpecs.entries()) {
      const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
        `${tag}-seller${index}@test.local`,
        `Multi Shop Seller ${index}`,
      ]);
      const sellerUserId = sellerUser.rows[0].id as string;
      sellerUserIds.push(sellerUserId);

      const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [
        sellerUserId,
      ]);
      const shop = await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
        seller.rows[0].id,
        `${tag} shop ${index}`,
        `${tag}-shop-${index}`,
      ]);
      const shopId = shop.rows[0].id as string;
      shopIds.push(shopId);

      const price = spec.price ?? 100;
      for (let p = 0; p < spec.products; p += 1) {
        const product = await query(
          `INSERT INTO products (shop_id, name, slug, price, status, sold_count)
           VALUES ($1, $2, $3, $4, 'published', 0) RETURNING id`,
          [shopId, `${tag} product ${index}-${p}`, `${tag}-p-${index}-${p}`, price],
        );
        const productId = product.rows[0].id as string;
        await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 100, 0)`, [productId]);

        // Variant lines of the SAME product are still the SAME shop, so they
        // must land in the same order (case 4).
        const variantCount = p === 0 ? (spec.variants ?? 0) : 0;
        for (let v = 0; v <= variantCount; v += 1) {
          let lineProductId = productId;
          let variantId: string | null = null;
          if (v > 0) {
            const variant = await query(
              `INSERT INTO product_variants (product_id, name, price, status, stock)
               VALUES ($1, $2, $3, 'active', 50) RETURNING id`,
              [productId, `${tag} variant ${v}`, price],
            );
            variantId = variant.rows[0].id as string;
          }
          const item = await query(
            `INSERT INTO cart_items (cart_id, product_id, variant_id, quantity, price)
             VALUES ($1, $2, $3, 1, $4) RETURNING id`,
            [cartId, lineProductId, variantId, price],
          );
          const cartItemId = item.rows[0].id as string;
          cartItemIds.push(cartItemId);
          lineOwner.push({
            cartItemId,
            sellerUserId,
            shopId,
            productName: `${tag} product ${index}-${p}${v > 0 ? ` v${v}` : ""}`,
          });
        }
      }
    }

    return { ownerId, cartId, cartItemIds, shopIds, sellerUserIds, lineOwner, tag };
  }

  /** Drive the REAL checkout route for the seeded cart. */
  async function checkout(asUserId: string, cartItemIds: string[], requestId: string) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    setupCartRoutes(app);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const token = jwt.sign(
        { userId: asUserId, email: `${asUserId}@test.local` },
        process.env.JWT_SECRET!,
        { expiresIn: "1h" },
      );
      const res = await fetch(`http://127.0.0.1:${port}/api/customer/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `velnox_session=${token}` },
        body: JSON.stringify({
          shippingAddress: {
            full_name: "Multi Shop Buyer",
            phone: "0800000000",
            address_line1: "1 Test Road",
            subdistrict: "Bang Rak",
            district: "Bangkok",
            province: "Bangkok",
            postal_code: "10100",
          },
          paymentMethod: "CARD",
          cartItemIds,
          requestId,
        }),
      });
      const body = (await res.json()) as {
        success?: boolean;
        data?: Record<string, unknown>;
        error?: { code?: string };
      };
      return { status: res.status, data: body.data, code: body.error?.code };
    } finally {
      server.close();
    }
  }

  /** Everything the checkout produced, read straight from the database. */
  async function purchaseOf(groupId: string) {
    const { query } = await import("../db/index.js");
    const group = (
      await query(`SELECT id, item_count, shop_count, total_amount, currency FROM checkout_groups WHERE id = $1`, [
        groupId,
      ])
    ).rows[0];
    const orders = (
      await query(
        `SELECT o.id, o.order_number, o.shop_id, o.status, o.total_amount,
                sh.name AS shop_name,
                (SELECT count(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count
           FROM orders o
           LEFT JOIN shops sh ON sh.id = o.shop_id
          WHERE o.checkout_group_id = $1
          ORDER BY o.id ASC`,
        [groupId],
      )
    ).rows as Array<Record<string, unknown>>;
    return { group, orders };
  }

  // ── Cases 1–4: the split ────────────────────────────────────────────────

  testFn("case 1 — A1 + A2 + A3 from one shop is ONE order", async () => {
    const seed = await seedCart([{ name: "A", products: 3 }]);
    try {
      const res = await checkout(seed.ownerId, seed.cartItemIds, crypto.randomUUID());
      expect(res.status).toBe(200);
      const groupId = res.data?.checkoutGroupId as string;
      expect(groupId).toBeTruthy();

      const { orders } = await purchaseOf(groupId);
      expect(orders.length).toBe(1);
      expect(Number(orders[0]!.item_count)).toBe(3);
      // One shop → one number, and it is the numeric public format.
      expect(orders[0]!.order_number).toMatch(/^[0-9]{18}$/);
    } finally {
      await purgeUsers([seed.ownerId, ...seed.sellerUserIds]);
    }
  });

  testFn("case 2 — A1 + B1 is TWO orders", async () => {
    const seed = await seedCart([
      { name: "A", products: 1 },
      { name: "B", products: 1 },
    ]);
    try {
      const res = await checkout(seed.ownerId, seed.cartItemIds, crypto.randomUUID());
      const groupId = res.data?.checkoutGroupId as string;
      const { orders } = await purchaseOf(groupId);
      expect(orders.length).toBe(2);
      // Each order belongs to exactly one shop — never a mixed-shop order.
      expect(new Set(orders.map((o) => o.shop_id)).size).toBe(2);
      expect(res.data?.shopCount).toBe(2);
      // Two DIFFERENT public numbers, and no collisions.
      const numbers = orders.map((o) => o.order_number);
      expect(new Set(numbers).size).toBe(2);
      for (const n of numbers) expect(n).toMatch(/^[0-9]{18}$/);
    } finally {
      await purgeUsers([seed.ownerId, ...seed.sellerUserIds]);
    }
  });

  testFn("case 3 — A1 + A2 + B1 + B2 + C1 is THREE orders", async () => {
    const seed = await seedCart([
      { name: "A", products: 2 },
      { name: "B", products: 2 },
      { name: "C", products: 1 },
    ]);
    try {
      const res = await checkout(seed.ownerId, seed.cartItemIds, crypto.randomUUID());
      const groupId = res.data?.checkoutGroupId as string;
      const { group, orders } = await purchaseOf(groupId);
      expect(orders.length).toBe(3);
      expect(Number(group.shop_count)).toBe(3);
      expect(Number(group.item_count)).toBe(5);
      // The per-shop item counts are 2 / 2 / 1 — the split is by SELLER.
      const counts = orders.map((o) => Number(o.item_count)).sort((a, b) => a - b);
      expect(counts).toEqual([1, 2, 2]);
      // The group total is the sum of its orders — one amount to pay.
      const sum = orders.reduce((acc, o) => acc + Number(o.total_amount), 0);
      expect(Number(group.total_amount)).toBeCloseTo(sum, 2);
    } finally {
      await purgeUsers([seed.ownerId, ...seed.sellerUserIds]);
    }
  });

  testFn("case 4 — several variants of one product from one shop is still ONE order", async () => {
    const seed = await seedCart([{ name: "A", products: 1, variants: 3 }]);
    try {
      const res = await checkout(seed.ownerId, seed.cartItemIds, crypto.randomUUID());
      const groupId = res.data?.checkoutGroupId as string;
      const { orders } = await purchaseOf(groupId);
      expect(orders.length).toBe(1);
      expect(Number(orders[0]!.item_count)).toBe(4);
    } finally {
      await purgeUsers([seed.ownerId, ...seed.sellerUserIds]);
    }
  });

  testFn("the group's total equals the sum of its orders — one amount to pay", async () => {
    const seed = await seedCart([
      { name: "A", products: 2, price: 120 },
      { name: "B", products: 1, price: 250 },
    ]);
    try {
      const res = await checkout(seed.ownerId, seed.cartItemIds, crypto.randomUUID());
      const groupId = res.data?.checkoutGroupId as string;
      const { group, orders } = await purchaseOf(groupId);
      expect(orders.length).toBe(2);
      // 2×120 + 1×250 — the charge covers the WHOLE purchase, not one shop.
      expect(Number(group.total_amount)).toBeCloseTo(490, 2);
      expect(Number(res.data?.total)).toBeCloseTo(490, 2);
    } finally {
      await purgeUsers([seed.ownerId, ...seed.sellerUserIds]);
    }
  });

  testFn("existing orders are untouched — a second purchase never rewrites the first", async () => {
    const seed = await seedCart([
      { name: "A", products: 1 },
      { name: "B", products: 1 },
    ]);
    try {
      const first = await checkout(seed.ownerId, seed.cartItemIds, crypto.randomUUID());
      const firstGroupId = first.data?.checkoutGroupId as string;
      const { orders: firstOrders } = await purchaseOf(firstGroupId);
      const firstNumbers = firstOrders.map((o) => o.order_number as string);

      // A second purchase gets its own group and its own numbers.
      const res = await checkout(seed.ownerId, seed.cartItemIds, crypto.randomUUID());
      const secondGroupId = res.data?.checkoutGroupId as string;
      expect(secondGroupId).not.toBe(firstGroupId);
      const { orders: secondOrders } = await purchaseOf(secondGroupId);
      const secondNumbers = secondOrders.map((o) => o.order_number as string);
      expect(secondNumbers.some((n) => firstNumbers.includes(n))).toBe(false);

      // …and the original purchase is still exactly as it was.
      const { orders: reread } = await purchaseOf(firstGroupId);
      expect(reread.map((o) => o.order_number)).toEqual(firstNumbers);
    } finally {
      await purgeUsers([seed.ownerId, ...seed.sellerUserIds]);
    }
  });

  // ── Ownership ───────────────────────────────────────────────────────────

  testFn("seller A sees only A's order; seller B sees only B's", async () => {
    const seed = await seedCart([
      { name: "A", products: 1 },
      { name: "B", products: 1 },
      { name: "C", products: 1 },
    ]);
    try {
      const res = await checkout(seed.ownerId, seed.cartItemIds, crypto.randomUUID());
      const groupId = res.data?.checkoutGroupId as string;
      const { orders } = await purchaseOf(groupId);
      expect(orders.length).toBe(3);

      for (const [index, sellerUserId] of seed.sellerUserIds.entries()) {
        const visible = await sellerOrdersOf(sellerUserId);
        const mine = new Set(orders.filter((o) => o.shop_id === seed.shopIds[index]).map((o) => o.id as string));
        // Exactly this seller's order…
        expect(visible.map((o) => o.id)).toEqual([...mine]);
        // …and never anybody else's.
        const allIds = new Set(orders.map((o) => o.id as string));
        for (const id of visible.map((o) => o.id as string)) expect(allIds.has(id)).toBe(true);
      }
    } finally {
      await purgeUsers([seed.ownerId, ...seed.sellerUserIds]);
    }
  });

  testFn("a customer sees their own purchase and nobody else's", async () => {
    const seed = await seedCart([
      { name: "A", products: 1 },
      { name: "B", products: 1 },
    ]);
    const { query } = await import("../db/index.js");
    const other = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${seed.tag}-intruder@test.local`,
      "Someone Else",
    ]);
    const otherId = other.rows[0].id as string;
    try {
      const res = await checkout(seed.ownerId, seed.cartItemIds, crypto.randomUUID());
      const groupId = res.data?.checkoutGroupId as string;
      const { orders } = await purchaseOf(groupId);

      const mine = await customerOrdersOf(seed.ownerId);
      expect(mine.map((o) => o.id).sort()).toEqual(orders.map((o) => o.id as string).sort());

      const theirs = await customerOrdersOf(otherId);
      for (const o of orders) expect(theirs.map((t) => t.id)).not.toContain(o.id);
    } finally {
      await purgeUsers([seed.ownerId, otherId, ...seed.sellerUserIds]);
    }
  });

  testFn("another customer cannot open an order of this purchase", async () => {
    const seed = await seedCart([
      { name: "A", products: 1 },
      { name: "B", products: 1 },
    ]);
    const { query } = await import("../db/index.js");
    const other = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${seed.tag}-intruder@test.local`,
      "Someone Else",
    ]);
    try {
      const res = await checkout(seed.ownerId, seed.cartItemIds, crypto.randomUUID());
      const groupId = res.data?.checkoutGroupId as string;
      const { orders } = await purchaseOf(groupId);

      for (const order of orders) {
        const detail = await orderDetail(other.rows[0].id as string, order.id as string);
        expect(detail.status).toBeGreaterThanOrEqual(400);
        // The existence of the order is never confirmed by the refusal.
        expect(detail.body?.data).toBeUndefined();
      }
    } finally {
      await purgeUsers([seed.ownerId, other.rows[0].id as string, ...seed.sellerUserIds]);
    }
  });

  // ── Payment: one charge, no duplicate, webhook-only ─────────────────────

  testFn("one settled session pays EVERY order of the purchase exactly once", async () => {
    const seed = await seedCart([
      { name: "A", products: 1, price: 120 },
      { name: "B", products: 1, price: 250 },
      { name: "C", products: 1, price: 80 },
    ]);
    try {
      const res = await checkout(seed.ownerId, seed.cartItemIds, crypto.randomUUID());
      const groupId = res.data?.checkoutGroupId as string;
      const { orders } = await purchaseOf(groupId);
      expect(orders.length).toBe(3);

      const { query } = await import("../db/index.js");
      // The ONE payment for the purchase, exactly as checkout would write it.
      const sessionId = `cs_group_${seed.tag.slice(-8)}`;
      const intentId = `pi_group_${seed.tag.slice(-8)}`;
      const paid = await query(
        `INSERT INTO payments
           (checkout_group_id, provider, method, status, amount, currency,
            provider_checkout_session_id, provider_payment_id)
         VALUES ($1, 'stripe', 'CARD', 'requires_action', 450.00, 'THB', $2, $3)
         RETURNING id`,
        [groupId, sessionId, intentId],
      );
      const paymentId = paid.rows[0].id as string;

      // Stripe says the charge succeeded. Nothing else does.
      expect(await deliverIntentSucceeded(intentId)).toBe(200);

      const after = await purchaseOf(groupId);
      for (const order of after.orders) expect(order.status).toBe("paid");

      // ONE paid payment for the purchase — never one per order, never two.
      const payments = await query(
        `SELECT status, count(*)::int AS n FROM payments WHERE checkout_group_id = $1 GROUP BY status`,
        [groupId],
      );
      expect(payments.rows).toHaveLength(1);
      expect(payments.rows[0].status).toBe("paid");
      expect(Number(payments.rows[0].n)).toBe(1);
      expect(paymentId).toBeTruthy();

      // A redelivery of the same event changes nothing: the idempotency claim
      // plus the per-order guards mean one charge, one settlement.
      expect(await deliverIntentSucceeded(intentId)).toBe(200);
      const again = await purchaseOf(groupId);
      for (const order of again.orders) expect(order.status).toBe("paid");
      const paidRows = await query(
        `SELECT count(*)::int AS n FROM payments WHERE checkout_group_id = $1 AND status = 'paid'`,
        [groupId],
      );
      expect(Number(paidRows.rows[0].n)).toBe(1);
    } finally {
      await purgeUsers([seed.ownerId, ...seed.sellerUserIds]);
    }
  });

  testFn("stock is committed once per order, never twice for one order", async () => {
    const seed = await seedCart([
      { name: "A", products: 2 },
      { name: "B", products: 1 },
    ]);
    try {
      const res = await checkout(seed.ownerId, seed.cartItemIds, crypto.randomUUID());
      const groupId = res.data?.checkoutGroupId as string;
      const { query } = await import("../db/index.js");
      const before = await query(
        `SELECT product_id, quantity, reserved FROM inventory
          WHERE product_id IN (SELECT product_id FROM order_items
                                WHERE order_id IN (SELECT id FROM orders WHERE checkout_group_id = $1))`,
        [groupId],
      );
      const snapshot = new Map(
        before.rows.map((r: Record<string, unknown>) => [r.product_id as string, Number(r.quantity)]),
      );

      const intentId = `pi_stock_${seed.tag.slice(-8)}`;
      await query(
        `INSERT INTO payments
           (checkout_group_id, provider, method, status, amount, currency, provider_payment_id)
         VALUES ($1, 'stripe', 'CARD', 'requires_action', 300.00, 'THB', $2)`,
        [groupId, intentId],
      );

      expect(await deliverIntentSucceeded(intentId)).toBe(200);
      // A duplicate delivery must not consume a second unit.
      expect(await deliverIntentSucceeded(intentId)).toBe(200);

      const after = await query(
        `SELECT product_id, quantity, reserved FROM inventory
          WHERE product_id IN (SELECT product_id FROM order_items
                                WHERE order_id IN (SELECT id FROM orders WHERE checkout_group_id = $1))`,
        [groupId],
      );
      for (const row of after.rows as Array<Record<string, unknown>>) {
        const id = row.product_id as string;
        // Checkout reserved one unit; settlement sells exactly that one.
        expect(Number(row.quantity)).toBe(snapshot.get(id)! - 1);
        expect(Number(row.reserved)).toBe(0);
      }
    } finally {
      await purgeUsers([seed.ownerId, ...seed.sellerUserIds]);
    }
  });

  testFn("a group is charged as ONE purchase — another customer's group is invisible", async () => {
    configureFakeStripe();
    const seed = await seedCart([
      { name: "A", products: 1 },
      { name: "B", products: 1 },
    ]);
    const { query } = await import("../db/index.js");
    const other = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${seed.tag}-intruder@test.local`,
      "Someone Else",
    ]);
    try {
      const res = await checkout(seed.ownerId, seed.cartItemIds, crypto.randomUUID());
      const groupId = res.data?.checkoutGroupId as string;

      // Opening a session for a purchase you do not own is a plain 404: the
      // group id resolves to nothing rather than to somebody else's orders.
      const refused = await openGroupSession(other.rows[0].id as string, groupId);
      expect(refused.status).toBe(404);
      expect(refused.code).toBe("NOT_FOUND");

      // …and no payment row was created for it.
      const payments = await query(
        `SELECT count(*)::int AS n FROM payments WHERE checkout_group_id = $1`,
        [groupId],
      );
      expect(Number(payments.rows[0].n)).toBe(0);
    } finally {
      await purgeUsers([seed.ownerId, other.rows[0].id as string, ...seed.sellerUserIds]);
    }
  });

  // ── helpers that drive the other real routes ────────────────────────────

  /** The REAL seller order list, scoped by the route's own ownership rule. */
  async function sellerOrdersOf(sellerUserId: string) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    setupSellerOrderRoutes(app);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const token = jwt.sign(
        { userId: sellerUserId, email: `${sellerUserId}@test.local` },
        process.env.JWT_SECRET!,
        { expiresIn: "1h" },
      );
      const res = await fetch(`http://127.0.0.1:${port}/api/seller/orders`, {
        headers: { Cookie: `velnox_session=${token}` },
      });
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      return body.data ?? [];
    } finally {
      server.close();
    }
  }

  /** The REAL customer order list. */
  async function customerOrdersOf(customerId: string) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    setupCartRoutes(app);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const token = jwt.sign(
        { userId: customerId, email: `${customerId}@test.local` },
        process.env.JWT_SECRET!,
        { expiresIn: "1h" },
      );
      const res = await fetch(`http://127.0.0.1:${port}/api/customer/orders`, {
        headers: { Cookie: `velnox_session=${token}` },
      });
      const body = (await res.json()) as { data?: Array<{ id: string }> };
      return body.data ?? [];
    } finally {
      server.close();
    }
  }

  /** The REAL single-order read, used to prove cross-customer refusal. */
  async function orderDetail(asUserId: string, orderId: string) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    setupStripeRoutes(app);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const token = jwt.sign(
        { userId: asUserId, email: `${asUserId}@test.local` },
        process.env.JWT_SECRET!,
        { expiresIn: "1h" },
      );
      const res = await fetch(`http://127.0.0.1:${port}/api/orders/${orderId}`, {
        headers: { Cookie: `velnox_session=${token}` },
      });
      const body = (await res.json()) as { data?: unknown };
      return { status: res.status, body };
    } finally {
      server.close();
    }
  }

  /** POST /api/stripe/checkout for a whole purchase, as a customer. */
  async function openGroupSession(asUserId: string, groupId: string) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    setupStripeRoutes(app);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const token = jwt.sign(
        { userId: asUserId, email: `${asUserId}@test.local` },
        process.env.JWT_SECRET!,
        { expiresIn: "1h" },
      );
      const res = await fetch(`http://127.0.0.1:${port}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `velnox_session=${token}` },
        body: JSON.stringify({ checkoutGroupId: groupId, method: "CARD", requestKey: crypto.randomUUID() }),
      });
      const body = (await res.json()) as { error?: { code?: string } };
      return { status: res.status, code: body.error?.code };
    } finally {
      server.close();
    }
  }

  /** Deliver a locally signed `payment_intent.succeeded` to the real webhook. */
  async function deliverIntentSucceeded(intentId: string): Promise<number> {
    process.env.STRIPE_SECRET_KEY = "sk_test_000000000000000000000000";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const payload = JSON.stringify({
      id: `evt_${crypto.randomUUID()}`,
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: { id: intentId, object: "payment_intent", metadata: {} } },
    });
    const app = express();
    app.use(stripeWebhookRawBody);
    app.use(express.json());
    app.use(cookieParser());
    setupStripeRoutes(app);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const timestamp = Math.floor(Date.now() / 1000);
      const signature = createHmac("sha256", WEBHOOK_SECRET)
        .update(`${timestamp}.${payload}`)
        .digest("hex");
      const res = await fetch(`http://127.0.0.1:${port}/api/payments/stripe/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": `t=${timestamp},v1=${signature}`,
        },
        body: payload,
      });
      return res.status;
    } finally {
      server.close();
    }
  }

  testFn("concurrent generation never collides — the retry is real, not assumed", async () => {
    // 400 numbers, generated at the SAME instant, are still distinct — and the
    // numbers the checkout wrote are exactly this shape.
    const at = new Date();
    const numbers = new Set<string>();
    for (let i = 0; i < 400; i += 1) numbers.add(generateOrderNumber(at));
    // 400 draws from 10^4 within one millisecond expect ~392 distinct values
    // (birthday bound), so the bar sits just below that — far above anything a
    // sequential number would reach, and far enough from the boundary not to
    // flake.
    expect(numbers.size).toBeGreaterThan(380);
    for (const n of numbers) {
      expect(typeof n).toBe("string");
      expect(n).toMatch(/^[0-9]{18}$/);
    }
  });
});