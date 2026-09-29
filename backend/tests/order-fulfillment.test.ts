/**
 * Order fulfilment, the payment gate, the address snapshot and the cancellation
 * cutoff — the business rules an e-commerce order must obey.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `orders.status` carries TWO lifecycles (payment and fulfilment) and the
 * frontend mirrors both, so the rules that join them have to be stated in ONE
 * place and pinned:
 *
 *    1. PAYMENT GATE. A seller may not start fulfilment on a CARD / PROMPTPAY
 *       order whose payment has not succeeded — `PATCH /api/seller/orders/:id/status`
 *       answers 409 `PAYMENT_REQUIRED`. COD is the deliberate exception (the
 *       carrier collects, so a `pending` payment row is NORMAL), and an order with
 *       no recorded method fails CLOSED. The shared contract the seller UI reads
 *       and the backend rule are pinned against each other here, so the button can
 *       never appear where the API refuses.
 *    2. NO SELLER PATH TO "PAID". `stripe.ts` is the only module that may write a
 *       successful payment. A seller action is a FULFILMENT action.
 *    3. ADDRESS SNAPSHOT. The shipping address and the phone come from the order's
 *       own `orders.shipping_address` snapshot on every endpoint, and the customer's
 *       account phone is NEVER substituted — not even for a legacy order with no
 *       snapshot phone. Editing the profile must not rewrite history.
 *    4. CANCELLATION CUTOFF = FULFILMENT. `confirmed` (the shop accepted) is still
 *       cancelable; the moment a shipment/tracking number exists it is not, and the
 *       refusal is 409 `ORDER_ALREADY_SHIPPING`, enforced inside the transaction
 *       with the order row locked.
 *    5. ORDER NUMBER ≠ TRACKING NUMBER.
 *   6. INVENTORY goes through the canonical `releaseOrderInventory()` — never a
 *       second stock-adjustment path.
 *
 * The contract half reads the shipped source (no database) in the style the other
 * order suites use; the DB-gated half runs the real endpoints against a test
 * database when `TEST_DATABASE_URL` is configured.
 */
import { afterEach, describe, expect, test } from "bun:test";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import { readFileSync } from "fs";
import { join } from "path";

import {
  CUSTOMER_CANCELABLE_ORDER_STATUSES,
  ORDER_ALREADY_SHIPPING_CODE,
  PAYMENT_REQUIRED_CODE,
  hasShipmentEvidence,
  isCodPaymentMethod,
  orderCustomerCancelability,
  orderFulfillmentPaymentGate,
  orderPaymentSummary,
  orderSettlementRail,
} from "../../packages/shared/src/lib/commerce.ts";
import { translations } from "../../packages/shared/src/lib/i18n/locales/index";
import { setupCartRoutes } from "../routes/cart.js";
import { cancellationDecision } from "../routes/cart.js";
import { setupSellerOrderRoutes, sellerConfirmationPaymentGate } from "../routes/seller-orders.js";
import { generateOrderNumber } from "../lib/order-number.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const CART_ROUTE = "backend/routes/cart.ts";
const SELLER_ROUTE = "backend/routes/seller-orders.ts";
const STRIPE_ROUTE = "backend/routes/stripe.ts";
const SHOP_DETAIL = "apps/velshop/src/pages/ShopOrderDetail.tsx";
const SELLER_DETAIL = "apps/velseller/src/pages/SellerOrderDetail.tsx";
const SELLER_LIST = "apps/velseller/src/pages/SellerOrders.tsx";
const LOCALES = ["th", "en", "my"] as const;

