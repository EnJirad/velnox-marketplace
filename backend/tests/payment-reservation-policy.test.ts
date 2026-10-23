/**
 * Fixed Payment Reservation Policy — exactly 30 minutes, for every order.
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * Stock is reserved inside the order-creation transaction, but the reservation
 * had NO deadline: an order abandoned at Stripe held its units until someone
 * cancelled it or Stripe expired the session (~24 h later). The last unit of a
 * scarce product therefore sat behind an abandoned order while other customers
 * were told it was out of stock.
 *
 * `backend/lib/payment-reservation.ts` fixes that with a CONSTANT window. What is
 * pinned here:
 *
 *    1. the duration is exactly 30 minutes — 1800 s, 1 800 000 ms — and
 *       `expiresAt` is `now` plus exactly that;
 *    2. the policy is a pure function of `now` ALONE: it takes no signals, so no
 *       order can ever get a different window;
 *    3. the module reads no popularity / views / clicks / sales-velocity /
 *       demand / behaviour data — the Part-1 scope boundary is enforced here, not
 *       just documented (v1's risk-based inputs are gone: `payment-reservation.ts`
 *       must not mention them);
 *    4. the stored `reservation_policy` record survives a JSONB round trip and
 *       identifies the policy version, so a v1 row stays distinguishable;
 *    5. COD gets no window at all (no online payment is waited on).
 *
 * No database and no Stripe call is involved: the policy is a pure function of
 * its inputs, which is exactly why it can be tested exhaustively.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import {
  calculatePaymentReservationPolicy,
  isUndefinedColumnError,
  PAYMENT_RESERVATION_EXPIRABLE_STATUSES,
  PAYMENT_RESERVATION_EXPIRED_STATUS,
  PAYMENT_RESERVATION_MINUTES,
  PAYMENT_RESERVATION_MS,
  PAYMENT_RESERVATION_POLICY_VERSION,
  PAYMENT_RESERVATION_REASON,
  PAYMENT_RESERVATION_SECONDS,
  paymentMethodNeedsReservation,
} from "../lib/payment-reservation.js";

const root = join(import.meta.dir, "..", "..");
const POLICY_LIB = "backend/lib/payment-reservation.ts";
const policySource = () => readFileSync(join(root, POLICY_LIB), "utf8");

/**
 * The module with its comments removed — i.e. what the CODE actually does.
 *
 * The file header deliberately documents the v1 risk policy it replaced (that is
 * why a v1 `reservation_policy` row is still distinguishable), so the scope
 * checks below must look at statements, not at prose.
 */
