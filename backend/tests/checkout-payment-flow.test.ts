/**
 * VelShop checkout → Stripe payment flow — regression tests.
 *
 * Why this file exists
 * --------------------
 * The storefront asked for a payment twice. `POST /api/customer/checkout`
 * created the order, the browser rendered a "คำสั่งซื้อสำเร็จ" screen, and only a
 * SECOND press ("ชำระเงิน") opened the Stripe Checkout Session and redirected.
 * A customer who stopped at that screen had an order they never paid, and the
 * success screen claimed a completed purchase before Stripe was even shown.
 *
 * What is pinned here
 * -------------------
 *   1. CARD and PROMPTPAY both go order → session → `window.location.assign`
 *      in one press, with the customer's own rail;
 *   2. no intermediate order-success screen (and no second "pay" button) exists
 *      for online payments;
 *   3. a missing session URL is an error, never a redirect to `undefined`;
 *   4. one press = one order (the click guard) and the backend still allows at
 *      most one active Stripe payment + one session per request key;
 *   5. an unpaid order is resumable from My Orders / the order page / the
 *      Stripe-return pages, using the recorded method and never a default;
 *   6. an order the backend will NOT accept a session for (`payment_failed`,
 *      `cancelled`, `paid`, COD) offers no resume button anywhere;
 *   7. the webhook stays the only writer of `paid`.
 *
 * The frontend assertions are source contracts, in the style this suite already
 * uses for `stripe.ts` and the order-status contract: the file is read and the
 * shape that must hold is asserted, so an edit that reintroduces the
 * double-press flow fails here.
 *
 * No test here calls Stripe. The DB-gated cases assert REFUSALS, which the
 * endpoint settles before any provider call, and use a fake `sk_test_` value
 * only to get past the configuration gate.
 */
import { afterEach, describe, expect, test } from "bun:test";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import { readFileSync } from "fs";
import { join } from "path";

import {
  PAYABLE_ORDER_STATUSES,
  isOrderPayable,
  orderStripePayability,
  stripeMethodForPaymentMethod,
} from "../../packages/shared/src/lib/commerce.ts";
import { setupStripeRoutes } from "../routes/stripe.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const SHOP_CHECKOUT = "apps/velshop/src/pages/ShopCheckout.tsx";
const MY_ORDERS = "apps/velshop/src/pages/MyOrders.tsx";
const ORDER_DETAIL = "apps/velshop/src/pages/ShopOrderDetail.tsx";
const SUCCESS_PAGE = "apps/velshop/src/pages/ShopCheckoutSuccess.tsx";
const CANCEL_PAGE = "apps/velshop/src/pages/ShopCheckoutCancel.tsx";
const RESUME_BUTTON = "apps/velshop/src/components/shop/ResumePaymentButton.tsx";
const STRIPE_ROUTE = "backend/routes/stripe.ts";
const CART_ROUTE = "backend/routes/cart.ts";

/** Every VelShop surface that can offer a resume-payment entry point. */
const RESUME_SURFACES = [MY_ORDERS, ORDER_DETAIL, SUCCESS_PAGE, CANCEL_PAGE];

// ═══════════════════════════════════════════════════════════════════════════
// 1. The payability rule (shared contract) — scenarios 6, 7, 8, 9
// ═══════════════════════════════════════════════════════════════════════════