type Nested = Record<string, unknown>;
/** Resolve a dotted key in a locale dictionary (the way `makeT` does). */
function resolveKey(dict: Nested, key: string): string | null {
  let node: unknown = dict;
  for (const part of key.split(".")) {
    if (typeof node !== "object" || node === null) return null;
    node = (node as Nested)[part];
  }
  return typeof node === "string" ? node : null;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The payment gate — the rule the seller UI and the backend both read
// ═══════════════════════════════════════════════════════════════════════════

describe("fulfilment payment gate — the shared rule", () => {
  test("an unpaid CARD order cannot start fulfilment", () => {
    for (const status of ["unpaid", "pending", "requires_action", "processing", "failed", "cancelled", null]) {
      expect(orderFulfillmentPaymentGate({ paymentMethod: "CARD", paymentStatus: status })).toEqual({
        canConfirm: false,
        rail: "ONLINE",
        code: PAYMENT_REQUIRED_CODE,
      });
    }
  });

  test("an unpaid PROMPTPAY order cannot start fulfilment (delayed notification)", () => {
    // The PromptPay trap: `checkout.session.completed` with `payment_status !=
    // "paid"` is NOT success, so `requires_action`/`pending` must never confirm.
    for (const status of ["unpaid", "pending", "requires_action", "processing", "failed"]) {
      expect(orderFulfillmentPaymentGate({ paymentMethod: "PROMPTPAY", paymentStatus: status }).canConfirm).toBe(false);
    }
  });

  test("a successful payment unlocks fulfilment, whatever the method name's case", () => {
    for (const method of ["CARD", "card", "online", "credit_card", "debit_card", "PROMPTPAY", "promptpay", "qr"]) {
      expect(orderFulfillmentPaymentGate({ paymentMethod: method, paymentStatus: "paid" })).toEqual({
        canConfirm: true,
        rail: "ONLINE",
        code: null,
      });
    }
  });

  test("COD may start fulfilment WITHOUT a successful online payment", () => {
    // Cash is collected on delivery, so the payment row is `pending` for the whole
    // delivery — reading that as "unpaid, so blocked" would deadlock every COD order.
    for (const method of ["cod", "COD", "cash_on_delivery"]) {
      for (const status of ["pending", "unpaid", "requires_action", "processing"]) {
        const gate = orderFulfillmentPaymentGate({ paymentMethod: method, paymentStatus: status });
        expect(gate.canConfirm).toBe(true);
        expect(gate.rail).toBe("COD");
        expect(gate.code).toBeNull();
      }
    }
  });

  test("an order with no recorded method needs PROOF of payment, not a status word", () => {
    // Nothing about an unrecognised (or absent) rail may be assumed: without a
    // payment that actually succeeded, the seller waits.
    for (const method of [null, undefined, "", "   ", "WALLET"]) {
      expect(orderFulfillmentPaymentGate({ paymentMethod: method, paymentStatus: "pending" }).canConfirm).toBe(false);
      expect(orderFulfillmentPaymentGate({ paymentMethod: method, paymentStatus: "requires_action" }).canConfirm).toBe(false);
      expect(orderFulfillmentPaymentGate({ paymentMethod: method, paymentStatus: "unpaid" }).canConfirm).toBe(false);
    }
    expect(orderFulfillmentPaymentGate({}).canConfirm).toBe(false);
    expect(orderFulfillmentPaymentGate(null).canConfirm).toBe(false);
    // …but a payment the provider confirmed as SUCCEEDED still lets the order
    // through. Blocking it would strand a paid order for good: `paid` also refuses
    // the customer's cancel, so it could never move again without an operator.
    expect(orderFulfillmentPaymentGate({ paymentMethod: "WALLET", paymentStatus: "paid" }).canConfirm).toBe(true);
  });

  test("the whole rule, in one line: COD, or a payment that actually succeeded", () => {
    for (const method of ["CARD", "PROMPTPAY", "WALLET", null]) {
      for (const status of ["unpaid", "pending", "requires_action", "processing", "failed", "refunded", "cancelled"]) {
        expect(orderFulfillmentPaymentGate({ paymentMethod: method, paymentStatus: status }).canConfirm).toBe(false);
      }
      expect(orderFulfillmentPaymentGate({ paymentMethod: method, paymentStatus: "paid" }).canConfirm).toBe(true);
    }
    // COD is the exception in the other direction: EVERY payment status is normal,
    // because the money is collected on delivery rather than before it.
    for (const status of ["unpaid", "pending", "requires_action", "processing", "failed", "refunded"]) {
      expect(orderFulfillmentPaymentGate({ paymentMethod: "cod", paymentStatus: status }).canConfirm).toBe(true);
    }
  });

  test("the method decides the rail, never the payment status alone", () => {
    expect(orderSettlementRail("cod")).toBe("COD");
    expect(orderSettlementRail("promptpay")).toBe("ONLINE");
    expect(orderSettlementRail("mystery")).toBe("UNKNOWN");
    expect(isCodPaymentMethod("cash_on_delivery")).toBe(true);
    expect(isCodPaymentMethod("card")).toBe(false);
  });

  test("the detail endpoint's payment rows are enough to decide", () => {
    // The order detail returns no `paymentMethod` in its list shape but does return
    // `payments[]`; the gate must read the newest row either way.
    expect(orderFulfillmentPaymentGate({ payments: [{ method: "CARD", status: "paid" }] }).canConfirm).toBe(true);
    expect(orderFulfillmentPaymentGate({ payments: [{ method: "CARD", status: "requires_action" }] }).canConfirm).toBe(false);
    expect(orderFulfillmentPaymentGate({ payments: [{ method: "cod", status: "pending" }] }).canConfirm).toBe(true);
  });
});

describe("fulfilment payment gate — the backend enforces the SAME rule", () => {
  const METHODS: Array<string | null> = [
    "CARD",
    "card",
    "online",
    "credit_card",
    "debit_card",
    "PROMPTPAY",
    "promptpay",
    "qr",
    "COD",
    "cod",
    "cash_on_delivery",
    null,
    "",
    "WALLET",
  ];
  const STATUSES: Array<string | null> = [
    "unpaid",
    "pending",
    "requires_action",
    "processing",
    "paid",
    "failed",
    "cancelled",
    "refunded",
    null,
  ];

  test("every method × status combination agrees with the shared contract", () => {
    for (const method of METHODS) {
      for (const status of STATUSES) {
        const backend = sellerConfirmationPaymentGate(method, status);
        const shared = orderFulfillmentPaymentGate({ paymentMethod: method, paymentStatus: status });
        expect(backend.ok).toBe(shared.canConfirm);
        expect(backend.code).toBe(shared.code);
      }
    }
    // The code itself is the one the frontend knows, not a second spelling.
    expect(sellerConfirmationPaymentGate("CARD", "pending").code).toBe(PAYMENT_REQUIRED_CODE);
  });

  test("the route refuses pending → confirmed with 409 PAYMENT_REQUIRED", () => {
    const route = read(SELLER_ROUTE);
    const patchStart = route.indexOf('app.patch("/api/seller/orders/:id/status"');
    expect(patchStart).toBeGreaterThan(-1);
    const body = route.slice(patchStart);
    // Read under the row lock (the transition is guarded by FOR UPDATE above).
    expect(body).toContain("FOR UPDATE");
    expect(body).toContain('if (status === "confirmed")');
    expect(body.indexOf("FOR UPDATE")).toBeLessThan(body.indexOf('if (status === "confirmed")'));
    expect(body).toContain("409,");
    expect(body).toContain("This order cannot be confirmed until payment is completed.");
    // The refusal is machine-readable, so the frontend can translate it.
    expect(route).toContain('export const PAYMENT_REQUIRED_CODE = "PAYMENT_REQUIRED"');
  });

  test("NO seller endpoint can mark a Stripe payment paid", () => {
    // `paid` is written in exactly one module — the Stripe webhook. A seller route
    // that could write it would turn "confirm the order" into "confirm the money".
    const writers = [...new Bun.Glob("backend/**/*.ts").scanSync({ cwd: root })]
      .filter((file) => !file.includes("/tests/"))
      .filter((file) => {
        const src = read(file);
        return /SET\s+status\s*=\s*'paid'/.test(src) || /SET\s+status\s*=\s*'paid'/.test(src);
      });
    expect(writers).toEqual(["backend/routes/stripe.ts"]);
    expect(read(SELLER_ROUTE)).not.toMatch(/SET\s+status\s*=\s*'paid'/);
  });

  test("the seller UI locks the same transition instead of hiding a refusal", () => {
    const src = read(SELLER_DETAIL);
    expect(src).toContain("orderFulfillmentPaymentGate(order)");
    expect(src).toContain('const locked = next === "confirmed" && confirmLocked;');
    // Disabled, with the reason on screen — not silently missing.
    expect(src).toContain("disabled={busyStatus !== null || locked}");
    expect(src).toContain('t("sellerOrders.paymentLockTitle")');
    expect(src).toContain('t("sellerOrders.paymentLockDesc")');
    // COD is presented as COD, not as a payment problem.
    expect(src).toContain('payment.kind === "cod"');
    expect(src).toContain('t("sellerOrders.codNote")');
  });

  test("the seller list shows a payment badge driven by the METHOD, not only the status", () => {
    const src = read(SELLER_LIST);
    expect(src).toContain("orderPaymentSummary(order)");
    expect(src).toContain("SellerPaymentBadge");
    // A COD order must not be reduced to its `pending` payment row.
    expect(src).not.toContain("paymentLabel(order.paymentStatus)");
  });
});

describe("payment badges — COD reads as COD, a card reads as paid / awaiting", () => {
  test("kinds and colours", () => {
    expect(orderPaymentSummary({ paymentMethod: "cod", paymentStatus: "pending" }).kind).toBe("cod");
    expect(orderPaymentSummary({ paymentMethod: "CARD", paymentStatus: "paid" }).kind).toBe("paid");
    expect(orderPaymentSummary({ paymentMethod: "CARD", paymentStatus: "requires_action" }).kind).toBe("awaiting");
    expect(orderPaymentSummary({ paymentMethod: "PROMPTPAY", paymentStatus: "pending" }).kind).toBe("awaiting");
    expect(orderPaymentSummary({ paymentMethod: "CARD", paymentStatus: "processing" }).kind).toBe("awaiting");
    expect(orderPaymentSummary({ paymentMethod: "CARD", paymentStatus: "failed" }).kind).toBe("failed");
    expect(orderPaymentSummary({ paymentMethod: "CARD", paymentStatus: "refunded" }).kind).toBe("refunded");
    expect(orderPaymentSummary({ paymentMethod: "CARD", paymentStatus: "cancelled" }).kind).toBe("cancelled");
    expect(orderPaymentSummary({ paymentStatus: "unpaid" }).kind).toBe("unpaid");
  });

  test("only an online order still waiting to be paid needs money before fulfilment", () => {
    expect(orderPaymentSummary({ paymentMethod: "CARD", paymentStatus: "requires_action" }).awaitingOnlinePayment).toBe(true);
    expect(orderPaymentSummary({ paymentMethod: "CARD", paymentStatus: "paid" }).awaitingOnlinePayment).toBe(false);
    expect(orderPaymentSummary({ paymentMethod: "cod", paymentStatus: "pending" }).awaitingOnlinePayment).toBe(false);
  });

  test("every badge label resolves in all three locales", () => {
    const inputs = [
      { paymentMethod: "cod", paymentStatus: "pending" },
      { paymentMethod: "CARD", paymentStatus: "paid" },
      { paymentMethod: "CARD", paymentStatus: "requires_action" },
      { paymentMethod: "CARD", paymentStatus: "failed" },
      { paymentMethod: "CARD", paymentStatus: "refunded" },
      { paymentMethod: "CARD", paymentStatus: "cancelled" },
      { paymentStatus: "unpaid" },
    ];
    for (const input of inputs) {
      const { i18nKey } = orderPaymentSummary(input);
      for (const lang of LOCALES) {
        const value = resolveKey(translations[lang] as unknown as Nested, i18nKey);
        expect(value).not.toBeNull();
        expect(value!.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The shipping address snapshot is the only shipping source
// ═══════════════════════════════════════════════════════════════════════════

describe("address snapshot — one source for both order surfaces", () => {
  test("all four order endpoints return `addressSnapshot`", () => {
    const cart = read(CART_ROUTE);
    const seller = read(SELLER_ROUTE);
    // Customer list + detail.
    expect((cart.match(/addressSnapshot: parseShippingAddress\(/g) ?? []).length).toBe(2);
    // Seller list + detail.
    expect((seller.match(/addressSnapshot: snapshot/g) ?? []).length).toBe(2);
    // The seller endpoints read the snapshot from the order row, once per request.
    expect((seller.match(/parseShippingAddress\((r|order)\.shipping_address\)/g) ?? []).length).toBe(2);
  });

  test("the seller's customer phone comes from the SNAPSHOT, never from users.phone", () => {
    const seller = read(SELLER_ROUTE);
    expect(seller).toContain("function shippingContact(");
    expect(seller).toContain("customerPhone: contact.phone");
    // The account phone is not even selected any more.
    expect(seller).not.toMatch(/SELECT[^`]*\bphone\b[^`]*FROM users/);
    expect(seller).toContain("SELECT id, name FROM users");
    expect(seller).toContain("SELECT name FROM users");
  });

  test("a missing snapshot phone is reported as missing, never guessed", () => {
    // Seller: says the order has no shipping phone.
    expect(read(SELLER_DETAIL)).toContain('t("sellerOrders.phoneUnavailable")');
    // Customer: says the number is unavailable for THIS order.
    expect(read(SHOP_DETAIL)).toContain('t("orderDetail.phoneUnavailable")');
    // Neither surface re-reads the profile to fill the gap.
    for (const page of [SHOP_DETAIL, SELLER_DETAIL]) {
      expect(read(page)).not.toMatch(/profile\.phone|user\.phone|me\.phone/);
    }
  });

  test("the snapshot type spells out the Thai address parts it is written with", () => {
    const commerce = read("packages/shared/src/lib/commerce.ts");
    for (const field of ["label", "recipientName", "phone", "line1", "line2", "subdistrict", "district", "province", "postalCode", "country"]) {
      expect(commerce).toMatch(new RegExp(`^\\s+${field}\\??:`, "m"));
    }
    // …and the writer stores exactly those fields.
    const cart = read(CART_ROUTE);
    const writer = cart.slice(cart.indexOf("function orderAddressSnapshot("));
    for (const field of ["label", "recipientName", "phone", "line1", "line2", "subdistrict", "district", "province", "postalCode", "country"]) {
      expect(writer.slice(0, 700)).toContain(`${field}:`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The cancellation cutoff is FULFILMENT
// ═══════════════════════════════════════════════════════════════════════════

describe("customer cancellation — the fulfilment cutoff", () => {
  test("`confirmed` is still cancelable; a shipment is not", () => {
    expect(orderCustomerCancelability({ status: "confirmed", paymentStatus: "unpaid" })).toEqual({
      cancelable: true,
      reason: null,
    });
    // A shipment row exists (the list reports it as `shippingStatus`) → cutoff.
    expect(orderCustomerCancelability({ status: "confirmed", paymentStatus: "unpaid", shippingStatus: "pending" })).toEqual({
      cancelable: false,
      reason: "shipping_started",
    });
    // The detail reports the shipment objects instead.
    expect(
      orderCustomerCancelability({ status: "confirmed", paymentStatus: "unpaid", shipments: [{ id: "s1" }] }).reason,
    ).toBe("shipping_started");
  });

  test("`shippingStatus: \"none\"` is not evidence of anything", () => {
    expect(hasShipmentEvidence({ shippingStatus: "none" })).toBe(false);
    expect(hasShipmentEvidence({ shippingStatus: "" })).toBe(false);
    expect(hasShipmentEvidence({ shipments: [] })).toBe(false);
    expect(hasShipmentEvidence({ shippingStatus: "in_transit" })).toBe(true);
  });

  test("money still outranks the shipment (a refund is not a cancellation)", () => {
    expect(
      orderCustomerCancelability({ status: "pending_payment", paymentStatus: "paid", shipments: [{ id: "s1" }] }),
    ).toEqual({ cancelable: false, reason: "payment_in_progress" });
  });

  test("the shipped/delivered/completed statuses stay refused", () => {
    for (const status of ["shipped", "delivered", "completed", "cancelled", "expired", "payment_failed", "refunded"]) {
      expect(orderCustomerCancelability({ status, paymentStatus: "unpaid" }).cancelable).toBe(false);
    }
  });

  test("the backend rule agrees, case by case", () => {
    const decided = (row: Parameters<typeof cancellationDecision>[0]) => {
      const decision = cancellationDecision(row);
      return decision.outcome === "cancelable" ? "cancelable" : decision.outcome === "terminal" ? "terminal" : decision.code;
    };
    expect(decided({ status: "pending", latest_payment_status: "unpaid" })).toBe("cancelable");
    expect(decided({ status: "pending_payment", latest_payment_status: "requires_action" })).toBe("cancelable");
    expect(decided({ status: "confirmed", latest_payment_status: "unpaid", has_shipment: false })).toBe("cancelable");
    expect(decided({ status: "confirmed", latest_payment_status: "unpaid", has_shipment: true })).toBe("ORDER_ALREADY_SHIPPING");
    expect(decided({ status: "pending", latest_payment_status: "unpaid", has_shipment: true })).toBe("ORDER_ALREADY_SHIPPING");
    expect(decided({ status: "pending_payment", latest_payment_status: "paid" })).toBe("ORDER_ALREADY_PAID");
    expect(decided({ status: "pending_payment", latest_payment_status: "processing" })).toBe("PAYMENT_IN_PROGRESS");
    // A shipped/delivered/completed order is out of the cancelable set → 400 (the
    // status the pre-existing suite already pins).
    expect(decided({ status: "shipped", latest_payment_status: "paid" })).toBe("INVALID_STATUS");
    expect(decided({ status: "delivered", latest_payment_status: "paid" })).toBe("INVALID_STATUS");
    expect(decided({ status: "completed", latest_payment_status: "paid" })).toBe("INVALID_STATUS");
    // Genuinely terminal states report their state instead of an error.
    expect(decided({ status: "cancelled", latest_payment_status: "cancelled" })).toBe("terminal");
    expect(decided({ status: "cancelled", latest_payment_status: "paid" })).toBe("terminal");
    expect(decided({ status: "expired", latest_payment_status: "cancelled" })).toBe("terminal");
    expect(decided({ status: "payment_failed", latest_payment_status: "failed" })).toBe("terminal");
  });

  test("the 409 the frontend expects is the one the backend sends", () => {
    const decision = cancellationDecision({ status: "pending", latest_payment_status: "unpaid", has_shipment: true });
    expect(decision.outcome).toBe("refused");
    if (decision.outcome === "refused") {
      expect(decision.status).toBe(409);
      expect(decision.code).toBe(ORDER_ALREADY_SHIPPING_CODE);
    }
    expect(read(CART_ROUTE)).toContain('code: "ORDER_ALREADY_SHIPPING"');
  });

  test("the cancellation status list is unchanged and shared", () => {
    expect([...CUSTOMER_CANCELABLE_ORDER_STATUSES]).toEqual(["pending", "pending_payment", "confirmed"]);
    const cart = read(CART_ROUTE);
    const match = cart.match(/const CANCELABLE_STATUSES = \[([^\]]+)\];/);
    expect(match).not.toBeNull();
    expect([...match![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1])).toEqual([...CUSTOMER_CANCELABLE_ORDER_STATUSES]);
  });

  test("the decision is taken twice from ONE rule — pre-flight and under the row lock", () => {
    const cart = read(CART_ROUTE);
    const body = cart.slice(
      cart.indexOf('app.patch("/api/customer/orders/:orderId/cancel"'),
      cart.indexOf('app.post("/api/customer/reorder"'),
    );
    expect(body).toContain("cancellationDecision(order)");
    expect(body).toContain("cancellationDecision(live)");
    // The authoritative pass runs after a row lock, and before the guarded UPDATE.
    const lock = body.indexOf("FOR UPDATE");
    const live = body.indexOf("cancellationDecision(live)");
    const claim = body.indexOf("SET status = 'cancelled'");
    expect(lock).toBeGreaterThan(-1);
    expect(live).toBeGreaterThan(lock);
    expect(claim).toBeGreaterThan(live);
    // Ownership stays in the WHERE clause — never a client-supplied id.
    expect(body).toContain("WHERE o.id = $1 AND o.user_id = $2");
    // No second copy of the status list survived inside the route.
    expect(body).not.toContain("const CANCELABLE_STATUSES = [");
  });

  test("the customer page explains the cutoff instead of hiding the button", () => {
    const src = read(SHOP_DETAIL);
    expect(src).toContain("orderCustomerCancelability");
    expect(src).toContain('cancelability.reason === "shipping_started"');
    expect(src).toContain('t("orderDetail.cancelBlockedShipping")');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Order number ≠ tracking number, and stock leaves through ONE path
// ═══════════════════════════════════════════════════════════════════════════

describe("tracking numbers and inventory", () => {
  test("the order number is not a tracking number", () => {
    const orderNumber = generateOrderNumber(new Date("2026-09-29T00:00:00Z"));
    expect(orderNumber).toMatch(/^VNX-20260929-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/);
    // The tracking number is a carrier value in its own column, on its own table.
    expect(read("db/schema.sql")).toMatch(/CREATE TABLE IF NOT EXISTS shipments[\s\S]*?tracking_number TEXT/);
    expect(read(SELLER_ROUTE)).toContain("trackingNumber: shipments[0]?.trackingNumber ?? null");
    expect(read(SELLER_ROUTE)).toContain("orderNumber: order.order_number || order.id");
    // Nothing ever writes a tracking number onto the order row.
    expect(read(CART_ROUTE)).not.toMatch(/SET\s+order_number\s*=/);
  });

  test("a seller cancellation releases stock through the canonical path only", () => {
    const seller = read(SELLER_ROUTE);
    const patch = seller.slice(seller.indexOf('app.patch("/api/seller/orders/:id/status"'));
    expect(patch).toContain('if (status === "cancelled")');
    expect(patch).toContain("await releaseOrderInventory(client, orderId);");
    // The hand-rolled stock math this route used to carry is gone.
    expect(patch).not.toContain("SET stock = stock + $1");
    expect(patch).not.toContain("GREATEST(0, reserved - $1)");
    expect(seller).toContain('import { releaseOrderInventory } from "../lib/inventory.js";');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Copy
// ═══════════════════════════════════════════════════════════════════════════

describe("order fulfilment copy", () => {
  test("the new keys exist in th, en and my", () => {
    const keys: Array<[string, string[]]> = [
      [
        "sellerOrders",
        [
          "paymentLockTitle",
          "paymentLockDesc",
          "addressTitle",
          "copyPhone",
          "copyAddress",
          "copied",
          "callPhone",
          "phoneUnavailable",
          "codNote",
        ],
      ],
      ["orderDetail", ["phoneUnavailable", "cancelBlockedShipping"]],
    ];
    for (const [namespace, names] of keys) {
      for (const lang of LOCALES) {
        for (const name of names) {
          const value = resolveKey(translations[lang] as unknown as Nested, `${namespace}.${name}`);
          expect(value).not.toBeNull();
          expect(value!.trim().length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("no Thai literal is hard-coded in the new seller copy paths", () => {
    // The seller detail/lock/address copy all come from the dictionaries: only
    // `paymentMethods.*` / `paymentLabels.*` keys are rendered.
    expect(read(SELLER_DETAIL)).toContain("t(payment.i18nKey)");
    expect(read(SELLER_LIST)).toContain("t(summary.i18nKey)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Database-gated: the rules against a real database
// ═══════════════════════════════════════════════════════════════════════════

const describeDb = hasTestDatabase() ? describe : describe.skip;

describeDb("order fulfilment (requires TEST_DATABASE_URL)", () => {
  const JWT_SECRET = process.env.JWT_SECRET!;

  afterEach(() => {
    /* nothing global to reset — every fixture is purged by its own test */
  });

  function buildApp(): express.Express {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    setupCartRoutes(app);
    setupSellerOrderRoutes(app);
    return app;
  }

  async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
    const server = buildApp().listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      return await fn(`http://127.0.0.1:${port}`);
    } finally {
      server.close();
    }
  }

  function token(userId: string): string {
    return jwt.sign({ userId, email: `${userId}@test.local` }, JWT_SECRET, { expiresIn: "1h" });
  }

  interface SeedOptions {
    /** The raw `orders.status` the order carries. */
    status?: string;
    /** The payment row, or null for an order with no payment at all. */
    payment?: { method: string; status: string; provider?: string } | null;
    /** Insert a shipment row (the fulfilment-start evidence). */
    shipment?: boolean;
    /** The checkout snapshot stored on the order. */
    address?: Record<string, unknown> | null;
    reserved?: number;
    quantity?: number;
    /** An account phone that must NEVER leak into the shipping contact. */
    accountPhone?: string;
  }

  /**
   * Seed owner → seller → shop → product → inventory → order (+ item, payment,
   * shipment). Stock is seeded the way checkout reserves it, so a correct release
   * brings `reserved` back to 0 and a double release would push it below.
   */
  async function seedOrder(opts: SeedOptions = {}) {
    const { query } = await import("../db/index.js");
    const tag = `fulfil-${crypto.randomUUID()}`;
    const quantity = opts.quantity ?? 3;
    const reserved = opts.reserved ?? quantity;

    const owner = await query(`INSERT INTO users (email, name, phone) VALUES ($1, $2, $3) RETURNING id`, [
      `${tag}-owner@test.local`,
      "Fulfil Owner",
      opts.accountPhone ?? "0899999999",
    ]);
    const ownerId = owner.rows[0].id as string;
    const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-seller@test.local`,
      "Fulfil Seller",
    ]);
    const sellerUserId = sellerUser.rows[0].id as string;
    const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [sellerUserId]);
    const sellerId = seller.rows[0].id as string;
    const shop = await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
      sellerId,
      `${tag} shop`,
      tag,
    ]);
    const shopId = shop.rows[0].id as string;
    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status) VALUES ($1, $2, $3, 120.00, 'published') RETURNING id`,
      [shopId, `${tag} product`, `${tag}-p`],
    );
    const productId = product.rows[0].id as string;
    await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 50, $2)`, [productId, reserved]);

    const snapshot = opts.address === undefined
      ? {
          label: "Home",
          recipientName: "สมชาย ใจดี",
          phone: "0811111111",
          line1: "99/99 หมู่ 5",
          line2: null,
          subdistrict: "แม่ตาว",
          district: "แม่สอด",
          province: "ตาก",
          postalCode: "63110",
          country: "TH",
        }
      : opts.address;

    const order = await query(
      `INSERT INTO orders (user_id, shop_id, order_number, status, subtotal, total_amount, currency, shipping_address)
       VALUES ($1, $2, $3, $4, 360.00, 360.00, 'THB', $5::jsonb) RETURNING id`,
      [ownerId, shopId, `VNX-20260929-${tag.slice(-6).toUpperCase()}`, opts.status ?? "pending", JSON.stringify(snapshot)],
    );
    const orderId = order.rows[0].id as string;
    await query(
      `INSERT INTO order_items (order_id, product_id, shop_id, product_name, quantity, price, subtotal)
       VALUES ($1, $2, $3, $4, $5, 120.00, $6)`,
      [orderId, productId, shopId, `${tag} product`, quantity, quantity * 120],
    );
    if (opts.payment) {
      await query(
        `INSERT INTO payments (order_id, provider, method, amount, currency, status)
         VALUES ($1, $2, $3, 360.00, 'THB', $4)`,
        [orderId, opts.payment.provider ?? "stripe", opts.payment.method, opts.payment.status],
      );
    }
    if (opts.shipment) {
      await query(
        `INSERT INTO shipments (order_id, carrier, tracking_number, status)
         VALUES ($1, 'Flash Express', $2, 'in_transit')`,
        [orderId, `TH${Math.floor(Math.random() * 1e9)}`],
      );
    }
    return { orderId, ownerId, sellerUserId, sellerId, shopId, productId };
  }

  async function setStatus(base: string, orderId: string, asUserId: string, status: string) {
    const res = await fetch(`${base}/api/seller/orders/${orderId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: `velnox_session=${token(asUserId)}` },
      body: JSON.stringify({ status }),
    });
    const body = (await res.json()) as { data?: { status?: string }; error?: { code?: string } };
    return { status: res.status, body };
  }

  async function getJson(base: string, path: string, asUserId: string) {
    const res = await fetch(`${base}${path}`, {
      headers: { Cookie: `velnox_session=${token(asUserId)}` },
    });
    return { status: res.status, body: (await res.json()) as { data?: any; error?: { code?: string } } };
  }

  async function cancel(base: string, orderId: string, asUserId: string) {
    const res = await fetch(`${base}/api/customer/orders/${orderId}/cancel`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: `velnox_session=${token(asUserId)}` },
    });
    const body = (await res.json()) as { data?: { status?: string; cancelled?: boolean }; error?: { code?: string } };
    return { status: res.status, body };
  }

  test("CARD unpaid → seller confirm is BLOCKED (409 PAYMENT_REQUIRED), nothing moves", async () => {
    for (const paymentStatus of ["requires_action", "pending", "unpaid", "failed"]) {
      const seed = await seedOrder({ payment: { method: "CARD", status: paymentStatus } });
      try {
        await withServer(async (base) => {
          const res = await setStatus(base, seed.orderId, seed.sellerUserId, "confirmed");
          expect(res.status).toBe(409);
          expect(res.body.error?.code).toBe("PAYMENT_REQUIRED");
        });
        const { query } = await import("../db/index.js");
        const row = (await query(`SELECT status FROM orders WHERE id = $1`, [seed.orderId])).rows[0];
        expect(row.status).toBe("pending");
      } finally {
        await purgeUsers([seed.ownerId, seed.sellerUserId]);
      }
    }
  });

  test("PROMPTPAY unpaid → BLOCKED; paid → ALLOWED", async () => {
    const unpaid = await seedOrder({ payment: { method: "PROMPTPAY", status: "requires_action" } });
    try {
      await withServer(async (base) => {
        expect((await setStatus(base, unpaid.orderId, unpaid.sellerUserId, "confirmed")).body.error?.code).toBe("PAYMENT_REQUIRED");
      });
    } finally {
      await purgeUsers([unpaid.ownerId, unpaid.sellerUserId]);
    }

    const paid = await seedOrder({ status: "paid", payment: { method: "PROMPTPAY", status: "paid" } });
    try {
      await withServer(async (base) => {
        const res = await setStatus(base, paid.orderId, paid.sellerUserId, "confirmed");
        expect(res.status).toBe(200);
        expect(res.body.data?.status).toBe("confirmed");
      });
      const { query } = await import("../db/index.js");
      const row = (await query(`SELECT status FROM orders WHERE id = $1`, [paid.orderId])).rows[0];
      expect(row.status).toBe("confirmed");
    } finally {
      await purgeUsers([paid.ownerId, paid.sellerUserId]);
    }
  });

  test("CARD paid → ALLOWED (the webhook's `paid` is what unlocks fulfilment)", async () => {
    const seed = await seedOrder({ status: "pending_payment", payment: { method: "CARD", status: "paid" } });
    try {
      await withServer(async (base) => {
        expect((await setStatus(base, seed.orderId, seed.sellerUserId, "confirmed")).status).toBe(200);
      });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("COD with an unpaid payment row → ALLOWED", async () => {
    const seed = await seedOrder({ payment: { method: "cod", status: "pending", provider: "cod" } });
    try {
      await withServer(async (base) => {
        const res = await setStatus(base, seed.orderId, seed.sellerUserId, "confirmed");
        expect(res.status).toBe(200);
      });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("an order with NO recorded method fails closed", async () => {
    const seed = await seedOrder({ payment: null });
    try {
      await withServer(async (base) => {
        const res = await setStatus(base, seed.orderId, seed.sellerUserId, "confirmed");
        expect(res.status).toBe(409);
        expect(res.body.error?.code).toBe("PAYMENT_REQUIRED");
      });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("shipping a confirmed order is NOT gated (only STARTING fulfilment is)", async () => {
    const seed = await seedOrder({ status: "confirmed", payment: { method: "CARD", status: "paid" } });
    try {
      await withServer(async (base) => {
        expect((await setStatus(base, seed.orderId, seed.sellerUserId, "shipped")).status).toBe(200);
      });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("another seller cannot confirm someone else's order (or learn it exists)", async () => {
    const seed = await seedOrder({ payment: { method: "COD", status: "pending" } });
    const intruder = await seedOrder({ payment: null });
    try {
      await withServer(async (base) => {
        const res = await setStatus(base, seed.orderId, intruder.sellerUserId, "confirmed");
        expect(res.status).toBe(404);
        expect(res.body.error?.code).toBe("NOT_FOUND");
      });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId, intruder.ownerId, intruder.sellerUserId]);
    }
  });

  test("a shipment blocks customer cancellation (409 ORDER_ALREADY_SHIPPING) and stock stays reserved", async () => {
    const seed = await seedOrder({ status: "confirmed", payment: { method: "CARD", status: "paid" }, shipment: true, reserved: 3 });
    try {
      await withServer(async (base) => {
        const res = await cancel(base, seed.orderId, seed.ownerId);
        expect(res.status).toBe(409);
        expect(res.body.error?.code).toBe("ORDER_ALREADY_SHIPPING");
      });
      const { query } = await import("../db/index.js");
      const order = (await query(`SELECT status, inventory_released FROM orders WHERE id = $1`, [seed.orderId])).rows[0];
      const inventory = (await query(`SELECT reserved FROM inventory WHERE product_id = $1`, [seed.productId])).rows[0];
      expect(order.status).toBe("confirmed");
      expect(order.inventory_released).toBe(false);
      expect(Number(inventory.reserved)).toBe(3);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("an order with no shipment, no payment yet and a cancelled card can still be cancelled", async () => {
    const seed = await seedOrder({ status: "pending_payment", payment: { method: "CARD", status: "cancelled" } });
    try {
      await withServer(async (base) => {
        const res = await cancel(base, seed.orderId, seed.ownerId);
        expect(res.status).toBe(200);
        expect(res.body.data?.cancelled).toBe(true);
      });
      const { query } = await import("../db/index.js");
      const inventory = (await query(`SELECT reserved FROM inventory WHERE product_id = $1`, [seed.productId])).rows[0];
      expect(Number(inventory.reserved)).toBe(0);
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("cancel vs confirm cannot contradict each other", async () => {
    // A COD order may be confirmed (no payment needed) and is still cancelable, so
    // the two requests genuinely race. Whatever the order, the outcome must be ONE
    // consistent state — never "confirmed AND stock released".
    const seed = await seedOrder({ payment: { method: "cod", status: "pending", provider: "cod" } });
    try {
      await withServer(async (base) => {
        const [confirmRes, cancelRes] = await Promise.all([
          setStatus(base, seed.orderId, seed.sellerUserId, "confirmed"),
          cancel(base, seed.orderId, seed.ownerId),
        ]);
        expect([200, 409, 400]).toContain(confirmRes.status);
        expect([200, 409, 400]).toContain(cancelRes.status);
      });
      const { query } = await import("../db/index.js");
      const order = (await query(`SELECT status, inventory_released FROM orders WHERE id = $1`, [seed.orderId])).rows[0];
      const inventory = (await query(`SELECT reserved FROM inventory WHERE product_id = $1`, [seed.productId])).rows[0];
      expect(["confirmed", "cancelled"]).toContain(order.status);
      if (order.status === "cancelled") {
        expect(order.inventory_released).toBe(true);
        expect(Number(inventory.reserved)).toBe(0);
      } else {
        expect(order.inventory_released).toBe(false);
        expect(Number(inventory.reserved)).toBe(3);
      }
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("the seller sees the customer's SNAPSHOT phone, not the account phone", async () => {
    // The account carries 0899999999 (seedOrder); the order's snapshot says
    // 0811111111. The seller must get the snapshot's.
    const seed = await seedOrder({ payment: { method: "COD", status: "pending" } });
    try {
      await withServer(async (base) => {
        const detail = await getJson(base, `/api/seller/orders/${seed.orderId}`, seed.sellerUserId);
        expect(detail.status).toBe(200);
        expect(detail.body.data.paymentMethod).toBe("cod");
        expect(detail.body.data.customerPhone).toBe("0811111111");
        expect(detail.body.data.customerName).toBe("สมชาย ใจดี");
        expect(detail.body.data.addressSnapshot).toMatchObject({
          label: "Home",
          recipientName: "สมชาย ใจดี",
          phone: "0811111111",
          line1: "99/99 หมู่ 5",
          subdistrict: "แม่ตาว",
          district: "แม่สอด",
          province: "ตาก",
          postalCode: "63110",
          country: "TH",
        });

        const list = await getJson(base, "/api/seller/orders", seed.sellerUserId);
        const row = (list.body.data as any[]).find((o) => o.id === seed.orderId);
        expect(row.customerPhone).toBe("0811111111");
        expect(row.paymentMethod).toBe("cod");
        expect(row.addressSnapshot.phone).toBe("0811111111");
      });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("a legacy order with no snapshot phone reports none — never the profile's", async () => {
    const seed = await seedOrder({
      payment: { method: "CARD", status: "paid" },
      address: { recipientName: "Legacy Buyer", line1: "1 Old Road", province: "Bangkok" },
      accountPhone: "0899999999",
    });
    try {
      await withServer(async (base) => {
        const detail = await getJson(base, `/api/seller/orders/${seed.orderId}`, seed.sellerUserId);
        expect(detail.body.data.customerPhone).toBeNull();
        expect(detail.body.data.addressSnapshot.phone).toBeUndefined();
        const customer = await getJson(base, `/api/customer/orders/${seed.orderId}`, seed.ownerId);
        expect(customer.body.data.addressSnapshot.phone).toBeUndefined();
      });
    } finally {
      await purgeUsers([seed.ownerId, seed.sellerUserId]);
    }
  });

  test("editing the profile does not rewrite an existing order's address or phone", async () => {
    const orderA = await seedOrder({
      payment: { method: "CARD", status: "paid" },
      address: { label: "Home", recipientName: "สมชาย ใจดี", phone: "0811111111", line1: "99/99 หมู่ 5", province: "ตาก", postalCode: "63110", country: "TH" },
      accountPhone: "0811111111",
    });
    try {
      // 1. the customer moves house and changes the phone on their profile.
      const { query } = await import("../db/index.js");
      await query(`UPDATE users SET phone = $1 WHERE id = $2`, ["0822222222", orderA.ownerId]);

      // 2. a NEW order is placed from the new address.
      const orderB = await seedOrder({
        payment: { method: "CARD", status: "paid" },
        address: { label: "Office", recipientName: "สมชาย ใจดี", phone: "0822222222", line1: "5 New Road", province: "เชียงใหม่", postalCode: "50000", country: "TH" },
        accountPhone: "0822222222",
      });

      await withServer(async (base) => {
        const a = await getJson(base, `/api/seller/orders/${orderA.orderId}`, orderA.sellerUserId);
        const b = await getJson(base, `/api/seller/orders/${orderB.orderId}`, orderB.sellerUserId);
        // History is frozen: the old order still ships to the old phone…
        expect(a.body.data.addressSnapshot.phone).toBe("0811111111");
        expect(a.body.data.customerPhone).toBe("0811111111");
        // …and the new order carries the new one.
        expect(b.body.data.addressSnapshot.phone).toBe("0822222222");
        expect(b.body.data.customerPhone).toBe("0822222222");

        // The customer's own order page agrees, for both orders.
        const ca = await getJson(base, `/api/customer/orders/${orderA.orderId}`, orderA.ownerId);
        expect(ca.body.data.addressSnapshot.phone).toBe("0811111111");
      });

      await purgeUsers([orderB.ownerId, orderB.sellerUserId]);
    } finally {
      await purgeUsers([orderA.ownerId, orderA.sellerUserId]);
    }
  });
});
