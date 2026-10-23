/**
 * MVP retail selling units (sets / packs).
 *
 * The commercial invariant this file exists to prove:
 *
 *     required base units = purchased quantity × selling-unit base quantity
 *
 * so a 6-pack and six singles draw from the SAME `inventory` row, the seller's
 * pack price (never base × quantity) is what the buyer is charged, and cancel /
 * expiry release exactly the base units that were reserved. Everything here runs
 * against a real PostgreSQL built from `db/schema.sql`; the triggers, CHECKs
 * and generated snapshot column are what is being tested, so a mocked query would
 * prove nothing.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { query } from "../../db/index.js";
import { hasTestDatabase } from "../../tests/helpers/test-db.js";
import {
  addressBody,
  api,
  checkout,
  createPublishedProduct,
  createSeller,
  createSellingUnit,
  createUser,
  seedCart,
  startApp,
  stockRow,
  type TestApp,
  type TestSeller,
  type TestUser,
} from "./helpers/mvp-app.js";

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

/** Create → submit → admin approve → publish through the real seller API. */
async function createPublishedViaApi(
  base: string,
  seller: TestSeller,
  admin: TestUser,
  opts: {
    name?: string;
    price?: string;
    stock?: number;
    variants?: Array<{ name: string; price: string; stock: number }>;
    /** Added while the product is still a draft, as a seller would. */
    packs?: Array<{ label: string; baseQuantity: number; price: string }>;
  } = {},
): Promise<{ productId: string; slug: string; variantId: string | null }> {
  const created = await api(base, "/api/mvp/seller/products", {
    method: "POST",
    cookie: seller.cookie,
    body: {
      name: opts.name ?? `Pack product ${crypto.randomUUID().slice(0, 6)}`,
      price: opts.price ?? "10.00",
      stock: opts.variants ? undefined : (opts.stock ?? 10),
      variants: opts.variants,
    },
  });
  if (created.status !== 201) {
    throw new Error(`create product failed ${created.status}: ${JSON.stringify(created.body)}`);
  }
  const product = created.body.data.product as {
    id: string;
    slug: string;
    variants: Array<{ id: string }>;
  };
  const variantId = product.variants[0]?.id ?? null;

  for (const pack of opts.packs ?? []) {
    const added = await api(base, `/api/mvp/seller/products/${product.id}/selling-units`, {
      method: "POST",
      cookie: seller.cookie,
      body: { ...pack, variantId },
    });
    if (added.status !== 201) {
      throw new Error(`add pack failed ${added.status}: ${JSON.stringify(added.body)}`);
    }
  }

  const submitted = await api(base, `/api/mvp/seller/products/${product.id}/submit`, {
    method: "POST",
    cookie: seller.cookie,
  });
  expect(submitted.status).toBe(200);
  const approved = await api(base, `/api/mvp/admin/products/${product.id}/approve`, {
    method: "POST",
    cookie: admin.cookie,
  });
  expect(approved.status).toBe(200);
  const published = await api(base, `/api/mvp/seller/products/${product.id}/publish`, {
    method: "POST",
    cookie: seller.cookie,
  });
  expect(published.status).toBe(200);

  return { productId: product.id, slug: product.slug, variantId };
}

