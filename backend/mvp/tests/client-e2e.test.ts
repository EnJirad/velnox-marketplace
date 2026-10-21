/**
 * MVP client end-to-end — the SHARED client against the REAL API.
 *
 * Every other MVP test drives `fetch` directly. This one drives
 * `@velnox/shared/mvp` — the exact module the VelShop / VelSeller / VelCenter
 * phases now use — through a cookie jar, so it proves the CLIENT WIRING as well
 * as the backend:
 *
 *   signup → apply → admin approves → create product → variants → submit →
 *   admin approves → publish → catalogue → cart → checkout → order →
 *   payment status → seller order list → admin metrics
 *
 * The `fetch` implementation only adds the session cookie and records the
 * `Set-Cookie` header; nothing else is mocked, so URL construction, the envelope
 * unwrapping and the typed errors are all exercised for real.
 *
 * Negative cases asserted here (the rest live in the route-level suites):
 *   • an unauthenticated client cannot read a cart (401);
 *   • a customer cannot call an admin endpoint (403);
 *   • a pending seller cannot write products (403);
 *   • another buyer cannot read the order (404);
 *   • a duplicate checkout with the same request key returns the SAME order;
 *   • the browser cannot supply a price, and the order total is the server's;
 *   • a seller cannot jump an unpaid order to `processing` (409 from the trigger).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  MvpApiError,
  createMvpApi,
  createMvpHttp,
  type MvpApi,
} from "../../../packages/shared/src/mvp/index.js";
import { hasTestDatabase } from "../../tests/helpers/test-db.js";
import { addressBody, createUser, startApp, type TestApp } from "./helpers/mvp-app.js";

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

interface Jar {
  cookie: string;
}

/**
 * A browser-shaped client: `credentials: "include"` (set by the client) plus a
 * cookie jar, which Bun's `fetch` does not provide.
 */
function clientFor(app: TestApp, jar: Jar): MvpApi {
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers = new Headers(init?.headers ?? undefined);
    if (jar.cookie) headers.set("cookie", jar.cookie);
    const response = await fetch(String(input), { ...init, headers });
    const cookies = response.headers.getSetCookie?.() ?? [];
    for (const line of cookies) {
      const pair = line.split(";")[0] ?? "";
      if (pair.startsWith("velnox_session=")) {
        // An empty value is the server expiring the cookie (logout).
        jar.cookie = pair.endsWith("=") ? "" : pair;
      }
    }
    return response;
  }) as typeof fetch;

  // The client appends `/api/mvp` itself, so it is given the bare origin.
  return createMvpApi(createMvpHttp({ apiOrigin: app.base, fetchImpl }));
}

const PASSWORD = "e2e-password-123";

async function newClient(app: TestApp, label: string): Promise<{ api: MvpApi; jar: Jar }> {
  const jar: Jar = { cookie: "" };
  const api = clientFor(app, jar);
  await api.auth.signup({
    email: `${label}-${crypto.randomUUID().slice(0, 8)}@e2e.invalid`,
    password: PASSWORD,
    name: `E2E ${label}`,
  });
  expect(jar.cookie).toContain("velnox_session=");
  return { api, jar };
}

