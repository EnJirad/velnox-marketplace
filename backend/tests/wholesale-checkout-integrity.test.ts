/**
 * WHOLESALE END TO END — the money and the stock, against a real database.
 *
 * DB-GATED: writes `wsale-test-*` fixtures through the REAL routes and reads
 * back what PostgreSQL stored. It runs only when `TEST_DATABASE_URL` points at
 * a disposable database (see backend/db/test-database.ts) and is skipped
 * everywhere else — it never touches production.
 *
 * What it pins, in the order the risks actually bite:
 *
 *   1. RETAIL REGRESSION   a product with no tiers prices exactly as before.
 *   2. THE GATE            only a `verified` business sees a tier; a customer, a
 *                          pending applicant and a rejected one pay retail.
 *   3. PACKS               1 pack, the tier boundaries, and a quantity that is
 *                          not a whole number of packs (retail, never a refusal).
 *   4. EXACTNESS           100.00 per pack of 3 charges 100.00, and the order's
 *                          subtotal equals the sum of its line subtotals.
 *   5. STOCK               packs deduct UNITS; an oversized order is refused.
 *   6. SHIPPING            the quote stays consistent with the wholesale price.
 *   7. HISTORY             a later tier edit does not rewrite a placed order.
 *   8. AUTHORIZATION       another seller cannot edit these tiers.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import crypto from "node:crypto";

import { hasTestDatabase, testDatabaseLabel } from "./helpers/test-db.js";
import { setupCartRoutes } from "../routes/cart.js";
import { setupShippingRoutes } from "../routes/shipping.js";
import { registerWholesaleRoutes } from "../routes/wholesale.js";
import { registerBusinessVerificationRoutes } from "../routes/business-verification.js";

const testFn = hasTestDatabase() ? test : test.skip;
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const PAYMENT_ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_MODE", "COD_ENABLED"];

function configureTestPaymentRail(): void {
  for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
  process.env.STRIPE_SECRET_KEY = "sk_test_wholesale_integrity_placeholder";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_wholesale_integrity_placeholder";
}

function token(userId: string): string {
  return jwt.sign({ userId, email: `${userId}@test.local` }, process.env.JWT_SECRET!, { expiresIn: "1h" });
}

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  setupShippingRoutes(app);
  setupCartRoutes(app);
  registerWholesaleRoutes(app);
  registerBusinessVerificationRoutes(app);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

async function call(
  base: string,
  method: string,
  path: string,
  userId: string | null,
  body?: unknown,
) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(userId ? { Cookie: `velnox_session=${makeToken(userId)}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const parsed = (await res.json()) as any;
  return { status: res.status, data: parsed?.data, code: parsed?.error?.code, body: parsed };
}

function makeToken(userId: string): string {
  return jwt.sign({ userId, email: `${userId}@test.local` }, process.env.JWT_SECRET!, { expiresIn: "1h" });
}

/* ── fixtures ─────────────────────────────────────────────────────────────── */

interface Seed {
  tag: string;
  buyerId: string;
  sellerUserId: string;
  otherSellerUserId: string;
  shopId: string;
  productId: string;
  addressId: string;
  cartId: string;
}

