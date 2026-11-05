/**
 * SHIPPING QUOTE — the pricing contract, pinned.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Every order in this marketplace used to be written with `shipping_fee = 0`
 * and the checkout screen printed a hard-coded "free shipping" row. The fix is
 * only real if the RULES are pinned by executable checks, so this file asserts
 * the contract directly against `backend/lib/shipping.ts`:
 *
 *   1. A shop with no configured fee is priced at the platform default — never
 *      at 0, because a misconfiguration must not read as free delivery.
 *   2. Free delivery happens only when the shop says 0, or when the shop's own
 *      threshold is reached — and the REASON is reported.
 *   3. Money is exact: `19.99 × 3 + 50.00` is `109.97`, not a float artefact.
 *   4. The fingerprint changes whenever the cart, a price, a quantity or the
 *      address changes, which is what makes a stale quote unusable.
 *   5. The endpoint refuses a client-supplied fee outright.
 *
 * Tests 1–10 need no database. The route-level checks (client-supplied money)
 * are refusals that happen before any query, so they run everywhere.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";

import {
  PLATFORM_DEFAULT_FLAT_FEE,
  SHIPPING_METHOD,
  SHIPPING_QUOTE_TTL_MINUTES,
  ShippingError,
  buildShippingQuote,
  computeShopShipping,
  isSupportedDestination,
  platformDefaultFee,
  shippingFingerprint,
  shippingQuoteExpiry,
  type QuotedLine,
  type ShopShippingConfig,
} from "../lib/shipping.js";
import { parseDecimal } from "../lib/money.js";
import { setupShippingRoutes } from "../routes/shipping.js";
import { setupCartRoutes } from "../routes/cart.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const SHOP_A = "11111111-1111-4111-8111-111111111111";
const SHOP_B = "22222222-2222-4222-8222-222222222222";
const ADDRESS = "33333333-3333-4333-8333-333333333333";
const PRODUCT = "44444444-4444-4444-8444-444444444444";

function shop(id: string, fee: string | null, threshold: string | null = null): ShopShippingConfig {
  return { shopId: id, shopName: `Shop ${id.slice(0, 4)}`, shippingFee: fee, freeShippingThreshold: threshold };
}

function line(overrides: Partial<QuotedLine> = {}): QuotedLine {
  return {
    productId: PRODUCT,
    variantId: null,
    shopId: SHOP_A,
    shopName: "Shop A",
    quantity: 1,
    unitPrice: "100.00",
    ...overrides,
  };
}

describe("the shipping rule (computeShopShipping)", () => {
  const subtotal = (value: string) => parseDecimal(value);

  test("an unconfigured shop is priced at the platform default, never 0", () => {
    const { fee, reason } = computeShopShipping(shop(SHOP_A, null), subtotal("100.00"));
    expect(reason).toBe("platform_default");
    expect(fee).toEqual(parseDecimal(PLATFORM_DEFAULT_FLAT_FEE));
    expect(`35.00`).toBe(PLATFORM_DEFAULT_FLAT_FEE);
  });

  test("a configured flat fee is used as stored", () => {
    const { fee, reason } = computeShopShipping(shop(SHOP_A, "35.50"), subtotal("100.00"));
    expect(reason).toBe("shop_flat_rate");
    expect(fee).toEqual(parseDecimal("35.50"));
  });

  test("an explicit 0 means the seller ships free (and says so)", () => {
    const { fee, reason } = computeShopShipping(shop(SHOP_A, "0.00"), subtotal("100.00"));
    expect(reason).toBe("seller_free_shipping");
    expect(fee.num).toBe(0n);
  });

  test("a free-shipping threshold grants free delivery at or above it", () => {
    const below = computeShopShipping(shop(SHOP_A, "50.00", "1000.00"), subtotal("999.99"));
    expect(below.reason).toBe("shop_flat_rate");
    expect(below.fee).toEqual(parseDecimal("50.00"));

    const at = computeShopShipping(shop(SHOP_A, "50.00", "1000.00"), subtotal("1000.00"));
    expect(at.reason).toBe("free_shipping_threshold");
    expect(at.fee.num).toBe(0n);
  });

  test("a negative stored fee is treated as corrupt config, not a discount", () => {
    const { fee, reason } = computeShopShipping(shop(SHOP_A, "-10.00"), subtotal("100.00"));
    expect(reason).toBe("platform_default");
    expect(fee.num).toBeGreaterThan(0n);
  });

  test("only Thailand is priceable by the implemented rule", () => {
    expect(isSupportedDestination("TH")).toBe(true);
    expect(isSupportedDestination("th")).toBe(true);
    expect(isSupportedDestination("MM")).toBe(false);
    expect(isSupportedDestination(null)).toBe(false);
  });
});

describe("the quote (buildShippingQuote)", () => {
  test("one shop: subtotal + delivery = total, in exact decimals", () => {
    const quote = buildShippingQuote(
      [line({ quantity: 3, unitPrice: "19.99" })],
      [shop(SHOP_A, "50.00")],
    );
    expect(SHIPPING_METHOD).toBe(quote.method);
    expect(quote.subtotal).toBe("59.97");
    expect(quote.shippingTotal).toBe("50.00");
    expect(quote.discount).toBe("0.00");
    expect(quote.total).toBe("109.97");
    expect(quote.shops).toHaveLength(1);
    expect(quote.shops[0]!.shippingFee).toBe("50.00");
    expect(quote.shops[0]!.itemCount).toBe(3);
  });

  test("no float drift: 0.10 × 3 + 0.20 is 0.50", () => {
    const quote = buildShippingQuote(
      [line({ unitPrice: "0.10", quantity: 3 })],
      [shop(SHOP_A, "0.20")],
    );
    expect(quote.subtotal).toBe("0.30");
    expect(quote.total).toBe("0.50");
  });

  test("half-up rounding happens once, at the stored precision", () => {
    // 33.335 is not a storable price, but 33.33 × 3 = 99.99 must not become 100.
    const quote = buildShippingQuote([line({ unitPrice: "33.33", quantity: 3 })], [shop(SHOP_A, "0.00")]);
    expect(quote.subtotal).toBe("99.99");
    expect(quote.total).toBe("99.99");
  });

  test("multiple shops are charged one delivery each, and totals add up", () => {
    const quote = buildShippingQuote(
      [
        line({ shopId: SHOP_A, quantity: 1, unitPrice: "100.00" }),
        line({ shopId: SHOP_B, productId: randomUUID(), quantity: 2, unitPrice: "25.50" }),
      ],
      [shop(SHOP_A, "50.00"), shop(SHOP_B, "30.00")],
    );
    expect(quote.shops).toHaveLength(2);
    expect(quote.subtotal).toBe("151.00");
    expect(quote.shippingTotal).toBe("80.00");
    expect(quote.total).toBe("231.00");
    expect(quote.shops.map((s) => s.shippingFee)).toEqual(["50.00", "30.00"]);
  });

  test("free delivery is reported as free, not as a missing fee", () => {
    const quote = buildShippingQuote([line({ quantity: 5, unitPrice: "250.00" })], [shop(SHOP_A, "50.00", "1000.00")]);
    expect(quote.shippingTotal).toBe("0.00");
    expect(quote.shops[0]!.freeShipping).toBe(true);
    expect(quote.shops[0]!.reason).toBe("free_shipping_threshold");
  });

  test("an empty cart cannot be priced at 0 — it is refused", () => {
    expect(() => buildShippingQuote([], [shop(SHOP_A, "50.00")])).toThrow(ShippingError);
  });

  test("an invalid quantity is refused", () => {
    expect(() => buildShippingQuote([line({ quantity: 0 })], [shop(SHOP_A, "50.00")])).toThrow(ShippingError);
    expect(() => buildShippingQuote([line({ quantity: 1.5 })], [shop(SHOP_A, "50.00")])).toThrow(ShippingError);
  });

  test("a negative unit price is refused", () => {
    expect(() => buildShippingQuote([line({ unitPrice: "-1.00" })], [shop(SHOP_A, "50.00")])).toThrow(ShippingError);
  });
});

describe("the fingerprint (quote ↔ cart consistency)", () => {
  const base = [line({ quantity: 2, unitPrice: "10.00" })];

  test("is stable regardless of the order rows arrive in", () => {
    const a = [line({ shopId: SHOP_A }), line({ shopId: SHOP_B, productId: randomUUID() })];
    const b = [...a].reverse();
    expect(shippingFingerprint(a, ADDRESS)).toBe(shippingFingerprint(b, ADDRESS));
  });

  test("changes when the quantity changes", () => {
    expect(shippingFingerprint(base, ADDRESS)).not.toBe(shippingFingerprint([line({ quantity: 3 })], ADDRESS));
  });

  test("changes when the server price changes", () => {
    expect(shippingFingerprint(base, ADDRESS)).not.toBe(
      shippingFingerprint([line({ quantity: 2, unitPrice: "11.00" })], ADDRESS),
    );
  });

  test("changes when the address changes", () => {
    expect(shippingFingerprint(base, ADDRESS)).not.toBe(shippingFingerprint(base, randomUUID()));
    expect(shippingFingerprint(base, ADDRESS)).not.toBe(shippingFingerprint(base, null));
  });

  test("normalises the price so 10 and 10.00 are the same cart", () => {
    expect(shippingFingerprint([line({ unitPrice: "10" })], ADDRESS)).toBe(
      shippingFingerprint([line({ unitPrice: "10.00" })], ADDRESS),
    );
  });
});

describe("platform configuration", () => {
  const original = process.env.SHIPPING_FLAT_FEE_THB;
  afterEach(() => {
    if (original === undefined) delete process.env.SHIPPING_FLAT_FEE_THB;
    else process.env.SHIPPING_FLAT_FEE_THB = original;
  });

  test("defaults to the documented value when unset", () => {
    delete process.env.SHIPPING_FLAT_FEE_THB;
    expect(platformDefaultFee()).toBe(PLATFORM_DEFAULT_FLAT_FEE);
  });

  test("honours a configured value", () => {
    process.env.SHIPPING_FLAT_FEE_THB = "65.5";
    expect(platformDefaultFee()).toBe("65.50");
  });

  test("a malformed value falls back to the default, never to 0", () => {
    process.env.SHIPPING_FLAT_FEE_THB = "free";
    expect(platformDefaultFee()).toBe(PLATFORM_DEFAULT_FLAT_FEE);
    process.env.SHIPPING_FLAT_FEE_THB = "-5";
    expect(platformDefaultFee()).toBe(PLATFORM_DEFAULT_FLAT_FEE);
  });

  test("a quote expires after the documented TTL", () => {
    const now = new Date("2026-01-01T00:00:00.000Z");
    expect(shippingQuoteExpiry(now).toISOString()).toBe("2026-01-01T00:15:00.000Z");
    expect(SHIPPING_QUOTE_TTL_MINUTES).toBe(15);
  });
});

/* ── Route-level refusals (no database involved) ───────────────────────── */

