/**
 * Selling units (sets / packs) — the buy-and-sell MVP's way to sell one product
 * by the piece or by the pack.
 *
 * WHAT THIS PINS
 *   1. A seller authors a set: name, pieces, price — and cannot author a second
 *      LIVE definition for the same size.
 *   2. A set and a single piece of ONE product are two DIFFERENT cart lines (the
 *      widened cart key), so adding a pack never merges into — or re-prices —
 *      the plain line.
 *   3. The price comes from the definition, never from the request body, and the
 *      definition must belong to that product.
 *   4. INVENTORY ONLY EVER SEES BASE PIECES: 2 sets of 12 reserve, commit and
 *      sell 24 — through the ONE existing authority, exactly once.
 *   5. A retired set is refused; an order line keeps its own snapshot, so a later
 *      edit to the definition cannot rewrite what was sold.
 *   6. The per-line cap applies to BASE units, so packs cannot smuggle a multiple
 *      of the cap past the server backstop.
 *
 * The integration half is gated on `hasTestDatabase()` — the same gate every
 * other DB-backed suite in this repository uses.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import { commitOrderInventory, releaseOrderInventory } from "../lib/inventory.js";
import { baseUnits } from "../lib/selling-units.js";
import { setupCartRoutes } from "../routes/cart.js";
import { setupProductSellingUnitRoutes } from "../routes/product-selling-units.js";
import { withTransaction } from "../db/index.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

// ─── The conversion itself (pure, no database) ───────────────────────────────

describe("base units — the one conversion", () => {
  test("a plain line is its own quantity", () => {
    expect(baseUnits(3, 1)).toBe(3);
    expect(baseUnits(1, 1)).toBe(1);
  });

  test("a set/pack multiplies by its pieces", () => {
    expect(baseUnits(2, 12)).toBe(24);
    expect(baseUnits(1, 6)).toBe(6);
    expect(baseUnits(3, 24)).toBe(72);
  });

  test("malformed input can never INFLATE a stock movement", () => {
    // Negative/absent quantity converts to 0 pieces, never a negative movement
    // that would ADD stock, and a missing size falls back to 1.
    expect(baseUnits(-5, 12)).toBe(0);
    expect(baseUnits(0, 12)).toBe(0);
    expect(baseUnits(Number.NaN, 12)).toBe(0);
    expect(baseUnits(2, 0)).toBe(2);
    expect(baseUnits(2, null)).toBe(2);
    expect(baseUnits(2, Number.NaN)).toBe(2);
  });
});

describe("the inventory authority converts, it does not re-implement", () => {
  const lib = read("backend/lib/inventory.ts");

  test("both settlement and release read the lines through the shared expression", () => {
    expect(lib).toContain("orderItemBaseQuantitySql()");
    expect(lib).toContain("baseUnits(item.base_quantity, 1)");
    // The raw selling-unit count is never handed to stock.
    expect(lib).not.toContain("SELECT product_id, variant_id, quantity FROM order_items");
  });

  test("no per-pack stock column exists anywhere in the canonical schema", () => {
    const schema = read("db/schema.sql");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS product_selling_units");
    // The selling-unit table states a price and a size — never a stock counter.
    const block = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS product_selling_units"));
    const body = block.slice(0, block.indexOf("\n);"));
    expect(body).toContain("pieces INTEGER NOT NULL CHECK (pieces > 0)");
    expect(body).toContain("price NUMERIC(12, 2) NOT NULL CHECK (price >= 0)");
    expect(body).not.toContain("stock");
  });
});

// ─── Integration ─────────────────────────────────────────────────────────────

describe("selling units (requires TEST_DATABASE_URL)", () => {
  const testFn = hasTestDatabase() ? test : test.skip;

  let server: Server | undefined;
  let base = "";
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    if (!hasTestDatabase()) return;
    // Checkout refuses CARD while Stripe is unconfigured (503
    // STRIPE_NOT_CONFIGURED) — a real boundary, not something to bypass. These
    // tests exercise the CART/ORDER path, so a syntactically valid test key is
    // set exactly as the other checkout suites do; no Stripe API call is made
    // (the session is never opened from this suite).
    process.env.STRIPE_SECRET_KEY = "sk_test_000000000000000000000000";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_000000000000000000000000";
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "1mb" }));
    setupCartRoutes(app);
    setupProductSellingUnitRoutes(app);
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (hasTestDatabase() && createdUserIds.length > 0) await purgeUsers(createdUserIds);
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  function cookie(userId: string, email: string): string {
    return `velnox_session=${jwt.sign({ userId, email }, process.env.JWT_SECRET as string, { expiresIn: "5m" })}`;
  }

  async function api(method: string, path: string, who: { userId: string; email: string }, body?: unknown) {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { "content-type": "application/json", cookie: cookie(who.userId, who.email) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  /** An approved seller with a published product (price 10) holding 1000 base units. */
  async function seedSellerWithProduct(tag: string) {
    const { query } = await import("../db/index.js");
    const email = `${tag}-${randomUUID().slice(0, 8)}@test.invalid`;
    const user = await query("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id", [email, `${tag} seller`]);
    const sellerUserId = user.rows[0].id as string;
    createdUserIds.push(sellerUserId);

    const seller = await query("INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id", [sellerUserId]);
    const sellerId = seller.rows[0].id as string;
    const shop = await query(
      "INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
      [sellerId, `${tag} shop`, `${tag}-${randomUUID().slice(0, 8)}`],
    );
    const shopId = shop.rows[0].id as string;

    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status, unit)
       VALUES ($1, $2, $3, 10, 'published', 'ชิ้น') RETURNING id`,
      [shopId, `${tag} water`, `${tag}-p-${randomUUID().slice(0, 8)}`],
    );
    const productId = product.rows[0].id as string;
    await query("INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 1000, 0)", [productId]);

    return { userId: sellerUserId, sellerUserId, email, sellerId, shopId, productId };
  }

  /** A customer who can buy. */
  async function seedCustomer(tag: string) {
    const { query } = await import("../db/index.js");
    const email = `${tag}-${randomUUID().slice(0, 8)}@test.invalid`;
    const user = await query("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id", [email, `${tag} buyer`]);
    const userId = user.rows[0].id as string;
    createdUserIds.push(userId);
    return { userId, email };
  }

  /** Author a set/pack through the real seller endpoint. */
  async function createUnit(
    seller: { userId: string; email: string; productId: string },
    body: Record<string, unknown>,
  ) {
    return api("POST", `/api/seller/products/${seller.productId}/selling-units`, seller, body);
  }

  testFn("a seller authors a set: pieces and price are validated and stored", async () => {
    const seller = await seedSellerWithProduct("su-author");
    const created = await createUnit(seller, { name: "เซ็ต 12", pieces: 12, price: 100 });
    expect(created.status).toBe(200);
    expect(created.json.data).toMatchObject({ name: "เซ็ต 12", pieces: 12, price: 100, status: "active" });
    // The per-piece price is DERIVED for display and never stored.
    expect(created.json.data.pricePerPiece).toBeCloseTo(8.33, 2);
  });

  testFn("invalid definitions are refused before anything is written", async () => {
    const seller = await seedSellerWithProduct("su-invalid");
    expect((await createUnit(seller, { name: "", pieces: 12, price: 100 })).status).toBe(400);
    expect((await createUnit(seller, { name: "zero", pieces: 0, price: 100 })).status).toBe(400);
    expect((await createUnit(seller, { name: "negative", pieces: -6, price: 100 })).status).toBe(400);
    expect((await createUnit(seller, { name: "fraction", pieces: 1.5, price: 100 })).status).toBe(400);
    expect((await createUnit(seller, { name: "negative price", pieces: 12, price: -1 })).status).toBe(400);
    expect((await createUnit(seller, { name: "no price", pieces: 12 })).status).toBe(400);
    // A variant that belongs to another product is refused.
    expect((await createUnit(seller, { name: "other variant", pieces: 6, price: 50, variantId: randomUUID() })).status).toBe(400);
  });

  testFn("one LIVE definition per (product, variant, pieces)", async () => {
    const seller = await seedSellerWithProduct("su-unique");
    expect((await createUnit(seller, { name: "Set 6", pieces: 6, price: 55 })).status).toBe(200);
    const dup = await createUnit(seller, { name: "Set 6 again", pieces: 6, price: 40 });
    expect(dup.status).toBe(409);
    expect(dup.json.error.code).toBe("DUPLICATE_SELLING_UNIT");

    // A DIFFERENT size is a different definition, and so is a retired one.
    expect((await createUnit(seller, { name: "Set 12", pieces: 12, price: 100 })).status).toBe(200);
  });

  testFn("a set and a single piece are two different cart lines", async () => {
    const seller = await seedSellerWithProduct("su-lines");
    const unit = (await createUnit(seller, { name: "เซ็ต 12", pieces: 12, price: 100 })).json.data;
    const buyer = await seedCustomer("su-lines-buyer");

    const asSet = await api("POST", "/api/customer/cart/add", buyer, {
      productId: seller.productId,
      quantity: 2,
      sellingUnitId: unit.id,
    });
    expect(asSet.status).toBe(200);
    const setLine = asSet.json.data.items[0];
    expect(setLine).toMatchObject({
      quantity: 2,
      sellingUnitId: unit.id,
      sellingUnitName: "เซ็ต 12",
      sellingUnitPieces: 12,
      priceSnapshot: 100,
      baseQuantity: 24,
    });

    const asPiece = await api("POST", "/api/customer/cart/add", buyer, {
      productId: seller.productId,
      quantity: 3,
    });
    expect(asPiece.status).toBe(200);
    // TWO lines: the pack line was not merged into, and did not re-price, the
    // plain line.
    expect(asPiece.json.data.items).toHaveLength(2);
    const pieceLine = asPiece.json.data.items.find((i: any) => i.sellingUnitId === null);
    expect(pieceLine).toMatchObject({ quantity: 3, sellingUnitPieces: 1, priceSnapshot: 10, baseQuantity: 3 });
    const stillSet = asPiece.json.data.items.find((i: any) => i.sellingUnitId === unit.id);
    expect(stillSet).toMatchObject({ quantity: 2, priceSnapshot: 100, baseQuantity: 24 });
  });

  testFn("the definition is the price authority — a crafted body cannot set it", async () => {
    const seller = await seedSellerWithProduct("su-price");
    const unit = (await createUnit(seller, { name: "Set 12", pieces: 12, price: 100 })).json.data;
    const buyer = await seedCustomer("su-price-buyer");

    const res = await api("POST", "/api/customer/cart/add", buyer, {
      productId: seller.productId,
      quantity: 1,
      sellingUnitId: unit.id,
      price: 1,
      sellingUnitPieces: 1,
    });
    expect(res.status).toBe(200);
    expect(res.json.data.items[0]).toMatchObject({ priceSnapshot: 100, sellingUnitPieces: 12, baseQuantity: 12 });
  });

  testFn("a selling unit from another product is refused", async () => {
    const sellerA = await seedSellerWithProduct("su-cross-a");
    const sellerB = await seedSellerWithProduct("su-cross-b");
    const unitB = (await createUnit(sellerB, { name: "B pack", pieces: 12, price: 100 })).json.data;
    const buyer = await seedCustomer("su-cross-buyer");

    const res = await api("POST", "/api/customer/cart/add", buyer, {
      productId: sellerA.productId,
      quantity: 1,
      sellingUnitId: unitB.id,
    });
    expect(res.status).toBe(400);
    expect(res.json.error.code).toBe("VALIDATION_ERROR");
  });

  testFn("a retired set cannot be added, and cannot be checked out", async () => {
    const seller = await seedSellerWithProduct("su-retired");
    const unit = (await createUnit(seller, { name: "Set 12", pieces: 12, price: 100 })).json.data;
    const buyer = await seedCustomer("su-retired-buyer");

    const added = await api("POST", "/api/customer/cart/add", buyer, {
      productId: seller.productId,
      quantity: 1,
      sellingUnitId: unit.id,
    });
    expect(added.status).toBe(200);

    // Retiring is a status change, never a row delete.
    const retired = await api("DELETE", `/api/seller/products/${seller.productId}/selling-units/${unit.id}`, seller);
    expect(retired.status).toBe(200);
    expect(retired.json.data.status).toBe("inactive");
    const { query } = await import("../db/index.js");
    const row = await query("SELECT id FROM product_selling_units WHERE id = $1", [unit.id]);
    expect(row.rows).toHaveLength(1); // still there

    // Adding it again is refused…
    const again = await api("POST", "/api/customer/cart/add", buyer, {
      productId: seller.productId,
      quantity: 1,
      sellingUnitId: unit.id,
    });
    expect(again.status).toBe(400);
    expect(again.json.error.code).toBe("SELLING_UNIT_UNAVAILABLE");

    // …and the line already in the cart cannot be checked out either.
    const checkout = await api("POST", "/api/customer/checkout", buyer, { paymentMethod: "CARD" });
    expect(checkout.status).toBe(400);
    expect(checkout.json.error.code).toBe("SELLING_UNIT_UNAVAILABLE");
  });

  testFn("2 sets of 12 reserve, order and settle as 24 base units — exactly once", async () => {
    const seller = await seedSellerWithProduct("su-flow");
    const unit = (await createUnit(seller, { name: "เซ็ต 12", pieces: 12, price: 100 })).json.data;
    const buyer = await seedCustomer("su-flow-buyer");

    await api("POST", "/api/customer/cart/add", buyer, {
      productId: seller.productId,
      quantity: 2, // 2 sets
      sellingUnitId: unit.id,
    });

    const checkout = await api("POST", "/api/customer/checkout", buyer, { paymentMethod: "CARD" });
    expect(checkout.status).toBe(200);
    expect(checkout.json.data.total).toBe(200); // 2 × ฿100, NOT 2 × ฿10

    const { query } = await import("../db/index.js");
    const orderId = checkout.json.data.orders[0].orderId as string;

    const line = await query(
      `SELECT quantity, price, subtotal, selling_unit_id, selling_unit_pieces, selling_unit_name
         FROM order_items WHERE order_id = $1`,
      [orderId],
    );
    expect(line.rows).toHaveLength(1);
    expect(line.rows[0]).toMatchObject({
      selling_unit_id: unit.id,
      selling_unit_name: "เซ็ต 12",
    });
    expect(Number(line.rows[0].selling_unit_pieces)).toBe(12);
    expect(Number(line.rows[0].quantity)).toBe(2);
    expect(Number(line.rows[0].price)).toBe(100);
    expect(Number(line.rows[0].subtotal)).toBe(200);

    // 24 base pieces are HELD, not 2.
    const held = await query("SELECT quantity, reserved FROM inventory WHERE product_id = $1", [seller.productId]);
    expect(Number(held.rows[0].reserved)).toBe(24);
    expect(Number(held.rows[0].quantity)).toBe(1000);

    // Settlement consumes 24 and counts 24 sold, exactly once.
    await withTransaction(async (client) => {
      await commitOrderInventory(client, orderId);
    });
    const settled = await query(
      "SELECT i.quantity, i.reserved, p.sold_count FROM inventory i JOIN products p ON p.id = i.product_id WHERE i.product_id = $1",
      [seller.productId],
    );
    expect(Number(settled.rows[0].quantity)).toBe(976);
    expect(Number(settled.rows[0].reserved)).toBe(0);
    expect(Number(settled.rows[0].sold_count)).toBe(24);

    // A release after settlement must not hand sold stock back.
    await withTransaction(async (client) => {
      await releaseOrderInventory(client, orderId);
    });
    const after = await query("SELECT quantity, reserved FROM inventory WHERE product_id = $1", [seller.productId]);
    expect(Number(after.rows[0].quantity)).toBe(976);
    expect(Number(after.rows[0].reserved)).toBe(0);
  });

  testFn("a failed set order returns exactly the 24 pieces it held", async () => {
    const seller = await seedSellerWithProduct("su-release");
    const unit = (await createUnit(seller, { name: "เซ็ต 12", pieces: 12, price: 100 })).json.data;
    const buyer = await seedCustomer("su-release-buyer");

    await api("POST", "/api/customer/cart/add", buyer, {
      productId: seller.productId,
      quantity: 2,
      sellingUnitId: unit.id,
    });
    const checkout = await api("POST", "/api/customer/checkout", buyer, { paymentMethod: "CARD" });
    const orderId = checkout.json.data.orders[0].orderId as string;

    const { query } = await import("../db/index.js");
    const held = await query("SELECT reserved FROM inventory WHERE product_id = $1", [seller.productId]);
    expect(Number(held.rows[0].reserved)).toBe(24);

    await withTransaction(async (client) => {
      await client.query("UPDATE orders SET status = 'cancelled' WHERE id = $1", [orderId]);
      await releaseOrderInventory(client, orderId);
    });
    const released = await query("SELECT quantity, reserved FROM inventory WHERE product_id = $1", [seller.productId]);
    expect(Number(released.rows[0].reserved)).toBe(0);
    expect(Number(released.rows[0].quantity)).toBe(1000);
  });

  testFn("a legacy line with no selling unit behaves exactly as before", async () => {
    const seller = await seedSellerWithProduct("su-legacy");
    const buyer = await seedCustomer("su-legacy-buyer");

    await api("POST", "/api/customer/cart/add", buyer, { productId: seller.productId, quantity: 3 });
    const checkout = await api("POST", "/api/customer/checkout", buyer, { paymentMethod: "CARD" });
    expect(checkout.status).toBe(200);
    expect(checkout.json.data.total).toBe(30); // 3 × ฿10

    const { query } = await import("../db/index.js");
    const line = await query(
      "SELECT quantity, selling_unit_id, selling_unit_pieces FROM order_items WHERE order_id = $1",
      [checkout.json.data.orders[0].orderId],
    );
    expect(line.rows[0].selling_unit_id).toBeNull();
    expect(Number(line.rows[0].selling_unit_pieces)).toBe(1);
    const held = await query("SELECT reserved FROM inventory WHERE product_id = $1", [seller.productId]);
    expect(Number(held.rows[0].reserved)).toBe(3); // 3 pieces, not 3 × anything
  });

  testFn("the per-line cap counts BASE units, so packs cannot smuggle past it", async () => {
    const seller = await seedSellerWithProduct("su-cap");
    const unit = (await createUnit(seller, { name: "ลัง 24", pieces: 24, price: 200 })).json.data;
    const buyer = await seedCustomer("su-cap-buyer");

    await api("POST", "/api/customer/cart/add", buyer, {
      productId: seller.productId,
      quantity: 1,
      sellingUnitId: unit.id,
    });

    // Push the line to 999 selling units = 23,976 base units, straight in the DB
    // (the API clamps to stock) — the cap must refuse it server-side.
    const { query } = await import("../db/index.js");
    const cart = await query("SELECT c.id FROM carts c WHERE c.user_id = $1", [buyer.userId]);
    await query("UPDATE cart_items SET quantity = 999 WHERE cart_id = $1", [cart.rows[0].id]);

    const checkout = await api("POST", "/api/customer/checkout", buyer, { paymentMethod: "CARD" });
    expect(checkout.status).toBe(400);
    expect(checkout.json.error.code).toBe("VALIDATION_ERROR");
  });

  testFn("a later edit to the definition cannot rewrite a past order line", async () => {
    const seller = await seedSellerWithProduct("su-immutable");
    const unit = (await createUnit(seller, { name: "Set 12", pieces: 12, price: 100 })).json.data;
    const buyer = await seedCustomer("su-immutable-buyer");

    await api("POST", "/api/customer/cart/add", buyer, {
      productId: seller.productId,
      quantity: 2,
      sellingUnitId: unit.id,
    });
    const checkout = await api("POST", "/api/customer/checkout", buyer, { paymentMethod: "CARD" });
    const orderId = checkout.json.data.orders[0].orderId as string;

    // The seller re-prices the set and changes its size.
    const updated = await api(
      "PATCH",
      `/api/seller/products/${seller.productId}/selling-units/${unit.id}`,
      seller,
      { pieces: 24, price: 180 },
    );
    expect(updated.status).toBe(200);

    const { query } = await import("../db/index.js");
    const line = await query(
      "SELECT quantity, price, subtotal, selling_unit_pieces, selling_unit_name FROM order_items WHERE order_id = $1",
      [orderId],
    );
    expect(Number(line.rows[0].quantity)).toBe(2);
    expect(Number(line.rows[0].price)).toBe(100);
    expect(Number(line.rows[0].subtotal)).toBe(200);
    expect(Number(line.rows[0].selling_unit_pieces)).toBe(12); // the size AS SOLD
    expect(line.rows[0].selling_unit_name).toBe("Set 12");
  });

  testFn("re-order re-adds the SET, not that many pieces", async () => {
    const seller = await seedSellerWithProduct("su-reorder");
    const unit = (await createUnit(seller, { name: "เซ็ต 12", pieces: 12, price: 100 })).json.data;
    const buyer = await seedCustomer("su-reorder-buyer");

    await api("POST", "/api/customer/cart/add", buyer, {
      productId: seller.productId,
      quantity: 2,
      sellingUnitId: unit.id,
    });
    const checkout = await api("POST", "/api/customer/checkout", buyer, { paymentMethod: "CARD" });
    const orderId = checkout.json.data.orders[0].orderId as string;

    const { query } = await import("../db/index.js");
    await query("DELETE FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1)", [buyer.userId]);

    const reorder = await api("POST", "/api/customer/reorder", buyer, { orderId });
    expect(reorder.status).toBe(200);

    const cart = await query(
      "SELECT quantity, price, selling_unit_id, selling_unit_pieces FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1)",
      [buyer.userId],
    );
    expect(cart.rows).toHaveLength(1);
    expect(cart.rows[0].selling_unit_id).toBe(unit.id);
    expect(Number(cart.rows[0].quantity)).toBe(2);
    expect(Number(cart.rows[0].selling_unit_pieces)).toBe(12);
    expect(Number(cart.rows[0].price)).toBe(100);
  });

  testFn("the product payload offers the sets a buyer may choose", async () => {
    const seller = await seedSellerWithProduct("su-payload");
    await createUnit(seller, { name: "Set 6", pieces: 6, price: 55 });
    await createUnit(seller, { name: "Set 12", pieces: 12, price: 100 });
    const retired = (await createUnit(seller, { name: "Set 3", pieces: 3, price: 30 })).json.data;
    await api("DELETE", `/api/seller/products/${seller.productId}/selling-units/${retired.id}`, seller);

    const { query } = await import("../db/index.js");
    const { loadSellingUnits } = await import("../lib/selling-units.js");
    const units = (await loadSellingUnits(query, [seller.productId])).get(seller.productId) ?? [];
    // Only ACTIVE definitions are offered, ordered by sort_order then size.
    expect(units.map((u) => u.pieces)).toEqual([6, 12]);
    expect(units.map((u) => u.status)).toEqual(["active", "active"]);
  });
});
