/**
 * BUY NOW — the customer buys exactly the quantity they chose, with the cart
 * left alone.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Buy Now used to work by ADDING the selection to the customer's cart and then
 * checking out `cartItemIds`. That had two correctness bugs:
 *
 *   1. A direct purchase MUTATED a saved shopping list the customer did not
 *      intend to change (an app end "Buy Now 1" even overwrote an existing
 *      line's quantity), and
 *   2. the quantity that was charged came from the cart line, not from the
 *      quantity chosen on the product page — so buying 1 of a product whose
 *      cart line held 3 charged for 3.
 *
 * The contract pinned here is therefore:
 *
 *   1. THE CLIENT SENDS ids AND A QUANTITY — never a price. `buyNow` is
 *      `{ productId, variantId, quantity }` and the row is re-read from Neon
 *      server-side (case: the charge follows the server price).
 *   2. THE ORDER LINE CARRIES THE REQUESTED QUANTITY for 1, 2 and larger
 *      quantities, and the order total is `price × quantity` (DB cases).
 *   3. STOCK IS HELD FOR THAT QUANTITY (`inventory.reserved` grows by exactly
 *      the quantity bought) (DB case).
 *   4. THE CART IS NOT TOUCHED: an existing cart line for the same product and
 *      variant keeps its own quantity (DB case).
 *   5. A DOUBLE SUBMIT with the same `requestId` produces ONE order — the
 *      checkout_requests claim answers the second press with the FIRST
 *      response (DB case).
 *   6. INVALID QUANTITIES (0, negative, fractional, > 999) and over-stock
 *      quantities are REFUSED with a 400/409 — never silently clamped to 1.
 *
 * No Stripe API call is made and no charge is faked: the DB cases drive the
 * real `POST /api/customer/checkout` route and read what it wrote to Neon.
 * Payment settlement is covered by the webhook suites.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { readFileSync } from "fs";
import { join } from "path";

import { setupCartRoutes } from "../routes/cart.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const CART_ROUTE = "backend/routes/cart.ts";
const CHECKOUT_PAGE = "apps/velshop/src/pages/ShopCheckout.tsx";
const PRODUCT_DETAIL = "apps/velshop/src/pages/ShopProductDetail.tsx";
const SELECTION_SHEET = "apps/velshop/src/components/shop/ProductSelectionSheet.tsx";

// ═══════════════════════════════════════════════════════════════════════════
// 1. The contract, structurally (no database)
// ═══════════════════════════════════════════════════════════════════════════

describe("buy now — the request contract", () => {
  const cart = read(CART_ROUTE);

  test("the client sends productId / variantId / quantity — never a price", () => {
    expect(cart).toContain("const buyNowRaw = body.buyNow as");
    // Shape checks before anything is trusted…
    expect(cart).toContain("buyNow.productId is required");
    expect(cart).toContain("buyNow.variantId must be a string or null");
    // …and the quantity goes through the SAME server validator as a cart line.
    expect(cart).toMatch(/const quantity = typeof buyNowRaw\.quantity === "number"/);
    expect(cart).toContain("validateCheckoutQuantity(quantity)");
    // There is no code path that reads a client-supplied unit price for a
    // buy-now line.
    expect(cart).not.toMatch(/buyNowRaw\.price|buyNow\.price/);
  });

  test("buyNow and cartItemIds are mutually exclusive", () => {
    expect(cart).toContain("Send either buyNow or cartItemIds, not both");
  });

  test("the buy-now line is loaded from the product tables, not from a cart row", () => {
    // The row comes from `products` (+ `inventory`, `product_variants`).
    expect(cart).toMatch(
      /FROM products p[\s\S]{0,400}LEFT JOIN product_variants pv ON pv\.product_id = p\.id AND pv\.id = \$2/,
    );
    // The synthetic line has no cart row: nothing can be deleted or overwritten
    // in the cart by this purchase.
    expect(cart).toMatch(/\/\/ A synthetic line: it has no cart row[\s\S]{0,220}id: null/);
    // …and the cleanup only ever deletes REAL cart ids.
    expect(cart).toContain(
      '.filter((id: unknown): id is string => typeof id === "string" && id.length > 0)',
    );
    // Recalculating the cart total happens only when a cart row was purchased.
    expect(cart).toContain("if (cartId && processedItemIds.length > 0) {");
  });

  test("the order total is computed server-side from price × quantity", () => {
    expect(cart).toContain("totalAmount += parseFloat(item.price) * item.quantity;");
    expect(cart).toContain("const subtotal = parseFloat(item.price) * item.quantity;");
  });

  test("the storefront sends the chosen quantity and does NOT touch the cart", () => {
    const checkout = read(CHECKOUT_PAGE);
    // Checkout submits the buy-now payload — with the quantity the product page
    // recorded — instead of mapping cart line ids.
    expect(checkout).toMatch(/checkoutPayload\.buyNow = \{/);
    expect(checkout).toContain("quantity: Math.max(1, Number(navState.buyNowQty)");
    // A client-supplied price is never part of the payload.
    expect(checkout).not.toMatch(/checkoutPayload\.[a-zA-Z]*[Pp]rice/);

    /** The text of one branch, from its start marker to its end marker. */
    const branch = (file: string, from: string, to: string): string => {
      const src = read(file);
      const start = src.indexOf(from);
      expect(start).toBeGreaterThan(-1);
      const end = src.indexOf(to, start + from.length);
      expect(end).toBeGreaterThan(start);
      return src.slice(start, end);
    };

    // Each buy branch navigates with the selected quantity and contains NO cart
    // mutation: the first `add(` of the file still lives in the CART branch.
    const sheetBuy = branch(
      SELECTION_SHEET,
      'if (mode === "buy") {',
      'track("CART_ADD"',
    );
    expect(sheetBuy).toContain("buyNowQty: qty");
    expect(sheetBuy).not.toContain("add(");

    for (const [from, to] of [
      ['} else if (action === "buy") {', "}, [product, isAuthenticated, navigate, outOfStock, optionGroups, selectedOptions, add, buyNowState"],
      ['} else if (pendingAction === "buy") {', "}, [product, pendingAction, optionGroups, selectedOptions, outOfStock, add, buyNowState"],
    ] as const) {
      const buyBranch = branch(PRODUCT_DETAIL, from, to);
      // The payload is built by the shared `buyNowState()` callback…
      expect(buyBranch).toContain("buyNowState()");
      expect(buyBranch).not.toContain("add(");
    }
    // …which records the sheet quantity for the server.
    const payload = branch(PRODUCT_DETAIL, "const buyNowState = useCallback", ", [product, selectedVariant, sheetQty, displayPrice, displayStock, cartImageUrl, selectedSummary]");
    expect(payload).toContain("buyNowQty: sheetQty");
    expect(payload).toContain("buyNowItem");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The behaviour, against the REAL route (requires TEST_DATABASE_URL)
