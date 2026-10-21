/**
 * MVP HTTP client + endpoint contract tests.
 *
 * A fake `fetch` captures the request instead of reaching a network, so these
 * assertions cover exactly what the browser will send: URL, method, cookie
 * credentials, headers, body and the error mapping.
 */
import { describe, expect, test } from "bun:test";
import { MvpApiError, createMvpHttp } from "../src/mvp/client.js";
import { createMvpApi } from "../src/mvp/api.js";
import { MVP_ROUTES } from "../src/mvp/routes.js";

const ORIGIN = "https://api.velnox.test";

interface Call {
  url: string;
  init: RequestInit;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function fakeFetch(
  handler: (call: Call) => Response | Promise<Response>,
): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const call = { url: String(input), init: init ?? {} };
    calls.push(call);
    return handler(call);
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe("URL construction and credentials", () => {
  test("every request targets /api/mvp exactly once, with the session cookie", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse({ success: true, data: { categories: [] } }),
    );
    const http = createMvpHttp({ apiOrigin: ORIGIN, fetchImpl });

    await http.request(MVP_ROUTES.catalog.categories);

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${ORIGIN}/api/mvp/categories`);
    expect(calls[0]!.init.credentials).toBe("include");
    expect(calls[0]!.init.method).toBe("GET");
    expect(calls[0]!.init.body).toBeUndefined();
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.Accept).toBe("application/json");
    // A GET without a body must not advertise a JSON content type.
    expect(headers["Content-Type"]).toBeUndefined();
  });

  test("an origin with a trailing slash does not produce a double slash", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse({ success: true, data: { orders: [] } }),
    );
    const http = createMvpHttp({ apiOrigin: `${ORIGIN}/`, fetchImpl });
    await http.request(MVP_ROUTES.orders.root);
    expect(calls[0]!.url).toBe(`${ORIGIN}/api/mvp/orders`);
  });

  test("mutations send JSON and the parsed envelope's data", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse({ success: true, data: { user: { id: "u1" } } }, 201),
    );
    const http = createMvpHttp({ apiOrigin: ORIGIN, fetchImpl });

    const data = await http.request<{ user: { id: string } }>(MVP_ROUTES.auth.login, {
      method: "POST",
      body: { email: "a@b.co", password: "secret-value" },
    });

    expect(data.user.id).toBe("u1");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      email: "a@b.co",
      password: "secret-value",
    });
  });

  test("path parameters are URL-encoded", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse({ success: true, data: { product: {} } }),
    );
    const http = createMvpHttp({ apiOrigin: ORIGIN, fetchImpl });
    await http.request(MVP_ROUTES.catalog.product("a b/c?d"));
    expect(calls[0]!.url).toBe(`${ORIGIN}/api/mvp/products/a%20b%2Fc%3Fd`);
  });
});

describe("error handling", () => {
  test("the backend error envelope becomes a typed MvpApiError", async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse(
        { success: false, error: { code: "SELLER_NOT_APPROVED", message: "Approved sellers only" } },
        403,
      ),
    );
    const http = createMvpHttp({ apiOrigin: ORIGIN, fetchImpl });

    const error = await http.request(MVP_ROUTES.seller.products).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(MvpApiError);
    const apiError = error as MvpApiError;
    expect(apiError.status).toBe(403);
    expect(apiError.code).toBe("SELLER_NOT_APPROVED");
    expect(apiError.message).toBe("Approved sellers only");
    expect(apiError.isForbidden).toBe(true);
    expect(apiError.isUnauthenticated).toBe(false);
  });

  test("401 is reported as unauthenticated without leaking a body", async () => {
    const { fetchImpl } = fakeFetch(() =>
      jsonResponse({ success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } }, 401),
    );
    const http = createMvpHttp({ apiOrigin: ORIGIN, fetchImpl });
    const error = (await http.request(MVP_ROUTES.cart.root).catch((e) => e)) as MvpApiError;
    expect(error.isUnauthenticated).toBe(true);
    expect(error.message).not.toContain("cookie");
  });

  test("a non-JSON error response still yields a typed error", async () => {
    const { fetchImpl } = fakeFetch(() => new Response("<html>oops</html>", { status: 502 }));
    const http = createMvpHttp({ apiOrigin: ORIGIN, fetchImpl });
    const error = (await http.request(MVP_ROUTES.orders.root).catch((e) => e)) as MvpApiError;
    expect(error).toBeInstanceOf(MvpApiError);
    expect(error.status).toBe(502);
    expect(error.code).toBe("HTTP_502");
  });

  test("a transport failure is status 0 / NETWORK_ERROR", async () => {
    const fetchImpl = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof fetch;
    const http = createMvpHttp({ apiOrigin: ORIGIN, fetchImpl });
    const error = (await http.request(MVP_ROUTES.orders.root).catch((e) => e)) as MvpApiError;
    expect(error.status).toBe(0);
    expect(error.code).toBe("NETWORK_ERROR");
  });

  test("a hung request is bounded by the timeout", async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;

    const http = createMvpHttp({ apiOrigin: ORIGIN, fetchImpl, timeoutMs: 20 });
    const error = (await http.request(MVP_ROUTES.orders.root).catch((e) => e)) as MvpApiError;
    expect(error).toBeInstanceOf(MvpApiError);
    expect(error.code).toBe("TIMEOUT");
    expect(error.status).toBe(0);
  });

  test("a caller abort is propagated, not disguised as a timeout", async () => {
    const fetchImpl = ((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
      })) as typeof fetch;

    const http = createMvpHttp({ apiOrigin: ORIGIN, fetchImpl, timeoutMs: 5_000 });
    const controller = new AbortController();
    const pending = http.request(MVP_ROUTES.orders.root, { signal: controller.signal });
    controller.abort();
    const error = await pending.catch((e: unknown) => e);
    expect(error).not.toBeInstanceOf(MvpApiError);
    expect((error as Error).name).toBe("AbortError");
  });
});

describe("endpoint wrappers", () => {
  test("catalogue queries are serialised and defaults omitted", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse({ success: true, data: { products: [], pagination: { page: 1, limit: 20, total: 0 } } }),
    );
    const api = createMvpApi(createMvpHttp({ apiOrigin: ORIGIN, fetchImpl }));

    await api.catalog.products({ q: "rice cooker", category: "home", page: 2 });
    const url = new URL(calls[0]!.url);
    expect(url.pathname).toBe("/api/mvp/products");
    expect(url.searchParams.get("q")).toBe("rice cooker");
    expect(url.searchParams.get("category")).toBe("home");
    expect(url.searchParams.get("page")).toBe("2");
    expect(url.searchParams.has("limit")).toBe(false);
    expect(url.searchParams.has("seller")).toBe(false);
  });

  test("cart mutations hit the item routes with only the ids and quantity", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse({ success: true, data: { cart: null } }),
    );
    const api = createMvpApi(createMvpHttp({ apiOrigin: ORIGIN, fetchImpl }));

    // A tampered price is never part of the request: the server prices the line.
    await api.cart.addItem({ productId: "p1", variantId: "v1", quantity: 2 });
    await api.cart.updateItem("item 1", 3);
    await api.cart.removeItem("item-2");

    expect(calls[0]!.url).toBe(`${ORIGIN}/api/mvp/cart/items`);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({
      productId: "p1",
      variantId: "v1",
      quantity: 2,
    });
    expect(calls[1]!.url).toBe(`${ORIGIN}/api/mvp/cart/items/item%201`);
    expect(calls[1]!.init.method).toBe("PATCH");
    expect(calls[2]!.url).toBe(`${ORIGIN}/api/mvp/cart/items/item-2`);
    expect(calls[2]!.init.method).toBe("DELETE");
  });

  test("checkout sends the idempotency key and the address snapshot", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse({ success: true, data: { order: { id: "o1" }, replayed: false } }, 201),
    );
    const api = createMvpApi(createMvpHttp({ apiOrigin: ORIGIN, fetchImpl }));

    await api.checkout.create({
      cartId: "c1",
      requestKey: "checkout-key-1234",
      address: {
        label: "Home",
        recipientName: "Somchai",
        phone: "0800000000",
        line1: "1 Moo 1",
        line2: null,
        subdistrict: null,
        district: null,
        city: "Chiang Mai",
        state: "Chiang Mai",
        postalCode: "50000",
        country: "TH",
      },
    });

    const body = JSON.parse(String(calls[0]!.init.body));
    expect(calls[0]!.url).toBe(`${ORIGIN}/api/mvp/checkout`);
    expect(body.requestKey).toBe("checkout-key-1234");
    expect(body.cartId).toBe("c1");
    expect(body.address.country).toBe("TH");
    expect(body.total).toBeUndefined();
    expect(body.amount).toBeUndefined();
  });

  test("payment status reads the server, never the redirect", async () => {
    const { fetchImpl, calls } = fakeFetch(() =>
      jsonResponse({
        success: true,
        data: { orderId: "o1", orderStatus: "pending_payment", paymentStatus: "requires_action", paidAt: null, settled: false },
      }),
    );
    const api = createMvpApi(createMvpHttp({ apiOrigin: ORIGIN, fetchImpl }));
    const status = await api.orders.paymentStatus("o1");
    expect(calls[0]!.url).toBe(`${ORIGIN}/api/mvp/orders/o1/payment-status`);
    expect(status.settled).toBe(false);
    expect(status.orderStatus).toBe("pending_payment");
  });

  test("admin and seller routes keep their own namespace", async () => {
    const { fetchImpl, calls } = fakeFetch(() => jsonResponse({ success: true, data: {} }));
    const api = createMvpApi(createMvpHttp({ apiOrigin: ORIGIN, fetchImpl }));

    await api.admin.approveSeller("s1");
    await api.admin.rejectProduct("p1", "Please add a clearer photo");
    await api.seller.setInventory("p1", { variantId: null, quantity: 12 });
    await api.seller.updateOrderStatus("o1", { status: "shipped", carrier: "Flash", trackingNumber: "T1" });

    expect(calls.map((c) => `${c.init.method} ${new URL(c.url).pathname}`)).toEqual([
      "POST /api/mvp/admin/sellers/s1/approve",
      "POST /api/mvp/admin/products/p1/reject",
      "PUT /api/mvp/seller/products/p1/inventory",
      "PATCH /api/mvp/seller/orders/o1/status",
    ]);
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({
      reason: "Please add a clearer photo",
    });
    expect(JSON.parse(String(calls[2]!.init.body))).toEqual({ variantId: null, quantity: 12 });
    expect(JSON.parse(String(calls[3]!.init.body))).toEqual({
      status: "shipped",
      carrier: "Flash",
      trackingNumber: "T1",
    });
  });

  test("a 204 response is not parsed as JSON", async () => {
    const { fetchImpl } = fakeFetch(() => new Response(null, { status: 204 }));
    const http = createMvpHttp({ apiOrigin: ORIGIN, fetchImpl });
    await expect(http.request(MVP_ROUTES.orders.root, { method: "DELETE" })).resolves.toBeUndefined();
  });
});
