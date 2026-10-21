/**
 * MVP test harness — a REAL express app against a REAL PostgreSQL database.
 *
 * There are no mocks here. Every assertion in `backend/mvp/tests/` drives the
 * actual route handlers, which issue the actual SQL against a database built
 * from `db/mvp/schema.sql`. That is the only way the schema's triggers, CHECKs,
 * composite foreign keys and unique indexes can be proven — a mocked `query()`
 * would prove nothing about them.
 *
 * WHICH DATABASE
 * --------------
 * `db/mvp/test-run.sh` creates a dedicated, disposable database
 * (`velnox_mvp_app_test`), applies the MVP schema, and exports it as
 * `TEST_DATABASE_URL` before `bun test` starts. `backend/db/index.ts` therefore
 * points the shared pool at it.
 *
 * `assertMvpDatabase()` refuses to run against anything else: the database name
 * must end in `_test`, `products` must have the MVP `seller_id` column, and the
 * pre-MVP `shops` table must be absent. Running these tests against the legacy
 * test database would otherwise fail with confusing "column does not exist"
 * errors instead of a clear instruction.
 */
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import { query } from "../../../db/index.js";
import { hashPassword } from "../../../lib/password.js";
import { MVP_STRIPE_WEBHOOK_PATH } from "../../webhook-body.js";
import { mvpWebhookRawBody } from "../../webhook-body.js";
import { setupMvpRoutes } from "../../index.js";

export { MVP_STRIPE_WEBHOOK_PATH };

export interface TestApp {
  base: string;
  close: () => Promise<void>;
}

let shapeChecked = false;

/** Refuse to run against anything that is not the disposable MVP database. */
export async function assertMvpDatabase(): Promise<void> {
  if (shapeChecked) return;
  const identity = await query(
    `SELECT current_database() AS database,
            (SELECT COUNT(*)::int FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'seller_id') AS seller_col,
            to_regclass('public.shops') IS NOT NULL AS has_legacy_shops`,
  );
  const row = identity.rows[0] as {
    database: string;
    seller_col: number;
    has_legacy_shops: boolean;
  };
  const problems: string[] = [];
  if (!/_test$/.test(row.database)) {
    problems.push(`database '${row.database}' does not end in _test`);
  }
  if (Number(row.seller_col) !== 1) {
    problems.push("products.seller_id is missing (this is not the MVP schema)");
  }
  if (row.has_legacy_shops) {
    problems.push("the pre-MVP 'shops' table exists (this is the legacy database)");
  }
  if (problems.length > 0) {
    throw new Error(
      [
        "REFUSING TO RUN MVP TESTS AGAINST THIS DATABASE:",
        ...problems.map((p) => `  • ${p}`),
        "  Run: bun run test:mvp   (it creates a disposable MVP database and points TEST_DATABASE_URL at it)",
      ].join("\n"),
    );
  }
  shapeChecked = true;
}