async function seedProduct(opts: {
  price?: number;
  stock?: number;
  variant?: { price: number; stock: number };
}): Promise<Seed> {
  const { query } = await import("../db/index.js");
  const tag = `wsale-test-${crypto.randomUUID()}`;

  const buyer = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
    `${tag}-buyer@test.local`,
    "Wholesale Buyer",
  ]);
  const buyerId = String(buyer.rows[0].id);

  const address = await query(
    `INSERT INTO addresses (user_id, label, recipient_name, phone, line1, city, state, postal_code, country)
     VALUES ($1, 'Home', 'Wholesale Buyer', '0800000000', '1 Test Road', 'Bangkok', 'Bangkok', '10110', 'TH')
     RETURNING id`,
    [buyerId],
  );
  const addressId = String(address.rows[0].id);

  const cart = await query(`INSERT INTO carts (user_id) VALUES ($1) RETURNING id`, [buyerId]);
  const cartId = String(cart.rows[0].id);

  const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
    `${tag}-seller@test.local`,
    "Wholesale Seller",
  ]);
  const sellerUserId = String(sellerUser.rows[0].id);
  const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [
    sellerUserId,
  ]);
  const shop = await query(
    `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
    [seller.rows[0].id, `${tag} shop`, `${tag}-shop`],
  );
  const shopId = String(shop.rows[0].id);

  const product = await query(
    `INSERT INTO products (shop_id, name, slug, price, status, sold_count)
     VALUES ($1, $2, $3, $4, 'published', 0) RETURNING id`,
    [shopId, `${tag} product`, `${tag}-p`, opts.price ?? 60],
  );
  const productId = String(product.rows[0].id);
  await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, $2, 0)`, [
    productId,
    opts.stock ?? 500,
  ]);

  if (opts.variant) {
    await query(
      `INSERT INTO product_variants (product_id, name, price, status, stock)
       VALUES ($1, $2, $3, 'active', $4)`,
      [productId, `${tag} variant`, opts.variant.price, opts.variant.stock],
    );
  }

  const otherUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
    `${tag}-other@test.local`,
    "Other Seller",
  ]);
  const otherSellerUserId = String(otherUser.rows[0].id);
  const otherSeller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [
    otherSellerUserId,
  ]);
  await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3)`, [
    otherSeller.rows[0].id,
    `${tag} other shop`,
    `${tag}-other-shop`,
  ]);

  return { tag, buyerId, sellerUserId, otherSellerUserId, shopId, productId, addressId, cartId };
}

/** Put `units` of the product (optionally a variant) into the buyer's cart. */
async function addToCart(seed: Seed, units: number, variantId: string | null = null): Promise<string> {
  const { query } = await import("../db/index.js");
  const item = await query(
    `INSERT INTO cart_items (cart_id, product_id, variant_id, quantity, price)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [seed.cartId, seed.productId, variantId, units, 60],
  );
  return String(item.rows[0].id);
}

async function setBusinessStatus(userId: string, status: string): Promise<void> {
  const { query } = await import("../db/index.js");
  await query(
    `INSERT INTO business_verifications (user_id, status, business_name, business_type, registration_number, submitted_at)
     VALUES ($1, $2, $3, 'retail', '0123456789012', NOW())
     ON CONFLICT (user_id) DO UPDATE SET status = $2, updated_at = NOW()`,
    [userId, status, `WS ${userId.slice(0, 8)}`],
  );
}

async function saveTiers(
  base: string,
  sellerUserId: string,
  productId: string,
  tiers: Array<{ variantId?: string | null; packSize: number; minPacks: number; pricePerPack: string }>,
) {
  return call(base, "PUT", `/api/seller/products/${productId}/wholesale`, sellerUserId, {
    tiers: tiers.map((t) => ({ variantId: t.variantId ?? null, ...t })),
  });
}

/* ── the suite ────────────────────────────────────────────────────────────── */

