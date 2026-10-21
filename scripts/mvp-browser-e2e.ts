/**
 * MVP BROWSER E2E — the three real frontends against the real MVP API.
 *
 * WHAT THIS PROVES
 * ────────────────
 * Every other MVP test drives HTTP directly. This one drives Chromium through the
 * BUILT React apps, so it is the only proof that the client wiring in
 * `packages/shared/src/mvp` and the per-app `src/mvp` trees actually work in a
 * browser:
 *
 *   seller signup → apply → admin approves → product draft + variant
 *   + retail pack (Pack 6) → submit → admin approves → publish → buyer signup →
 *   catalogue → variant → 6-pack → cart → checkout → order confirmation
 *   (pack snapshot + 6 base units held) → cancel → stock restored
 *   → second 6-pack order expires via the admin sweep → stock restored again
 *
 * HOW IT IS ISOLATED
 * ──────────────────
 *   • the database comes from `TEST_DATABASE_URL`, must end in `_test`, must have
 *     the MVP `products.seller_id` column and must NOT have the pre-MVP `shops`
 *     table — otherwise it refuses to start (same rule as the API suite);
 *   • `MVP_E2E_ALLOW=1` is required, so a stray invocation cannot start building
 *     apps and writing rows;
 *   • each app is served on 127.0.0.1 from its own `dist/`, and the API is
 *     mounted in the SAME express process (same origin, so the session cookie
 *     behaves exactly as it does in staging);
 *   • HTTPS with a throwaway self-signed certificate, because Chromium rejects a
 *     `SameSite=None` cookie without `Secure`. The API sends `Secure` because the
 *     harness sets `MVP_COOKIE_SECURE=true`; nothing about production changes.
 *
 * RUN IT
 *   bun run test:mvp:browser      (creates and drops its own database)
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { createServer, type Server } from "node:https";
import path from "node:path";
import type { AddressInfo } from "node:net";
import cookieParser from "cookie-parser";
import express from "express";
import { chromium, type Browser, type Page } from "playwright";
import { query } from "../backend/db/index.js";
import { setupMvpRoutes } from "../backend/mvp/index.js";
import { mvpWebhookRawBody } from "../backend/mvp/webhook-body.js";
import { createUser } from "../backend/mvp/tests/helpers/mvp-app.js";

const ROOT = path.resolve(import.meta.dir, "..");
const SHOP = 4181;
const SELLER = 4182;
const CENTER = 4183;
const ADMIN_PASSWORD = "AdminPass123!";
const PASSWORD = "BuyerPass123!";
const STORE = `Browser Store ${crypto.randomUUID().slice(0, 6)}`;
const PRODUCT = `Browser Product ${crypto.randomUUID().slice(0, 6)}`;

function fail(message: string): never {
  throw new Error(message);
}

function log(step: string, extra = "") {
  console.log(`\x1b[32mPASS\x1b[0m  ${step}${extra ? ` — ${extra}` : ""}`);
}

// ─── Guards ─────────────────────────────────────────────────────────────────

if (!process.env.MVP_E2E_ALLOW) {
  fail(
    "MVP_E2E_ALLOW is not set. Run `bun run test:mvp:browser` (it creates a disposable database).",
  );
}
if (!process.env.TEST_DATABASE_URL) {
  fail("TEST_DATABASE_URL is required; this harness never reads DATABASE_URL.");
}
if (!process.env.JWT_SECRET) {
  fail("JWT_SECRET is required (a test-only value is fine).");
}

async function assertMvpDatabase(): Promise<string> {
  const result = await query(
    `SELECT current_database() AS database,
            to_regclass('public.shops') IS NOT NULL AS has_legacy_shops,
            COALESCE((SELECT COUNT(*)::int FROM information_schema.columns
                       WHERE table_schema = 'public' AND table_name = 'products'
                         AND column_name = 'seller_id'), 0) AS seller_col,
            (SELECT COUNT(*)::int FROM users) AS users`,
  );
  const row = result.rows[0] as {
    database: string;
    has_legacy_shops: boolean;
    seller_col: number;
    users: number;
  };
  const problems: string[] = [];
  if (!/_test$/.test(row.database)) problems.push(`database '${row.database}' does not end in _test`);
  if (row.seller_col !== 1) problems.push("products.seller_id is missing (not the MVP schema)");
  if (row.has_legacy_shops) problems.push("the pre-MVP 'shops' table exists (legacy database)");
  if (Number(row.users) > 0) problems.push("the database is not empty (expected a fresh MVP database)");
  if (problems.length) fail(`REFUSING BROWSER E2E:\n  • ${problems.join("\n  • ")}`);
  return row.database;
}

// ─── Build the three apps in MVP mode ───────────────────────────────────────

function buildApp(filter: string, origin: string): void {
  const env = {
    ...process.env,
    VITE_API_MODE: "mvp",
    VITE_DEPLOY_ENV: "staging",
    VITE_API_URL: origin,
  };
  const result = spawnSync("bun", ["--filter", filter, "build"], {
    cwd: ROOT,
    env,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    fail(`build failed for ${filter} (exit ${result.status}):\n${result.stderr ?? result.stdout ?? ""}`);
  }
  log(`built ${filter} in MVP mode`, origin);
}

// ─── One HTTPS server per app: same API, different static bundle ─────────────

interface RunningApp {
  url: string;
  server: Server;
}

function serveApp(distDir: string, port: number, certDir: string): Promise<RunningApp> {
  const indexFile = path.join(distDir, "index.html");
  if (!fs.existsSync(indexFile)) fail(`missing build output: ${indexFile}`);

  const app = express();
  app.use(cookieParser());
  // Byte-exact webhook body before JSON, mirroring `server.ts`.
  app.use(mvpWebhookRawBody);
  app.use(express.json({ limit: "1mb" }));
  setupMvpRoutes(app);
  app.use(express.static(distDir, { index: false }));
  app.get("*", (_req, res) => res.sendFile(indexFile));

  const server = createServer(
    {
      key: fs.readFileSync(path.join(certDir, "key.pem")),
      cert: fs.readFileSync(path.join(certDir, "cert.pem")),
    },
    app,
  );
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      const address = server.address() as AddressInfo;
      resolve({ url: `https://localhost:${address.port}`, server });
    });
  });
}

// ─── Small browser helpers ──────────────────────────────────────────────────

async function newPage(browser: Browser): Promise<Page> {
  const context = await browser.newContext({
    ignoreHTTPSErrors: true,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  return page;
}

/** Click the mode toggle in the shared auth panel, then fill + submit it. */
async function authenticate(
  page: Page,
  base: string,
  mode: "login" | "signup",
  email: string,
  password: string,
  name?: string,
): Promise<void> {
  await page.goto(`${base}/auth`);
  if (mode === "signup") {
    await page.getByRole("button", { name: "Create account" }).click();
    await page.locator("#mvp-name").fill(name ?? email.split("@")[0]!);
  }
  await page.locator("#mvp-email").fill(email);
  await page.locator("#mvp-password").fill(password);
  await page.locator('form button[type="submit"]').click();
}