export async function startApp(): Promise<TestApp> {
  await assertMvpDatabase();
  const app = express();
  app.use(cookieParser());
  // Webhook first: it must see the raw bytes, exactly as `server.ts` orders it.
  app.use(mvpWebhookRawBody);
  app.use(express.json({ limit: "1mb" }));
  setupMvpRoutes(app);
  const server: Server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  return {
    base,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

export interface ApiResponse {
  status: number;
  body: any;
  setCookie: string[];
}

/** One HTTP call. `cookie` is a raw `velnox_session=…` string. */
export async function api(
  base: string,
  path: string,
  opts: { method?: string; body?: unknown; cookie?: string } = {},
): Promise<ApiResponse> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return {
    status: res.status,
    body,
    setCookie: typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [],
  };
}

/** A signed session cookie, matching what `session.ts` mints. */
export function cookieFor(userId: string, email: string): string {
  const token = jwt.sign({ userId, email }, process.env.JWT_SECRET as string, { expiresIn: "10m" });
  return `velnox_session=${token}`;
}

const uuidPart = () => crypto.randomUUID().slice(0, 8);

export interface TestUser {
  id: string;
  email: string;
  password: string;
  cookie: string;
}

export async function createUser(
  opts: { role?: "customer" | "seller" | "admin" | "owner"; status?: string; password?: string } = {},
): Promise<TestUser> {
  const email = `mvp-${uuidPart()}@test.invalid`;
  const password = opts.password ?? `pw-${crypto.randomUUID()}`;
  const hash = await hashPassword(password);
  const result = await query(
    `INSERT INTO users (email, name, password_hash, role, status)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id, email`,
    [email, "MVP Test User", hash, opts.role ?? "customer", opts.status ?? "active"],
  );
  const row = result.rows[0] as { id: string; email: string };
  return { id: row.id, email: row.email, password, cookie: cookieFor(row.id, row.email) };
}

export interface TestSeller {
  id: string;
  userId: string;
  slug: string;
  cookie: string;
}

export async function createSeller(
  opts: { status?: "pending" | "approved" | "rejected" | "suspended"; approvedBy?: string } = {},
): Promise<TestSeller> {
  const status = opts.status ?? "approved";
  const user = await createUser({ role: status === "approved" ? "seller" : "customer" });
  const slug = `store-${uuidPart()}`;
  const result = await query(
    `INSERT INTO seller_profiles
       (user_id, store_name, slug, status, approved_at, approved_by, rejection_reason, suspended_at, suspension_reason)
     VALUES ($1, $2, $3, $4,
             CASE WHEN $4 = 'approved' THEN NOW() ELSE NULL END,
             CASE WHEN $4 = 'approved' THEN $5::uuid ELSE NULL END,
             CASE WHEN $4 = 'rejected' THEN 'documents missing' ELSE NULL END,
             CASE WHEN $4 = 'suspended' THEN NOW() ELSE NULL END,
             CASE WHEN $4 = 'suspended' THEN 'policy violation' ELSE NULL END)
     RETURNING id`,
    [user.id, `Store ${slug}`, slug, status, opts.approvedBy ?? null],
  );
  return { id: (result.rows[0] as { id: string }).id, userId: user.id, slug, cookie: user.cookie };
}

export interface TestProduct {
  id: string;
  slug: string;
  sellerId: string;
}

/**
 * A published product, created through the SAME legal lifecycle the routes use:
 * draft → submitted → approved → published. Inserting `status='published'`
 * directly is impossible — the trigger and the evidence CHECKs refuse it — which
 * is itself part of what the lifecycle tests assert.
 */
export async function createPublishedProduct(
  sellerId: string,
  adminId: string,
  opts: {
    name?: string;
    price?: string;
    stock?: number;
    categorySlug?: string | null;
    description?: string;
    variants?: Array<{ name: string; price: string; stock: number; status?: "active" | "inactive" }>;
  } = {},
): Promise<TestProduct> {
  const name = opts.name ?? `Product ${uuidPart()}`;
  const slug = `p-${uuidPart()}`;
  const price = opts.price ?? "100.00";
  const inserted = await query(
    `INSERT INTO products (seller_id, category_slug, name, slug, description, price, status)
     VALUES ($1, $2, $3, $4, $5, $6, 'draft')
     RETURNING id`,
    [sellerId, opts.categorySlug ?? null, name, slug, opts.description ?? "", price],
  );
  const productId = (inserted.rows[0] as { id: string }).id;

  await query(`UPDATE products SET status = 'submitted', submitted_at = NOW() WHERE id = $1`, [
    productId,
  ]);
  await query(
    `UPDATE products SET status = 'approved', approved_at = NOW(), approved_by = $2 WHERE id = $1`,
    [productId, adminId],
  );
  await query(`UPDATE products SET status = 'published', published_at = NOW() WHERE id = $1`, [
    productId,
  ]);

  if (opts.variants && opts.variants.length > 0) {
    for (const variant of opts.variants) {
      const v = await query(
        `INSERT INTO product_variants (product_id, name, price, status) VALUES ($1, $2, $3, $4) RETURNING id`,
        [productId, variant.name, variant.price, variant.status ?? "active"],
      );
      await query(`INSERT INTO inventory (product_id, variant_id, quantity) VALUES ($1, $2, $3)`, [
        productId,
        (v.rows[0] as { id: string }).id,
        variant.stock,
      ]);
    }
  } else {
    await query(`INSERT INTO inventory (product_id, variant_id, quantity) VALUES ($1, NULL, $2)`, [
      productId,
      opts.stock ?? 10,
    ]);
  }

  return { id: productId, slug, sellerId };
}

export async function createCategory(slug?: string): Promise<{ id: string; slug: string }> {
  const value = slug ?? `cat-${uuidPart()}`;
  const result = await query(
    `INSERT INTO categories (slug, name) VALUES ($1, $2) RETURNING id, slug`,
    [value, value],
  );
  return result.rows[0] as { id: string; slug: string };
}

/** Active stock and reservation for one inventory scope. */
export async function stockRow(
  productId: string,
  variantId: string | null = null,
): Promise<{ quantity: number; reserved: number } | null> {
  const result = await query(
    `SELECT quantity, reserved FROM inventory
      WHERE product_id = $1 AND variant_id IS NOT DISTINCT FROM $2::uuid`,
    [productId, variantId],
  );
  return (result.rows[0] as { quantity: number; reserved: number } | undefined) ?? null;
}

/** A complete, valid Thai address body for checkout. */
export function addressBody(): Record<string, string> {
  return {
    recipientName: "สมชาย ใจดี",
    phone: "0812345678",
    line1: "123/45 ถนนสุขุมวิท",
    subdistrict: "คลองเตย",
    district: "คลองเตย",
    city: "กรุงเทพมหานคร",
    state: "กรุงเทพมหานคร",
    postalCode: "10110",
  };
}

export interface SeededCart {
  seller: TestSeller;
  product: TestProduct;
  cartId: string;
  buyer: TestUser;
}

/** Create a buyer with a one-line cart for a freshly published product. */
export async function seedCart(
  base: string,
  opts: {
    adminId: string;
    quantity?: number;
    price?: string;
    stock?: number;
    variants?: Array<{ name: string; price: string; stock: number; status?: "active" | "inactive" }>;
    variantIndex?: number;
    buyer?: TestUser;
    seller?: TestSeller;
  },
): Promise<SeededCart & { variantId: string | null }> {
  const seller = opts.seller ?? (await createSeller());
  const product = await createPublishedProduct(seller.id, opts.adminId, {
    price: opts.price ?? "100.00",
    stock: opts.stock ?? 10,
    variants: opts.variants,
  });
  const buyer = opts.buyer ?? (await createUser());

  let variantId: string | null = null;
  if (opts.variants && opts.variants.length > 0) {
    const variants = await query(
      `SELECT id FROM product_variants WHERE product_id = $1 ORDER BY sort_order, created_at`,
      [product.id],
    );
    variantId = (variants.rows[opts.variantIndex ?? 0] as { id: string } | undefined)?.id ?? null;
  }

  const added = await api(base, "/api/mvp/cart/items", {
    method: "POST",
    cookie: buyer.cookie,
    body: { productId: product.id, variantId, quantity: opts.quantity ?? 1 },
  });
  if (added.status !== 201) {
    throw new Error(`seedCart: add-to-cart failed ${added.status}: ${JSON.stringify(added.body)}`);
  }
  return { seller, product, buyer, cartId: added.body.data.cart.id, variantId };
}

/** Checkout through the real endpoint. */
export async function checkout(
  base: string,
  buyer: TestUser,
  cartId: string,
  opts: { requestKey?: string; address?: unknown } = {},
): Promise<ApiResponse> {
  return api(base, "/api/mvp/checkout", {
    method: "POST",
    cookie: buyer.cookie,
    body: {
      cartId,
      requestKey: opts.requestKey ?? `req-${crypto.randomUUID()}`,
      address: opts.address ?? addressBody(),
    },
  });
}

/** Settle an order through the real webhook with a real signature. */
export async function deliverPaidWebhook(
  base: string,
  args: {
    orderId: string;
    paymentId: string;
    sessionId: string;
    amountTotal: number;
    currency?: string;
    eventId?: string;
    paymentIntent?: string;
  },
): Promise<ApiResponse & { payload: string }> {
  const { default: Stripe } = await import("stripe");
  const secret = process.env.STRIPE_WEBHOOK_SECRET as string;
  const payload = JSON.stringify({
    id: args.eventId ?? `evt_${crypto.randomUUID()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: args.sessionId,
        object: "checkout.session",
        payment_status: "paid",
        payment_intent: args.paymentIntent ?? `pi_${crypto.randomUUID()}`,
        amount_total: args.amountTotal,
        currency: args.currency ?? "thb",
        metadata: { orderId: args.orderId, paymentId: args.paymentId },
      },
    },
  });
  // Async form: Bun's Stripe platform layer selects the WebCrypto provider,
  // whose sync path throws. This signs the exact same bytes the route verifies.
  const signature = await Stripe.webhooks.generateTestHeaderStringAsync({ payload, secret });
  const res = await fetch(`${base}${MVP_STRIPE_WEBHOOK_PATH}`, {
    method: "POST",
    headers: { "content-type": "application/json", "stripe-signature": signature },
    body: payload,
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body, setCookie: [], payload };
}