function authCookie(userId = randomUUID()): string {
  const token = jwt.sign({ userId, email: `${userId}@test.local` }, process.env.JWT_SECRET!, { expiresIn: "1h" });
  return `velnox_session=${token}`;
}

async function withServer<T>(setup: (app: express.Express) => void, fn: (base: string) => Promise<T>): Promise<T> {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  setup(app);
  const server = app.listen(0);
  const port = (server.address() as { port: number }).port;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
}

async function post(base: string, path: string, body: unknown, cookie: string) {
  const res = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  const parsed = (await res.json()) as { success?: boolean; error?: { code?: string }; data?: Record<string, unknown> };
  return { status: res.status, code: parsed.error?.code, data: parsed.data };
}

describe("a client can never state a price", () => {
  let cookie: string;
  beforeEach(() => {
    cookie = authCookie();
  });

  const refusals: Array<[string, unknown]> = [
    ["shippingFee = 0", { shippingFee: 0 }],
    ["shippingFee = 1", { shippingFee: 1 }],
    ["shipping_fee", { shipping_fee: "0.00" }],
    ["total", { total: 1 }],
    ["totalAmount", { totalAmount: 1 }],
    ["amount", { amount: 1 }],
    ["subtotal", { subtotal: 1 }],
    ["discount", { discount: 1 }],
  ];

  for (const [label, extra] of refusals) {
    test(`checkout refuses ${label}`, async () => {
      await withServer((app) => {
        // Cart routes only; the refusal happens before any cart/database read.
        setupCartRoutes(app);
      }, async (base) => {
        const res = await post(base, "/api/customer/checkout", { paymentMethod: "CARD", ...(extra as object) }, cookie);
        expect(res.status).toBe(400);
        expect(res.code).toBe("CLIENT_AMOUNT_NOT_ACCEPTED");
      });
    });
  }

  test("the quote endpoint refuses a client-supplied fee", async () => {
    await withServer(setupShippingRoutes, async (base) => {
      const res = await post(
        base,
        "/api/customer/shipping/quote",
        { addressId: ADDRESS, shippingTotal: 0, shippingFee: 0 },
        cookie,
      );
      expect(res.status).toBe(400);
      expect(res.code).toBe("CLIENT_AMOUNT_NOT_ACCEPTED");
    });
  });

  test("the quote endpoint requires an address before it will price anything", async () => {
    await withServer(setupShippingRoutes, async (base) => {
      const res = await post(base, "/api/customer/shipping/quote", {}, cookie);
      expect(res.status).toBe(400);
      expect(res.code).toBe("ADDRESS_REQUIRED");
    });
  });
});
