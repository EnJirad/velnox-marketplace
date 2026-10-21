/**
 * MVP admin — authorization, category management, metrics and the expiry sweep.
 *
 * Admin is a ROLE, not a permission catalog: every route must answer 403 to an
 * ordinary customer, including the read-only metrics surface.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { query } from "../../db/index.js";
import { hasTestDatabase } from "../../tests/helpers/test-db.js";
import {
  api,
  checkout,
  createSeller,
  createUser,
  seedCart,
  startApp,
  stockRow,
  type TestApp,
} from "./helpers/mvp-app.js";

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

describe("MVP admin (needs a test database + JWT_SECRET)", () => {
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

  itDb("refuses every admin surface to a non-admin", async () => {
    const customer = await createUser();
    const seller = await createSeller({ status: "approved" });
    for (const cookie of [customer.cookie, seller.cookie]) {
      expect((await api(app.base, "/api/mvp/admin/metrics", { cookie })).status).toBe(403);
      expect((await api(app.base, "/api/mvp/admin/sellers", { cookie })).status).toBe(403);
      expect((await api(app.base, "/api/mvp/admin/products?status=submitted", { cookie })).status).toBe(403);
      expect(
        (
          await api(app.base, "/api/mvp/admin/categories", {
            method: "POST",
            cookie,
            body: { slug: "sneaky", name: "Sneaky" },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await api(app.base, "/api/mvp/admin/maintenance/expire-pending-orders", {
            method: "POST",
            cookie,
          })
        ).status,
      ).toBe(403);
    }

    expect((await api(app.base, "/api/mvp/admin/metrics")).status).toBe(401);
  });

  itDb("reports essential marketplace metrics with a decimal money total", async () => {
    const seeded = await seedCart(app.base, { adminId: admin.id, price: "50.00" });
    const placed = await checkout(app.base, seeded.buyer, seeded.cartId);
    expect(placed.status).toBe(201);

    const res = await api(app.base, "/api/mvp/admin/metrics", { cookie: admin.cookie });
    expect(res.status).toBe(200);
    const metrics = res.body.data.metrics as Record<string, unknown>;
    for (const key of [
      "active_users",
      "pending_sellers",
      "approved_sellers",
      "suspended_sellers",
      "products_awaiting_review",
      "published_products",
      "orders_total",
      "orders_pending_payment",
      "orders_paid",
      "orders_delivered",
      "orders_cancelled",
      "paid_payments",
      "gross_settled_amount",
    ]) {
      expect(metrics[key]).toBeDefined();
    }
    expect(Number(metrics.orders_total)).toBeGreaterThan(0);
    expect(String(metrics.gross_settled_amount)).toMatch(/^\d+\.\d{2}$/);
  });

  itDb("creates, updates and deletes a category; duplicates are refused", async () => {
    const slug = `admin-cat-${crypto.randomUUID().slice(0, 6)}`;
    const created = await api(app.base, "/api/mvp/admin/categories", {
      method: "POST",
      cookie: admin.cookie,
      body: { slug, name: "Home & Living", names: { th: "บ้าน", en: "Home" }, sortOrder: 3 },
    });
    expect(created.status).toBe(201);
    const categoryId = created.body.data.category.id as string;

    const duplicate = await api(app.base, "/api/mvp/admin/categories", {
      method: "POST",
      cookie: admin.cookie,
      body: { slug, name: "Duplicate" },
    });
    expect(duplicate.status).toBe(409);

    const invalidSlug = await api(app.base, "/api/mvp/admin/categories", {
      method: "POST",
      cookie: admin.cookie,
      body: { slug: "Bad Slug!", name: "Bad" },
    });
    expect(invalidSlug.status).toBe(400);

    const patched = await api(app.base, `/api/mvp/admin/categories/${categoryId}`, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { name: "Home & Living (renamed)", isActive: false },
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.category.name).toBe("Home & Living (renamed)");
    expect(patched.body.data.category.is_active).toBe(false);

    const deleted = await api(app.base, `/api/mvp/admin/categories/${categoryId}`, {
      method: "DELETE",
      cookie: admin.cookie,
    });
    expect(deleted.status).toBe(200);
    const gone = await query(`SELECT COUNT(*)::int AS n FROM categories WHERE id = $1`, [categoryId]);
    expect((gone.rows[0] as { n: number }).n).toBe(0);
  });

  itDb("refuses a category cycle and a self-parent, in the database", async () => {
    const parent = await api(app.base, "/api/mvp/admin/categories", {
      method: "POST",
      cookie: admin.cookie,
      body: { slug: `parent-${crypto.randomUUID().slice(0, 6)}`, name: "Parent" },
    });
    const parentId = parent.body.data.category.id as string;
    const child = await api(app.base, "/api/mvp/admin/categories", {
      method: "POST",
      cookie: admin.cookie,
      body: { slug: `child-${crypto.randomUUID().slice(0, 6)}`, name: "Child", parentId },
    });
    const childId = child.body.data.category.id as string;

    const selfParent = await api(app.base, `/api/mvp/admin/categories/${parentId}`, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { parentId },
    });
    expect(selfParent.status).toBe(409);

    const cycle = await api(app.base, `/api/mvp/admin/categories/${parentId}`, {
      method: "PATCH",
      cookie: admin.cookie,
      body: { parentId: childId },
    });
    expect(cycle.status).toBe(409);

    const row = await query(`SELECT parent_id FROM categories WHERE id = $1`, [parentId]);
    expect((row.rows[0] as { parent_id: string | null }).parent_id).toBeNull();
  });

  itDb("paginates the seller and product moderation queues", async () => {
    const seller = await createSeller({ status: "pending" });
    const sellers = await api(app.base, "/api/mvp/admin/sellers?status=pending&limit=1", {
      cookie: admin.cookie,
    });
    expect(sellers.status).toBe(200);
    expect(sellers.body.data.sellers.length).toBeLessThanOrEqual(1);
    expect(sellers.body.data.pagination.total).toBeGreaterThanOrEqual(1);
    expect(
      (sellers.body.data.sellers as Array<{ status: string }>).every((s) => s.status === "pending"),
    ).toBe(true);
    expect(seller.id).toBeTruthy();

    const products = await api(app.base, "/api/mvp/admin/products?status=submitted", {
      cookie: admin.cookie,
    });
    expect(products.status).toBe(200);
    expect(Array.isArray(products.body.data.products)).toBe(true);
  });

  itDb("expires unpaid orders past their payment window and releases their stock", async () => {
    const seeded = await seedCart(app.base, { adminId: admin.id, stock: 4, quantity: 2 });
    const placed = await checkout(app.base, seeded.buyer, seeded.cartId);
    expect(placed.status).toBe(201);
    expect(await stockRow(seeded.product.id)).toEqual({ quantity: 4, reserved: 2 });

    await query(
      `UPDATE orders SET payment_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`,
      [placed.body.data.order.id],
    );

    const sweep = await api(app.base, "/api/mvp/admin/maintenance/expire-pending-orders", {
      method: "POST",
      cookie: admin.cookie,
      body: { limit: 100 },
    });
    expect(sweep.status).toBe(200);
    expect(sweep.body.data.expired).toBeGreaterThanOrEqual(1);

    const order = await query(`SELECT status, cancel_reason FROM orders WHERE id = $1`, [
      placed.body.data.order.id,
    ]);
    const row = order.rows[0] as { status: string; cancel_reason: string | null };
    expect(row.status).toBe("cancelled");
    expect(row.cancel_reason).toBe("payment_expired");
    expect(await stockRow(seeded.product.id)).toEqual({ quantity: 4, reserved: 0 });

    const again = await api(app.base, "/api/mvp/admin/maintenance/expire-pending-orders", {
      method: "POST",
      cookie: admin.cookie,
    });
    expect(again.body.data.expired).toBe(0);
  });

  itDb("writes an audit row for every moderation decision", async () => {
    const seller = await createSeller({ status: "pending" });
    const approved = await api(app.base, `/api/mvp/admin/sellers/${seller.id}/approve`, {
      method: "POST",
      cookie: admin.cookie,
    });
    expect(approved.status).toBe(200);

    const suspended = await api(app.base, `/api/mvp/admin/sellers/${seller.id}/suspend`, {
      method: "POST",
      cookie: admin.cookie,
      body: { reason: "test suspension" },
    });
    expect(suspended.status).toBe(200);

    const actions = await query(
      `SELECT action, actor_id FROM audit_logs WHERE entity_id = $1 ORDER BY created_at`,
      [seller.id],
    );
    const rows = actions.rows as Array<{ action: string; actor_id: string | null }>;
    expect(rows.map((r) => r.action)).toEqual(["SELLER_APPROVED", "SELLER_SUSPENDED"]);
    expect(rows.every((r) => r.actor_id === admin.id)).toBe(true);
  });
});
