/**
 * MVP cart + checkout — the money and stock invariants.
 *
 * These are the assertions that matter commercially: one seller per order, the
 * server's price (never the client's), one order per request key, no overselling
 * under a race, and no partial write when any line fails.
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
  createUser,
  seedCart,
  startApp,
  stockRow,
  type TestApp,
} from "./helpers/mvp-app.js";

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

describe("MVP cart + checkout (needs a test database + JWT_SECRET)", () => {
  let app: TestApp;
  let admin: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    if (!hasDb) return;
    app = await startApp();
    admin = await createUser({ role: "admin" });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  itDb("keeps ONE cart per (buyer, seller) and never merges two sellers", async () => {
    const buyer = await createUser();
    const sellerA = await createSeller();
    const sellerB = await createSeller();
    const productA = await createPublishedProduct(sellerA.id, admin.id, { price: "10.00" });
    const productB = await createPublishedProduct(sellerB.id, admin.id, { price: "20.00" });

    const addA = await api(app.base, "/api/mvp/cart/items", {
      method: "POST",
      cookie: buyer.cookie,
      body: { productId: productA.id, quantity: 2 },
    });
    expect(addA.status).toBe(201);
    const cartAId = addA.body.data.cart.id as string;

    const addA2 = await api(app.base, "/api/mvp/cart/items", {
      method: "POST",
      cookie: buyer.cookie,
      body: { productId: productA.id, quantity: 1 },
    });
    expect(addA2.body.data.cart.id).toBe(cartAId);
    expect(addA2.body.data.cart.items[0].quantity).toBe(3);

    const addB = await api(app.base, "/api/mvp/cart/items", {
      method: "POST",
      cookie: buyer.cookie,
      body: { productId: productB.id, quantity: 1 },
    });
    expect(addB.status).toBe(201);
    expect(addB.body.data.cart.id).not.toBe(cartAId);

    const carts = await api(app.base, "/api/mvp/cart", { cookie: buyer.cookie });
    expect(carts.body.data.carts).toHaveLength(2);
    expect(carts.body.data.itemCount).toBe(4);
    expect(carts.body.data.carts[0].subtotal).toBe("30.00");
  });

  itDb("the database itself refuses a cart line that names another seller", async () => {
    const seeded = await seedCart(app.base, { adminId: admin.id });
    const otherSeller = await createSeller();

    let failed = false;
    try {
      await query(
        `INSERT INTO cart_items (cart_id, seller_id, product_id, quantity, price)
         VALUES ($1, $2, $3, 1, 1.00)`,
        [seeded.cartId, otherSeller.id, seeded.product.id],
      );
    } catch {
      failed = true;
    }
    expect(failed).toBe(true);
  });

  itDb("only the owner may change or remove a cart line", async () => {
    const seeded = await seedCart(app.base, { adminId: admin.id });
    const intruder = await createUser();
    const itemId = (
      await api(app.base, "/api/mvp/cart", { cookie: seeded.buyer.cookie })
    ).body.data.carts[0].items[0].id as string;

    const patch = await api(app.base, `/api/mvp/cart/items/${itemId}`, {
      method: "PATCH",
      cookie: intruder.cookie,
      body: { quantity: 9 },
    });
    expect(patch.status).toBe(404);

    const del = await api(app.base, `/api/mvp/cart/items/${itemId}`, {
      method: "DELETE",
      cookie: intruder.cookie,
    });
    expect(del.status).toBe(404);

    const remove = await api(app.base, `/api/mvp/cart/items/${itemId}`, {
      method: "DELETE",
      cookie: seeded.buyer.cookie,
    });
    expect(remove.status).toBe(200);
    expect(remove.body.data.cart.items).toEqual([]);
  });

  itDb("checkout uses the SERVER's price, not the cart snapshot or any client amount", async () => {
    const seeded = await seedCart(app.base, {
      adminId: admin.id,
      price: "123.45",
      stock: 5,
      quantity: 2,
    });

    // Corrupt the display snapshot to 1 cent: checkout must ignore it.
    await query(`UPDATE cart_items SET price = 0.01 WHERE cart_id = $1`, [seeded.cartId]);

    const res = await api(app.base, "/api/mvp/checkout", {
      method: "POST",
      cookie: seeded.buyer.cookie,
      body: {
        cartId: seeded.cartId,
        requestKey: `price-${crypto.randomUUID()}`,
        address: addressBody(),
        total: "0.01",
        subtotal: "0.01",
        items: [{ unitPrice: "0.01", quantity: 2 }],
      },
    });

    expect(res.status).toBe(201);
    expect(res.body.data.order.subtotal).toBe("246.90");
    expect(res.body.data.order.totalAmount).toBe("246.90");
    expect(res.body.data.order.items[0].unit_price).toBe("123.45");
    expect(res.body.data.order.items[0].subtotal).toBe("246.90");
  });

  itDb("is idempotent: the same request key returns the same order and reserves stock once", async () => {
    const seeded = await seedCart(app.base, { adminId: admin.id, stock: 5, quantity: 2 });
    const requestKey = `idem-${crypto.randomUUID()}`;

    const first = await checkout(app.base, seeded.buyer, seeded.cartId, { requestKey });
    expect(first.status).toBe(201);

    const replay = await checkout(app.base, seeded.buyer, seeded.cartId, { requestKey });
    expect(replay.status).toBe(200);
    expect(replay.body.data.replayed).toBe(true);
    expect(replay.body.data.order.id).toBe(first.body.data.order.id);

    const orders = await query(`SELECT COUNT(*)::int AS n FROM orders WHERE user_id = $1`, [
      seeded.buyer.id,
    ]);
    expect((orders.rows[0] as { n: number }).n).toBe(1);
    expect(await stockRow(seeded.product.id)).toEqual({ quantity: 5, reserved: 2 });
  });

  itDb("a second checkout of the same cart (different key) creates no second order", async () => {
    const seeded = await seedCart(app.base, { adminId: admin.id, stock: 5 });
    const first = await checkout(app.base, seeded.buyer, seeded.cartId);
    expect(first.status).toBe(201);

    const second = await checkout(app.base, seeded.buyer, seeded.cartId);
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("CART_EMPTY");

    const orders = await query(`SELECT COUNT(*)::int AS n FROM orders WHERE user_id = $1`, [
      seeded.buyer.id,
    ]);
    expect((orders.rows[0] as { n: number }).n).toBe(1);
    expect(await stockRow(seeded.product.id)).toEqual({ quantity: 5, reserved: 1 });
  });

  itDb("refuses an empty cart, a foreign address and a foreign cart", async () => {
    const buyer = await createUser();
    const empty = await query(
      `INSERT INTO carts (user_id, seller_id)
       SELECT $1, id FROM seller_profiles LIMIT 1
       RETURNING id`,
      [buyer.id],
    );
    const emptyCartId = (empty.rows[0] as { id: string }).id;
    const emptyRes = await checkout(app.base, buyer, emptyCartId);
    expect(emptyRes.status).toBe(409);
    expect(emptyRes.body.error.code).toBe("CART_EMPTY");

    const seeded = await seedCart(app.base, { adminId: admin.id });
    const other = await createUser();
    const otherAddress = await query(
      `INSERT INTO addresses (user_id, recipient_name, phone, line1, city, state, postal_code)
       VALUES ($1, 'Other', '0800000000', '1 Road', 'Bangkok', 'Bangkok', '10110')
       RETURNING id`,
      [other.id],
    );
    const foreignAddress = await api(app.base, "/api/mvp/checkout", {
      method: "POST",
      cookie: seeded.buyer.cookie,
      body: {
        cartId: seeded.cartId,
        requestKey: `addr-${crypto.randomUUID()}`,
        addressId: (otherAddress.rows[0] as { id: string }).id,
      },
    });
    expect(foreignAddress.status).toBe(400);
    expect(foreignAddress.body.error.code).toBe("ADDRESS_NOT_FOUND");

    const foreignCart = await api(app.base, "/api/mvp/checkout", {
      method: "POST",
      cookie: other.cookie,
      body: {
        cartId: seeded.cartId,
        requestKey: `cart-${crypto.randomUUID()}`,
        address: addressBody(),
      },
    });
    expect(foreignCart.status).toBe(409);
    expect(foreignCart.body.error.code).toBe("CART_NOT_FOUND");
  });

  itDb("rolls back every line when one line is short of stock", async () => {
    const seller = await createSeller();
    const buyer = await createUser();
    const enough = await createPublishedProduct(seller.id, admin.id, {
      name: "Enough stock",
      price: "10.00",
      stock: 5,
    });
    const short = await createPublishedProduct(seller.id, admin.id, {
      name: "Short stock",
      price: "20.00",
      stock: 1,
    });

    for (const [productId, quantity] of [
      [enough.id, 2],
      [short.id, 5],
    ] as Array<[string, number]>) {
      const added = await api(app.base, "/api/mvp/cart/items", {
        method: "POST",
        cookie: buyer.cookie,
        body: { productId, quantity },
      });
      expect(added.status).toBe(201);
    }
    const cartId = (await api(app.base, "/api/mvp/cart", { cookie: buyer.cookie })).body.data.carts[0]
      .id as string;

    const res = await checkout(app.base, buyer, cartId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("OUT_OF_STOCK");

    expect(await stockRow(enough.id)).toEqual({ quantity: 5, reserved: 0 });
    expect(await stockRow(short.id)).toEqual({ quantity: 1, reserved: 0 });

    const orders = await query(`SELECT COUNT(*)::int AS n FROM orders WHERE user_id = $1`, [buyer.id]);
    expect((orders.rows[0] as { n: number }).n).toBe(0);
    const items = await query(`SELECT COUNT(*)::int AS n FROM cart_items WHERE cart_id = $1`, [cartId]);
    expect((items.rows[0] as { n: number }).n).toBe(2);
  });

  itDb("cannot oversell the last unit across two concurrent checkouts", async () => {
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id, {
      name: "Last unit",
      price: "99.00",
      stock: 1,
    });

    const buyers = [await createUser(), await createUser()];
    const cartIds: string[] = [];
    for (const buyer of buyers) {
      const added = await api(app.base, "/api/mvp/cart/items", {
        method: "POST",
        cookie: buyer.cookie,
        body: { productId: product.id, quantity: 1 },
      });
      expect(added.status).toBe(201);
      cartIds.push(added.body.data.cart.id);
    }

    const [a, b] = await Promise.all([
      checkout(app.base, buyers[0]!, cartIds[0]!),
      checkout(app.base, buyers[1]!, cartIds[1]!),
    ]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 409]);
    expect(await stockRow(product.id)).toEqual({ quantity: 1, reserved: 1 });

    const orders = await query(`SELECT COUNT(*)::int AS n FROM orders WHERE seller_id = $1`, [
      seller.id,
    ]);
    expect((orders.rows[0] as { n: number }).n).toBe(1);
  });

  itDb("stores an immutable address and item snapshot and emits an 18-digit order number", async () => {
    const seeded = await seedCart(app.base, { adminId: admin.id, price: "77.70", quantity: 2 });
    const res = await checkout(app.base, seeded.buyer, seeded.cartId);
    expect(res.status).toBe(201);

    const order = res.body.data.order;
    expect(order.orderNumber).toMatch(/^[0-9]{18}$/);
    expect(order.shippingAddress.recipientName).toBe("สมชาย ใจดี");
    expect(order.items[0].product_name).toMatch(/^Product [0-9a-f]{8}$/);
    expect(order.items[0].variant_name).toBeNull();
    expect(order.payments).toEqual([]);

    // The address row is not referenced: editing it later cannot rewrite history.
    expect(order.shippingAddress.line1).toBe("123/45 ถนนสุขุมวิท");
  });

  itDb("an order can be cancelled while unpaid, releasing the reservation exactly once", async () => {
    const seeded = await seedCart(app.base, { adminId: admin.id, stock: 3, quantity: 2 });
    const placed = await checkout(app.base, seeded.buyer, seeded.cartId);
    expect(placed.status).toBe(201);
    expect(await stockRow(seeded.product.id)).toEqual({ quantity: 3, reserved: 2 });

    const cancelled = await api(app.base, `/api/mvp/orders/${placed.body.data.order.id}/cancel`, {
      method: "POST",
      cookie: seeded.buyer.cookie,
    });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.order.status).toBe("cancelled");
    expect(cancelled.body.data.order.cancelReason).toBe("cancelled_by_customer");
    expect(await stockRow(seeded.product.id)).toEqual({ quantity: 3, reserved: 0 });

    const again = await api(app.base, `/api/mvp/orders/${placed.body.data.order.id}/cancel`, {
      method: "POST",
      cookie: seeded.buyer.cookie,
    });
    expect(again.status).toBe(200);
    expect(again.body.data.outcome).toBe("already_cancelled");
    expect(await stockRow(seeded.product.id)).toEqual({ quantity: 3, reserved: 0 });

    const other = await createUser();
    const notMine = await api(app.base, `/api/mvp/orders/${placed.body.data.order.id}/cancel`, {
      method: "POST",
      cookie: other.cookie,
    });
    expect(notMine.status).toBe(404);
  });

  itDb("a buyer can only read their own order", async () => {
    const seeded = await seedCart(app.base, { adminId: admin.id });
    const placed = await checkout(app.base, seeded.buyer, seeded.cartId);
    const intruder = await createUser();

    const mine = await api(app.base, `/api/mvp/orders/${placed.body.data.order.id}`, {
      cookie: seeded.buyer.cookie,
    });
    expect(mine.status).toBe(200);

    const theirs = await api(app.base, `/api/mvp/orders/${placed.body.data.order.id}`, {
      cookie: intruder.cookie,
    });
    expect(theirs.status).toBe(404);

    const list = await api(app.base, "/api/mvp/orders", { cookie: intruder.cookie });
    expect(list.body.data.orders).toEqual([]);
  });
});