describe("MVP selling units — seller configuration (needs a test database + JWT_SECRET)", () => {
  let app: TestApp;
  let admin: TestUser;

  beforeAll(async () => {
    if (!hasDb) return;
    app = await startApp();
    admin = await createUser({ role: "admin" });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  itDb("an approved seller can add a pack, and the catalogue publishes it with its own price", async () => {
    const seller = await createSeller();
    const { productId, slug, variantId } = await createPublishedViaApi(app.base, seller, admin, {
      name: "Water",
      variants: [{ name: "Bottle", price: "10.00", stock: 10 }],
      packs: [{ label: "Pack 6", baseQuantity: 6, price: "55.00" }],
    });

    const sellerView = await api(app.base, `/api/mvp/seller/products/${productId}`, {
      cookie: seller.cookie,
    });
    expect(sellerView.status).toBe(200);
    const units = sellerView.body.data.product.sellingUnits as Array<Record<string, unknown>>;
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({
      label: "Pack 6",
      baseQuantity: 6,
      price: "55.00",
      isActive: true,
      variantId,
    });

    const detail = await api(app.base, `/api/mvp/products/${slug}`);
    expect(detail.status).toBe(200);
    const options = detail.body.data.product.variants[0].sellingUnits as Array<Record<string, unknown>>;
    // The implicit single-unit option plus the seller's pack.
    expect(options.map((option) => option.baseQuantity)).toEqual([1, 6]);
    expect(options[0]).toMatchObject({ id: null, isBase: true, price: "10.00", available: 10 });
    expect(options[1]).toMatchObject({
      label: "Pack 6",
      baseQuantity: 6,
      price: "55.00",
      // 10 base units / 6 per pack → one pack can be bought.
      available: 1,
      isBase: false,
    });
  });

  itDb("an explicit one-unit option replaces the implicit single unit (no duplicate choices)", async () => {
    const seller = await createSeller();
    const { slug } = await createPublishedViaApi(app.base, seller, admin, {
      variants: [{ name: "Bag", price: "100.00", stock: 20 }],
      packs: [{ label: "1 bag", baseQuantity: 1, price: "95.00" }],
    });

    const detail = await api(app.base, `/api/mvp/products/${slug}`);
    const options = detail.body.data.product.variants[0].sellingUnits as Array<Record<string, unknown>>;
    expect(options).toHaveLength(1);
    expect(options[0]).toMatchObject({ label: "1 bag", baseQuantity: 1, price: "95.00" });
  });

  itDb("pending sellers, customers and other sellers cannot manage a product's packs", async () => {
    const owner = await createSeller();
    const { productId } = await createPublishedViaApi(app.base, owner, admin, {
      variants: [{ name: "Bag", price: "10.00", stock: 10 }],
    });

    const pending = await createSeller({ status: "pending" });
    const pendingRes = await api(app.base, `/api/mvp/seller/products/${productId}/selling-units`, {
      method: "POST",
      cookie: pending.cookie,
      body: { label: "Pack 3", baseQuantity: 3, price: "25.00" },
    });
    expect(pendingRes.status).toBe(403);
    expect(pendingRes.body.error.code).toBe("SELLER_NOT_APPROVED");

    const customer = await createUser();
    const customerRes = await api(app.base, `/api/mvp/seller/products/${productId}/selling-units`, {
      method: "POST",
      cookie: customer.cookie,
      body: { label: "Pack 3", baseQuantity: 3, price: "25.00" },
    });
    expect(customerRes.status).toBe(403);

    const other = await createSeller();
    const otherRes = await api(app.base, `/api/mvp/seller/products/${productId}/selling-units`, {
      method: "POST",
      cookie: other.cookie,
      body: { label: "Pack 3", baseQuantity: 3, price: "25.00" },
    });
    // Another seller's product is a 404, exactly like a nonexistent one.
    expect(otherRes.status).toBe(404);
    expect(otherRes.body.error.code).toBe("PRODUCT_NOT_FOUND");
  });

  itDb("a seller cannot edit or deactivate another seller's pack", async () => {
    const owner = await createSeller();
    const { productId } = await createPublishedViaApi(app.base, owner, admin, {
      variants: [{ name: "Bag", price: "10.00", stock: 10 }],
    });
    const unit = await createSellingUnit(productId, { label: "Pack 6", baseQuantity: 6 });
    const other = await createSeller();

    const res = await api(
      app.base,
      `/api/mvp/seller/products/${productId}/selling-units/${unit.id}`,
      { method: "PATCH", cookie: other.cookie, body: { price: "1.00" } },
    );
    expect(res.status).toBe(404);

    const unchanged = await query(
      `SELECT price FROM product_selling_units WHERE id = $1`,
      [unit.id],
    );
    expect((unchanged.rows[0] as { price: string }).price).toBe("500.00");
  });

  itDb("invalid base quantities, prices and labels are refused", async () => {
    const seller = await createSeller();
    const { productId } = await createPublishedViaApi(app.base, seller, admin, {
      variants: [{ name: "Bag", price: "10.00", stock: 10 }],
    });
    const endpoint = `/api/mvp/seller/products/${productId}/selling-units`;

    const cases: Array<{ body: Record<string, unknown>; label: string }> = [
      { body: { label: "Pack 0", baseQuantity: 0, price: "10.00" }, label: "base quantity 0" },
      { body: { label: "Negative", baseQuantity: -3, price: "10.00" }, label: "negative base quantity" },
      { body: { label: "Fraction", baseQuantity: 1.5, price: "10.00" }, label: "fractional base quantity" },
      { body: { label: "Free", baseQuantity: 6, price: "-1" }, label: "negative price" },
      { body: { label: "Text", baseQuantity: 6, price: "abc" }, label: "non-numeric price" },
      { body: { label: "   ", baseQuantity: 6, price: "10.00" }, label: "blank label" },
    ];

    for (const entry of cases) {
      const res = await api(app.base, endpoint, {
        method: "POST",
        cookie: seller.cookie,
        body: entry.body,
      });
      expect({ label: entry.label, status: res.status }).toEqual({ label: entry.label, status: 400 });
    }

    const rows = await query(
      `SELECT COUNT(*)::int AS n FROM product_selling_units WHERE product_id = $1`,
      [productId],
    );
    expect((rows.rows[0] as { n: number }).n).toBe(0);
  });

  itDb("the database refuses two packs with the same label on one shelf", async () => {
    const seller = await createSeller();
    const { productId, variantId } = await createPublishedViaApi(app.base, seller, admin, {
      variants: [{ name: "Bag", price: "10.00", stock: 10 }],
    });
    await createSellingUnit(productId, { label: "Pack 6", baseQuantity: 6, variantId });

    const duplicate = await api(app.base, `/api/mvp/seller/products/${productId}/selling-units`, {
      method: "POST",
      cookie: seller.cookie,
      body: { label: "Pack 6", baseQuantity: 12, price: "900.00", variantId },
    });
    expect(duplicate.status).toBe(409);
  });

  itDb("deactivating a pack retires it from the catalogue but keeps it visible to the seller", async () => {
    const seller = await createSeller();
    const { productId, slug } = await createPublishedViaApi(app.base, seller, admin, {
      variants: [{ name: "Bag", price: "10.00", stock: 30 }],
      packs: [{ label: "Pack 6", baseQuantity: 6, price: "55.00" }],
    });
    const unit = (
      (await query(`SELECT id FROM product_selling_units WHERE product_id = $1`, [productId]))
        .rows[0] as { id: string }
    );

    const off = await api(
      app.base,
      `/api/mvp/seller/products/${productId}/selling-units/${unit.id}`,
      { method: "PATCH", cookie: seller.cookie, body: { isActive: false } },
    );
    expect(off.status).toBe(200);
    // Retiring an option is operational, not a material listing edit: the
    // published product stays published.
    expect(off.body.data.product.status).toBe("published");
    const units = off.body.data.product.sellingUnits as Array<Record<string, unknown>>;
    expect(units.find((row) => row.id === unit.id)).toMatchObject({ isActive: false });

    const detail = await api(app.base, `/api/mvp/products/${slug}`);
    expect(detail.status).toBe(200);
    const options = detail.body.data.product.variants[0].sellingUnits as Array<Record<string, unknown>>;
    expect(options.some((option) => option.id === unit.id)).toBe(false);
  });

  itDb("admin product review sees each pack's label, base quantity, price and active state", async () => {
    const seller = await createSeller();
    const { productId, variantId } = await createPublishedViaApi(app.base, seller, admin, {
      name: "Review pack product",
      variants: [{ name: "Bag", price: "10.00", stock: 10 }],
      packs: [{ label: "Pack 6", baseQuantity: 6, price: "500.00" }],
    });
    const unit = (
      (await query(`SELECT id FROM product_selling_units WHERE product_id = $1`, [productId]))
        .rows[0] as { id: string }
    );

    const res = await api(app.base, "/api/mvp/admin/products?status=published&limit=50", {
      cookie: admin.cookie,
    });
    expect(res.status).toBe(200);
    const row = (res.body.data.products as Array<Record<string, unknown>>).find(
      (product) => product.id === productId,
    );
    expect(row).toBeDefined();
    expect(row!.selling_units).toEqual([
      {
        id: unit.id,
        variantId,
        label: "Pack 6",
        baseQuantity: 6,
        price: "500.00",
        isActive: true,
      },
    ]);
  });
});

describe("MVP selling units — cart, price and inventory (needs a test database + JWT_SECRET)", () => {
  let app: TestApp;
  let admin: TestUser;

  beforeAll(async () => {
    if (!hasDb) return;
    app = await startApp();
    admin = await createUser({ role: "admin" });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  itDb("different packs of one variant stay separate cart lines; the same pack merges", async () => {
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id, {
      price: "10.00",
      variants: [{ name: "Bottle", price: "10.00", stock: 40 }],
    });
    const variantId = (
      (await query(`SELECT id FROM product_variants WHERE product_id = $1`, [product.id]))
        .rows[0] as { id: string }
    ).id;
    const pack6 = await createSellingUnit(product.id, { label: "Pack 6", baseQuantity: 6, price: "55.00", variantId });
    const pack12 = await createSellingUnit(product.id, { label: "Pack 12", baseQuantity: 12, price: "100.00", variantId });
    const buyer = await createUser();

    const add = (body: Record<string, unknown>) =>
      api(app.base, "/api/mvp/cart/items", { method: "POST", cookie: buyer.cookie, body });

    expect((await add({ productId: product.id, variantId, sellingUnitId: pack6.id, quantity: 2 })).status).toBe(201);
    expect((await add({ productId: product.id, variantId, sellingUnitId: pack12.id, quantity: 1 })).status).toBe(201);
    expect((await add({ productId: product.id, variantId, quantity: 1 })).status).toBe(201);
    const merged = await add({ productId: product.id, variantId, sellingUnitId: pack6.id, quantity: 1 });
    expect(merged.status).toBe(201);

    const cart = merged.body.data.cart as {
      items: Array<Record<string, unknown>>;
      subtotal: string;
      itemCount: number;
    };
    expect(cart.items).toHaveLength(3);
    const pack6Line = cart.items.find((item) => item.sellingUnitId === pack6.id)!;
    const pack12Line = cart.items.find((item) => item.sellingUnitId === pack12.id)!;
    const baseLine = cart.items.find((item) => item.sellingUnitId === null)!;

    expect(pack6Line).toMatchObject({
      quantity: 3,
      sellingUnitLabel: "Pack 6",
      sellingUnitBaseQuantity: 6,
      baseQuantityTotal: 18,
      unitPrice: "55.00",
      lineTotal: "165.00",
    });
    expect(pack12Line).toMatchObject({ quantity: 1, baseQuantityTotal: 12, lineTotal: "100.00" });
    expect(baseLine).toMatchObject({ quantity: 1, sellingUnitLabel: null, baseQuantityTotal: 1 });
    // 3 × 55 + 1 × 100 + 1 × 10
    expect(cart.subtotal).toBe("275.00");
  });

  itDb("an inactive pack cannot be added to a cart", async () => {
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id, {
      variants: [{ name: "Bag", price: "10.00", stock: 10 }],
    });
    const variantId = (
      (await query(`SELECT id FROM product_variants WHERE product_id = $1`, [product.id]))
        .rows[0] as { id: string }
    ).id;
    const unit = await createSellingUnit(product.id, {
      label: "Retired pack",
      baseQuantity: 6,
      variantId,
      isActive: false,
    });
    const buyer = await createUser();

    const res = await api(app.base, "/api/mvp/cart/items", {
      method: "POST",
      cookie: buyer.cookie,
      body: { productId: product.id, variantId, sellingUnitId: unit.id, quantity: 1 },
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SELLING_UNIT_NOT_AVAILABLE");
  });

  itDb("a pack from another product or variant cannot enter a cart line (database guard)", async () => {
    const seller = await createSeller();
    const first = await createPublishedProduct(seller.id, admin.id, {
      variants: [{ name: "Bag", price: "10.00", stock: 10 }],
    });
    const second = await createPublishedProduct(seller.id, admin.id, {
      variants: [{ name: "Bag", price: "20.00", stock: 10 }],
    });
    const foreignUnit = await createSellingUnit(second.id, { label: "Pack 6", baseQuantity: 6 });
    const buyer = await createUser();
    const cart = await query(
      `INSERT INTO carts (user_id, seller_id) VALUES ($1, $2) RETURNING id`,
      [buyer.id, seller.id],
    );
    const cartId = (cart.rows[0] as { id: string }).id;

    let rejected = false;
    try {
      await query(
        `INSERT INTO cart_items (cart_id, seller_id, product_id, selling_unit_id, quantity, price)
         VALUES ($1, $2, $3, $4, 1, 1.00)`,
        [cartId, seller.id, first.id, foreignUnit.id],
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  itDb("checkout charges the seller's pack price and reserves quantity × base quantity", async () => {
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id, {
      price: "10.00",
      variants: [{ name: "Bag", price: "10.00", stock: 10 }],
    });
    const variantId = (
      (await query(`SELECT id FROM product_variants WHERE product_id = $1`, [product.id]))
        .rows[0] as { id: string }
    ).id;
    const pack = await createSellingUnit(product.id, {
      label: "Pack 6",
      baseQuantity: 6,
      price: "500.00",
      variantId,
    });

    // Example A: stock 10, pack 6, buy 1 → 4 left.
    const buyer = await createUser();
    const added = await api(app.base, "/api/mvp/cart/items", {
      method: "POST",
      cookie: buyer.cookie,
      body: { productId: product.id, variantId, sellingUnitId: pack.id, quantity: 1 },
    });
    const cartId = added.body.data.cart.id as string;

    const placed = await checkout(app.base, buyer, cartId);
    expect(placed.status).toBe(201);
    const order = placed.body.data.order as {
      subtotal: string;
      totalAmount: string;
      items: Array<Record<string, unknown>>;
    };
    expect(order.subtotal).toBe("500.00");
    expect(order.totalAmount).toBe("500.00");
    expect(order.items[0]).toMatchObject({
      product_id: product.id,
      variant_id: variantId,
      selling_unit_id: pack.id,
      selling_unit_label: "Pack 6",
      selling_unit_base_quantity: 6,
      base_quantity_total: 6,
      quantity: 1,
      unit_price: "500.00",
      subtotal: "500.00",
    });
    expect(await stockRow(product.id, variantId)).toEqual({ quantity: 10, reserved: 6 });

    // Example B: stock 10, pack 6, buy 2 → required 12, rejected without
    // reserving anything more (the 6 units of Example A's order stay held).
    const greedy = await createUser();
    const greedyCart = await api(app.base, "/api/mvp/cart/items", {
      method: "POST",
      cookie: greedy.cookie,
      body: { productId: product.id, variantId, sellingUnitId: pack.id, quantity: 2 },
    });
    expect(greedyCart.status).toBe(201);
    const rejected = await checkout(app.base, greedy, greedyCart.body.data.cart.id);
    expect(rejected.status).toBe(409);
    expect(rejected.body.error.code).toBe("OUT_OF_STOCK");
    expect(await stockRow(product.id, variantId)).toEqual({ quantity: 10, reserved: 6 });
    const orders = await query(`SELECT COUNT(*)::int AS n FROM orders WHERE user_id = $1`, [
      greedy.id,
    ]);
    expect((orders.rows[0] as { n: number }).n).toBe(0);
  });

  itDb("Example C: two base units reserve two base units", async () => {
    const seeded = await seedCart(app.base, { adminId: admin.id, stock: 10, quantity: 2 });
    const placed = await checkout(app.base, seeded.buyer, seeded.cartId);
    expect(placed.status).toBe(201);
    expect(await stockRow(seeded.product.id, seeded.variantId)).toEqual({ quantity: 10, reserved: 2 });
  });

  itDb("Example D: one pack of 6 plus two base units reserve eight", async () => {
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id, {
      price: "10.00",
      variants: [{ name: "Bag", price: "10.00", stock: 10 }],
    });
    const variantId = (
      (await query(`SELECT id FROM product_variants WHERE product_id = $1`, [product.id]))
        .rows[0] as { id: string }
    ).id;
    const pack = await createSellingUnit(product.id, {
      label: "Pack 6",
      baseQuantity: 6,
      price: "500.00",
      variantId,
    });
    const buyer = await createUser();

    const packLine = await api(app.base, "/api/mvp/cart/items", {
      method: "POST",
      cookie: buyer.cookie,
      body: { productId: product.id, variantId, sellingUnitId: pack.id, quantity: 1 },
    });
    expect(packLine.status).toBe(201);
    const baseLine = await api(app.base, "/api/mvp/cart/items", {
      method: "POST",
      cookie: buyer.cookie,
      body: { productId: product.id, variantId, quantity: 2 },
    });
    expect(baseLine.status).toBe(201);
    expect(baseLine.body.data.cart.items).toHaveLength(2);

    const placed = await checkout(app.base, buyer, baseLine.body.data.cart.id);
    expect(placed.status).toBe(201);
    expect(placed.body.data.order.totalAmount).toBe("520.00");
    expect(await stockRow(product.id, variantId)).toEqual({ quantity: 10, reserved: 8 });
  });

  itDb("Example E: two concurrent pack checkouts cannot reserve the last stock", async () => {
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id, {
      variants: [{ name: "Bag", price: "10.00", stock: 10 }],
    });
    const variantId = (
      (await query(`SELECT id FROM product_variants WHERE product_id = $1`, [product.id]))
        .rows[0] as { id: string }
    ).id;
    const pack = await createSellingUnit(product.id, {
      label: "Pack 6",
      baseQuantity: 6,
      price: "500.00",
      variantId,
    });

    const buyers = [await createUser(), await createUser()];
    const cartIds: string[] = [];
    for (const buyer of buyers) {
      const added = await api(app.base, "/api/mvp/cart/items", {
        method: "POST",
        cookie: buyer.cookie,
        body: { productId: product.id, variantId, sellingUnitId: pack.id, quantity: 1 },
      });
      expect(added.status).toBe(201);
      cartIds.push(added.body.data.cart.id as string);
    }

    const [a, b] = await Promise.all([
      checkout(app.base, buyers[0]!, cartIds[0]!),
      checkout(app.base, buyers[1]!, cartIds[1]!),
    ]);
    expect([a.status, b.status].sort()).toEqual([201, 409]);
    expect(await stockRow(product.id, variantId)).toEqual({ quantity: 10, reserved: 6 });
  });

  itDb("a pack deactivated after it was carted is refused at checkout", async () => {
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id, {
      variants: [{ name: "Bag", price: "10.00", stock: 10 }],
    });
    const variantId = (
      (await query(`SELECT id FROM product_variants WHERE product_id = $1`, [product.id]))
        .rows[0] as { id: string }
    ).id;
    const pack = await createSellingUnit(product.id, {
      label: "Pack 6",
      baseQuantity: 6,
      variantId,
    });
    const buyer = await createUser();
    const added = await api(app.base, "/api/mvp/cart/items", {
      method: "POST",
      cookie: buyer.cookie,
      body: { productId: product.id, variantId, sellingUnitId: pack.id, quantity: 1 },
    });
    expect(added.status).toBe(201);

    await query(`UPDATE product_selling_units SET is_active = FALSE WHERE id = $1`, [pack.id]);

    const res = await checkout(app.base, buyer, added.body.data.cart.id);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SELLING_UNIT_NOT_AVAILABLE");
    expect(await stockRow(product.id, variantId)).toEqual({ quantity: 10, reserved: 0 });
  });
});

describe("MVP selling units — release and history (needs a test database + JWT_SECRET)", () => {
  let app: TestApp;
  let admin: TestUser;

  beforeAll(async () => {
    if (!hasDb) return;
    app = await startApp();
    admin = await createUser({ role: "admin" });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  /** A published variant product with a 6-pack, and a cart holding `packs`. */
  async function packCart(packs: number, stock: number) {
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id, {
      variants: [{ name: "Bag", price: "10.00", stock }],
    });
    const variantId = (
      (await query(`SELECT id FROM product_variants WHERE product_id = $1`, [product.id]))
        .rows[0] as { id: string }
    ).id;
    const pack = await createSellingUnit(product.id, {
      label: "Pack 6",
      baseQuantity: 6,
      price: "500.00",
      variantId,
    });
    const buyer = await createUser();
    const added = await api(app.base, "/api/mvp/cart/items", {
      method: "POST",
      cookie: buyer.cookie,
      body: { productId: product.id, variantId, sellingUnitId: pack.id, quantity: packs },
    });
    expect(added.status).toBe(201);
    return { seller, product, variantId, pack, buyer, cartId: added.body.data.cart.id as string };
  }

  itDb("cancelling a two-pack order releases exactly twelve base units, once", async () => {
    const seeded = await packCart(2, 20);
    const placed = await checkout(app.base, seeded.buyer, seeded.cartId);
    expect(placed.status).toBe(201);
    expect(await stockRow(seeded.product.id, seeded.variantId)).toEqual({ quantity: 20, reserved: 12 });

    const orderId = placed.body.data.order.id as string;
    const cancelled = await api(app.base, `/api/mvp/orders/${orderId}/cancel`, {
      method: "POST",
      cookie: seeded.buyer.cookie,
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.order.cancelledAt).not.toBeNull();
    expect(await stockRow(seeded.product.id, seeded.variantId)).toEqual({ quantity: 20, reserved: 0 });

    const again = await api(app.base, `/api/mvp/orders/${orderId}/cancel`, {
      method: "POST",
      cookie: seeded.buyer.cookie,
    });
    expect(again.body.data.outcome).toBe("already_cancelled");
    // No double release: `reserved` cannot go negative.
    expect(await stockRow(seeded.product.id, seeded.variantId)).toEqual({ quantity: 20, reserved: 0 });
  });

  itDb("the expiry sweep releases the pack's base quantity and cannot release twice", async () => {
    const seeded = await packCart(2, 20);
    const placed = await checkout(app.base, seeded.buyer, seeded.cartId);
    expect(placed.status).toBe(201);
    const orderId = placed.body.data.order.id as string;
    expect(await stockRow(seeded.product.id, seeded.variantId)).toEqual({ quantity: 20, reserved: 12 });

    await query(
      `UPDATE orders SET payment_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [orderId],
    );

    const sweep = await api(app.base, "/api/mvp/admin/maintenance/expire-pending-orders", {
      method: "POST",
      cookie: admin.cookie,
      body: {},
    });
    expect(sweep.status).toBe(200);
    expect(sweep.body.data.expired).toBeGreaterThanOrEqual(1);
    expect(await stockRow(seeded.product.id, seeded.variantId)).toEqual({ quantity: 20, reserved: 0 });

    const second = await api(app.base, "/api/mvp/admin/maintenance/expire-pending-orders", {
      method: "POST",
      cookie: admin.cookie,
      body: {},
    });
    // The second sweep may find other files' expired orders, but it must never
    // release THIS order again: `reserved` stays at zero, not −12.
    expect(second.status).toBe(200);
    expect(await stockRow(seeded.product.id, seeded.variantId)).toEqual({ quantity: 20, reserved: 0 });

    const order = await query(`SELECT status, cancel_reason FROM orders WHERE id = $1`, [orderId]);
    expect(order.rows[0]).toEqual({ status: "cancelled", cancel_reason: "payment_expired" });
  });

  itDb("renaming, deactivating or deleting a pack never rewrites a placed order", async () => {
    const seeded = await packCart(2, 20);
    const placed = await checkout(app.base, seeded.buyer, seeded.cartId);
    expect(placed.status).toBe(201);
    const orderId = placed.body.data.order.id as string;

    await query(
      `UPDATE product_selling_units SET label = 'Mega Pack', base_quantity = 12, price = 1500.00, is_active = FALSE
        WHERE id = $1`,
      [seeded.pack.id],
    );

    const afterEdit = await api(app.base, `/api/mvp/orders/${orderId}`, {
      cookie: seeded.buyer.cookie,
    });
    expect(afterEdit.status).toBe(200);
    expect(afterEdit.body.data.order.items[0]).toMatchObject({
      selling_unit_label: "Pack 6",
      selling_unit_base_quantity: 6,
      base_quantity_total: 12,
      unit_price: "500.00",
      quantity: 2,
      subtotal: "1000.00",
    });

    // Even a hard delete only drops the reference; the snapshot is the history.
    await query(`DELETE FROM product_selling_units WHERE id = $1`, [seeded.pack.id]);
    const afterDelete = await api(app.base, `/api/mvp/orders/${orderId}`, {
      cookie: seeded.buyer.cookie,
    });
    expect(afterDelete.body.data.order.items[0]).toMatchObject({
      selling_unit_id: null,
      selling_unit_label: "Pack 6",
      selling_unit_base_quantity: 6,
      base_quantity_total: 12,
      subtotal: "1000.00",
    });
  });

  itDb("an order line can never snapshot an inactive pack", async () => {
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id, {
      variants: [{ name: "Bag", price: "10.00", stock: 10 }],
    });
    const variantId = (
      (await query(`SELECT id FROM product_variants WHERE product_id = $1`, [product.id]))
        .rows[0] as { id: string }
    ).id;
    const unit = await createSellingUnit(product.id, {
      label: "Pack 6",
      baseQuantity: 6,
      variantId,
      isActive: false,
    });
    const buyer = await createUser();
    const orderNumber = `${Date.now()}${Math.floor(Math.random() * 100000)}`.slice(0, 18);
    const order = await query(
      `INSERT INTO orders (order_number, user_id, seller_id, subtotal, total_amount, shipping_address)
       VALUES ($3, $1, $2, 500, 500, '{}') RETURNING id`,
      [buyer.id, seller.id, orderNumber],
    );
    const orderId = (order.rows[0] as { id: string }).id;

    let rejected = false;
    try {
      await query(
        `INSERT INTO order_items
           (order_id, seller_id, product_id, variant_id, selling_unit_id,
            selling_unit_label, selling_unit_base_quantity, product_name, unit_price, quantity, subtotal)
         VALUES ($1, $2, $3, $4, $5, 'Pack 6', 6, 'Coffee', 500, 1, 500)`,
        [orderId, seller.id, product.id, variantId, unit.id],
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  itDb("a variant that still has packs cannot be deleted out from under them", async () => {
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id, {
      variants: [{ name: "Bag", price: "10.00", stock: 10 }],
    });
    const variantId = (
      (await query(`SELECT id FROM product_variants WHERE product_id = $1`, [product.id]))
        .rows[0] as { id: string }
    ).id;
    await createSellingUnit(product.id, { label: "Pack 6", baseQuantity: 6, variantId });

    let rejected = false;
    try {
      await query(`DELETE FROM product_variants WHERE id = $1`, [variantId]);
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);
  });

  itDb("a pack reserves nothing until it is bought (it owns no stock)", async () => {
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id, { stock: 7 });
    await createSellingUnit(product.id, { label: "Pack 3", baseQuantity: 3, price: "25.00" });

    expect(await stockRow(product.id, null)).toEqual({ quantity: 7, reserved: 0 });
    const inventoryRows = await query(
      `SELECT COUNT(*)::int AS n FROM inventory WHERE product_id = $1`,
      [product.id],
    );
    expect((inventoryRows.rows[0] as { n: number }).n).toBe(1);

    const buyer = await createUser();
    const added = await api(app.base, "/api/mvp/cart/items", {
      method: "POST",
      cookie: buyer.cookie,
      body: { productId: product.id, quantity: 1 },
    });
    expect(added.status).toBe(201);
    const placed = await checkout(app.base, buyer, added.body.data.cart.id);
    expect(placed.status).toBe(201);
    // Base-unit purchase still touches the one stock row.
    expect(await stockRow(product.id, null)).toEqual({ quantity: 7, reserved: 1 });
  });

  itDb("checkout ignores a tampered cart snapshot price and uses the pack's stored price", async () => {
    const seeded = await packCart(1, 20);
    await query(`UPDATE cart_items SET price = 0.01 WHERE cart_id = $1`, [seeded.cartId]);

    const res = await api(app.base, "/api/mvp/checkout", {
      method: "POST",
      cookie: seeded.buyer.cookie,
      body: {
        cartId: seeded.cartId,
        requestKey: `pack-price-${crypto.randomUUID()}`,
        address: addressBody(),
        subtotal: "0.01",
        total: "0.01",
        items: [{ unitPrice: "0.01", quantity: 1 }],
      },
    });
    expect(res.status).toBe(201);
    expect(res.body.data.order.subtotal).toBe("500.00");
    expect(res.body.data.order.items[0].unit_price).toBe("500.00");
  });
});