describe("order payability — the rule the resume button and the backend share", () => {
  test("only the statuses the backend accepts are payable", () => {
    expect([...PAYABLE_ORDER_STATUSES]).toEqual(["pending", "pending_payment"]);
    expect(isOrderPayable("pending")).toBe(true);
    expect(isOrderPayable("pending_payment")).toBe(true);
    // `expired` (the payment reservation window lapsing) is terminal for
    // payment, like every other status outside this list.
    expect(isOrderPayable("expired")).toBe(false);
    expect(orderStripePayability({ status: "expired" })).toEqual({
      payable: false,
      method: null,
      expired: false,
    });
  });

  test("a lapsed payment reservation is not payable before the sweep even writes `expired`", () => {
    // The reservation rule itself is pinned in
    // `payment-reservation-expiry.test.ts`; here we only pin that the shared
    // payability answer carries the flag the order page renders.
    const now = Date.now();
    expect(orderStripePayability({ status: "pending_payment", paymentExpiresAt: now + 60_000 }).expired).toBe(false);
    expect(orderStripePayability({ status: "pending_payment", paymentExpiresAt: now - 1 })).toEqual({
      payable: false,
      method: null,
      expired: true,
    });
  });

  test("a payment_failed order is NOT payable — retrying follows the backend rule", () => {
    // `markPaymentFailed` already released the reserved stock, so the backend
    // refuses a session (`INVALID_STATUS`) and there is no stock to sell.
    expect(isOrderPayable("payment_failed")).toBe(false);
    expect(orderStripePayability({ status: "payment_failed", paymentStatus: "failed" })).toEqual({
      payable: false,
      method: null,
      expired: false,
    });
  });

  test("a cancelled/expired or refunded order is NOT payable", () => {
    expect(orderStripePayability({ status: "cancelled", paymentStatus: "cancelled" })).toEqual({
      payable: false,
      method: null,
      expired: false,
    });
    expect(orderStripePayability({ status: "refunded", paymentStatus: "refunded" })).toEqual({
      payable: false,
      method: null,
      expired: false,
    });
  });

  test("a paid order has no resume entry point, even if the order row lags", () => {
    expect(orderStripePayability({ status: "paid", paymentStatus: "paid" })).toEqual({ payable: false, method: null, expired: false });
    expect(orderStripePayability({ status: "completed", paymentStatus: "paid" })).toEqual({ payable: false, method: null, expired: false });
    // The payment row is the authority on money: a stale `pending_payment`
    // order whose payment is already `paid` must not offer a second charge.
    expect(orderStripePayability({ status: "pending_payment", paymentStatus: "paid" })).toEqual({
      payable: false,
      method: null,
      expired: false,
    });
  });

  test("an unpaid pending_payment order IS payable, with the method it was created with", () => {
    expect(
      orderStripePayability({ status: "pending_payment", paymentStatus: "requires_action", paymentMethod: "PROMPTPAY" }),
    ).toEqual({ payable: true, method: "PROMPTPAY", expired: false });
    expect(
      orderStripePayability({ status: "pending_payment", paymentStatus: "requires_action", paymentMethod: "CARD" }),
    ).toEqual({ payable: true, method: "CARD", expired: false });
  });

  test("the legacy `online` rail resumes as CARD, and PromptPay never collapses into card", () => {
    expect(stripeMethodForPaymentMethod("online")).toBe("CARD");
    expect(stripeMethodForPaymentMethod("card")).toBe("CARD");
    expect(stripeMethodForPaymentMethod("promptpay")).toBe("PROMPTPAY");
    expect(stripeMethodForPaymentMethod("qr")).toBe("PROMPTPAY");
    // Case-insensitive, like the backend's own normalizer.
    expect(stripeMethodForPaymentMethod("PROMPTPAY")).toBe("PROMPTPAY");
    expect(stripeMethodForPaymentMethod("Card")).toBe("CARD");
    // An extended PromptPay rail must never be read as card.
    expect(stripeMethodForPaymentMethod("promptpay-store")).not.toBe("CARD");
  });

  test("a COD order is not offered the Stripe rail", () => {
    expect(orderStripePayability({ status: "pending", paymentStatus: "pending", paymentMethod: "cod" })).toEqual({
      payable: false,
      method: null,
      expired: false,
    });
    expect(
      orderStripePayability({ status: "pending", paymentStatus: "pending", paymentMethod: "cash_on_delivery" }),
    ).toEqual({ payable: false, method: null, expired: false });
  });

  test("a payable order with no recorded method asks instead of defaulting to card", () => {
    // The order was created and the session request failed: no payments row
    // exists, so the rail is unknown. `method: null` means "ask the customer".
    expect(orderStripePayability({ status: "pending", paymentStatus: "unpaid", paymentMethod: null })).toEqual({
      payable: true,
      method: null,
      expired: false,
    });
    expect(orderStripePayability({ status: "pending", paymentStatus: "unpaid" })).toEqual({ payable: true, method: null, expired: false });
    // An unrecognised method is also "ask", never "assume card".
    expect(orderStripePayability({ status: "pending", paymentMethod: "cheque" })).toEqual({ payable: true, method: null, expired: false });
  });

  test("the order-detail shape (payments[], newest first) is read too", () => {
    expect(
      orderStripePayability({
        status: "pending_payment",
        paymentStatus: "requires_action",
        payments: [{ method: "PROMPTPAY", status: "requires_action" }],
      }),
    ).toEqual({ payable: true, method: "PROMPTPAY", expired: false });
    expect(
      orderStripePayability({ status: "pending_payment", paymentStatus: "pending", payments: [{ method: "cod" }] }),
    ).toEqual({ payable: false, method: null, expired: false });
  });

  test("hostile input is not payable", () => {
    for (const order of [null, undefined, { status: null }, { status: "" }, { status: 42 }, { status: "PENDING" }]) {
      expect(orderStripePayability(order as never)).toEqual({ payable: false, method: null, expired: false });
    }
  });

  test("an order can never be payable while its payment is settled", () => {
    for (const status of ["pending", "pending_payment", "paid", "payment_failed", "cancelled"]) {
      expect(orderStripePayability({ status, paymentStatus: "paid" }).payable).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The submit flow — scenarios 1, 2, 3, 4, 5 (ShopCheckout.tsx)
// ═══════════════════════════════════════════════════════════════════════════

describe("ShopCheckout — one press goes order → Stripe → redirect", () => {
  const src = read(SHOP_CHECKOUT);
  /** The body of `handleSubmit`, from its declaration to the retry handler. */
  const submitBody = src.slice(src.indexOf("const handleSubmit = async ()"), src.indexOf("const handleRetryPayment"));
  /** The body of `openStripeSession`, from its declaration to `handleSubmit`. */
  const sessionBody = src.slice(src.indexOf("const openStripeSession"), src.indexOf("const handleSubmit"));

  test("CARD: the order is created first, then the Checkout Session is opened (scenario 1)", () => {
    expect(submitBody.length).toBeGreaterThan(0);
    const orderAt = submitBody.indexOf("await checkoutAction(checkoutPayload)");
    const sessionAt = submitBody.indexOf("openStripeSession(");
    expect(orderAt).toBeGreaterThan(-1);
    expect(sessionAt).toBeGreaterThan(-1);
    expect(orderAt).toBeLessThan(sessionAt);
    // The session is opened for the ORDER THAT WAS JUST CREATED, not for a
    // cart, a client-side total, or a new order.
    expect(submitBody).toContain("order.parentOrderId");
  });

  test("CARD and PROMPTPAY both take the Stripe branch, and it redirects in the SAME tab", () => {
    expect(src).toContain('const stripeFlow = chosenMethod === "CARD" || chosenMethod === "PROMPTPAY";');
    expect(submitBody).toContain("if (redirectUrl) window.location.assign(redirectUrl);");
    // No new tab/window anywhere in this flow.
    expect(src).not.toContain("window.open(");
    expect(src).not.toContain('target="_blank"');
  });

  test("PROMPTPAY: the customer's own method travels to the backend unchanged (scenario 2)", () => {
    // `chosenMethod` is a snapshot of the selection: no re-read of state and no
    // fallback branch that could swap the rail after the customer chose.
    expect(submitBody).toContain("const chosenMethod = paymentMethod;");
    expect(submitBody).toContain("paymentMethod: chosenMethod,");
    expect(sessionBody).toContain("method,");
    // …and the backend turns PROMPTPAY into exactly `promptpay`.
    expect(read(STRIPE_ROUTE)).toContain("payment_method_types: [stripePaymentMethodType(method)!]");
  });

  test("no intermediate order-success screen before Stripe (scenario 3)", () => {
    // The old flow: `setResult(res)` rendered the success screen, which held the
    // second "ชำระเงิน" button (`handlePayOnline`).
    expect(src).not.toContain("handlePayOnline");
    expect(src).not.toContain('t("checkout.payNow")');
    // The order result is only stored on the non-Stripe branch.
    const stripeBranchAt = submitBody.indexOf("if (stripeFlow)");
    const setResultAt = submitBody.indexOf("setResult(order)");
    expect(stripeBranchAt).toBeGreaterThan(-1);
    expect(setResultAt).toBeGreaterThan(stripeBranchAt);
  });

  test("the order-success screen is only reachable for a rail that stays offline", () => {
    expect(src).toContain("This screen is only reached by a rail that does not continue into");
    expect(submitBody).toContain("} else {");
    expect(src).not.toContain("checkout.payNowDesc");
  });

  test("one press = one order: the click guard is checked before the first await (scenario 4)", () => {
    const guardAt = submitBody.indexOf("if (submitRef.current) return;");
    const firstAwaitAt = submitBody.indexOf("await checkoutAction(");
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(firstAwaitAt);
    const setRefAt = submitBody.indexOf("submitRef.current = true;");
    expect(setRefAt).toBeGreaterThan(guardAt);
    expect(setRefAt).toBeLessThan(firstAwaitAt);
  });

  test("the submit buttons show the preparing state and disable while it runs", () => {
    expect(src).toContain('t("checkout.preparingPayment")');
    // Both the desktop and the mobile CTA are disabled while submitting.
    expect(src.match(/disabled=\{submitting \|\| checkoutCount === 0 \|\| addresses === null\}/g) ?? []).toHaveLength(2);
    // The empty-cart screen must not steal the view mid-redirect.
    expect(src).toContain("!syncing && !authLoading && !submitting && isAuthenticated");
  });

  test("a missing session URL is an error, never a redirect to undefined (scenario 5)", () => {
    expect(sessionBody).toContain('if (typeof url !== "string" || url.trim() === "")');
    expect(sessionBody).toContain('throw new Error(t("checkout.payStartFailed"))');
    // `assign` only ever receives the local that was validated.
    expect(src).not.toContain("window.location.assign(res");
    expect(src).not.toContain("window.location.assign(undefined");
    expect(src).not.toContain("window.location.href =");
  });

  test("session failure does not claim a sale, and keeps the order resumable (scenario 5)", () => {
    expect(submitBody).toContain("setPaymentStartError({");
    expect(submitBody).toContain("orderNumber: order.parentOrderNumber,");
    expect(src).toContain('t("checkout.paymentNotStarted")');
    expect(src).toContain('t("checkout.retryPayment")');
    const panel = src.slice(src.indexOf("if (paymentStartError)"), src.indexOf("// Empty cart"));
    expect(panel.length).toBeGreaterThan(0);
    expect(panel).not.toContain("checkout.successTitle");
    expect(panel).not.toContain("checkoutSuccess.paid");
  });

  test("the retry reuses the order and the method, and uses a fresh idempotency key", () => {
    // The target is an OBJECT now: a multi-shop purchase is charged through its
    // `checkoutGroupId`, a single order through its `orderId`. A retry of one
    // specific order still names that order and creates no second one.
    expect(src).toContain("{ orderId: pending.orderId },");
    expect(src).toContain("pending.method");
    expect(src).toContain("crypto.randomUUID()");
    // A retry must never create a second order.
    const retryBody = src.slice(src.indexOf("const handleRetryPayment"));
    expect(retryBody).not.toContain("checkoutAction(");
  });

  test("the session request carries the order, the method, the key and the return path", () => {
    // EXACTLY ONE of the two parents is sent: the group when the checkout
    // produced a purchase group, the order otherwise. Sending both would make
    // the backend's own routing ambiguous, and the amount would come from the
    // wrong parent.
    expect(sessionBody).toContain("checkoutGroupId: target.checkoutGroupId");
    expect(sessionBody).toContain("orderId: target.orderId");
    expect(sessionBody).toContain("method,");
    expect(sessionBody).toContain("requestKey,");
    expect(sessionBody).toContain("returnPath: `/orders?order=${target.orderId}`,");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Resume surfaces — scenarios 6, 8, 10
// ═══════════════════════════════════════════════════════════════════════════

describe("resume payment — one shared control on every surface", () => {
  test("all four surfaces use the same control and the same rule", () => {
    for (const file of RESUME_SURFACES) {
      const src = read(file);
      expect(src).toContain("ResumePaymentButton");
      expect(src).toContain("orderStripePayability");
    }
  });

  test("My Orders offers it only for a payable order, with the order's own method (scenario 6)", () => {
    const src = read(MY_ORDERS);
    expect(src).toContain("const payability = orderStripePayability(order);");
    expect(src).toContain("{payability.payable && (");
    expect(src).toContain("method={payability.method}");
  });

  test("the order page replaces the legacy `online`-only predicate", () => {
    const src = read(ORDER_DETAIL);
    // The old predicate only matched a legacy method/status pair, so a real
    // Stripe order (CARD/PROMPTPAY → requires_action) had no button at all.
    expect(src).not.toContain('p.method === "online" && p.status === "pending"');
    expect(src).toContain("{payability.payable && (");
  });

  test("the Stripe-return pages read authoritative state and only then offer a resume", () => {
    expect(read(SUCCESS_PAGE)).toContain("await fetch(`${apiUrl}/api/orders/${orderId}`");
    expect(read(CANCEL_PAGE)).toContain("orderDetail({ orderId })");
    // Neither page invents a status, and the success page labels the payment
    // from the API's own status value.
    expect(read(SUCCESS_PAGE)).not.toContain('setOrder({ status: "paid"');
    expect(read(CANCEL_PAGE)).not.toContain('status: "paid"');
    expect(read(SUCCESS_PAGE)).toContain("paymentStatusLabel(order.payment.status)");
  });

  test("the control asks for the order and method, and never sends a user id (scenario 10)", () => {
    const src = read(RESUME_BUTTON);
    expect(src).toContain("orderId,\n        method: chosen,");
    // Ownership is proven by the server from the session cookie — no ownership
    // hint travels from the browser.
    expect(src).not.toContain("userId");
    expect(read(STRIPE_ROUTE)).toContain("order.user_id !== userId");
    expect(read(STRIPE_ROUTE)).toContain('fail(res, 403, "FORBIDDEN", "Not your order")');
  });

  test("the control cannot start a second request, and keeps the loading state", () => {
    const src = read(RESUME_BUTTON);
    expect(src).toContain("if (paying) return;");
    expect(src).toContain("disabled={paying}");
    expect(src).toContain("crypto.randomUUID()");
  });

  test("the method chooser opens for EVERY rail, and lists the backend's own methods", () => {
    const src = read(RESUME_BUTTON);
    // The chooser is no longer reserved for an unknown rail: the customer may
    // choose the payment method again on any unpaid order (a PromptPay attempt
    // that failed can be retried by card).
    expect(src).toContain("onClick={openChooser}");
    expect(src).toContain("void loadMethods();");
    expect(src).toContain("fetchPaymentMethods()");
    expect(src).toContain('m.id === "CARD" || m.id === "PROMPTPAY"');
    // The recorded rail is only PRESELECTED, so switching rails is a real choice.
    expect(src).toContain("setSelected(method)");
    expect(src).toContain("setSelected(rail)");
    // The request body carries the RESOLVED rail only — no literal, no
    // fallback, and no operator that could substitute one.
    const payload = src.slice(src.indexOf("await createStripeCheckout({"), src.indexOf("})) as unknown"));
    expect(payload.length).toBeGreaterThan(0);
    expect(payload).toContain("method: chosen,");
    expect(/method:\s*(?:"CARD"|"PROMPTPAY")/.test(payload)).toBe(false);
    expect(payload).not.toContain('"CARD"');
    expect(payload).not.toContain('"PROMPTPAY"');
  });

  test("a paid or terminal order gets no button from any caller", () => {
    for (const file of RESUME_SURFACES) {
      const src = read(file);
      // Every render site is guarded by the payability result, never by a raw
      // status or a payment status alone.
      expect((src.match(/payability\.payable &&/g) ?? []).length).toBeGreaterThan(0);
      expect(src).not.toContain('paymentStatus !== "paid" &&');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Backend contract — scenarios 7, 9, 11, 12
// ═══════════════════════════════════════════════════════════════════════════

describe("backend contract — the session endpoint and the webhook", () => {
  const stripeSrc = read(STRIPE_ROUTE);

  test("the payable status list is exactly the shared one (no drift)", () => {
    const match = stripeSrc.match(/if \(!\[([^\]]+)\]\.includes\(order\.status\)\)/);
    expect(match).not.toBeNull();
    const accepted = [...match![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(accepted).toEqual([...PAYABLE_ORDER_STATUSES]);
  });

  test("the endpoint refuses any other status instead of inventing a retry (scenario 7)", () => {
    expect(stripeSrc).toContain('fail(res, 400, "INVALID_STATUS"');
  });

  test("an expired/cancelled session cancels the order — it never marks it paid (scenario 9)", () => {
    expect(stripeSrc).toContain('case "checkout.session.expired"');
    // Whitespace-tolerant: the contract is that the expired-session path CALLS
    // the cancel writer with the order, not how that call happens to be wrapped.
    // It is also pinned attempt-scoped (audit HIGH #4) — the expiry of one
    // session says nothing about a different session the customer still has open.
    expect(stripeSrc).toMatch(/markPaymentCanceled\(\s*orderId,\s*\{[^}]*checkoutSessionId:\s*session\.id/);
    // A `completed` session whose payment has not settled is NOT a payment
    // (PromptPay completes the session before the bank settles).
    expect(stripeSrc).toContain("if (!sessionConfirmsPayment(session))");
  });

  test("only the Stripe path writes `paid` to an order (scenario 11)", () => {
    const writers: string[] = [];
    for (const dir of ["backend/routes", "backend/lib", "backend/realtime"]) {
      for (const file of new Bun.Glob(`${dir}/**/*.ts`).scanSync({ cwd: root })) {
        if (/UPDATE orders SET status = 'paid'/.test(read(file))) writers.push(file);
      }
    }
    expect(writers).toEqual([STRIPE_ROUTE]);
  });

  test("the resume request keeps the existing idempotency design (scenario 12)", () => {
    // Layer 1: one durable row per (user, 'payment', request key).
    expect(stripeSrc).toContain("scope = 'payment'");
    expect(stripeSrc).toContain('fail(res, 409, "DUPLICATE_PAYMENT_IN_PROGRESS"');
    // Layer 2: at most one active Stripe payment per order, enforced by the DB.
    expect(read("db/schema.sql")).toContain("idx_payments_one_active_stripe");
    expect(stripeSrc).toContain("AND status IN ('pending', 'requires_action')");
    // A reused session is only handed back for the SAME method.
    expect(stripeSrc).toContain("existing.metadata?.method === method");
  });

  test("the storefront can read the order's rail from the list endpoint", () => {
    const cartSrc = read(CART_ROUTE);
    // The rail is read through the ONE covering-set resolver. The literal this test
    // used to pin — `WHERE order_id = o.id` — answered NULL for a multi-shop
    // purchase, whose only payment row carries `order_id IS NULL`, so the storefront
    // rendered a paid order with no rail (and no payment status) at all.
    expect(cartSrc).toContain("${ORDER_PAYMENT_METHOD_SQL} AS payment_method,");
    expect(cartSrc).toContain("paymentMethod: r.payment_method ?? null,");
    // …and the constant resolves the purchase's whole covering set, so a grouped
    // charge is reachable from EVERY member order.
    const resolver = read("backend/lib/payment-attempt.ts");
    expect(resolver).toContain("export const ORDER_PAYMENT_METHOD_SQL");
    expect(resolver).toContain("FROM (${ORDER_COVERING_PAYMENTS_SQL}) cp");
    expect(resolver).toContain("export const ORDER_COVERING_PAYMENTS_SQL");
  });

  test("the checkout request key stays scoped separately from the payment key", () => {
    // One store, different scopes: a checkout retry and a payment retry can
    // never collide on one key.
    expect(read(CART_ROUTE)).toContain("scope, request_key) VALUES ($1, 'checkout', $2)");
    expect(stripeSrc).toContain("scope, request_key) VALUES ($1, 'payment', $2)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Database-gated: refusals write nothing (scenarios 5, 7, 9, 10)
// ═══════════════════════════════════════════════════════════════════════════

const describeDb = hasTestDatabase() ? describe : describe.skip;

describeDb("resume payment refusals (requires TEST_DATABASE_URL)", () => {
  const PAYMENT_ENV_KEYS = ["STRIPE_SECRET_KEY", "STRIPE_PUBLISHABLE_KEY", "STRIPE_WEBHOOK_SECRET", "STRIPE_MODE"] as const;

  /** A plausible TEST key. It is not a credential: no Stripe call is made. */
  function configureFakeStripe(): void {
    for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
    process.env.STRIPE_SECRET_KEY = "sk_test_000000000000000000000000";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_000000000000000000000000";
  }

  afterEach(() => {
    for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
  });

  /** Seed user → seller → shop → order (+ an optional payment row). */
  async function seedOrder(status: string, method: string | null) {
    const { query } = await import("../db/index.js");
    const tag = `payflow-${crypto.randomUUID()}`;
    const owner = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-owner@test.local`,
      "Payment Flow Owner",
    ]);
    const ownerId = owner.rows[0].id as string;
    const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-seller@test.local`,
      "Payment Flow Seller",
    ]);
    const sellerUserId = sellerUser.rows[0].id as string;
    const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [
      sellerUserId,
    ]);
    const shop = await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
      seller.rows[0].id,
      `${tag} shop`,
      tag,
    ]);
    const order = await query(
      `INSERT INTO orders (user_id, shop_id, order_number, status, total_amount, currency)
       VALUES ($1, $2, $3, $4, 250.00, 'THB') RETURNING id`,
      [ownerId, shop.rows[0].id, `PF-${tag.slice(-12)}`, status],
    );
    const orderId = order.rows[0].id as string;
    if (method) {
      await query(
        `INSERT INTO payments (order_id, provider, method, amount, currency, status)
         VALUES ($1, 'stripe', $2, 250.00, 'THB', 'requires_action')`,
        [orderId, method],
      );
    }
    return { orderId, ownerId, sellerUserId };
  }

  /** Post a resume request as `asUserId` and return the response + order state. */
  async function resumePayment(orderId: string, asUserId: string, method: string) {
    const app = express();
    app.use(express.json());
    app.use(cookieParser());
    setupStripeRoutes(app);
    const server = app.listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      const token = jwt.sign({ userId: asUserId, email: `${asUserId}@test.local` }, process.env.JWT_SECRET!, {
        expiresIn: "1h",
      });
      const res = await fetch(`http://127.0.0.1:${port}/api/stripe/checkout`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `velnox_session=${token}` },
        body: JSON.stringify({ orderId, method, requestKey: crypto.randomUUID() }),
      });
      const body = (await res.json()) as { error?: { code?: string } };
      return { status: res.status, code: body.error?.code };
    } finally {
      server.close();
    }
  }

  /** Read the order back: status plus how many payments exist and are paid. */
  async function orderState(orderId: string) {
    const { query } = await import("../db/index.js");
    const row = (
      await query(
        `SELECT o.status,
                (SELECT count(*)::int FROM payments WHERE order_id = $1) AS payments,
                (SELECT count(*)::int FROM payments WHERE order_id = $1 AND status = 'paid') AS paid,
                (SELECT count(*)::int FROM payments WHERE order_id = $1 AND provider_checkout_session_id IS NOT NULL) AS sessions
           FROM orders o WHERE o.id = $1`,
        [orderId],
      )
    ).rows[0];
    return {
      status: row.status as string,
      payments: Number(row.payments),
      paid: Number(row.paid),
      sessions: Number(row.sessions),
    };
  }

  test("another customer's order is refused and nothing changes (scenario 10)", async () => {
    configureFakeStripe();
    const { orderId, ownerId, sellerUserId } = await seedOrder("pending_payment", "CARD");
    try {
      const res = await resumePayment(orderId, sellerUserId, "CARD");
      expect(res.status).toBe(403);
      expect(res.code).toBe("FORBIDDEN");

      const after = await orderState(orderId);
      // Untouched: still unpaid, still one payment row, no session, never paid.
      expect(after).toEqual({ status: "pending_payment", payments: 1, paid: 0, sessions: 0 });
    } finally {
      await purgeUsers([ownerId, sellerUserId]);
    }
  });

  test("a payment_failed order is refused with INVALID_STATUS and stays unpaid (scenario 7)", async () => {
    configureFakeStripe();
    const { orderId, ownerId, sellerUserId } = await seedOrder("payment_failed", "CARD");
    try {
      const res = await resumePayment(orderId, ownerId, "CARD");
      expect(res.status).toBe(400);
      expect(res.code).toBe("INVALID_STATUS");

      const after = await orderState(orderId);
      expect(after).toEqual({ status: "payment_failed", payments: 1, paid: 0, sessions: 0 });
    } finally {
      await purgeUsers([ownerId, sellerUserId]);
    }
  });

  test("a cancelled order is refused too — an expired session cannot be paid (scenario 9)", async () => {
    configureFakeStripe();
    const { orderId, ownerId, sellerUserId } = await seedOrder("cancelled", "PROMPTPAY");
    try {
      const res = await resumePayment(orderId, ownerId, "PROMPTPAY");
      expect(res.status).toBe(400);
      expect(res.code).toBe("INVALID_STATUS");

      const after = await orderState(orderId);
      expect(after).toEqual({ status: "cancelled", payments: 1, paid: 0, sessions: 0 });
    } finally {
      await purgeUsers([ownerId, sellerUserId]);
    }
  });

  test("a disabled method is refused before any order or payment is touched (scenario 5)", async () => {
    // No Stripe configuration at all: CARD/PROMPTPAY are unavailable, so the
    // request must fail as a configuration refusal — never as a fabricated sale.
    const { orderId, ownerId, sellerUserId } = await seedOrder("pending_payment", null);
    try {
      const res = await resumePayment(orderId, ownerId, "CARD");
      expect(res.status).toBe(503);
      expect(res.code).toBe("STRIPE_NOT_CONFIGURED");

      const after = await orderState(orderId);
      expect(after).toEqual({ status: "pending_payment", payments: 0, paid: 0, sessions: 0 });
    } finally {
      await purgeUsers([ownerId, sellerUserId]);
    }
  });
});
