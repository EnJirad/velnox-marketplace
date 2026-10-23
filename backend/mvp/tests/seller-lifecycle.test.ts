/**
 * MVP seller lifecycle — pending → approved → suspended, enforced server-side.
 *
 * Every assertion drives the real admin/seller endpoints. The point is that the
 * gate is the SERVER: a pending or suspended seller is refused by the API even
 * when it sends a perfectly formed request with a valid session cookie.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { query } from "../../db/index.js";
import { hasTestDatabase } from "../../tests/helpers/test-db.js";
import {
  api,
  checkout,
  createPublishedProduct,
  createSeller,
  createUser,
  seedCart,
  startApp,
  stockRow,
  addressBody,
  type TestApp,
} from "./helpers/mvp-app.js";

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

describe("MVP seller lifecycle (needs a test database + JWT_SECRET)", () => {
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

  itDb("applies as pending and is refused every seller operation until approved", async () => {
    const user = await createUser();

    const applied = await api(app.base, "/api/mvp/seller/apply", {
      method: "POST",
      cookie: user.cookie,
      body: { storeName: "Pending Store", description: "hello" },
    });
    expect(applied.status).toBe(201);
    expect(applied.body.data.seller.status).toBe("pending");

    const status = await api(app.base, "/api/mvp/seller/status", { cookie: user.cookie });
    expect(status.status).toBe(200);
    expect(status.body.data.seller.status).toBe("pending");

    const create = await api(app.base, "/api/mvp/seller/products", {
      method: "POST",
      cookie: user.cookie,
      body: { name: "Sneaky draft", price: "10.00" },
    });
    expect(create.status).toBe(403);
    expect(create.body.error.code).toBe("SELLER_NOT_APPROVED");

    const orders = await api(app.base, "/api/mvp/seller/orders", { cookie: user.cookie });
    expect(orders.status).toBe(403);
  });

  itDb("only an admin can approve, and approval unlocks seller operations", async () => {
    const user = await createUser();
    const applied = await api(app.base, "/api/mvp/seller/apply", {
      method: "POST",
      cookie: user.cookie,
      body: { storeName: "Awaiting Store" },
    });
    const sellerId = applied.body.data.seller.id as string;

    const notAdmin = await api(app.base, `/api/mvp/admin/sellers/${sellerId}/approve`, {
      method: "POST",
      cookie: user.cookie,
    });
    expect(notAdmin.status).toBe(403);
    expect(notAdmin.body.error.code).toBe("ADMIN_ONLY");

    const approved = await api(app.base, `/api/mvp/admin/sellers/${sellerId}/approve`, {
      method: "POST",
      cookie: admin.cookie,
    });
    expect(approved.status).toBe(200);
    expect(approved.body.data.seller.status).toBe("approved");

    const role = await query(`SELECT role FROM users WHERE id = $1`, [user.id]);
    expect((role.rows[0] as { role: string }).role).toBe("seller");

    const create = await api(app.base, "/api/mvp/seller/products", {
      method: "POST",
      cookie: user.cookie,
      body: { name: "First real product", price: "199.00", stock: 4 },
    });
    expect(create.status).toBe(201);
    expect(create.body.data.product.status).toBe("draft");
    expect(create.body.data.product.stock).toEqual({ quantity: 4, reserved: 0, available: 4 });

    const audit = await query(
      `SELECT action FROM audit_logs WHERE entity_id = $1 ORDER BY created_at`,
      [sellerId],
    );
    expect((audit.rows as Array<{ action: string }>).map((r) => r.action)).toContain(
      "SELLER_APPROVED",
    );
  });

  itDb("refuses a seller approving their own application (DB constraint, not just a check)", async () => {
    const owner = await createUser({ role: "admin" });
    const applied = await api(app.base, "/api/mvp/seller/apply", {
      method: "POST",
      cookie: owner.cookie,
      body: { storeName: "Self Approved Store" },
    });
    const sellerId = applied.body.data.seller.id as string;

    const res = await api(app.base, `/api/mvp/admin/sellers/${sellerId}/approve`, {
      method: "POST",
      cookie: owner.cookie,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("CONSTRAINT_VIOLATION");

    const row = await query(`SELECT status FROM seller_profiles WHERE id = $1`, [sellerId]);
    expect((row.rows[0] as { status: string }).status).toBe("pending");
  });

  itDb("rejects a pending application with a reason, and allows a correction to be resubmitted", async () => {
    const user = await createUser();
    const applied = await api(app.base, "/api/mvp/seller/apply", {
      method: "POST",
      cookie: user.cookie,
      body: { storeName: "Rejected Store" },
    });
    const sellerId = applied.body.data.seller.id as string;

    const missingReason = await api(app.base, `/api/mvp/admin/sellers/${sellerId}/reject`, {
      method: "POST",
      cookie: admin.cookie,
      body: {},
    });
    expect(missingReason.status).toBe(400);

    const rejected = await api(app.base, `/api/mvp/admin/sellers/${sellerId}/reject`, {
      method: "POST",
      cookie: admin.cookie,
      body: { reason: "Store name is misleading" },
    });
    expect(rejected.status).toBe(200);
    expect(rejected.body.data.seller.status).toBe("rejected");

    const blocked = await api(app.base, "/api/mvp/seller/products", {
      method: "POST",
      cookie: user.cookie,
      body: { name: "Not yet", price: "1.00" },
    });
    expect(blocked.status).toBe(403);

    const reapplied = await api(app.base, "/api/mvp/seller/apply", {
      method: "POST",
      cookie: user.cookie,
      body: { storeName: "Corrected Store" },
    });
    expect(reapplied.status).toBe(200);
    expect(reapplied.body.data.seller.status).toBe("pending");
    expect(reapplied.body.data.seller.rejection_reason).toBeNull();
  });

  itDb("a suspended seller loses every write path and their listings leave the catalogue", async () => {
    const seller = await createSeller({ status: "approved" });
    const product = await createPublishedProduct(seller.id, admin.id, {
      name: "Suspended Seller Product",
      price: "50.00",
      stock: 3,
    });

    const before = await api(app.base, `/api/mvp/products/${product.slug}`);
    expect(before.status).toBe(200);

    const suspended = await api(app.base, `/api/mvp/admin/sellers/${seller.id}/suspend`, {
      method: "POST",
      cookie: admin.cookie,
      body: { reason: "Repeated policy violations" },
    });
    expect(suspended.status).toBe(200);
    expect(suspended.body.data.seller.status).toBe("suspended");

    const after = await api(app.base, `/api/mvp/products/${product.slug}`);
    expect(after.status).toBe(404);

    const edit = await api(app.base, `/api/mvp/seller/products/${product.id}`, {
      method: "PATCH",
      cookie: seller.cookie,
      body: { price: "1.00" },
    });
    expect(edit.status).toBe(403);
    expect(edit.body.error.code).toBe("SELLER_NOT_APPROVED");

    const restock = await api(app.base, `/api/mvp/seller/products/${product.id}/inventory`, {
      method: "PUT",
      cookie: seller.cookie,
      body: { quantity: 999 },
    });
    expect(restock.status).toBe(403);

    const list = await api(app.base, "/api/mvp/products?q=Suspended%20Seller%20Product");
    expect(list.status).toBe(200);
    expect(
      (list.body.data.products as Array<{ id: string }>).some((p) => p.id === product.id),
    ).toBe(false);
  });

  itDb("suspension is re-checked at checkout: an existing cart cannot become an order", async () => {
    const seeded = await seedCart(app.base, { adminId: admin.id, price: "80.00", stock: 5 });

    const suspended = await api(app.base, `/api/mvp/admin/sellers/${seeded.seller.id}/suspend`, {
      method: "POST",
      cookie: admin.cookie,
      body: { reason: "Suspended after the cart was filled" },
    });
    expect(suspended.status).toBe(200);

    const res = await checkout(app.base, seeded.buyer, seeded.cartId);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("SELLER_NOT_APPROVED");

    const stock = await stockRow(seeded.product.id);
    expect(stock).toEqual({ quantity: 5, reserved: 0 });
  });

  itDb("a seller can only see their own orders", async () => {
    const seeded = await seedCart(app.base, { adminId: admin.id, price: "25.00", stock: 5 });
    const placed = await checkout(app.base, seeded.buyer, seeded.cartId, { address: addressBody() });
    expect(placed.status).toBe(201);

    const other = await createSeller({ status: "approved" });
    const mine = await api(app.base, "/api/mvp/seller/orders", { cookie: seeded.seller.cookie });
    expect(mine.status).toBe(200);
    expect((mine.body.data.orders as Array<{ id: string }>).some((o) => o.id === placed.body.data.order.id)).toBe(true);

    const theirs = await api(app.base, "/api/mvp/seller/orders", { cookie: other.cookie });
    expect(theirs.status).toBe(200);
    expect((theirs.body.data.orders as Array<{ id: string }>).some((o) => o.id === placed.body.data.order.id)).toBe(false);

    const steal = await api(app.base, `/api/mvp/seller/orders/${placed.body.data.order.id}/status`, {
      method: "PATCH",
      cookie: other.cookie,
      body: { status: "processing" },
    });
    expect(steal.status).toBe(404);
  });

  itDb("product images: fails closed without storage and never uploads into another seller's product", async () => {
    const seller = await createSeller({ status: "approved" });
    const product = await createPublishedProduct(seller.id, admin.id);
    const other = await createSeller({ status: "approved" });

    const saved = {
      id: process.env.R2_ACCOUNT_ID,
      key: process.env.R2_ACCESS_KEY_ID,
      secret: process.env.R2_SECRET_ACCESS_KEY,
      bucket: process.env.R2_BUCKET,
    };
    try {
      delete process.env.R2_ACCOUNT_ID;
      delete process.env.R2_ACCESS_KEY_ID;
      delete process.env.R2_SECRET_ACCESS_KEY;
      delete process.env.R2_BUCKET;

      const presign = await api(app.base, `/api/mvp/seller/products/${product.id}/images/presign`, {
        method: "POST",
        cookie: seller.cookie,
        body: { contentType: "image/png", size: 1024 },
      });
      expect(presign.status).toBe(503);
      expect(presign.body.error.code).toBe("UPLOAD_NOT_CONFIGURED");
    } finally {
      for (const [key, value] of [
        ["R2_ACCOUNT_ID", saved.id],
        ["R2_ACCESS_KEY_ID", saved.key],
        ["R2_SECRET_ACCESS_KEY", saved.secret],
        ["R2_BUCKET", saved.bucket],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }

    const foreignProduct = await api(
      app.base,
      `/api/mvp/seller/products/${product.id}/images/presign`,
      { method: "POST", cookie: other.cookie, body: { contentType: "image/png", size: 1024 } },
    );
    expect(foreignProduct.status).toBe(404);
    expect(foreignProduct.body.error.code).toBe("PRODUCT_NOT_FOUND");

    const foreignObject = await api(
      app.base,
      `/api/mvp/seller/products/${product.id}/images/confirm`,
      { method: "POST", cookie: seller.cookie, body: { objectKey: "product/other/other/x.png" } },
    );
    expect(foreignObject.status).toBe(403);
    expect(foreignObject.body.error.code).toBe("OBJECT_NOT_OWNED");
  });
});
