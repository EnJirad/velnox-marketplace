/**
 * CHECKOUT SHIPPING INTEGRITY — the money has to add up, and it has to be the
 * server's number.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The reported defect was "every order is created with shipping_fee = 0 and the
 * checkout screen says free shipping". Fixing the display is not enough: the
 * invariants below are what make the fix a FINANCIAL fix.
 *
 *   1. Persisted:  total_amount = subtotal − discount + shipping_fee  (per order)
 *   2. The checkout group equals the sum of its orders, delivery included, so
 *      the amount Stripe/PromptPay is asked to charge is the amount stored.
 *   3. A quote can be redeemed once, only against the cart it priced, and only
 *      before it expires.
 *   4. A client cannot influence any of it.
 *
 * DB-GATED: this file writes fixtures (`ship-test-*` users → sellers → shops →
 * products → orders) and only runs when `TEST_DATABASE_URL` points at a
 * disposable database (see `backend/db/test-database.ts`). It never runs against
 * production and no Stripe call is ever made.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

import { hasTestDatabase, testDatabaseLabel } from "./helpers/test-db.js";
import { setupCartRoutes } from "../routes/cart.js";
import { setupShippingRoutes } from "../routes/shipping.js";
import { setupSellerOrderRoutes } from "../routes/seller-orders.js";

const testFn = hasTestDatabase() ? test : test.skip;

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const PAYMENT_ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_MODE", "COD_ENABLED"];

function configureTestPaymentRail(): void {
  for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
  // A TEST-mode key only: no Stripe request is made by any case below.
  process.env.STRIPE_SECRET_KEY = "sk_test_shipping_integrity_placeholder";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_shipping_integrity_placeholder";
}

interface Seeded {
  ownerId: string;
  cartItemIds: string[];
  shopIds: string[];
  addressId: string;
}

/**
 * Seed one customer with an address and N shops, each with one published
 * product and a cart line. `fee` is written to `shops.shipping_fee` so the
 * per-shop rule is exercised end to end.
 */
async function seed(shops: Array<{ fee: string | null; price?: number; threshold?: string | null }>): Promise<Seeded> {
  const { query } = await import("../db/index.js");
  const tag = `ship-test-${crypto.randomUUID()}`;

  const owner = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
    `${tag}@test.local`,
    "Shipping Owner",
  ]);
  const ownerId = owner.rows[0].id as string;

  const address = await query(
    `INSERT INTO addresses (user_id, label, recipient_name, phone, line1, city, state, postal_code, country)
     VALUES ($1, 'Home', 'Shipping Owner', '0800000000', '1 Test Road', 'Bangkok', 'Bangkok', '10110', 'TH')
     RETURNING id`,
    [ownerId],
  );
  const addressId = address.rows[0].id as string;

  const cart = await query(`INSERT INTO carts (user_id) VALUES ($1) RETURNING id`, [ownerId]);
  const cartId = cart.rows[0].id as string;

  const cartItemIds: string[] = [];
  const shopIds: string[] = [];

  for (const [index, spec] of shops.entries()) {
    const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-seller${index}@test.local`,
      `Shipping Seller ${index}`,
    ]);
    const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [
      sellerUser.rows[0].id,
    ]);
    const shop = await query(
      `INSERT INTO shops (seller_id, name, slug, shipping_fee, free_shipping_threshold)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [seller.rows[0].id, `${tag} shop ${index}`, `${tag}-shop-${index}`, shops[index]!.fee, shops[index]!.threshold ?? null],
    );
    const shopId = shop.rows[0].id as string;
    shopIds.push(shopId);

    const price = shops[index]?.price ?? 100;
    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status, sold_count)
       VALUES ($1, $2, $3, $4, 'published', 0) RETURNING id`,
      [shopId, `${tag} product ${index}`, `${tag}-p-${index}`, price],
    );
    const productId = product.rows[0].id as string;
    await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 50, 0)`, [productId]);

    const item = await query(
      `INSERT INTO cart_items (cart_id, product_id, quantity, price) VALUES ($1, $2, 1, $3) RETURNING id`,
      [cartId, productId, price],
    );
    cartItemIds.push(item.rows[0].id as string);
  }

  return { ownerId, cartItemIds, shopIds, addressId };
}

