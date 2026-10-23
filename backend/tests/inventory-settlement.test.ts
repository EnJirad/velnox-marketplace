/**
 * Inventory settlement & release — ONE commit path, ONE release path.
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * Full-system audit §42 (handoff, 2026-09-29) found two CRITICAL defects:
 *
 *   #1  `markPaymentSucceeded` decremented `inventory.reserved` and incremented
 *       `products.sold_count` but NEVER decremented `inventory.quantity`, and
 *       it did so for every line by `product_id` — so for a VARIANT line it
 *       decremented a hold belonging to somebody else. Availability is
 *       `quantity - reserved`, so the moment a payment settled the sold units
 *       became purchasable again.
 *
 *   #2  `PATCH /api/seller/orders/:id/status` restored stock with its OWN
 *       inline `UPDATE inventory` / `UPDATE product_variants`, bypassing the
 *       `inventory_released` claim in `releaseOrderInventory()` — a second
 *       release path that could restore the same units twice.
 *
 * This file pins both halves of the fix:
 *
 *   • SETTLEMENT consumes (quantity −N, reserved −N, sold_count +N) exactly
 *     once — Tests A, B, C, I2.
 *   • RELEASE converges on `releaseOrderInventory()` and happens at most once
 *     per reservation — Tests D, E and the races F/G/I/J/K.
 *
 * HOW A DOUBLE RELEASE IS MADE VISIBLE
 * ------------------------------------
 * Both stock writes are floored (`GREATEST(0, …)`), so restoring too much is
 * invisible on a product whose hold is the only thing in `reserved`. Every
 * exactly-once test therefore seeds the product with a SECOND, unrelated open
 * order's hold (`reserved = 2·q` while this order owns only `q` of it):
 *
 *     one release  → reserved = q   (the stranger's hold survives)   PASS
 *     two releases → reserved = 0   (somebody else's hold was wiped) FAIL
 *
 * Evidence tiers: the structural describe runs in every environment; the
 * `describeDb` block needs `TEST_DATABASE_URL` (a disposable PostgreSQL) and is
 * executed by CI's `postgres:16` service — locally it skips, like the rest of
 * this suite. No real Stripe call is made: webhook cases sign a payload locally
 * with Stripe's own scheme.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import { readFileSync } from "fs";
import jwt from "jsonwebtoken";
import { join } from "path";

import { expirePaymentReservation } from "../jobs/payment-reservation-scheduler.js";
import { reserveInventoryStock } from "../lib/inventory.js";
import { stripeWebhookRawBody } from "../middleware/stripe-raw-body.js";
import { setupCartRoutes } from "../routes/cart.js";
import { setupSellerOrderRoutes } from "../routes/seller-orders.js";
import { setupStripeRoutes } from "../routes/stripe.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

// ═══════════════════════════════════════════════════════════════════════════
// 1. Structural contract (no database) — the authorities can only live once
// ═══════════════════════════════════════════════════════════════════════════

describe("inventory authorities — structural contract", () => {
  const INVENTORY_LIB = "backend/lib/inventory.ts";

  test("settlement and release are both defined in the ONE inventory module", () => {
    const lib = read(INVENTORY_LIB);
    expect(lib).toContain("export async function commitOrderInventory(");
    expect(lib).toContain("export async function releaseOrderInventory(");
    expect(lib).toContain("export async function reserveInventoryStock(");

    // Commit consumes BOTH columns of a non-variant hold and counts the sale…
    expect(lib).toContain("SET quantity = GREATEST(0, quantity - $1)");
    expect(lib).toContain("reserved = GREATEST(0, reserved - $1)");
    expect(lib).toContain("sold_count = sold_count + $1");
    // …reads the lines variant-aware (the old stripe.ts read was product-only)…
    expect(lib).toContain("SELECT product_id, variant_id, quantity FROM order_items");
    // …and never falls back to the parent inventory row for a variant line.
    expect(lib).toContain("Variant: `product_variants.stock` was decremented at reserve time");

    // Release claims the flag atomically AND refuses an order whose money
    // settled — COMMIT + RELEASE on one reservation is impossible either way.
    expect(lib).toContain("AND inventory_released = FALSE");
    expect(lib).toContain("AND status = ANY($2::text[])");
    expect(lib).toContain("p.status = ANY($3::text[])");
    expect(lib).toContain("refusing a second terminal transition");
  });

  test("no order-lifecycle route writes inventory directly any more", () => {
    // These are the writers of an ORDER's stock. `products.ts` (set stock) and
    // `product-options.ts` (edit a variant) are product-management writes and
    // are deliberately out of this list; `velrepeat-scheduler.ts` reserves at
    // creation and is a known, separate finding (audit §42 MEDIUM #10).
    const orderPaths = [
      "backend/routes/cart.ts",
      "backend/routes/stripe.ts",
      "backend/routes/seller-orders.ts",
      "backend/routes/center.ts",
      "backend/jobs/payment-reservation-scheduler.ts",
    ];
    for (const path of orderPaths) {
      const src = read(path);
      // The `inventory` table is owned by lib/inventory.ts: an order path may
      // RESERVE through `reserveInventoryStock()` and release through
      // `releaseOrderInventory()`, but it may never write a row itself.
      expect(src, `${path} must not write the inventory table itself`).not.toContain(
        "UPDATE inventory",
      );
      // …and no path may RESTORE stock on its own — that is exactly what
      // `stock = stock +` means, and it is the shape the old seller route used.
      // (checkout's `stock = stock - $1 … WHERE stock >= $1` is the RESERVE
      // direction and is deliberately left alone.)
      expect(src, `${path} must not restore stock itself`).not.toContain("stock = stock +");
      expect(src, `${path} must not count sales itself`).not.toContain("sold_count = sold_count +");
    }

    // …and the settlement/release calls are exactly where they belong.
    const stripe = read("backend/routes/stripe.ts");
    expect(stripe).toContain("await commitOrderInventory(client, orderId);");
    expect(stripe).toContain("releaseOrderInventory(client, orderId)");
    // The variant-blind read that drove the old inline loop is gone.
    expect(stripe).not.toContain("SELECT product_id, quantity FROM order_items");
    expect(stripe).not.toContain("sold_count = sold_count +");
    const seller = read("backend/routes/seller-orders.ts");
    expect(seller).toContain("await releaseOrderInventory(client, orderId);");
    // The release must come AFTER the status claim — the claim is what makes
    // the `inventory_released` claim win at most once.
    expect(seller.indexOf("UPDATE orders SET status = $1")).toBeLessThan(
      seller.indexOf("releaseOrderInventory(client, orderId)"),
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Database-gated: the real transitions, the real stock, real concurrency
// ═══════════════════════════════════════════════════════════════════════════

const describeDb = hasTestDatabase() ? describe : describe.skip;

describeDb("inventory settlement & release (requires TEST_DATABASE_URL)", () => {
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

  function sessionToken(userId: string): string {
    return jwt.sign({ userId, email: `${userId}@test.local` }, process.env.JWT_SECRET!, {
      expiresIn: "1h",
    });
  }

  function stripeSignature(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)) {
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    return `t=${timestamp},v1=${signature}`;
  }

  /** The REAL middleware `server.ts` mounts, in the real order — not a copy. */
  function buildApp(): express.Express {
    const app = express();
    app.use(stripeWebhookRawBody);
    app.use(express.json());
    app.use(cookieParser());
    setupCartRoutes(app);
    setupStripeRoutes(app);
    setupSellerOrderRoutes(app);
    return app;
  }

  async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
    const server = buildApp().listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      return await fn(`http://127.0.0.1:${port}`);
    } finally {
      server.close();
    }
  }

  /** Deliver a locally signed Stripe event to the real webhook route. */
  async function deliverWebhook(event: Record<string, unknown>): Promise<number> {
    process.env.STRIPE_SECRET_KEY = "sk_test_000000000000000000000000";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const payload = JSON.stringify(event);
    return withServer(async (base) => {
      const res = await fetch(`${base}/api/payments/stripe/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET),
        },
        body: payload,
      });
      return res.status;
    });
  }

  /** A DISTINCT event for the same charge: the payment_events claim cannot
   *  absorb it, so the ORDER claim is what must refuse the second settle. */
  function succeededEvent(orderId: string) {
    return {
      id: `evt_${crypto.randomUUID()}`,
      object: "event",
      type: "payment_intent.succeeded",
      data: {
        object: {
          id: `pi_${crypto.randomUUID()}`,
          object: "payment_intent",
          metadata: { orderId },
        },
      },
    };
  }

  /** The provider closing the abandoned session — the webhook CANCEL path. */
  function expiredSessionEvent(orderId: string) {
    return {
      id: `evt_${crypto.randomUUID()}`,
      object: "event",
      type: "checkout.session.expired",
      data: {
        object: {
          id: `cs_test_${crypto.randomUUID()}`,
          object: "checkout.session",
          metadata: { orderId },
        },
      },
    };
  }

  interface Seed {
    quantity?: number;
    /** Units a SECOND, unrelated order holds — the double-release probe. */
    otherHold?: number;
    soldCount?: number;
  }

  /** owner → approved seller → shop → product → inventory. */
  async function seedShop(opts: Seed = {}) {
    const { query } = await import("../db/index.js");
    const tag = `stl-${crypto.randomUUID()}`;
    const owner = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-owner@test.local`,
      "Settlement Owner",
    ]);
    const ownerId = owner.rows[0].id as string;
    const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-seller@test.local`,
      "Settlement Seller",
    ]);
    const sellerUserId = sellerUser.rows[0].id as string;
    const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [
      sellerUserId,
    ]);
    const shop = await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
      seller.rows[0].id,
      `${tag} shop`,
      tag,
    ]);
    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status, sold_count)
       VALUES ($1, $2, $3, 120.00, 'published', $4) RETURNING id`,
      [shop.rows[0].id, `${tag} product`, `${tag}-p`, opts.soldCount ?? 0],
    );
    const productId = product.rows[0].id as string;
    await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, $2, $3)`, [
      productId,
      opts.quantity ?? 50,
      opts.otherHold ?? 0,
    ]);
    return { ownerId, sellerUserId, shopId: shop.rows[0].id as string, productId, tag };
  }

  /** A variant row, plus its sibling so "only mine changed" is provable. */
  async function seedVariant(productId: string, name: string, stock: number): Promise<string> {
    const { query } = await import("../db/index.js");
    const row = await query(
      `INSERT INTO product_variants (product_id, name, price, stock) VALUES ($1, $2, 120.00, $3) RETURNING id`,
      [productId, name, stock],
    );
    return row.rows[0].id as string;
  }

  interface OrderOpts {
    /** Units this order holds (written into `inventory.reserved`). */
    hold?: number;
    q?: number;
    status?: string;
    variantId?: string | null;
    /** Apply the hold with the REAL reserve function instead of seeding it. */
    realReserve?: boolean;
  }

  /**
   * An order (+ item) holding `q` units. The hold is seeded the way checkout
   * writes it (`inventory.reserved += q`, or `product_variants.stock -= q`),
   * so a correct release returns exactly `q` and a second one does not.
   */
  async function seedOrder(shop: Awaited<ReturnType<typeof seedShop>>, opts: OrderOpts = {}) {
    const { query, withTransaction } = await import("../db/index.js");
    const q = opts.q ?? 2;
    const hold = opts.hold ?? q;
    const status = opts.status ?? "pending_payment";

    if (opts.variantId) {
      // The statement checkout runs for a variant line (routes/cart.ts).
      await query(
        `UPDATE product_variants SET stock = stock - $1, updated_at = NOW() WHERE id = $2 AND stock >= $1`,
        [hold, opts.variantId],
      );
    } else if (opts.realReserve) {
      await withTransaction((client) => reserveInventoryStock(client, shop.productId, hold));
    } else if (hold > 0) {
      await query(`UPDATE inventory SET reserved = reserved + $1 WHERE product_id = $2`, [
        hold,
        shop.productId,
      ]);
    }

    const order = await query(
      `INSERT INTO orders (user_id, shop_id, order_number, status, total_amount, currency, inventory_released)
       VALUES ($1, $2, $3, $4, 360.00, 'THB', false) RETURNING id`,
      [shop.ownerId, shop.shopId, `STL-${shop.tag.slice(-12)}-${(crypto.randomUUID() as string).slice(0, 4)}`, status],
    );
    const orderId = order.rows[0].id as string;
    await query(
      `INSERT INTO order_items (order_id, product_id, shop_id, product_name, variant_id, quantity, price, subtotal)
       VALUES ($1, $2, $3, $4, $5, $6, 120.00, $7)`,
      [orderId, shop.productId, shop.shopId, `${shop.tag} product`, opts.variantId ?? null, q, q * 120],
    );
    await query(
      `INSERT INTO payments (order_id, provider, method, amount, currency, status)
       VALUES ($1, 'stripe', 'CARD', 360.00, 'THB', 'requires_action')`,
      [orderId],
    );
    return { orderId, q };
  }

  /** Everything a settlement/release can change, read back in one place. */
  async function stateOf(orderId: string, productId: string) {
    const { query } = await import("../db/index.js");
    const order = (
      await query(`SELECT status, inventory_released FROM orders WHERE id = $1`, [orderId])
    ).rows[0];
    const inventory = (
      await query(`SELECT quantity, reserved FROM inventory WHERE product_id = $1`, [productId])
    ).rows[0];
    const product = (await query(`SELECT sold_count FROM products WHERE id = $1`, [productId]))
      .rows[0];
    const quantity = Number(inventory.quantity);
    const reserved = Number(inventory.reserved);
    return {
      status: order.status as string,
      inventoryReleased: order.inventory_released as boolean,
      quantity,
      reserved,
      /** on-hand minus held — what every other customer can still buy. */
      available: quantity - reserved,
      soldCount: Number(product.sold_count),
    };
  }

  async function inventoryOf(productId: string): Promise<{ quantity: number; reserved: number }> {
    const { query } = await import("../db/index.js");
    const row = (
      await query(`SELECT quantity, reserved FROM inventory WHERE product_id = $1`, [productId])
    ).rows[0];
    return { quantity: Number(row.quantity), reserved: Number(row.reserved) };
  }

  async function variantStock(variantId: string): Promise<number> {
    const { query } = await import("../db/index.js");
    const row = (await query(`SELECT stock FROM product_variants WHERE id = $1`, [variantId])).rows[0];
    return Number(row.stock);
  }

  /** The seller's real transition endpoint (ownership resolved from session). */
  async function sellerCancel(base: string, orderId: string, sellerUserId: string) {
    const res = await fetch(`${base}/api/seller/orders/${orderId}/status`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: `velnox_session=${sessionToken(sellerUserId)}`,
      },
      body: JSON.stringify({ status: "cancelled" }),
    });
    return { status: res.status, body: (await res.json()) as { error?: { code?: string } } };
  }

  /** The customer's real cancellation endpoint. */
  async function customerCancel(base: string, orderId: string, ownerId: string) {
    const res = await fetch(`${base}/api/customer/orders/${orderId}/cancel`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Cookie: `velnox_session=${sessionToken(ownerId)}`,
      },
    });
    return { status: res.status, body: (await res.json()) as { error?: { code?: string } } };
  }

  // ── Test A + J: non-variant settlement consumes exactly once ─────────────

  test("A/J — settlement: quantity −N, reserved −N, sold_count +N, once", async () => {
    const shop = await seedShop({ quantity: 50 });
    // The REAL reserve function takes the hold (50 on-hand, 2 held → 48 free).
    const order = await seedOrder(shop, { q: 2, realReserve: true });
    try {
      const held = await stateOf(order.orderId, shop.productId);
      expect(held.quantity).toBe(50);
      expect(held.reserved).toBe(2);
      expect(held.available).toBe(48);
      expect(held.soldCount).toBe(0);

      expect(await deliverWebhook(succeededEvent(order.orderId))).toBe(200);

      const paid = await stateOf(order.orderId, shop.productId);
      expect(paid.status).toBe("paid");
      expect(paid.quantity).toBe(48); // 50 − 2  ← CRITICAL #1: was pinned at 50
      expect(paid.reserved).toBe(0); // the hold ended with the sale
      expect(paid.soldCount).toBe(2); // counted once
      expect(paid.inventoryReleased).toBe(false);
      // Availability is unchanged by a sale: nobody else gains or loses a unit.
      expect(paid.available).toBe(48);
      expect(paid.quantity).toBeGreaterThanOrEqual(0);
    } finally {
      await purgeUsers([shop.ownerId, shop.sellerUserId]);
    }
  });

  // ── Test B: the VARIANT line, and only that variant, is consumed ─────────

  test("B — variant settlement consumes that variant and never the parent's hold", async () => {
    const shop = await seedShop({ quantity: 50, otherHold: 3 });
    const red = await seedVariant(shop.productId, "Red / M", 10);
    const blue = await seedVariant(shop.productId, "Blue / L", 7);
    const order = await seedOrder(shop, { q: 2, variantId: red, hold: 2 });
    try {
      expect(await variantStock(red)).toBe(8); // checkout already took the 2
      expect(await variantStock(blue)).toBe(7);
      const held = await stateOf(order.orderId, shop.productId);
      // A variant's hold lives in `product_variants.stock` — the parent's
      // `inventory` row still belongs to the OTHER order holding 3 units.
      expect(held.reserved).toBe(3);

      expect(await deliverWebhook(succeededEvent(order.orderId))).toBe(200);

      const paid = await stateOf(order.orderId, shop.productId);
      expect(paid.status).toBe("paid");
      // Consumed = still decremented. Nothing restored it, nothing decremented
      // it twice, and its sibling is untouched.
      expect(await variantStock(red)).toBe(8);
      expect(await variantStock(blue)).toBe(7);
      // CRITICAL #1/#7: the parent inventory row is NOT this order's stock —
      // the old loop decremented `reserved` here and wiped the other hold.
      expect(paid.quantity).toBe(50);
      expect(paid.reserved).toBe(3);
      expect(paid.soldCount).toBe(2);
      expect(paid.inventoryReleased).toBe(false);
    } finally {
      await purgeUsers([shop.ownerId, shop.sellerUserId]);
    }
  });

  // ── Test C: a second settlement changes nothing ──────────────────────────

  test("C — a second, differently-identified settlement consumes nothing more", async () => {
    const shop = await seedShop({ quantity: 50 });
    const order = await seedOrder(shop, { q: 2, realReserve: true });
    try {
      expect(await deliverWebhook(succeededEvent(order.orderId))).toBe(200);
      const first = await stateOf(order.orderId, shop.productId);
      expect(first.quantity).toBe(48);

      // A different event id for the same charge: the payment_events claim
      // cannot absorb it, so the ORDER claim is what must refuse.
      expect(await deliverWebhook(succeededEvent(order.orderId))).toBe(200);

      const second = await stateOf(order.orderId, shop.productId);
      expect(second.quantity).toBe(48); // not 46
      expect(second.reserved).toBe(0); // not −2
      expect(second.soldCount).toBe(2); // not 4
      expect(second.inventoryReleased).toBe(false);
      expect(second.status).toBe("paid");
    } finally {
      await purgeUsers([shop.ownerId, shop.sellerUserId]);
    }
  });

  // ── Test D + race 9: duplicate cancellation releases once ────────────────

  test("D — a cancellation (issued twice, concurrently) releases exactly once", async () => {
    // reserved = 2·q with only q belonging to this order: a second release
    // would wipe the stranger's hold and land on 0 instead of q.
    const shop = await seedShop({ quantity: 50, otherHold: 2 });
    const order = await seedOrder(shop, { q: 2, hold: 2 });
    try {
      const before = await stateOf(order.orderId, shop.productId);
      expect(before.reserved).toBe(4);

      const statuses = await Promise.all([
        withServer((base) => customerCancel(base, order.orderId, shop.ownerId)),
        withServer((base) => customerCancel(base, order.orderId, shop.ownerId)),
      ]);
      expect(statuses.map((r) => r.status)).toContain(200);

      const after = await stateOf(order.orderId, shop.productId);
      expect(after.status).toBe("cancelled");
      expect(after.inventoryReleased).toBe(true);
      expect(after.reserved).toBe(2); // OUR 2 returned, the stranger's 2 intact
      expect(after.quantity).toBe(50); // release never touches on-hand
      expect(after.soldCount).toBe(0);
    } finally {
      await purgeUsers([shop.ownerId, shop.sellerUserId]);
    }
  });

  // ── Test E: the seller goes through the ONE release authority ────────────

  test("E — seller cancellation restores stock exactly once, through the authority", async () => {
    const shop = await seedShop({ quantity: 50, otherHold: 2 });
    const order = await seedOrder(shop, { q: 2, hold: 2 });
    try {
      const first = await withServer((base) => sellerCancel(base, order.orderId, shop.sellerUserId));
      expect(first.status).toBe(200);

      const after = await stateOf(order.orderId, shop.productId);
      expect(after.status).toBe("cancelled");
      // The CLAIM — the old inline restore never set this flag.
      expect(after.inventoryReleased).toBe(true);
      expect(after.reserved).toBe(2); // once, and the stranger's hold survives
      expect(after.quantity).toBe(50);

      // A repeated cancel is refused by the state machine AND changes nothing.
      const repeat = await withServer((base) => sellerCancel(base, order.orderId, shop.sellerUserId));
      expect(repeat.status).toBe(400);
      const again = await stateOf(order.orderId, shop.productId);
      expect(again.reserved).toBe(2);
      expect(again.quantity).toBe(50);
    } finally {
      await purgeUsers([shop.ownerId, shop.sellerUserId]);
    }
  });

  // ── Race 5: seller cancel ∥ webhook cancellation ─────────────────────────

  test("F — seller cancel ∥ checkout.session.expired: one release, never two", async () => {
    const shop = await seedShop({ quantity: 50, otherHold: 2 });
    const order = await seedOrder(shop, { q: 2, hold: 2 });
    try {
      const [sellerRes, webhookStatus] = await Promise.all([
        withServer((base) => sellerCancel(base, order.orderId, shop.sellerUserId)),
        deliverWebhook(expiredSessionEvent(order.orderId)),
      ]);
      // The loser looks at an order that is already terminal: the seller is
      // refused by the state machine, the webhook still acknowledges.
      expect([200, 400]).toContain(sellerRes.status);
      expect(webhookStatus).toBe(200);

      const after = await stateOf(order.orderId, shop.productId);
      expect(after.status).toBe("cancelled");
      expect(after.inventoryReleased).toBe(true);
      expect(after.reserved).toBe(2); // ← a double release would make this 0
      expect(after.quantity).toBe(50);
      expect(after.soldCount).toBe(0);
    } finally {
      await purgeUsers([shop.ownerId, shop.sellerUserId]);
    }
  });

  // ── Race 7: expiry ∥ webhook cancellation ────────────────────────────────

  test("G — expiry sweep ∥ checkout.session.expired: one release, never two", async () => {
    const shop = await seedShop({ quantity: 50, otherHold: 2 });
    const order = await seedOrder(shop, { q: 2, hold: 2 });
    try {
      const { query } = await import("../db/index.js");
      await query(`UPDATE orders SET payment_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [
        order.orderId,
      ]);

      const [expiry, webhookStatus] = await Promise.all([
        expirePaymentReservation(order.orderId),
        deliverWebhook(expiredSessionEvent(order.orderId)),
      ]);

      // Whichever writer moved the order first, the other reports no-op.
      expect(["expired", "skipped"]).toContain(expiry.outcome);
      expect(webhookStatus).toBe(200);
      const after = await stateOf(order.orderId, shop.productId);
      expect(["expired", "cancelled"]).toContain(after.status);
      expect(after.inventoryReleased).toBe(true);
      expect(after.reserved).toBe(2); // ← a double release would make this 0
      expect(after.quantity).toBe(50);
      expect(after.soldCount).toBe(0);
    } finally {
      await purgeUsers([shop.ownerId, shop.sellerUserId]);
    }
  });

  // ── Race 10: the same expiry issued twice ────────────────────────────────

  test("H2 — the expiry sweep run twice concurrently expires once", async () => {
    const shop = await seedShop({ quantity: 50, otherHold: 2 });
    const order = await seedOrder(shop, { q: 2, hold: 2 });
    try {
      const { query } = await import("../db/index.js");
      await query(`UPDATE orders SET payment_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [
        order.orderId,
      ]);
      const outcomes = await Promise.all([
        expirePaymentReservation(order.orderId),
        expirePaymentReservation(order.orderId),
      ]);
      expect(outcomes.filter((o) => o.outcome === "expired")).toHaveLength(1);
      expect(outcomes.filter((o) => o.outcome !== "expired")).toHaveLength(1);
      expect(outcomes.every((o) => o.outcome === "expired" || o.outcome === "skipped")).toBe(true);

      const after = await stateOf(order.orderId, shop.productId);
      expect(after.status).toBe("expired");
      expect(after.inventoryReleased).toBe(true);
      expect(after.reserved).toBe(2); // released once
      expect(after.quantity).toBe(50);
    } finally {
      await purgeUsers([shop.ownerId, shop.sellerUserId]);
    }
  });

  // ── Race 6: customer cancel ∥ webhook cancellation ───────────────────────

  test("I — customer cancel ∥ checkout.session.expired: one release, never two", async () => {
    const shop = await seedShop({ quantity: 50, otherHold: 2 });
    const order = await seedOrder(shop, { q: 2, hold: 2 });
    try {
      const [cancelRes, webhookStatus] = await Promise.all([
        withServer((base) => customerCancel(base, order.orderId, shop.ownerId)),
        deliverWebhook(expiredSessionEvent(order.orderId)),
      ]);
      expect([200, 409]).toContain(cancelRes.status);
      expect(webhookStatus).toBe(200);

      const after = await stateOf(order.orderId, shop.productId);
      expect(after.status).toBe("cancelled");
      expect(after.inventoryReleased).toBe(true);
      expect(after.reserved).toBe(2); // ← a double release would make this 0
      expect(after.quantity).toBe(50);
      expect(after.soldCount).toBe(0);
    } finally {
      await purgeUsers([shop.ownerId, shop.sellerUserId]);
    }
  });

  // ── Race 2: payment success ∥ seller cancel ──────────────────────────────

  test("J — settlement ∥ seller cancel: commit XOR release, never both", async () => {
    const shop = await seedShop({ quantity: 50, otherHold: 2 });
    const order = await seedOrder(shop, { q: 2, hold: 2 });
    try {
      const [webhookStatus, sellerRes] = await Promise.all([
        deliverWebhook(succeededEvent(order.orderId)),
        withServer((base) => sellerCancel(base, order.orderId, shop.sellerUserId)),
      ]);
      expect(webhookStatus).toBe(200);
      // 200 — the seller cancelled first, while the money was still pending.
      // 400 — the state machine refused (the order had already moved on).
      // 409 — the cancellation gate: the webhook committed `paid` first, so the
      //        order may not be cancelled at all (a refund is an operator flow).
      expect([200, 400, 409]).toContain(sellerRes.status);

      const after = await stateOf(order.orderId, shop.productId);
      // Exactly ONE terminal inventory transition for this reservation:
      //  • committed — the units left the shelf and were never returned, or
      //  • released  — the hold went back and nothing was counted as sold.
      const committed = after.soldCount === 2 && after.quantity === 48;
      const released = after.inventoryReleased === true;
      expect(committed !== released).toBe(true);
      // The stranger's hold survives both outcomes, and stock stays coherent.
      expect(after.reserved).toBe(2);
      expect(after.quantity).toBeGreaterThanOrEqual(after.reserved);
      expect(after.quantity).toBeGreaterThanOrEqual(0);
    } finally {
      await purgeUsers([shop.ownerId, shop.sellerUserId]);
    }
  });

  // ── Race 3 + 12: settlement ∥ expiry (the near-deadline delivery) ────────

  test("K — settlement ∥ expiry sweep: one terminal transition, decided by the DB", async () => {
    const shop = await seedShop({ quantity: 50, otherHold: 2 });
    const order = await seedOrder(shop, { q: 2, hold: 2 });
    try {
      const { query } = await import("../db/index.js");
      await query(`UPDATE orders SET payment_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [
        order.orderId,
      ]);

      const [webhookStatus, expiry] = await Promise.all([
        deliverWebhook(succeededEvent(order.orderId)),
        expirePaymentReservation(order.orderId),
      ]);
      expect(webhookStatus).toBe(200);
      expect(["expired", "skipped"]).toContain(expiry.outcome);

      const after = await stateOf(order.orderId, shop.productId);
      const committed = after.status === "paid";
      const released = after.status === "expired";
      expect(committed || released).toBe(true); // never a mixture, never neither
      expect(after.soldCount).toBe(committed ? 2 : 0);
      expect(after.quantity).toBe(committed ? 48 : 50);
      expect(after.inventoryReleased).toBe(released);
      // The stranger's 2 held units survive both outcomes…
      expect(after.reserved).toBe(2);
      // …and availability never drops below what a stranger still holds:
      // committed → 48−2 = 46 free, released → 50−2 = 48 free.
      expect(after.available).toBe(committed ? 46 : 48);
    } finally {
      await purgeUsers([shop.ownerId, shop.sellerUserId]);
    }
  });

  // ── Test I2: stock boundaries never go negative ──────────────────────────

  test("I2 — stock boundaries: last unit, exact fit, surplus, and an oversell attempt", async () => {
    const { withTransaction } = await import("../db/index.js");
    const shops: Array<{ ownerId: string; sellerUserId: string }> = [];
    try {
      // (a) the last unit: 1 on-hand, 1 bought → 0, never −1.
      const last = await seedShop({ quantity: 1 });
      shops.push(last);
      const lastOrder = await seedOrder(last, { q: 1, hold: 1 });
      expect(await deliverWebhook(succeededEvent(lastOrder.orderId))).toBe(200);
      const paidLast = await stateOf(lastOrder.orderId, last.productId);
      expect(paidLast.quantity).toBe(0);
      expect(paidLast.reserved).toBe(0);
      expect(paidLast.soldCount).toBe(1);

      // (b) purchased exactly the available stock → 0 free, never negative.
      const exact = await seedShop({ quantity: 4 });
      shops.push(exact);
      const exactOrder = await seedOrder(exact, { q: 4, realReserve: true });
      expect(await deliverWebhook(succeededEvent(exactOrder.orderId))).toBe(200);
      const paidExact = await stateOf(exactOrder.orderId, exact.productId);
      expect(paidExact.quantity).toBe(0);
      expect(paidExact.available).toBe(0);

      // (c) surplus stays: 10 on-hand, 3 bought → 7 left, 7 free.
      const surplus = await seedShop({ quantity: 10 });
      shops.push(surplus);
      const surplusOrder = await seedOrder(surplus, { q: 3, realReserve: true });
      expect(await deliverWebhook(succeededEvent(surplusOrder.orderId))).toBe(200);
      const paidSurplus = await stateOf(surplusOrder.orderId, surplus.productId);
      expect(paidSurplus.quantity).toBe(7);
      expect(paidSurplus.available).toBe(7);

      // (d) an oversell attempt is refused by the RESERVE, before any order
      // exists — the guard is `quantity - reserved >= q`, so stock can never
      // go negative to begin with.
      const scarce = await seedShop({ quantity: 2 });
      shops.push(scarce);
      await expect(
        withTransaction((client) => reserveInventoryStock(client, scarce.productId, 3)),
      ).rejects.toThrow(/INSUFFICIENT_STOCK/);
      const untouched = await inventoryOf(scarce.productId);
      expect(untouched.quantity).toBe(2);
      expect(untouched.reserved).toBe(0);
    } finally {
      await purgeUsers(shops.flatMap((s) => [s.ownerId, s.sellerUserId]));
    }
  }, 30_000);
});