async function waitForText(page: Page, text: string | RegExp, label: string): Promise<void> {
  try {
    await page.getByText(text).first().waitFor({ state: "visible", timeout: 20_000 });
  } catch {
    fail(`${label}: expected to see ${String(text)} on ${page.url()}`);
  }
}

async function clickButton(page: Page, name: string | RegExp): Promise<void> {
  await page.getByRole("button", { name }).first().click();
}

/** Read one row from the disposable database (the E2E's own assertions). */
async function one<T>(sql: string, params: unknown[] = []): Promise<T> {
  const result = await query(sql, params);
  const row = result.rows[0] as T | undefined;
  if (!row) fail(`expected a row from: ${sql}`);
  return row;
}

function assertEqual(actual: unknown, expected: unknown, label: string): void {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) fail(`${label}: expected ${e}, got ${a}`);
}

/** Fill the checkout address form and place the order. */
async function placeOrder(page: Page, quantity: number): Promise<string> {
  const plus = page.getByRole("button", { name: "Increase quantity" });
  for (let i = 1; i < quantity; i += 1) await plus.click();
  await clickButton(page, "Add to cart");
  await waitForText(page, "Added to your cart.", "add to cart");
  await page.getByRole("link", { name: "View cart" }).click();

  await page.getByRole("link", { name: /^Checkout with / }).click();
  await page.locator("#recipient").fill("Browser Buyer");
  await page.locator("#phone").fill("0812345678");
  await page.locator("#line1").fill("123/45 Sukhumvit");
  await page.locator("#city").fill("Bangkok");
  await page.locator("#state").fill("Bangkok");
  await page.locator("#postal").fill("10110");
  await clickButton(page, "Place order");
  await page.waitForURL(/\/orders\/[0-9a-f-]{36}/, { timeout: 20_000 });
  await waitForText(page, "Order placed", "order confirmation");
  return page.url();
}