function codeOnly(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("payment reservation policy — the 30-minute fixed window", () => {
  test("the duration is exactly 30 minutes, in every unit the code uses", () => {
    expect(PAYMENT_RESERVATION_MINUTES).toBe(30);
    expect(PAYMENT_RESERVATION_SECONDS).toBe(30 * 60);
    expect(PAYMENT_RESERVATION_SECONDS).toBe(1800);
    expect(PAYMENT_RESERVATION_MS).toBe(30 * 60_000);
    expect(PAYMENT_RESERVATION_MS).toBe(1_800_000);
  });

  test("a policy is always 30 minutes and says so", () => {
    const p = calculatePaymentReservationPolicy();
    expect(p.reservationMinutes).toBe(30);
    expect(p.reservationMinutes).toBe(PAYMENT_RESERVATION_MINUTES);
    expect(p.reason).toBe(PAYMENT_RESERVATION_REASON);
    expect(p.reason).toContain("30-minute");
    expect(p.version).toBe(PAYMENT_RESERVATION_POLICY_VERSION);
  });

  test("expiresAt is `now` plus exactly 30 minutes — never 29, never 31", () => {
    const now = new Date("2026-09-28T00:00:00.000Z");
    expect(calculatePaymentReservationPolicy(now).expiresAt).toBe("2026-09-28T00:30:00.000Z");

    // A less round instant, including crossing an hour and a DST-free day
    // boundary, must land on the same delta.
    for (const iso of [
      "2026-09-28T12:34:56.789Z",
      "2026-09-28T23:45:00.000Z",
      "2026-12-31T23:59:59.999Z",
      "2026-03-01T00:00:00.000Z",
    ]) {
      const start = new Date(iso);
      const expires = new Date(calculatePaymentReservationPolicy(start).expiresAt);
      expect(expires.getTime() - start.getTime()).toBe(PAYMENT_RESERVATION_MS);
      expect(expires.getTime() - start.getTime()).toBe(1_800_000);
    }
  });

  test("the same instant always produces the same decision", () => {
    const now = new Date("2026-09-28T00:00:00.000Z");
    expect(calculatePaymentReservationPolicy(now)).toEqual(calculatePaymentReservationPolicy(now));
  });
});

describe("payment reservation policy — nothing dynamic is involved", () => {
  test("the policy is a function of `now` alone — it accepts no signals", () => {
    // ONE parameter, with a default: a caller cannot pass stock, velocity or a
    // risk level, so no order can be given a different window than any other.
    expect(codeOnly(policySource())).toContain(
      "export function calculatePaymentReservationPolicy(now: Date = new Date())",
    );
  });

  test("the module reads no popularity, views, clicks, velocity or demand data", () => {
    const source = codeOnly(policySource());
    for (const forbidden of [
      "salesVelocity",
      "unitsSold",
      "stockCoverage",
      "velocityWindow",
      "riskLevel",
      "CRITICAL",
      "VERY_LOW",
      "isPromoted",
      "featured",
      "view_count",
      "click",
    ]) {
      expect(source).not.toContain(forbidden);
    }
    // …and no signal-gathering query is left behind either.
    expect(source).not.toContain("gatherOrderReservationSignals");
    expect(source).not.toContain("order_items");
  });

  test("no risk → window table survives, and no second duration is defined", () => {
    const source = codeOnly(policySource());
    // v1 exported MIN/MAX/DEFAULT and a RISK_MINUTES table; Part 1 has ONE number.
    expect(source).not.toContain("PAYMENT_RESERVATION_MAX_MINUTES");
    expect(source).not.toContain("PAYMENT_RESERVATION_MIN_MINUTES");
    expect(source).not.toContain("PAYMENT_RESERVATION_RISK_MINUTES");
    expect(source).toContain("PAYMENT_RESERVATION_MINUTES = 30");
  });
});

describe("payment reservation policy — the stored record and the sweep's scope", () => {
  test("the stored policy survives a JSONB round trip unchanged", () => {
    // `orders.reservation_policy` is JSONB: what the audit trail holds is the
    // serialised policy, so it must be lossless and version-tagged.
    const p = calculatePaymentReservationPolicy(new Date("2026-09-28T00:00:00.000Z"));
    const roundTripped = JSON.parse(JSON.stringify(p)) as typeof p;
    expect(roundTripped).toEqual(p);
    expect(roundTripped.expiresAt).toBe("2026-09-28T00:30:00.000Z");
    expect(roundTripped.reservationMinutes).toBe(30);
    // A v1 row carried the risk inputs; a Part-1 row must not, so the audit
    // trail never implies the window depended on behaviour.
    expect(Object.keys(roundTripped).sort()).toEqual([
      "expiresAt",
      "reason",
      "reservationMinutes",
      "version",
    ]);
  });

  test("COD waits on no online payment, so it gets no window", () => {
    expect(paymentMethodNeedsReservation("cod")).toBe(false);
    expect(paymentMethodNeedsReservation("COD")).toBe(false);
    expect(paymentMethodNeedsReservation(" cash_on_delivery ")).toBe(false);
    expect(paymentMethodNeedsReservation("CARD")).toBe(true);
    expect(paymentMethodNeedsReservation("PROMPTPAY")).toBe(true);
    // Unknown / missing rails are treated as waiting on a payment — the safe
    // direction, because a window can never leak stock forever.
    expect(paymentMethodNeedsReservation(undefined)).toBe(true);
    expect(paymentMethodNeedsReservation(null)).toBe(true);
  });

  test("only `undefined_column` is tolerated — a deploy may precede its migration", () => {
    // The reservation write runs inside a SAVEPOINT and swallows EXACTLY this
    // code, so a backend deployed before `db/migrations/048_payment_reservation.sql`
    // keeps checkout working instead of breaking every order. Any other error
    // must still abort the caller's transaction.
    expect(isUndefinedColumnError({ code: "42703" })).toBe(true);
    expect(isUndefinedColumnError({ code: "42P01" })).toBe(false);
    expect(isUndefinedColumnError({ code: "23505" })).toBe(false);
    expect(isUndefinedColumnError(new Error("boom"))).toBe(false);
    expect(isUndefinedColumnError(null)).toBe(false);
    expect(isUndefinedColumnError(undefined)).toBe(false);
    expect(isUndefinedColumnError("42703")).toBe(false);
  });

  test("the expiry sweep only ever touches pre-payment statuses", () => {
    expect([...PAYMENT_RESERVATION_EXPIRABLE_STATUSES]).toEqual(["pending", "pending_payment"]);
    expect(PAYMENT_RESERVATION_EXPIRED_STATUS).toBe("expired");
  });
});