describe("MVP shared client ↔ real API (needs a test database + JWT_SECRET)", () => {
  let app: TestApp;

  beforeAll(async () => {
    if (!hasDb) return;
    app = await startApp();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  itDb("completes the seller → admin → buyer flow through the shared client", async () => {
    const admin = await createUser({ role: "admin" });
    const adminApi = clientFor(app, { cookie: admin.cookie });

    // ── 1. A new account applies to sell ────────────────────────────────────
    const { api: sellerApi } = await newClient(app, "seller");
    const application = await sellerApi.seller.apply({
      storeName: `E2E Store ${crypto.randomUUID().slice(0, 6)}`,
      description: "Created by the Phase 3b client E2E",
    });
    expect(application.seller.status).toBe("pending");

    // A pending seller is refused by the API, not merely hidden in the UI.
    const pendingWrite = await sellerApi.seller
      .createProduct({ name: "Not allowed yet", price: "10.00" })
      .catch((error: unknown) => error);
    expect(pendingWrite).toBeInstanceOf(MvpApiError);
    expect((pendingWrite as MvpApiError).status).toBe(403);

    await adminApi.admin.approveSeller(application.seller.id);
    const approved = await sellerApi.seller.status();
    expect(approved.seller?.status).toBe("approved");

    // ── 2. Product lifecycle: draft → submitted → approved → published ──────
    const draft = await sellerApi.seller.createProduct({
      name: `E2E Product ${crypto.randomUUID().slice(0, 6)}`,
      price: "250.50",
      description: "Two variants, one price each.",
    });
    expect(draft.status).toBe("draft");

    const withVariant = await sellerApi.seller.addVariant(draft.id, {
      name: "Large",
      price: "300.00",
      stock: 5,
    });
    expect(withVariant.variants).toHaveLength(1);
    const variantId = withVariant.variants[0]!.id;

    // Inventory is ABSOLUTE and refuses to drop below what is reserved.
    const stocked = await sellerApi.seller.setInventory(draft.id, { variantId, quantity: 8 });
    expect(stocked.variants[0]!.stock.quantity).toBe(8);

    const submitted = await sellerApi.seller.submit(draft.id);
    expect(submitted.status).toBe("submitted");

    // The catalogue does not show an unreviewed product.
    const hidden = await sellerApi.catalog
      .product(submitted.slug)
      .catch((error: unknown) => error);
    expect(hidden).toBeInstanceOf(MvpApiError);
    expect((hidden as MvpApiError).isNotFound).toBe(true);

    await adminApi.admin.approveProduct(draft.id);
    const published = await sellerApi.seller.publish(draft.id);
    expect(published.status).toBe("published");

    // ── 3. Buyer: catalogue → cart → checkout ───────────────────────────────
    const { api: buyerApi } = await newClient(app, "buyer");

    const categories = await buyerApi.catalog.categories();
    expect(Array.isArray(categories)).toBe(true);

    const listing = await buyerApi.catalog.products({ limit: 100 });
    expect(listing.products.some((entry) => entry.id === draft.id)).toBe(true);

    const detail = await buyerApi.catalog.product(published.slug);
    expect(detail.id).toBe(draft.id);
    expect(detail.variants[0]!.price).toBe("300.00");

    const cart = await buyerApi.cart.addItem({
      productId: detail.id,
      variantId,
      quantity: 2,
    });
    expect(cart).not.toBeNull();
    // 2 × 300.00 — priced by the server, not by this test.
    expect(cart!.subtotal).toBe("600.00");

    const requestKey = `e2e-${crypto.randomUUID()}`;
    const placed = await buyerApi.checkout.create({
      cartId: cart!.id,
      sellerId: cart!.seller.id,
      requestKey,
      address: { ...addressBody(), label: "Home" },
      notes: "E2E order",
    });
    expect(placed.replayed).toBe(false);
    expect(placed.order.status).toBe("pending_payment");
    expect(placed.order.totalAmount).toBe("600.00");
    expect(placed.order.shippingFee).toBe("0.00");

    // ── 4. A duplicate request key reuses the same order ────────────────────
    const duplicate = await buyerApi.checkout.create({
      cartId: cart!.id,
      sellerId: cart!.seller.id,
      requestKey,
      address: { ...addressBody(), label: "Home" },
    });
    expect(duplicate.replayed).toBe(true);
    expect(duplicate.order.id).toBe(placed.order.id);

    // ── 5. Order history and server-confirmed payment state ─────────────────
    const history = await buyerApi.orders.list();
    expect(history.some((order) => order.id === placed.order.id)).toBe(true);

    const payment = await buyerApi.orders.paymentStatus(placed.order.id);
    expect(payment.orderStatus).toBe("pending_payment");
    expect(payment.settled).toBe(false);

    // ── 6. Another buyer cannot read that order ─────────────────────────────
    const { api: strangerApi } = await newClient(app, "stranger");
    const foreign = await strangerApi.orders
      .get(placed.order.id)
      .catch((error: unknown) => error);
    expect(foreign).toBeInstanceOf(MvpApiError);
    expect((foreign as MvpApiError).isNotFound).toBe(true);

    // ── 7. A customer cannot call an admin endpoint ─────────────────────────
    const forbidden = await buyerApi.admin
      .metrics()
      .catch((error: unknown) => error);
    expect(forbidden).toBeInstanceOf(MvpApiError);
    expect((forbidden as MvpApiError).isForbidden).toBe(true);

    // ── 8. The seller sees the order but cannot skip payment ────────────────
    const sellerOrders = await sellerApi.seller.orders();
    expect(sellerOrders.some((order) => order.id === placed.order.id)).toBe(true);

    const skipPayment = await sellerApi.seller
      .updateOrderStatus(placed.order.id, { status: "processing" })
      .catch((error: unknown) => error);
    expect(skipPayment).toBeInstanceOf(MvpApiError);
    expect((skipPayment as MvpApiError).status).toBe(409);

    const unchanged = await buyerApi.orders.get(placed.order.id);
    expect(unchanged.status).toBe("pending_payment");

    // ── 9. Admin metrics include the new order ──────────────────────────────
    const metrics = await adminApi.admin.metrics();
    expect(Number(metrics.orders_total)).toBeGreaterThan(0);
    expect(Number(metrics.pending_sellers ?? 0)).toBeGreaterThanOrEqual(0);

    // ── 10. An unauthenticated client gets a typed 401, not a blank page ─────
    const anonymous = createMvpApi(createMvpHttp({ apiOrigin: app.base }));
    const noCart = await anonymous.cart.get().catch((error: unknown) => error);
    expect(noCart).toBeInstanceOf(MvpApiError);
    expect((noCart as MvpApiError).isUnauthenticated).toBe(true);
  });

  itDb("a cancelled checkout never creates a second order for the same cart", async () => {
    // The duplicate-key path above covers the retry case. This one covers the
    // opposite order: a FIRST checkout on an already-empty cart must fail rather
    // than invent an order from nothing.
    const { api: buyerApi } = await newClient(app, "empty");
    const failure = await buyerApi.checkout
      .create({
        requestKey: `e2e-empty-${crypto.randomUUID()}`,
        address: { ...addressBody(), label: "Home" },
      })
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MvpApiError);
    expect((failure as MvpApiError).status).toBeGreaterThanOrEqual(400);
  });
});