// ─── Main ───────────────────────────────────────────────────────────────────

let browser: Browser | null = null;
const running: RunningApp[] = [];
let exitCode = 1;

/** Close the browser and every server, then let the pool drain. */
async function shutdown(): Promise<void> {
  await browser?.close().catch(() => undefined);
  for (const app of running) {
    // Chromium keeps keep-alive sockets open; `close()` alone waits for them
    // forever, which is what made the first run hang after ALL STEPS PASSED.
    app.server.closeAllConnections();
    await new Promise<void>((resolve) => app.server.close(() => resolve()));
  }
}

try {
  const database = await assertMvpDatabase();
  console.log(`[browser-e2e] database ${database} (verified: MVP schema, no legacy tables, empty)`);

  const certDir = process.env.MVP_E2E_CERT_DIR ?? "";
  if (!certDir || !fs.existsSync(path.join(certDir, "cert.pem"))) {
    fail("MVP_E2E_CERT_DIR must point at a directory containing cert.pem/key.pem (the wrapper creates one).");
  }

  buildApp("@velnox/velshop", `https://localhost:${SHOP}`);
  buildApp("@velnox/velseller", `https://localhost:${SELLER}`);
  buildApp("@velnox/velcenter", `https://localhost:${CENTER}`);

  running.push(await serveApp(path.join(ROOT, "apps/velshop/dist"), SHOP, certDir));
  running.push(await serveApp(path.join(ROOT, "apps/velseller/dist"), SELLER, certDir));
  running.push(await serveApp(path.join(ROOT, "apps/velcenter/dist"), CENTER, certDir));
  log("serving the three MVP frontends", `${SHOP}/${SELLER}/${CENTER}`);

  const seededAdmin = await createUser({ role: "admin", password: ADMIN_PASSWORD });
  console.log(`[browser-e2e] seeded admin ${seededAdmin.email} (password is test-only)`);

  browser = await chromium.launch({ headless: true });

  // ── Admin signs in through the real VelCenter UI ──────────────────────────
  const adminPage = await newPage(browser);
  await authenticate(
    adminPage,
    `https://localhost:${CENTER}`,
    "login",
    seededAdmin.email,
    ADMIN_PASSWORD,
  );
  await adminPage.waitForURL(`https://localhost:${CENTER}/`, { timeout: 20_000 });
  await waitForText(adminPage, "Marketplace overview", "admin console");
  log("admin signed in through the VelCenter UI");

  // ── Seller signs up and applies ───────────────────────────────────────────
  const sellerEmail = `browser-seller-${crypto.randomUUID().slice(0, 8)}@e2e.invalid`;
  const sellerPage = await newPage(browser);
  await authenticate(sellerPage, `https://localhost:${SELLER}`, "signup", sellerEmail, PASSWORD, "Browser Seller");
  await sellerPage.waitForURL(`https://localhost:${SELLER}/seller`, { timeout: 20_000 });
  await sellerPage.locator("#store-name").fill(STORE);
  await clickButton(sellerPage, "Submit application");
  await waitForText(sellerPage, "Your application is under review", "seller application");
  log("seller application submitted", STORE);

  // ── Admin approves the seller ─────────────────────────────────────────────
  await adminPage.goto(`https://localhost:${CENTER}/sellers`);
  await waitForText(adminPage, STORE, "seller queue");
  await clickButton(adminPage, "Approve");
  await waitForText(adminPage, "Nothing to review", "seller approval");
  log("admin approved the seller from the review queue");

  // ── Seller creates a product with a variant and submits it ────────────────
  await sellerPage.goto(`https://localhost:${SELLER}/seller`);
  await waitForText(sellerPage, STORE, "seller workspace");
  await sellerPage.goto(`https://localhost:${SELLER}/seller/products`);
  await clickButton(sellerPage, "New product");
  await sellerPage.locator("#np-name").fill(PRODUCT);
  await sellerPage.locator("#np-price").fill("250.00");
  await sellerPage.locator("#np-stock").fill("0");
  await clickButton(sellerPage, "Create draft");
  await sellerPage.getByRole("link", { name: new RegExp(PRODUCT) }).click();

  await sellerPage.getByPlaceholder("Variant name").fill("Large");
  // Exact: "Pack price" also contains "Price".
  await sellerPage.getByPlaceholder("Price", { exact: true }).fill("300.00");
  await sellerPage.getByPlaceholder("Stock", { exact: true }).fill("10");
  // Exact: "Add pack" also contains "Add".
  await sellerPage.getByRole("button", { name: "Add", exact: true }).click();
  await waitForText(sellerPage, "10 available", "variant stock");

  // ── A retail pack on the variant: 6 base units for ฿500 ──────────────────
  await sellerPage.getByPlaceholder("Label (e.g. Pack 6)").fill("Pack 6");
  await sellerPage.getByPlaceholder("Units in pack").fill("6");
  await sellerPage.getByPlaceholder("Pack price").fill("500.00");
  await clickButton(sellerPage, "Add pack");
  // The row renders the label and "6 units · <price> · active" as separate
  // nodes, so assert on the size line and then on the label itself.
  await waitForText(sellerPage, /6 units/, "pack configuration");
  await waitForText(sellerPage, "Pack 6", "pack label");
  log("seller added a 6-unit retail pack at ฿500.00 to the variant");

  await clickButton(sellerPage, "Submit for review");
  await waitForText(sellerPage, /submitted/i, "product submission");
  log("seller created a draft, added a variant + pack and submitted it");

  // ── Admin approves the product, seller publishes it ───────────────────────
  await adminPage.goto(`https://localhost:${CENTER}/products`);
  await waitForText(adminPage, PRODUCT, "product queue");
  await clickButton(adminPage, "Approve");
  await waitForText(adminPage, "Nothing to review", "product approval");
  log("admin approved the product");

  await sellerPage.reload();
  await clickButton(sellerPage, "Publish");
  await waitForText(sellerPage, /published/i, "product publication");
  log("seller published the product");

  // ── Buyer: signup → catalogue → variant → cart → checkout → order ────────
  const buyerEmail = `browser-buyer-${crypto.randomUUID().slice(0, 8)}@e2e.invalid`;
  const buyerPage = await newPage(browser);
  await authenticate(buyerPage, `https://localhost:${SHOP}`, "signup", buyerEmail, PASSWORD, "Browser Buyer");
  await buyerPage.waitForURL(`https://localhost:${SHOP}/`, { timeout: 20_000 });
  await waitForText(buyerPage, "Buy from local sellers", "storefront home");

  await buyerPage.goto(`https://localhost:${SHOP}/products`);
  await buyerPage.getByRole("link", { name: new RegExp(PRODUCT) }).click();
  await buyerPage.getByRole("button", { name: /Large/ }).click();
  await waitForText(buyerPage, /Pack 6/, "pack option on the product page");
  await buyerPage.getByRole("button", { name: /Pack 6/ }).click();
  await waitForText(buyerPage, /6 units per pack/, "pack meaning explained");
  const firstOrderUrl = await placeOrder(buyerPage, 1);
  await waitForText(buyerPage, "Awaiting payment", "order status");
  // The pack's OWN price, never 6 × the single-unit price.
  await waitForText(buyerPage, /500\.00/, "pack total from the server");
  await waitForText(buyerPage, /Pack 6/, "order item snapshot");
  await waitForText(buyerPage, /6 units/, "base units in the order line");
  const orderNumber = (await buyerPage.locator("h1").first().textContent())?.trim() ?? "";
  log("buyer completed catalogue → pack → cart → checkout", `${orderNumber} = ฿500.00`);

  const firstOrderId = new URL(buyerPage.url()).pathname.split("/").pop()!;
  const productRow = await one<{ id: string }>(`SELECT id FROM products WHERE name = $1`, [PRODUCT]);
  const variantRow = await one<{ id: string }>(
    `SELECT id FROM product_variants WHERE product_id = $1 ORDER BY sort_order LIMIT 1`,
    [productRow.id],
  );

  // The order snapshot is the durable record of WHICH pack was bought.
  const snapshot = await one<Record<string, unknown>>(
    `SELECT selling_unit_label, selling_unit_base_quantity, base_quantity_total,
            quantity, unit_price::text AS unit_price, subtotal::text AS subtotal
       FROM order_items WHERE order_id = $1`,
    [firstOrderId],
  );
  assertEqual(
    snapshot,
    {
      selling_unit_label: "Pack 6",
      selling_unit_base_quantity: 6,
      base_quantity_total: 6,
      quantity: 1,
      unit_price: "500.00",
      subtotal: "500.00",
    },
    "order_items pack snapshot",
  );

  // Stock is reserved by BASE quantity: 1 pack × 6 = 6 of the 10 units.
  const held = await one<{ quantity: number; reserved: number }>(
    `SELECT quantity, reserved FROM inventory WHERE product_id = $1 AND variant_id = $2`,
    [productRow.id, variantRow.id],
  );
  assertEqual(held, { quantity: 10, reserved: 6 }, "reservation after buying one 6-pack");
  log("checkout reserved 1 pack × 6 base units", "10 on hand, 6 reserved");

  const stockPage = await newPage(browser);
  await stockPage.goto(`https://localhost:${SHOP}/products`);
  await stockPage.getByRole("link", { name: new RegExp(PRODUCT) }).click();
  await stockPage.getByRole("button", { name: /Large/ }).click();
  await waitForText(stockPage, "4 available", "reservation visible to the next buyer");

  // ── Buyer cancels: the full 6 units come back ───────────────────────────
  await buyerPage.reload();
  await clickButton(buyerPage, "Cancel order");
  await waitForText(buyerPage, "Cancelled", "order cancellation");
  const released = await one<{ quantity: number; reserved: number }>(
    `SELECT quantity, reserved FROM inventory WHERE product_id = $1 AND variant_id = $2`,
    [productRow.id, variantRow.id],
  );
  assertEqual(released, { quantity: 10, reserved: 0 }, "release after cancelling a 6-pack order");
  await stockPage.reload();
  await stockPage.getByRole("button", { name: /Large/ }).click();
  await waitForText(stockPage, "10 available", "stock released on cancel");
  log("cancelling released the pack's 6 base units", "6 → 0 reserved");

  // ── A second pack order expires through the admin sweep ─────────────────
  await (async () => {
    await buyerPage.goto(`https://localhost:${SHOP}/products`);
    await buyerPage.getByRole("link", { name: new RegExp(PRODUCT) }).click();
    await buyerPage.getByRole("button", { name: /Large/ }).click();
    await buyerPage.getByRole("button", { name: /Pack 6/ }).click();
    return placeOrder(buyerPage, 1);
  })();
  const secondOrderId = new URL(buyerPage.url()).pathname.split("/").pop()!;
  await query(`UPDATE orders SET payment_expires_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [
    secondOrderId,
  ]);
  await adminPage.goto(`https://localhost:${CENTER}/`);
  await clickButton(adminPage, "Run expiry sweep");
  await waitForText(adminPage, "Expiry sweep finished.", "admin expiry sweep");
  await buyerPage.reload();
  await waitForText(buyerPage, "Cancelled", "expired order cancelled");
  await stockPage.reload();
  await stockPage.getByRole("button", { name: /Large/ }).click();
  await waitForText(stockPage, "10 available", "stock released on expiry");
  const expired = await one<{ quantity: number; reserved: number }>(
    `SELECT quantity, reserved FROM inventory WHERE product_id = $1 AND variant_id = $2`,
    [productRow.id, variantRow.id],
  );
  assertEqual(expired, { quantity: 10, reserved: 0 }, "release after an expired 6-pack order");
  log("admin expiry sweep cancelled the unpaid pack order and released its 6 units");

  // ── The seller sees both orders (permitted orders only) ─────────────────
  await sellerPage.goto(`https://localhost:${SELLER}/seller/orders`);
  await waitForText(sellerPage, orderNumber, "seller order list");
  log("seller sees the order that belongs to the store");
  console.log(`[browser-e2e] first order ${firstOrderUrl}`);
  console.log("\n[browser-e2e] ALL STEPS PASSED");
  exitCode = 0;
} catch (error) {
  console.error(
    `\n[browser-e2e] FAILED: ${error instanceof Error ? error.message : String(error)}`,
  );
} finally {
  await shutdown();
}

// The pg pool keeps the event loop alive by design; a harness must exit.
process.exit(exitCode);
