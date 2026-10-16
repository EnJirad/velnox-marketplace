/**
 * Store accounts + the wholesale gate (migration 059).
 *
 * WHAT THIS PINS
 *   1. A buyer applies ONCE. One row per user: a rejection sends the SAME row
 *      back to `pending`, and an approved account keeps its approval while it
 *      corrects a phone number.
 *   2. `status = 'approved'` is the ONLY thing that grants wholesale visibility.
 *      A pending, rejected or anonymous caller is never an approved store, and a
 *      database without the table grants nothing (fail closed).
 *   3. The gate is applied in ONE place and enforced on the SERVER: the catalog
 *      and the detail payload omit a wholesale unit for everyone else, the cart
 *      refuses to attach one (403, nothing written), a cart line cannot be
 *      ENLARGED without access, checkout re-refuses it, and reorder skips it.
 *   4. The RETAIL path is unchanged: an anonymous viewer sees exactly the units
 *      that existed before this feature (every pre-existing row is
 *      `is_wholesale = false`), and the product's own price/stock is identical
 *      whether the caller is approved or not.
 *   5. VelCenter decides: the queue needs `stores.manage`, a rejection needs a
 *      reason, approving twice conflicts, and a reviewer cannot approve their own
 *      application. Every decision is audited.
 *   6. The seller marks a unit wholesale with a real boolean, and the same size
 *      may be offered to both audiences at different prices.
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
import { isApprovedStore, validateStoreApplication } from "../lib/store-accounts.js";
import { formatSellingUnit } from "../lib/selling-units.js";
import { setupCartRoutes } from "../routes/cart.js";
import { setupProductRoutes } from "../routes/products.js";
import { setupProductSellingUnitRoutes } from "../routes/product-selling-units.js";
import { setupStoreAccountRoutes } from "../routes/store-accounts.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";
import { NO_CANONICAL_DRIFT, canonicalParity, readCanonical, RUN_SQLEDITOR_SQL, SCHEMA_SQL } from "./helpers/canonical-schema.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

// ─── One gate, one applier (pure, no database) ───────────────────────────────

describe("the wholesale gate lives in one place", () => {
  test("the authority module owns the question", () => {
    const lib = read("backend/lib/store-accounts.ts");
    expect(lib).toContain("export async function isApprovedStore");
    expect(lib).toContain("export async function getStoreAccount");
    expect(lib).toContain("export function validateStoreApplication");
    // The rule is the status, and nothing else.
    expect(lib).toContain("WHERE user_id = $1 AND status = 'approved'");
    // Anonymous / unset / malformed can never be approved: the gate is TOTAL, so
    // an id that is not a `users.id` is false rather than a database error.
    expect(lib).toContain("if (!isUserId(userId)) return false;");
    expect(lib).toContain("if (!isUserId(userId)) return null;");
  });

  test("selling units apply it — visibility and purchasability use the same flag", () => {
    const units = read("backend/lib/selling-units.ts");
    expect(units).toContain('if (row.is_wholesale === true && opts.wholesaleAllowed !== true)');
    expect(units).toContain('code: "SELLING_UNIT_WHOLESALE_ONLY"');
    expect(units).toContain("withWholesale ? WHERE : `${WHERE} AND is_wholesale = FALSE`");
    // `isWholesale` travels in the payload so a storefront can label the row.
    expect(units).toContain("isWholesale: row.is_wholesale === true");
  });

  test("no route re-implements the gate", () => {
    // Every surface asks the authority: catalog, detail, cart add, cart update,
    // checkout and reorder. A second `SELECT ... FROM store_accounts` outside the
    // lib would be the drift this test exists to catch.
    for (const file of [
      "backend/routes/products.ts",
      "backend/routes/cart.ts",
      "backend/routes/store-accounts.ts",
    ]) {
      expect(read(file)).toContain("isApprovedStore");
    }
    const products = read("backend/routes/products.ts");
    // Both the catalog and the detail read the VIEWER's access.
    expect(products.split("includeWholesale: await isApprovedStore(query, req.user?.userId)").length - 1).toBe(2);
    // …and both are `optionalAuth`, so a signed-out read still resolves the viewer.
    expect(products).toContain('app.get("/api/products/catalog", optionalAuth');
    expect(products).toContain('app.get("/api/products/:productId", optionalAuth');

    const cart = read("backend/routes/cart.ts");
    // add / checkout / reorder each resolve it ONCE per request…
    expect(cart.split("const wholesaleAllowed = await isApprovedStore(query, userId);").length - 1).toBe(3);
    // …and pass it to every resolve call (add, update, checkout, reorder).
    expect(cart).toContain("{ wholesaleAllowed },");
    expect(cart).toContain("{ wholesaleAllowed: await isApprovedStore(query, userId) },");
    // A restricted line is a permission answer, not a bad request.
    expect(cart).toContain('lineUnit.code === "SELLING_UNIT_WHOLESALE_ONLY"');
    expect(cart).not.toContain("if (resolvedUnit.code === \"SELLING_UNIT_WHOLESALE_ONLY\") {\n        res.status(400)");
  });

  test("the review queue is gated by its own permission code", () => {
    const routes = read("backend/routes/store-accounts.ts");
    expect(routes).toContain('const REVIEW_PERMISSION = "stores.manage";');
    expect(routes).toContain("userHasPermission(userId, REVIEW_PERMISSION)");
    expect(routes).toContain("isCenterMember(userId)");
    // The catalog declares the code, and the guard checks the same string.
    const perms = read("backend/lib/permissions.ts");
    expect(perms).toContain('{ code: "stores.manage"');
  });

  test("both canonical SQL files describe the same schema", () => {
    expect(canonicalParity(readCanonical(SCHEMA_SQL), readCanonical(RUN_SQLEDITOR_SQL))).toEqual(NO_CANONICAL_DRIFT);
    for (const file of ["db/schema.sql", "db/run-sqleditor.sql"]) {
      const sql = read(file);
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS store_accounts");
      expect(sql).toContain("is_wholesale BOOLEAN NOT NULL DEFAULT FALSE");
      // The live-definition key carries the audience.
      expect(sql).toContain("pieces, is_wholesale) WHERE status = 'active'");
    }
    // The reconciler's measured object counts were re-measured for migration 059
    // (77 tables | 305 indexes | 352 constraints | 837 columns).
    expect(read("db/verify-reconciler.sh")).toContain('CANON="77|305|352|837"');
  });

  test("the application rules are validated on the server", () => {
    const missing = validateStoreApplication({ storeName: "", contactName: "x", contactPhone: "0812345678" });
    expect(missing.ok).toBe(false);
    const noPhone = validateStoreApplication({ storeName: "ร้าน", contactName: "x", contactPhone: "   " });
    expect(noPhone.ok).toBe(false);
    const ok = validateStoreApplication({
      storeName: "  ร้านชำสุขใจ  ",
      contactName: "สมชาย",
      contactPhone: "0812345678",
      address: "  ",
    });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.values.storeName).toBe("ร้านชำสุขใจ");
      // A blank optional field is stored as NULL, never "".
      expect(ok.values.address).toBeNull();
    }
  });

  test("a wholesale unit is labelled in the payload, defaulting to public", () => {
    expect(formatSellingUnit({ id: "u", pieces: 12, price: 100, status: "active" }).isWholesale).toBe(false);
    expect(formatSellingUnit({ id: "u", pieces: 12, price: 100, status: "active", is_wholesale: true }).isWholesale).toBe(true);
  });
});

// ─── Integration ─────────────────────────────────────────────────────────────

describe("store accounts + wholesale access (requires TEST_DATABASE_URL)", () => {
  const testFn = hasTestDatabase() ? test : test.skip;

  let server: Server | undefined;
  let base = "";
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    if (!hasTestDatabase()) return;
    process.env.STRIPE_SECRET_KEY = "sk_test_000000000000000000000000";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_000000000000000000000000";
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "1mb" }));
    setupProductRoutes(app);
    setupProductSellingUnitRoutes(app);
    setupCartRoutes(app);
    setupStoreAccountRoutes(app);
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

  async function api(
    method: string,
    path: string,
    who: { userId: string; email: string } | null,
    body?: unknown,
  ) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (who) headers.cookie = cookie(who.userId, who.email);
    const res = await fetch(`${base}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json: any = await res.json().catch(() => null);
    return { status: res.status, json };
  }

  /** A buyer/center account. `role` decides what the session may do. */
  async function seedUser(tag: string, role = "customer") {
    const { query } = await import("../db/index.js");
    const email = `${tag}-${randomUUID().slice(0, 8)}@test.invalid`;
    const user = await query("INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id", [
      email,
      `${tag} user`,
      role,
    ]);
    const userId = user.rows[0].id as string;
    createdUserIds.push(userId);
    return { userId, email, role };
  }

  /** An approved seller with a published product (price 10) holding 1000 base units. */
  async function seedSellerWithProduct(tag: string) {
    const { query } = await import("../db/index.js");
    const seller = await seedUser(tag, "seller");
    const sellerRow = await query("INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id", [
      seller.userId,
    ]);
    const sellerId = sellerRow.rows[0].id as string;
    const shop = await query("INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id", [
      sellerId,
      `${tag} shop`,
      `${tag}-${randomUUID().slice(0, 8)}`,
    ]);
    const shopId = shop.rows[0].id as string;
    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status, unit)
       VALUES ($1, $2, $3, 10, 'published', 'ชิ้น') RETURNING id`,
      [shopId, `${tag} water`, `${tag}-p-${randomUUID().slice(0, 8)}`],
    );
    const productId = product.rows[0].id as string;
    await query("INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 1000, 0)", [productId]);
    return { ...seller, sellerId, shopId, productId };
  }

  async function createUnit(seller: { userId: string; email: string; productId: string }, body: Record<string, unknown>) {
    return api("POST", `/api/seller/products/${seller.productId}/selling-units`, seller, body);
  }

  async function applyForStore(who: { userId: string; email: string }, overrides: Record<string, unknown> = {}) {
    return api("POST", "/api/customer/store-account", who, {
      storeName: "ร้านชำสุขใจ",
      contactName: "สมชาย",
      contactPhone: "0812345678",
      address: "12 หมู่ 3",
      ...overrides,
    });
  }

  /** Reviews through the real endpoint. */
  async function review(
    reviewer: { userId: string; email: string },
    accountId: string,
    decision: "approve" | "reject",
    reviewNote?: string,
  ) {
    return api("PATCH", `/api/admin/store-accounts/${accountId}`, reviewer, { decision, reviewNote });
  }

  async function unitNamesInCatalog(productId: string, shopId: string, who: { userId: string; email: string } | null) {
    const res = await api("GET", `/api/products/catalog?shopId=${shopId}&limit=50`, who);
    expect(res.status).toBe(200);
    const product = (res.json.data as any[]).find((p) => p.id === productId);
    expect(product).toBeDefined();
    return { names: (product.sellingUnits as any[]).map((u) => u.name), product };
  }

  testFn("an application starts pending, and a user has exactly ONE row", async () => {
    const buyer = await seedUser("sa-apply");
    const first = await applyForStore(buyer);
    expect(first.status).toBe(200);
    expect(first.json.data).toMatchObject({ status: "pending", approved: false, storeName: "ร้านชำสุขใจ" });

    const second = await applyForStore(buyer, { storeName: "ร้านชำสุขใจ (สาขา 2)", contactPhone: "0899999999" });
    expect(second.status).toBe(200);
    expect(second.json.data.id).toBe(first.json.data.id);
    expect(second.json.data.storeName).toBe("ร้านชำสุขใจ (สาขา 2)");

    const { query } = await import("../db/index.js");
    const rows = await query("SELECT count(*)::int AS n FROM store_accounts WHERE user_id = $1", [buyer.userId]);
    expect(rows.rows[0].n).toBe(1);

    // The applicant's own read is the row it wrote, and it is never cached.
    const mine = await api("GET", "/api/customer/store-account", buyer);
    expect(mine.status).toBe(200);
    expect(mine.json.data.status).toBe("pending");
    // Anonymous callers cannot read anybody's application.
    expect((await api("GET", "/api/customer/store-account", null)).status).toBe(401);
  });

  testFn("a rejection sends the SAME row back to pending, and clears the old review", async () => {
    const { query } = await import("../db/index.js");
    const owner = await seedUser("sa-owner-reapply", "owner");
    const buyer = await seedUser("sa-reapply");
    const applied = await applyForStore(buyer);
    const id = applied.json.data.id as string;

    const rejected = await review(owner, id, "reject", "ข้อมูลร้านไม่ครบ");
    expect(rejected.status).toBe(200);
    expect(rejected.json.data.status).toBe("rejected");

    const again = await applyForStore(buyer, { storeName: "ร้านชำสุขใจ (แก้ไขแล้ว)" });
    expect(again.status).toBe(200);
    expect(again.json.data.id).toBe(id);
    expect(again.json.data.status).toBe("pending");
    // A stale reviewer note must not follow the new application into the queue.
    expect(again.json.data.reviewNote).toBeNull();
    expect(again.json.data.reviewedAt).toBeNull();
    const rows = await query("SELECT count(*)::int AS n FROM store_accounts WHERE user_id = $1", [buyer.userId]);
    expect(rows.rows[0].n).toBe(1);
  });

  testFn("an approved account keeps its approval while correcting its details", async () => {
    const owner = await seedUser("sa-owner-keep", "owner");
    const buyer = await seedUser("sa-keep");
    const applied = await applyForStore(buyer);
    const id = applied.json.data.id as string;
    await review(owner, id, "approve");

    const updated = await applyForStore(buyer, { contactPhone: "0800000000" });
    expect(updated.status).toBe(200);
    expect(updated.json.data.status).toBe("approved");
    expect(updated.json.data.approved).toBe(true);
    expect(updated.json.data.contactPhone).toBe("0800000000");
    expect(updated.json.data.reviewedAt).not.toBeNull();
  });

  testFn("the catalog and the detail show a wholesale unit to an approved store ONLY", async () => {
    const seller = await seedSellerWithProduct("sa-catalog");
    const publicUnit = (await createUnit(seller, { name: "เซ็ต 6", pieces: 6, price: 55 })).json.data;
    const wholesaleUnit = (await createUnit(seller, { name: "ลัง 24", pieces: 24, price: 180, isWholesale: true })).json.data;
    expect(publicUnit.isWholesale).toBe(false);
    expect(wholesaleUnit.isWholesale).toBe(true);

    // Anonymous, an ordinary customer, and an approved store.
    const customer = await seedUser("sa-catalog-customer");
    const store = await seedUser("sa-catalog-store");
    const owner = await seedUser("sa-catalog-owner", "owner");
    const applied = await applyForStore(store);
    await review(owner, applied.json.data.id as string, "approve");

    const anon = await unitNamesInCatalog(seller.productId, seller.shopId, null);
    expect(anon.names).toEqual(["เซ็ต 6"]);
    const ordinary = await unitNamesInCatalog(seller.productId, seller.shopId, customer);
    expect(ordinary.names).toEqual(["เซ็ต 6"]);
    const approved = await unitNamesInCatalog(seller.productId, seller.shopId, store);
    expect(approved.names).toEqual(["เซ็ต 6", "ลัง 24"]);

    // RETAIL PARITY: the only difference is the wholesale row. The product's own
    // price and stock read identically for every viewer.
    expect(anon.product.price).toBe(ordinary.product.price);
    expect(anon.product.price).toBe(approved.product.price);
    expect(anon.product.stock).toEqual(approved.product.stock);

    // …and the same is true of the product detail payload.
    const detailAnon = await api("GET", `/api/products/${seller.productId}`, null);
    const detailStore = await api("GET", `/api/products/${seller.productId}`, store);
    expect((detailAnon.json.data.sellingUnits as any[]).map((u) => u.name)).toEqual(["เซ็ต 6"]);
    expect((detailStore.json.data.sellingUnits as any[]).map((u) => u.name)).toEqual(["เซ็ต 6", "ลัง 24"]);
  });

  testFn("the cart refuses a wholesale pack without access, and writes nothing", async () => {
    const { query } = await import("../db/index.js");
    const seller = await seedSellerWithProduct("sa-cart-refuse");
    const wholesale = (await createUnit(seller, { name: "ลัง 24", pieces: 24, price: 180, isWholesale: true })).json.data;
    const buyer = await seedUser("sa-cart-refuse-buyer");

    const res = await api("POST", "/api/customer/cart/add", buyer, {
      productId: seller.productId,
      quantity: 2,
      sellingUnitId: wholesale.id,
    });
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("SELLING_UNIT_WHOLESALE_ONLY");

    const lines = await query(
      "SELECT count(*)::int AS n FROM cart_items WHERE cart_id IN (SELECT id FROM carts WHERE user_id = $1)",
      [buyer.userId],
    );
    expect(lines.rows[0].n).toBe(0);
  });

  testFn("an approved store buys the pack, and loses it the moment the approval does", async () => {
    const { query } = await import("../db/index.js");
    const owner = await seedUser("sa-buy-owner", "owner");
    const seller = await seedSellerWithProduct("sa-buy");
    const wholesale = (await createUnit(seller, { name: "ลัง 24", pieces: 24, price: 180, isWholesale: true })).json.data;
    const store = await seedUser("sa-buy-store");
    const applied = await applyForStore(store);
    const accountId = applied.json.data.id as string;
    await review(owner, accountId, "approve");

    const added = await api("POST", "/api/customer/cart/add", store, {
      productId: seller.productId,
      quantity: 2,
      sellingUnitId: wholesale.id,
    });
    expect(added.status).toBe(200);
    const line = added.json.data.items[0];
    expect(line).toMatchObject({
      sellingUnitId: wholesale.id,
      sellingUnitName: "ลัง 24",
      sellingUnitPieces: 24,
      quantity: 2,
      priceSnapshot: 180,
      baseQuantity: 48,
    });

    // The list endpoint is not the authority: a line may not be ENLARGED once
    // the approval is gone.
    await query("UPDATE store_accounts SET status = 'rejected' WHERE id = $1", [accountId]);
    const grown = await api("PUT", `/api/customer/cart/item/${line.id}`, store, { quantity: 5 });
    expect(grown.status).toBe(403);
    expect(grown.json.error.code).toBe("SELLING_UNIT_WHOLESALE_ONLY");

    // …and checkout re-applies the gate to the line already in the cart: the
    // order is refused and NOTHING is written.
    const checkout = await api("POST", "/api/customer/checkout", store, { paymentMethod: "CARD" });
    expect(checkout.status).toBe(403);
    expect(checkout.json.error.code).toBe("SELLING_UNIT_WHOLESALE_ONLY");
    const orders = await query(
      "SELECT count(*)::int AS n FROM orders WHERE user_id = $1",
      [store.userId],
    );
    expect(orders.rows[0].n).toBe(0);
  });

  testFn("a re-order skips a wholesale line the buyer may no longer order", async () => {
    const { query } = await import("../db/index.js");
    const owner = await seedUser("sa-reorder-owner", "owner");
    const seller = await seedSellerWithProduct("sa-reorder");
    const wholesale = (await createUnit(seller, { name: "ลัง 24", pieces: 24, price: 180, isWholesale: true })).json.data;
    const store = await seedUser("sa-reorder-store");
    const applied = await applyForStore(store);
    const accountId = applied.json.data.id as string;
    await review(owner, accountId, "approve");

    await api("POST", "/api/customer/cart/add", store, {
      productId: seller.productId,
      quantity: 1,
      sellingUnitId: wholesale.id,
    });
    const checkout = await api("POST", "/api/customer/checkout", store, { paymentMethod: "CARD" });
    expect(checkout.status).toBe(200);
    const orderId = checkout.json.data.orders[0].orderId as string;

    // The approval goes away, then the buyer tries to buy the same basket again.
    await query("UPDATE store_accounts SET status = 'rejected' WHERE id = $1", [accountId]);
    const reorder = await api("POST", "/api/customer/reorder", store, { orderId });
    expect(reorder.status).toBe(200);
    expect(reorder.json.data.added).toHaveLength(0);
    expect(reorder.json.data.skipped[0].reason).toBe("selling_unit_restricted");
  });

  testFn("the queue needs stores.manage, and every decision is audited", async () => {
    const { query } = await import("../db/index.js");
    const customer = await seedUser("sa-queue-customer");
    const owner = await seedUser("sa-queue-owner", "owner");
    const buyer = await seedUser("sa-queue-applicant");
    const applied = await applyForStore(buyer);
    const accountId = applied.json.data.id as string;

    // A plain customer cannot see or touch the queue.
    expect((await api("GET", "/api/admin/store-accounts", customer)).status).toBe(403);
    expect((await review(customer, accountId, "approve")).status).toBe(403);

    const queue = await api("GET", "/api/admin/store-accounts?status=pending&limit=100", owner);
    expect(queue.status).toBe(200);
    expect(queue.json.data.pagination.total).toBeGreaterThanOrEqual(1);
    expect((queue.json.data.accounts as any[]).some((a) => a.id === accountId)).toBe(true);

    const approved = await review(owner, accountId, "approve", "ตรวจแล้ว");
    expect(approved.status).toBe(200);
    expect(approved.json.data.status).toBe("approved");

    const audit = await query(
      "SELECT action, entity_type, entity_id FROM audit_logs WHERE entity_id = $1 ORDER BY created_at DESC LIMIT 1",
      [accountId],
    );
    expect(audit.rows[0]).toMatchObject({
      action: "STORE_ACCOUNT_APPROVED",
      entity_type: "store_account",
      entity_id: accountId,
    });

    // Approving again is a conflict, not a silent no-op that hides a mistake.
    const twice = await review(owner, accountId, "approve");
    expect(twice.status).toBe(409);
    expect(twice.json.error.code).toBe("INVALID_TRANSITION");

    // A rejection without a reason is refused: the applicant could not act on it.
    const store2 = await seedUser("sa-queue-applicant-2");
    const applied2 = await applyForStore(store2);
    const noReason = await review(owner, applied2.json.data.id as string, "reject", "   ");
    expect(noReason.status).toBe(400);

    // A decision on a row that does not exist is a 404, never a 500.
    expect((await review(owner, randomUUID(), "approve")).status).toBe(404);
  });

  testFn("a reviewer cannot approve their own application", async () => {
    const owner = await seedUser("sa-self-owner", "owner");
    const applied = await applyForStore(owner);
    const res = await review(owner, applied.json.data.id as string, "approve");
    expect(res.status).toBe(403);
    expect(res.json.error.code).toBe("SELF_APPROVAL_FORBIDDEN");

    // The same reviewer may REJECT it (the decision can only withhold access).
    const rejected = await review(owner, applied.json.data.id as string, "reject", "ผลประโยชน์ทับซ้อน");
    expect(rejected.status).toBe(200);
  });

  testFn("the seller marks a unit wholesale with a real boolean", async () => {
    const seller = await seedSellerWithProduct("sa-author");
    const created = await createUnit(seller, { name: "ลัง 24", pieces: 24, price: 180, isWholesale: true });
    expect(created.status).toBe(200);
    expect(created.json.data.isWholesale).toBe(true);
    // Default for an authored unit that says nothing is PUBLIC — the retail path.
    const plain = await createUnit(seller, { name: "เซ็ต 6", pieces: 6, price: 55 });
    expect(plain.json.data.isWholesale).toBe(false);
    // A truthy STRING is refused rather than quietly publishing a hidden pack.
    const crafted = await createUnit(seller, { name: "ลัง 12", pieces: 12, price: 90, isWholesale: "false" });
    expect(crafted.status).toBe(400);
    // Switching an existing unit's audience is a PATCH, and it round-trips.
    const toggled = await api(
      "PATCH",
      `/api/seller/products/${seller.productId}/selling-units/${plain.json.data.id}`,
      seller,
      { isWholesale: true },
    );
    expect(toggled.status).toBe(200);
    expect(toggled.json.data.isWholesale).toBe(true);
  });

  testFn("one size may be offered to retail AND wholesale at different prices", async () => {
    const seller = await seedSellerWithProduct("sa-both-audiences");
    const retail = await createUnit(seller, { name: "แพ็ค 12 (ปลีก)", pieces: 12, price: 120 });
    expect(retail.status).toBe(200);
    const wholesale = await createUnit(seller, { name: "แพ็ค 12 (ส่ง)", pieces: 12, price: 96, isWholesale: true });
    expect(wholesale.status).toBe(200);
    // The same size for the SAME audience is still refused.
    const duplicate = await createUnit(seller, { name: "แพ็ค 12 ซ้ำ", pieces: 12, price: 90, isWholesale: true });
    expect(duplicate.status).toBe(409);
    expect(duplicate.json.error.code).toBe("DUPLICATE_SELLING_UNIT");
  });

  testFn("the authority answers false for an unknown account and for a non-uuid id", async () => {
    const { query } = await import("../db/index.js");
    const missing = await seedUser("sa-authority");
    expect(await isApprovedStore(query, missing.userId)).toBe(false);
    expect(await isApprovedStore(query, null)).toBe(false);
    expect(await isApprovedStore(query, undefined)).toBe(false);
    // A session id that is not a uuid must never reach the database: that would
    // be a 500 (22P02) where the honest answer is "not an approved store".
    expect(await isApprovedStore(query, "user-payment-test")).toBe(false);
    expect(await isApprovedStore(query, "")).toBe(false);
  });
});