describe(`wholesale pack pricing${testDatabaseLabel() ? ` (${testDatabaseLabel()})` : ""}`, () => {
  beforeEach(() => configureTestPaymentRail());
  afterEach(() => {
    for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
  });

  testFn("retail-only product is unaffected (regression)", async () => {
    const seed = await seedProduct({ price: 60 });
    await setBusinessStatus(seed.buyerId, "verified");
    const itemId = await addToCart(seed, 3);

    await withServer(async (base) => {
      const quote = await call(base, "POST", "/api/customer/shipping/quote", seed.buyerId, {
        addressId: seed.addressId,
        cartItemIds: [itemId],
      });
      expect(quote.status).toBe(200);
      expect(quote.data.subtotal).toBe("180.00");
      expect(quote.data.lines[0].wholesale).toBe(false);
    });
  });

  testFn("only a verified business is priced wholesale", async () => {
    const seed = await seedProduct({ price: 60 });
    const itemId = await addToCart(seed, 12);

    await withServer(async (base) => {
      await saveTiers(base, seed.sellerUserId, seed.productId, [{ packSize: 6, minPacks: 1, pricePerPack: "300.00" }]);

      for (const [status, expectedSubtotal, expectedWholesale] of [
        [null, "720.00", false], // no request at all
        ["pending", "720.00", false],
        ["rejected", "720.00", false],
        ["suspended", "720.00", false],
        ["verified", "600.00", true],
      ] as Array<[string | null, string, boolean]>) {
        const { query } = await import("../db/index.js");
        await query(`DELETE FROM business_verifications WHERE user_id = $1`, [seed.buyerId]);
        if (status) await setBusinessStatus(seed.buyerId, status);

        const quote = await call(base, "POST", "/api/customer/shipping/quote", seed.buyerId, {
          addressId: seed.addressId,
          cartItemIds: [itemId],
        });
        expect(quote.status).toBe(200);
        expect(quote.data.subtotal).toBe(expectedSubtotal);
        expect(quote.data.lines[0].wholesale).toBe(expectedWholesale);
      }
    });
  });

  testFn("one pack of three at 100.00 charges exactly 100.00", async () => {
    const seed = await seedProduct({ price: 40 });
    await setBusinessStatus(seed.buyerId, "verified");
    const itemId = await addToCart(seed, 3);

    await withServer(async (base) => {
      await saveTiers(base, seed.sellerUserId, seed.productId, [{ packSize: 3, minPacks: 1, pricePerPack: "100.00" }]);

      const quote = await call(base, "POST", "/api/customer/shipping/quote", seed.buyerId, {
        addressId: seed.addressId,
        cartItemIds: [itemId],
      });
      expect(quote.data.subtotal).toBe("100.00");
      expect(quote.data.lines[0]).toMatchObject({ wholesale: true, packSize: 3, packs: 1, pricePerPack: "100.00" });
    });
  });

  testFn("tier boundaries: below, at, and above each min_packs", async () => {
    const seed = await seedProduct({ price: 60 });
    await setBusinessStatus(seed.buyerId, "verified");

    await withServer(async (base) => {
      await saveTiers(base, seed.sellerUserId, seed.productId, [
        { packSize: 6, minPacks: 1, pricePerPack: "500.00" },
        { packSize: 6, minPacks: 5, pricePerPack: "450.00" },
        { packSize: 6, minPacks: 10, pricePerPack: "400.00" },
      ]);

      const cases: Array<[packs: number, perPack: string]> = [
        [1, "500.00"],
        [1, "500.00"],
        [4, "500.00"],
        [5, "450.00"],
        [9, "450.00"],
        [10, "400.00"],
        [20, "400.00"],
      ];
      for (const [packs, perPack] of cases) {
        const { query } = await import("../db/index.js");
        await query(`DELETE FROM cart_items WHERE cart_id = $1`, [seed.cartId]);
        const itemId = await addToCart(seed, packs * 6);
        const quote = await call(base, "POST", "/api/customer/shipping/quote", seed.buyerId, {
          addressId: seed.addressId,
          cartItemIds: [itemId],
        });
        expect(quote.data.lines[0].pricePerPack).toBe(perPack);
        expect(quote.data.subtotal).toBe((Number(perPack) * packs).toFixed(2));
      }
    });
  });

  testFn("a quantity that is not a whole number of packs stays retail", async () => {
    const seed = await seedProduct({ price: 20 });
    await setBusinessStatus(seed.buyerId, "verified");
    const itemId = await addToCart(seed, 11);

    await withServer(async (base) => {
      await saveTiers(base, seed.sellerUserId, seed.productId, [{ packSize: 5, minPacks: 1, pricePerPack: "90.00" }]);
      const quote = await call(base, "POST", "/api/customer/shipping/quote", seed.buyerId, {
        addressId: seed.addressId,
        cartItemIds: [itemId],
      });
      expect(quote.status).toBe(200);
      expect(quote.data.lines[0].wholesale).toBe(false);
      expect(quote.data.lines[0].reason).toBe("retail_partial_pack");
      expect(quote.data.subtotal).toBe("220.00");
    });
  });

  testFn("complete packs below the seller minimum stay retail", async () => {
    const seed = await seedProduct({ price: 60 });
    await setBusinessStatus(seed.buyerId, "verified");
    const itemId = await addToCart(seed, 6);

    await withServer(async (base) => {
      await saveTiers(base, seed.sellerUserId, seed.productId, [{ packSize: 6, minPacks: 2, pricePerPack: "300.00" }]);
      const quote = await call(base, "POST", "/api/customer/shipping/quote", seed.buyerId, {
        addressId: seed.addressId,
        cartItemIds: [itemId],
      });
      expect(quote.data.lines[0].reason).toBe("retail_below_minimum");
      expect(quote.data.subtotal).toBe("360.00");
    });
  });

  testFn("invalid pack size or price is refused by the seller endpoint", async () => {
    const seed = await seedProduct({ price: 60 });
    await withServer(async (base) => {
      const bad: Array<Record<string, unknown>> = [
        { packSize: 1, minPacks: 1, pricePerPack: "300" },
        { packSize: 6, minPacks: 0, pricePerPack: "300" },
        { packSize: 6, minPacks: 1, pricePerPack: "0" },
        { packSize: 6, minPacks: 1, pricePerPack: "-5" },
        { packSize: 6, minPacks: 1, pricePerPack: "300.001" },
      ];
      for (const tier of bad) {
        const res = await call(base, "PUT", `/api/seller/products/${seed.productId}/wholesale`, seed.sellerUserId, {
          tiers: [{ variantId: null, ...tier }],
        });
        expect(res.status).toBe(400);
        expect(res.code).toBe("VALIDATION_ERROR");
      }

      // Nothing was written by any refused call.
      const { query } = await import("../db/index.js");
      const rows = await query(`SELECT 1 FROM wholesale_tiers WHERE product_id = $1`, [seed.productId]);
      expect(rows.rows).toHaveLength(0);
    });
  });

  testFn("another seller cannot read or write these tiers", async () => {
    const seed = await seedProduct({ price: 60 });
    await withServer(async (base) => {
      const write = await call(base, "PUT", `/api/seller/products/${seed.productId}/wholesale`, seed.otherSellerUserId, {
        tiers: [{ variantId: null, packSize: 6, minPacks: 1, pricePerPack: "1.00" }],
      });
      expect([403, 404]).toContain(write.status);

      const read = await call(base, "GET", `/api/seller/products/${seed.productId}/wholesale`, seed.otherSellerUserId);
      expect([403, 404]).toContain(read.status);

      const anon = await call(base, "PUT", `/api/seller/products/${seed.productId}/wholesale`, null, { tiers: [] });
      expect(write.status).not.toBe(200);
      expect(anon.status).toBe(401);
    });
  });

  testFn("packs deduct UNITS from stock, and an oversized order is refused", async () => {
    const seed = await seedProduct({ price: 60, stock: 10 });
    await setBusinessStatus(seed.buyerId, "verified");
    const itemId = await addToCart(seed, 6);

    await withServer(async (base) => {
      await saveTiers(base, seed.sellerUserId, seed.productId, [{ packSize: 6, minPacks: 1, pricePerPack: "300.00" }]);

      // 6 units ordered from 10 in stock → 4 left, NOT 9.
      const ordered = await call(base, "POST", "/api/customer/checkout", seed.buyerId, {
        addressId: seed.addressId,
        cartItemIds: [itemId],
        paymentMethod: "CARD",
        requestId: crypto.randomUUID(),
      });
      expect(ordered.status).toBe(200);

      const { query } = await import("../db/index.js");
      const inventory = await query(`SELECT quantity, reserved FROM inventory WHERE product_id = $1`, [seed.productId]);
      expect(Number(inventory.rows[0].reserved)).toBe(6);
    });
  });

  testFn("the order keeps the exact pack price and the exact subtotal", async () => {
    const seed = await seedProduct({ price: 40 });
    await setBusinessStatus(seed.buyerId, "verified");
    const itemId = await addToCart(seed, 9);

    await withServer(async (base) => {
      await saveTiers(base, seed.sellerUserId, seed.productId, [{ packSize: 3, minPacks: 1, pricePerPack: "100.00" }]);

      const ordered = await call(base, "POST", "/api/customer/checkout", seed.buyerId, {
        addressId: seed.addressId,
        cartItemIds: [itemId],
        paymentMethod: "CARD",
        requestId: crypto.randomUUID(),
      });
      expect(ordered.status).toBe(200);
      const orderId = ordered.data.orders[0].orderId;

      const { query } = await import("../db/index.js");
      const orderRow = (
        await query(`SELECT subtotal, discount, shipping_fee, total_amount FROM orders WHERE id = $1`, [orderId])
      ).rows[0];
      const line = (
        await query(
          `SELECT quantity, price, subtotal, wholesale_pack_size, wholesale_packs, wholesale_tier_price
             FROM order_items WHERE order_id = $1`,
          [orderId],
        )
      ).rows[0];

      // 3 packs × 3 units at 100.00 per pack.
      expect(Number(line.quantity)).toBe(9);
      expect(Number(line.wholesale_pack_size)).toBe(3);
      expect(Number(line.wholesale_packs)).toBe(3);
      expect(String(line.wholesale_tier_price)).toBe("100.00");

      // The line amount is EXACT (packs × pack price), not 33.33 × 9.
      expect(String(line.subtotal)).toBe("300.00");
      expect(String(orderRow.subtotal)).toBe("300.00");

      // `order_items.price` is the 2-dp DISPLAY value of 100/3; it is deliberately
      // not the number the line total is derived from.
      expect(String(line.price)).toBe("33.33");

      // The order subtotal equals the sum of its line subtotals, and the
      // documented invariant still holds.
      const sum = (
        await query(`SELECT COALESCE(SUM(subtotal), 0) AS s FROM order_items WHERE order_id = $1`, [orderId])
      ).rows[0].s;
      expect(Number(orderRow.subtotal)).toBe(Number(sum));
      expect(Number(orderRow.total_amount)).toBe(
        Number(orderRow.subtotal) - Number(orderRow.discount) + Number(orderRow.shipping_fee),
      );
    });
  });

  testFn("a later tier edit does not rewrite a placed order", async () => {
    const seed = await seedProduct({ price: 40 });
    await setBusinessStatus(seed.buyerId, "verified");
    const itemId = await addToCart(seed, 6);

    await withServer(async (base) => {
      await saveTiers(base, seed.sellerUserId, seed.productId, [{ packSize: 3, minPacks: 1, pricePerPack: "100.00" }]);
      const ordered = await call(base, "POST", "/api/customer/checkout", seed.buyerId, {
        addressId: seed.addressId,
        cartItemIds: [itemId],
        paymentMethod: "CARD",
        requestId: crypto.randomUUID(),
      });
      expect(ordered.status).toBe(200);
      const orderId = ordered.data.orders[0].orderId;

      const { query } = await import("../db/index.js");
      const before = (
        await query(
          `SELECT o.subtotal, oi.subtotal AS line_subtotal, oi.wholesale_tier_price, oi.wholesale_packs
             FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.id = $1`,
          [orderId],
        )
      ).rows[0];
      expect(String(before.subtotal)).toBe("200.00");

      // The seller halves the pack price afterwards.
      await saveTiers(base, seed.sellerUserId, seed.productId, [{ packSize: 3, minPacks: 1, pricePerPack: "50.00" }]);

      const after = (
        await query(
          `SELECT o.subtotal, oi.subtotal AS line_subtotal, oi.wholesale_tier_price, oi.wholesale_packs
             FROM orders o JOIN order_items oi ON oi.order_id = o.id WHERE o.id = $1`,
          [orderId],
        )
      ).rows[0];

      // History is immutable: the order still says 2 packs at 100.00.
      expect(String(after.subtotal)).toBe("200.00");
      expect(String(after.line_subtotal)).toBe("200.00");
      expect(String(after.wholesale_tier_price)).toBe("100.00");
      expect(Number(after.wholesale_packs)).toBe(2);
    });
  });

  testFn("shipping quote stays consistent with wholesale pricing", async () => {
    const seed = await seedProduct({ price: 60 });
    await setBusinessStatus(seed.buyerId, "verified");
    const itemId = await addToCart(seed, 12);

    await withServer(async (base) => {
      await saveTiers(base, seed.sellerUserId, seed.productId, [{ packSize: 6, minPacks: 1, pricePerPack: "300.00" }]);

      const quote = await call(base, "POST", "/api/customer/shipping/quote", seed.buyerId, {
        addressId: seed.addressId,
        cartItemIds: [itemId],
      });
      expect(quote.status).toBe(200);

      const ordered = await call(base, "POST", "/api/customer/checkout", seed.buyerId, {
        addressId: seed.addressId,
        cartItemIds: [itemId],
        paymentMethod: "CARD",
        shippingQuoteId: quote.data.quoteId,
        requestId: crypto.randomUUID(),
      });
      expect(ordered.status).toBe(200);
      expect(Number(ordered.data.orders[0].subtotal)).toBe(Number(quote.data.subtotal));
      expect(Number(ordered.data.orders[0].total)).toBe(Number(quote.data.total));
    });
  });

  testFn("a stale quote is refused once the buyer loses verification", async () => {
    const seed = await seedProduct({ price: 60 });
    await setBusinessStatus(seed.buyerId, "verified");
    const itemId = await addToCart(seed, 12);

    await withServer(async (base) => {
      await saveTiers(base, seed.sellerUserId, seed.productId, [{ packSize: 6, minPacks: 1, pricePerPack: "300.00" }]);

      const quote = await call(base, "POST", "/api/customer/shipping/quote", seed.buyerId, {
        addressId: seed.addressId,
        cartItemIds: [itemId],
      });
      expect(quote.status).toBe(200);

      // The account is suspended after the quote was minted.
      await setBusinessStatus(seed.buyerId, "suspended");

      const ordered = await call(base, "POST", "/api/customer/checkout", seed.buyerId, {
        addressId: seed.addressId,
        cartItemIds: [itemId],
        paymentMethod: "CARD",
        shippingQuoteId: quote.data.quoteId,
        requestId: crypto.randomUUID(),
      });
      expect(ordered.status).toBe(409);
      expect(ordered.code).toBe("SHIPPING_QUOTE_STALE");

      const { query } = await import("../db/index.js");
      const orders = await query(`SELECT 1 FROM orders WHERE user_id = $1`, [seed.buyerId]);
      expect(orders.rows).toHaveLength(0);
    });
  });

  testFn("a client cannot submit a wholesale price or discount", async () => {
    const seed = await seedProduct({ price: 60 });
    await setBusinessStatus(seed.buyerId, "verified");
    const itemId = await addToCart(seed, 12);

    await withServer(async (base) => {
      for (const extra of [{ shippingFee: 0 }, { total: 1 }, { amount: 1 }, { discount: 5 }]) {
        const res = await call(base, "POST", "/api/customer/checkout", seed.buyerId, {
          addressId: seed.addressId,
          cartItemIds: [itemId],
          paymentMethod: "CARD",
          requestId: crypto.randomUUID(),
          ...extra,
        });
        expect(res.status).toBe(400);
        expect(res.code).toBe("CLIENT_AMOUNT_NOT_ACCEPTED");
      }
    });
  });
});