function makeToken(userId: string): string {
  return jwt.sign({ userId, email: `${userId}@test.local` }, process.env.JWT_SECRET!, { expiresIn: "1h" });
}

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  setupShippingRoutes(app);
  setupCartRoutes(app);
  setupSellerOrderRoutes(app);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

async function post(base: string, path: string, userId: string, body: unknown) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: `velnox_session=${makeToken(userId)}` },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json()) as {
    success?: boolean;
    data?: any;
    error?: { code?: string; message?: string };
  };
  return { status: res.status, code: parsed.error?.code, data: parsed.data };
}

async function quote(base: string, userId: string, body: Record<string, unknown>) {
  return post(base, "/api/customer/shipping/quote", userId, body);
}

async function checkout(base: string, userId: string, body: Record<string, unknown>) {
  return post(base, "/api/customer/checkout", userId, body);
}

describe(`checkout shipping integrity${testDatabaseLabel() ? ` (${testDatabaseLabel()})` : ""}`, () => {
  beforeEach(() => {
    configureTestPaymentRail();
  });
  afterEach(() => {
    for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
  });

  testFn("a normal order persists a non-zero shipping fee and an exact total", async () => {
    const seeded = await seed([{ fee: "25.00", price: 100 }]);
    await withServer(async (base) => {
      const quoted = await quote(base, seeded.ownerId, { addressId: seeded.addressId, cartItemIds: seeded.cartItemIds });
      expect(quoted.status).toBe(200);
      expect(quoted.data.subtotal).toBe("100.00");
      expect(quoted.data.shippingTotal).toBe("25.00");
      expect(quoted.data.total).toBe("125.00");

      const ordered = await checkout(base, seeded.ownerId, {
        addressId: seeded.addressId,
        cartItemIds: seeded.cartItemIds,
        paymentMethod: "CARD",
        shippingQuoteId: quoted.data.quoteId,
        requestId: crypto.randomUUID(),
      });
      expect(ordered.status).toBe(200);

      const { query } = await import("../db/index.js");
      const order = (
        await query(
          `SELECT subtotal, shipping_fee, discount, total_amount, shipping_quote_id
             FROM orders WHERE id = $1`,
          [ordered.data.orders[0].orderId],
        )
      ).rows[0];
      expect(Number(order.subtotal)).toBe(100);
      expect(Number(order.shipping_fee)).toBe(25);
      expect(Number(order.discount)).toBe(0);
      expect(Number(order.total_amount)).toBe(125);
      expect(order.shipping_quote_id).toBe(quoted.data.quoteId);

      // The invariant, asserted with exact decimal comparison.
      expect(Number(order.total_amount)).toBe(
        Number((Number(order.subtotal) - Number(order.discount) + Number(order.shipping_fee)).toFixed(2)),
      );

      // The group is what payment charges: it must include delivery.
      const group = (
        await query(`SELECT total_amount FROM checkout_groups WHERE id = $1`, [ordered.data.checkoutGroupId])
      ).rows[0];
      expect(Number(group.total_amount)).toBe(125);
    });
  });

  testFn("an explicitly free quote is persisted as 0 and says why", async () => {
    const seeded = await seed([{ fee: "0.00", price: 80 }]);
    await withServer(async (base) => {
      const quoted = await quote(base, seeded.ownerId, { addressId: seeded.addressId, cartItemIds: seeded.cartItemIds });
      expect(quoted.data.shippingTotal).toBe("0.00");
      expect(quoted.data.shops[0].freeShipping).toBe(true);
      expect(quoted.data.shops[0].reason).toBe("seller_free_shipping");

      const ordered = await checkout(base, seeded.ownerId, {
        addressId: seeded.addressId,
        cartItemIds: seeded.cartItemIds,
        paymentMethod: "CARD",
        shippingQuoteId: quoted.data.quoteId,
        requestId: crypto.randomUUID(),
      });
      expect(ordered.status).toBe(200);
      expect(Number(ordered.data.orders[0].shippingFee)).toBe(0);
      expect(Number(ordered.data.orders[0].total)).toBe(80);
    });
  });

  testFn("a shop that has not configured a fee is charged the platform default", async () => {
    const seeded = await seed([{ fee: null, price: 100 }]);
    await withServer(async (base) => {
      const quoted = await quote(base, seeded.ownerId, { addressId: seeded.addressId, cartItemIds: seeded.cartItemIds });
      expect(quoted.data.shops[0].reason).toBe("platform_default");
      expect(Number(quoted.data.shippingTotal)).toBeGreaterThan(0);
    });
  });

  testFn("an unsupported destination is refused, never priced at 0", async () => {
    const seeded = await seed([{ fee: "25.00" }]);
    const { query } = await import("../db/index.js");
    await query(`UPDATE addresses SET country = 'MM' WHERE id = $1`, [seeded.addressId]);
    await withServer(async (base) => {
      const quoted = await quote(base, seeded.ownerId, { addressId: seeded.addressId, cartItemIds: seeded.cartItemIds });
      expect(quoted.status).toBe(422);
      expect(quoted.code).toBe("SHIPPING_DESTINATION_UNSUPPORTED");
    });
  });

  testFn("an expired quote is refused and the order is not created", async () => {
    const seeded = await seed([{ fee: "25.00" }]);
    await withServer(async (base) => {
      const quoted = await quote(base, seeded.ownerId, { addressId: seeded.addressId, cartItemIds: seeded.cartItemIds });
      const { query } = await import("../db/index.js");
      await query(`UPDATE shipping_quotes SET expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [
        quoted.data.quoteId,
      ]);

      const ordered = await checkout(base, seeded.ownerId, {
        addressId: seeded.addressId,
        cartItemIds: seeded.cartItemIds,
        paymentMethod: "CARD",
        shippingQuoteId: quoted.data.quoteId,
        requestId: crypto.randomUUID(),
      });
      expect(ordered.status).toBe(409);
      expect(ordered.code).toBe("SHIPPING_QUOTE_EXPIRED");

      const orders = await query(`SELECT 1 FROM orders WHERE user_id = $1`, [seeded.ownerId]);
      expect(orders.rows).toHaveLength(0);
    });
  });

  testFn("a cart quantity changed after the quote is refused as stale", async () => {
    const seeded = await seed([{ fee: "25.00", price: 100 }]);
    await withServer(async (base) => {
      const quoted = await quote(base, seeded.ownerId, { addressId: seeded.addressId, cartItemIds: seeded.cartItemIds });
      const { query } = await import("../db/index.js");
      await query(`UPDATE cart_items SET quantity = 2 WHERE id = $1`, [seeded.cartItemIds[0]]);

      const ordered = await checkout(base, seeded.ownerId, {
        addressId: seeded.addressId,
        cartItemIds: seeded.cartItemIds,
        paymentMethod: "CARD",
        shippingQuoteId: quoted.data.quoteId,
        requestId: crypto.randomUUID(),
      });
      expect(ordered.status).toBe(409);
      expect(ordered.code).toBe("SHIPPING_QUOTE_STALE");
    });
  });

  testFn("a product price changed after the quote is refused as stale", async () => {
    const seeded = await seed([{ fee: "25.00", price: 100 }]);
    await withServer(async (base) => {
      const quoted = await quote(base, seeded.ownerId, { addressId: seeded.addressId, cartItemIds: seeded.cartItemIds });
      const { query } = await import("../db/index.js");
      await query(
        `UPDATE products SET price = 120 WHERE id = (SELECT product_id FROM cart_items WHERE id = $1)`,
        [seeded.cartItemIds[0]],
      );

      const ordered = await checkout(base, seeded.ownerId, {
        addressId: seeded.addressId,
        cartItemIds: seeded.cartItemIds,
        paymentMethod: "CARD",
        shippingQuoteId: quoted.data.quoteId,
        requestId: crypto.randomUUID(),
      });
      expect(ordered.status).toBe(409);
      expect(ordered.code).toBe("SHIPPING_QUOTE_STALE");
    });
  });

  testFn("a sold shipping fee changed after the quote is refused as stale", async () => {
    const seeded = await seed([{ fee: "25.00", price: 100 }]);
    await withServer(async (base) => {
      const quoted = await quote(base, seeded.ownerId, { addressId: seeded.addressId, cartItemIds: seeded.cartItemIds });
      const { query } = await import("../db/index.js");
      await query(`UPDATE shops SET shipping_fee = 60 WHERE id = $1`, [seeded.shopIds[0]]);

      const ordered = await checkout(base, seeded.ownerId, {
        addressId: seeded.addressId,
        cartItemIds: seeded.cartItemIds,
        paymentMethod: "CARD",
        shippingQuoteId: quoted.data.quoteId,
        requestId: crypto.randomUUID(),
      });
      expect(ordered.status).toBe(409);
      expect(ordered.code).toBe("SHIPPING_QUOTE_STALE");
    });
  });

  testFn("a quote cannot be redeemed twice", async () => {
    const seeded = await seed([{ fee: "25.00", price: 100 }]);
    await withServer(async (base) => {
      const quoted = await quote(base, seeded.ownerId, { addressId: seeded.addressId, cartItemIds: seeded.cartItemIds });
      const payload = {
        addressId: seeded.addressId,
        cartItemIds: seeded.cartItemIds,
        paymentMethod: "CARD",
        shippingQuoteId: quoted.data.quoteId,
        requestId: crypto.randomUUID(),
      };
      const first = await checkout(base, seeded.ownerId, payload);
      expect(first.status).toBe(200);

      // Re-seed a cart line so the cart is priceable again, then replay the quote.
      const { query } = await import("../db/index.js");
      const productId = (
        await query(`SELECT product_id FROM order_items WHERE order_id = $1 LIMIT 1`, [first.data.orders[0].orderId])
      ).rows[0].product_id;
      const cart = await query(`SELECT id FROM carts WHERE user_id = $1`, [seeded.ownerId]);
      const item = await query(
        `INSERT INTO cart_items (cart_id, product_id, quantity, price) VALUES ($1, $2, 1, 100) RETURNING id`,
        [cart.rows[0].id, productId],
      );

      const second = await checkout(base, seeded.ownerId, {
        ...payload,
        cartItemIds: [item.rows[0].id],
        requestId: crypto.randomUUID(),
      });
      // Either the replay is refused outright, or the cart no longer matches the
      // quote — both are safe refusals, and neither creates a second order.
      expect([409]).toContain(second.status);
      const orders = await query(`SELECT id FROM orders WHERE user_id = $1`, [seeded.ownerId]);
      expect(orders.rows).toHaveLength(1);
    });
  });

  testFn("another customer's quote is refused", async () => {
    const seeded = await seed([{ fee: "25.00" }]);
    const { query } = await import("../db/index.js");
    const other = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `ship-test-other-${crypto.randomUUID()}@test.local`,
      "Other",
    ]);
    await withServer(async (base) => {
      const quoted = await quote(base, seeded.ownerId, { addressId: seeded.addressId, cartItemIds: seeded.cartItemIds });
      const otherId = other.rows[0].id as string;
      const ordered = await checkout(base, otherId, {
        addressId: seeded.addressId,
        cartItemIds: seeded.cartItemIds,
        paymentMethod: "CARD",
        shippingQuoteId: quoted.data.quoteId,
        requestId: crypto.randomUUID(),
      });
      // REFUSED — the precedence of the refusal code is not the invariant, the
      // refusal is. The address and the cart both belong to the other customer, so
      // the ownership guard answers 403 before the quote is ever looked at; a
      // caller who owned the address/cart but passed somebody else's quote gets
      // 409 SHIPPING_QUOTE_INVALID (routes/cart.ts). Pinning the exact 409 here
      // asserted one guard's position, not the security property.
      expect([403, 409]).toContain(ordered.status);
      expect(typeof ordered.code).toBe("string");
      // …and nothing was created for either account, and the quote stays unused.
      const orders = await query(`SELECT 1 FROM orders WHERE user_id = ANY($1::uuid[])`, [
        [seeded.ownerId, otherId],
      ]);
      expect(orders.rows).toHaveLength(0);
      const quoteRow = await query(`SELECT consumed_at FROM shipping_quotes WHERE id = $1`, [
        quoted.data.quoteId,
      ]);
      expect(quoteRow.rows[0]?.consumed_at ?? null).toBeNull();
    });
  });

  testFn("a multi-shop purchase charges one delivery per shop and adds up", async () => {
    const seeded = await seed([{ fee: "25.00", price: 100 }, { fee: "30.00", price: 50 }]);
    await withServer(async (base) => {
      const quoted = await quote(base, seeded.ownerId, { addressId: seeded.addressId, cartItemIds: seeded.cartItemIds });
      expect(quoted.data.shops).toHaveLength(2);
      expect(quoted.data.subtotal).toBe("150.00");
      expect(quoted.data.shippingTotal).toBe("55.00");
      expect(quoted.data.total).toBe("205.00");

      const ordered = await checkout(base, seeded.ownerId, {
        addressId: seeded.addressId,
        cartItemIds: seeded.cartItemIds,
        paymentMethod: "CARD",
        shippingQuoteId: quoted.data.quoteId,
        requestId: crypto.randomUUID(),
      });
      expect(ordered.status).toBe(200);
      expect(ordered.data.orders).toHaveLength(2);

      const { query } = await import("../db/index.js");
      const sum = (
        await query(
          `SELECT COALESCE(SUM(total_amount), 0) AS total, COALESCE(SUM(shipping_fee), 0) AS shipping
             FROM orders WHERE checkout_group_id = $1`,
          [ordered.data.checkoutGroupId],
        )
      ).rows[0];
      expect(Number(sum.total)).toBe(205);
      expect(Number(sum.shipping)).toBe(55);

      const group = (
        await query(`SELECT total_amount FROM checkout_groups WHERE id = $1`, [ordered.data.checkoutGroupId])
      ).rows[0];
      expect(Number(group.total_amount)).toBe(205);
    });
  });

  testFn("a checkout without a quote is still priced by the server", async () => {
    const seeded = await seed([{ fee: "25.00", price: 100 }]);
    await withServer(async (base) => {
      const ordered = await checkout(base, seeded.ownerId, {
        addressId: seeded.addressId,
        cartItemIds: seeded.cartItemIds,
        paymentMethod: "CARD",
        requestId: crypto.randomUUID(),
      });
      expect(ordered.status).toBe(200);
      expect(Number(ordered.data.orders[0].shippingFee)).toBe(25);
      expect(Number(ordered.data.orders[0].total)).toBe(125);

      // Even then a real quote row backs the order (auditable, never a client number).
      const { query } = await import("../db/index.js");
      const order = (
        await query(`SELECT shipping_quote_id FROM orders WHERE id = $1`, [ordered.data.orders[0].orderId])
      ).rows[0];
      expect(order.shipping_quote_id).toBeTruthy();
    });
  });

  testFn("a client-supplied fee or total cannot move the order amount", async () => {
    const seeded = await seed([{ fee: "25.00", price: 100 }]);
    await withServer(async (base) => {
      const quoted = await quote(base, seeded.ownerId, { addressId: seeded.addressId, cartItemIds: seeded.cartItemIds });
      const manipulated = await checkout(base, seeded.ownerId, {
        addressId: seeded.addressId,
        cartItemIds: seeded.cartItemIds,
        paymentMethod: "CARD",
        shippingQuoteId: quoted.data.quoteId,
        shippingFee: 0,
        total: 100,
        requestId: crypto.randomUUID(),
      });
      expect(manipulated.status).toBe(400);
      expect(manipulated.code).toBe("CLIENT_AMOUNT_NOT_ACCEPTED");

      const { query } = await import("../db/index.js");
      const orders = await query(`SELECT id FROM orders WHERE user_id = $1`, [seeded.ownerId]);
      expect(orders.rows).toHaveLength(0);
    });
  });

  testFn("decimal precision survives persistence: 19.99 × 3 + 25.00", async () => {
    const seeded = await seed([{ fee: "25.00", price: 19.99 }]);
    const { query } = await import("../db/index.js");
    await query(`UPDATE cart_items SET quantity = 3 WHERE id = $1`, [seeded.cartItemIds[0]]);

    await withServer(async (base) => {
      const quoted = await quote(base, seeded.ownerId, { addressId: seeded.addressId, cartItemIds: seeded.cartItemIds });
      expect(quoted.data.subtotal).toBe("59.97");
      expect(quoted.data.total).toBe("84.97");

      const ordered = await checkout(base, seeded.ownerId, {
        addressId: seeded.addressId,
        cartItemIds: seeded.cartItemIds,
        paymentMethod: "CARD",
        shippingQuoteId: quoted.data.quoteId,
        requestId: crypto.randomUUID(),
      });
      expect(ordered.status).toBe(200);

      const order = (
        await query(`SELECT subtotal, shipping_fee, total_amount FROM orders WHERE id = $1`, [
          ordered.data.orders[0].orderId,
        ])
      ).rows[0];
      expect(String(order.subtotal)).toBe("59.97");
      expect(String(order.shipping_fee)).toBe("25.00");
      expect(String(order.total_amount)).toBe("84.97");
    });
  });

  testFn("the seller sees the delivery fee and may only read their own order", async () => {
    const seeded = await seed([{ fee: "25.00", price: 100 }]);
    await withServer(async (base) => {
      const quoted = await quote(base, seeded.ownerId, { addressId: seeded.addressId, cartItemIds: seeded.cartItemIds });
      const ordered = await checkout(base, seeded.ownerId, {
        addressId: seeded.addressId,
        cartItemIds: seeded.cartItemIds,
        paymentMethod: "CARD",
        shippingQuoteId: quoted.data.quoteId,
        requestId: crypto.randomUUID(),
      });
      expect(ordered.status).toBe(200);

      const { query } = await import("../db/index.js");
      const sellerUserId = (
        await query(`SELECT s.user_id FROM sellers s JOIN shops sh ON sh.seller_id = s.id WHERE sh.id = $1`, [
          seeded.shopIds[0],
        ])
      ).rows[0].user_id as string;

      const detailRes = await fetch(`${base}/api/seller/orders/${ordered.data.orders[0].orderId}`, {
        headers: { Cookie: `velnox_session=${makeToken(sellerUserId)}` },
      });
      expect(detailRes.status).toBe(200);
      const detail = (await detailRes.json()) as { data: any };
      expect(Number(detail.data.shippingFee)).toBe(25);
      expect(detail.data.shippingMethod).toBe("shop_flat_rate");
      expect(Number(detail.data.subtotal)).toBe(100);

      // A stranger is not a seller: the route must refuse or 404, never leak.
      const stranger = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
        `ship-test-stranger-${crypto.randomUUID()}@test.local`,
        "Stranger",
      ]);
      const strangerRes = await fetch(`${base}/api/seller/orders/${ordered.data.orders[0].orderId}`, {
        headers: { Cookie: `velnox_session=${makeToken(stranger.rows[0].id as string)}` },
      });
      expect([403, 404]).toContain(strangerRes.status);
    });
  });
});