// ═══════════════════════════════════════════════════════════════════════════

const describeDb = hasTestDatabase() ? describe : describe.skip;
const testFn = hasTestDatabase() ? test : test.skip;

describeDb("buy now — quantity, stock, cart and idempotency (requires TEST_DATABASE_URL)", () => {
  const PRICE = 125.5;
  const fixtureUsers: Array<string | null> = [];
  const savedEnv: Record<string, string | undefined> = {};

  beforeAll(() => {
    // A plausible TEST key: the reservation policy is configured like production,
    // but no Stripe call is made from this route.
    for (const key of [
      "STRIPE_SECRET_KEY",
      "STRIPE_PUBLISHABLE_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "VITE_VELSHOP_URL",
    ] as const) {
      savedEnv[key] = process.env[key];
    }
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.VITE_VELSHOP_URL;
    process.env.STRIPE_SECRET_KEY = "sk_test_000000000000000000000000";
  });

  afterAll(async () => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await purgeUsers(fixtureUsers.splice(0));
  });

  interface Fixture {
    ownerId: string;
    shopId: string;
    productId: string;
    /** A cart line the customer saved BEFORE buying directly (qty 3). */
    existingCartItemId: string;
    stockQty: number;
  }

  /** One customer, one shop, one published product with inventory. */
  async function seedBuyNowFixture(tag: string, stock: number): Promise<Fixture> {
    const { query } = await import("../db/index.js");
    const owner = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-buyer@test.local`,
      "Buy Now Buyer",
    ]);
    const ownerId = owner.rows[0].id as string;
    fixtureUsers.push(ownerId);

    const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-seller@test.local`,
      "Buy Now Seller",
    ]);
    fixtureUsers.push(sellerUser.rows[0].id as string);
    const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [
      sellerUser.rows[0].id,
    ]);
    const shop = await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
      seller.rows[0].id,
      `${tag} shop`,
      `${tag}-shop`,
    ]);
    const shopId = shop.rows[0].id as string;

    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status, sold_count)
       VALUES ($1, $2, $3, $4, 'published', 0) RETURNING id`,
      [shopId, `${tag} product`, `${tag}-p`, PRICE],
    );
    const productId = product.rows[0].id as string;
    await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, $2, 0)`, [
      productId,
      stock,
    ]);

    // The saved cart line the OLD implementation would have charged.
    const cart = await query(`INSERT INTO carts (user_id) VALUES ($1) RETURNING id`, [ownerId]);
    const item = await query(
      `INSERT INTO cart_items (cart_id, product_id, quantity, price) VALUES ($1, $2, 3, $3) RETURNING id`,
      [cart.rows[0].id, productId, PRICE],
    );

    return { ownerId, shopId, productId, existingCartItemId: item.rows[0].id as string, stockQty: stock };
  }

  interface CheckoutResult {
    status: number;
    data?: Record<string, unknown>;
    code?: string;
  }

  /** Drive the REAL checkout route with a buy-now payload. */
  async function buyNow(
    asUserId: string,
    payload: { productId: string; variantId?: string | null; quantity: number },
    requestId: string,
    extra: Record<string, unknown> = {},
  ): Promise<CheckoutResult> {
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
          paymentMethod: "CARD",
          buyNow: {
            productId: payload.productId,
            variantId: payload.variantId ?? null,
            quantity: payload.quantity,
          },
          requestId,
          ...extra,
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

  /** What the checkout actually wrote to Neon, read straight back. */
  async function purchaseOf(orderId: string) {
    const { query } = await import("../db/index.js");
    const order = (
      await query(`SELECT id, user_id, status, total_amount, checkout_group_id FROM orders WHERE id = $1`, [
        orderId,
      ])
    ).rows[0];
    const lines = (
      await query(
        `SELECT product_id, quantity, price, subtotal FROM order_items WHERE order_id = $1 ORDER BY id ASC`,
        [orderId],
      )
    ).rows as Array<Record<string, unknown>>;
    return { order, lines };
  }

  async function inventoryOf(productId: string) {
    const { query } = await import("../db/index.js");
    const row = (
      await query(`SELECT quantity, reserved FROM inventory WHERE product_id = $1`, [productId])
    ).rows[0];
    return { quantity: Number(row.quantity), reserved: Number(row.reserved) };
  }

  async function cartLineOf(cartItemId: string) {
    const { query } = await import("../db/index.js");
    const row = (await query(`SELECT quantity FROM cart_items WHERE id = $1`, [cartItemId])).rows[0];
    return row ? Number(row.quantity) : null;
  }

  for (const quantity of [1, 2, 5] as const) {
    testFn(`quantity = ${quantity}: order line, total, stock and cart are all exact`, async () => {
      const fx = await seedBuyNowFixture(`bn${quantity}-${crypto.randomUUID().slice(0, 8)}`, 50);
      try {
        const before = await inventoryOf(fx.productId);
        const res = await buyNow(
          fx.ownerId,
          { productId: fx.productId, quantity },
          crypto.randomUUID(),
        );
        expect(res.status).toBe(200);

        const groupId = res.data?.checkoutGroupId as string | undefined;
        const orderId = (res.data?.parentOrderId as string | undefined) ?? "";
        expect(orderId).toBeTruthy();
        expect(groupId).toBeTruthy();

        // The response mirrors the quantity…
        expect(Number(res.data?.itemCount)).toBe(quantity);
        const summary = res.data?.items as Array<Record<string, unknown>> | undefined;
        expect(summary?.length).toBe(1);
        expect(Number(summary?.[0]?.qty)).toBe(quantity);

        // …and so does the order the database holds.
        const { order, lines } = await purchaseOf(orderId);
        expect(lines.length).toBe(1);
        expect(Number(lines[0]!.quantity)).toBe(quantity);
        expect(Number(lines[0]!.price)).toBeCloseTo(PRICE, 5);
        expect(Number(lines[0]!.subtotal)).toBeCloseTo(PRICE * quantity, 2);
        expect(Number(order.total_amount)).toBeCloseTo(PRICE * quantity, 2);

        // Stock is held for EXACTLY this quantity (checkout reserves, payment
        // settles later — see lib/inventory.ts).
        const after = await inventoryOf(fx.productId);
        expect(after.quantity).toBe(before.quantity);
        expect(after.reserved).toBe(before.reserved + quantity);

        // The saved cart line is untouched — this is the mutation the old
        // implementation performed.
        expect(await cartLineOf(fx.existingCartItemId)).toBe(3);
      } finally {
        await purgeUsers([fx.ownerId]);
      }
    });
  }

  testFn("over-stock quantity is refused, never silently clamped", async () => {
    const fx = await seedBuyNowFixture(`bnoos-${crypto.randomUUID().slice(0, 8)}`, 2);
    try {
      const res = await buyNow(fx.ownerId, { productId: fx.productId, quantity: 3 }, crypto.randomUUID());
      expect(res.status).toBe(400);
      expect(res.code).toBe("INSUFFICIENT_STOCK");
      const inv = await inventoryOf(fx.productId);
      expect(inv.reserved).toBe(0);
      expect(await cartLineOf(fx.existingCartItemId)).toBe(3);
    } finally {
      await purgeUsers([fx.ownerId]);
    }
  });

  testFn("invalid quantities (0, -1, 1.5, 1000) are refused with VALIDATION_ERROR", async () => {
    const fx = await seedBuyNowFixture(`bnbad-${crypto.randomUUID().slice(0, 8)}`, 50);
    try {
      for (const quantity of [0, -1, 1.5, 1000]) {
        const res = await buyNow(fx.ownerId, { productId: fx.productId, quantity }, crypto.randomUUID());
        expect(res.status).toBe(400);
        expect(res.code).toBe("VALIDATION_ERROR");
      }
      // Nothing was created or held.
      const inv = await inventoryOf(fx.productId);
      expect(inv.reserved).toBe(0);
      const { query } = await import("../db/index.js");
      const orders = await query(`SELECT id FROM orders WHERE user_id = $1`, [fx.ownerId]);
      expect(orders.rows.length).toBe(0);
    } finally {
      await purgeUsers([fx.ownerId]);
    }
  });

  testFn("double submit with the same requestId creates ONE order, not two", async () => {
    const fx = await seedBuyNowFixture(`bndup-${crypto.randomUUID().slice(0, 8)}`, 50);
    try {
      const requestId = crypto.randomUUID();
      const first = await buyNow(fx.ownerId, { productId: fx.productId, quantity: 2 }, requestId);
      const second = await buyNow(fx.ownerId, { productId: fx.productId, quantity: 2 }, requestId);
      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      // The replay answers with the FIRST purchase — same group, same order.
      expect(second.data?.checkoutGroupId).toBe(first.data?.checkoutGroupId);
      expect(second.data?.parentOrderId).toBe(first.data?.parentOrderId);

      const { query } = await import("../db/index.js");
      const orders = await query(`SELECT id FROM orders WHERE user_id = $1`, [fx.ownerId]);
      expect(orders.rows.length).toBe(1);
      // Stock was held ONCE: 2 units, not 4.
      const inv = await inventoryOf(fx.productId);
      expect(inv.reserved).toBe(2);
      // …and the cart is still untouched.
      expect(await cartLineOf(fx.existingCartItemId)).toBe(3);
    } finally {
      await purgeUsers([fx.ownerId]);
    }
  });

  testFn("buyNow together with cartItemIds is refused", async () => {
    const fx = await seedBuyNowFixture(`bnboth-${crypto.randomUUID().slice(0, 8)}`, 50);
    try {
      const res = await buyNow(
        fx.ownerId,
        { productId: fx.productId, quantity: 1 },
        crypto.randomUUID(),
        { cartItemIds: [fx.existingCartItemId] },
      );
      expect(res.status).toBe(400);
      expect(res.code).toBe("VALIDATION_ERROR");
    } finally {
      await purgeUsers([fx.ownerId]);
    }
  });

  testFn("an unpublished product cannot be bought directly", async () => {
    const fx = await seedBuyNowFixture(`bnunpub-${crypto.randomUUID().slice(0, 8)}`, 50);
    try {
      const { query } = await import("../db/index.js");
      await query(`UPDATE products SET status = 'draft' WHERE id = $1`, [fx.productId]);
      const res = await buyNow(fx.ownerId, { productId: fx.productId, quantity: 1 }, crypto.randomUUID());
      expect(res.status).toBe(400);
      expect(res.code).toBe("PRODUCT_UNAVAILABLE");
    } finally {
      await purgeUsers([fx.ownerId]);
    }
  });
});
