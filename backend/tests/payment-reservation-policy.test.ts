/**
 * Dynamic Payment Reservation Policy V1 — the risk → window decision.
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * Stock is reserved inside the order-creation transaction, but the reservation
 * had NO deadline: an order abandoned at Stripe held its units until someone
 * cancelled it or Stripe expired the session (~24 h later). The last unit of a
 * scarce product therefore sat behind an abandoned order while other customers
 * were told it was out of stock.
 *
 * `backend/lib/payment-reservation.ts` fixes that with a DETERMINISTIC,
 * rule-based window derived only from data this schema really stores (stock,
 * `products.featured`, trailing sales velocity). What is pinned here:
 *
 *    1. the default is 30 minutes;
 *    2. every risk level maps to its documented window (CRITICAL 15, HIGH 20,
 *       NORMAL 30, LOW 45, VERY_LOW 60);
 *    3. the V1 hard limits (MIN 10, MAX 60) cannot be escaped, not even by a
 *       future edit to the risk table;
 *    4. the decisions are deterministic and their reasons are auditable;
 *    5. COD gets no window at all (no online payment is waited on).
 *
 * No database and no Stripe call is involved: the policy is a pure function of
 * its inputs, which is exactly why it can be tested exhaustively.
 */
import { describe, expect, test } from "bun:test";

import {
  calculatePaymentReservationPolicy,
  clampReservationMinutes,
  deriveDemandMetrics,
  PAYMENT_RESERVATION_DEFAULT_MINUTES,
  PAYMENT_RESERVATION_EXPIRABLE_STATUSES,
  PAYMENT_RESERVATION_EXPIRED_STATUS,
  PAYMENT_RESERVATION_MAX_MINUTES,
  PAYMENT_RESERVATION_MIN_MINUTES,
  PAYMENT_RESERVATION_POLICY_VERSION,
  PAYMENT_RESERVATION_RISK_LEVELS,
  PAYMENT_RESERVATION_RISK_MINUTES,
  PAYMENT_RESERVATION_SOLD_STATUSES,
  PAYMENT_RESERVATION_THRESHOLDS,
  paymentMethodNeedsReservation,
  type PaymentReservationSignals,
} from "../lib/payment-reservation.js";

/** Build a signal set from real-shaped numbers, deriving velocity/coverage. */
function sig(over: Partial<PaymentReservationSignals> = {}): PaymentReservationSignals {
  const availableStock = over.availableStock === undefined ? 15 : over.availableStock;
  const unitsSold7d = over.unitsSold7d ?? 0;
  return {
    availableStock,
    totalStock: over.totalStock === undefined ? availableStock : over.totalStock,
    reservedStock: over.reservedStock ?? 0,
    unitsSold7d,
    isPromoted: over.isPromoted ?? false,
    itemLines: over.itemLines ?? 1,
    ...deriveDemandMetrics(availableStock, unitsSold7d),
    ...over,
  };
}

const policy = (over: Partial<PaymentReservationSignals> = {}, now?: Date) =>
  calculatePaymentReservationPolicy(sig(over), now);

describe("payment reservation policy V1 — risk → window", () => {
  test("an ordinary order gets the 30-minute default", () => {
    const p = policy({ availableStock: 15 });
    expect(p.riskLevel).toBe("NORMAL");
    expect(p.reservationMinutes).toBe(PAYMENT_RESERVATION_DEFAULT_MINUTES);
    expect(p.reservationMinutes).toBe(30);
    expect(p.reason).toBe("standard stock and demand");
    expect(p.version).toBe(PAYMENT_RESERVATION_POLICY_VERSION);
  });

  test("critical stock (≤2 available) gets 15 minutes", () => {
    for (const available of [2, 1, 0]) {
      const p = policy({ availableStock: available });
      expect(p.riskLevel).toBe("CRITICAL");
      expect(p.reservationMinutes).toBe(15);
      expect(p.reason).toContain("critical stock");
    }
  });

  test("scarce stock with active demand (≤5 available, ≥1 unit/day) gets 15 minutes", () => {
    // 14 units in the 7-day window → 2/day.
    const p = policy({ availableStock: 5, unitsSold7d: 14 });
    expect(p.riskLevel).toBe("CRITICAL");
    expect(p.reservationMinutes).toBe(15);
    expect(p.reason).toContain("scarce stock");
    expect(p.reason).toContain("active demand");
  });

  test("a promoted (spotlight/flash-style) item that is scarce gets 15 minutes", () => {
    // The schema has no flash-sale column; `products.featured` is the platform's
    // real promotion signal, and this is the branch that maps it to the
    // shortest window.
    const p = policy({ availableStock: 4, isPromoted: true, unitsSold7d: 0 });
    expect(p.riskLevel).toBe("CRITICAL");
    expect(p.reservationMinutes).toBe(15);
    expect(p.reason).toContain("promoted");
  });

  test("under 1.5 days of stock cover gets 15 minutes", () => {
    // 20 available, 14 units/day → 1.43 days of cover.
    const p = policy({ availableStock: 20, unitsSold7d: 98 });
    expect(p.riskLevel).toBe("CRITICAL");
    expect(p.reservationMinutes).toBe(15);
    expect(p.reason).toContain("stock cover");
  });

  test("tight stock (≤10 available) gets 20 minutes", () => {
    for (const available of [10, 9, 3]) {
      const p = policy({ availableStock: available });
      expect(p.riskLevel).toBe("HIGH");
      expect(p.reservationMinutes).toBe(20);
      expect(p.reason).toContain("tight stock");
    }
  });

  test("moderate stock with active demand (≤20 available, ≥1 unit/day) gets 20 minutes", () => {
    const p = policy({ availableStock: 20, unitsSold7d: 7 });
    expect(p.riskLevel).toBe("HIGH");
    expect(p.reservationMinutes).toBe(20);
    expect(p.reason).toContain("active demand");
  });

  test("under 3 days of stock cover gets 20 minutes", () => {
    // 30 available, 12 units/day → 2.5 days of cover.
    const p = policy({ availableStock: 30, unitsSold7d: 84 });
    expect(p.riskLevel).toBe("HIGH");
    expect(p.reservationMinutes).toBe(20);
    expect(p.reason).toContain("stock cover");
  });

  test("ample stock with low demand gets 45 minutes", () => {
    // 40 available, 0.29 units/day → ~140 days of cover.
    const p = policy({ availableStock: 40, unitsSold7d: 2 });
    expect(p.riskLevel).toBe("LOW");
    expect(p.reservationMinutes).toBe(45);
    expect(p.reason).toContain("low demand");
  });

  test("very high stock with negligible demand gets 60 minutes", () => {
    // 100 available, 0.14 units/day → 700 days of cover.
    const p = policy({ availableStock: 100, unitsSold7d: 1 });
    expect(p.riskLevel).toBe("VERY_LOW");
    expect(p.reservationMinutes).toBe(60);
    expect(p.reason).toContain("negligible demand");
  });

  test("a busy product does not get a long window just because stock is high", () => {
    // 100 available but 0.43 units/day is NOT negligible → LOW, not VERY_LOW.
    expect(policy({ availableStock: 100, unitsSold7d: 3 }).reservationMinutes).toBe(45);
    // 30 available at 3 units/day → 10 days of cover but real demand → NORMAL.
    expect(policy({ availableStock: 30, unitsSold7d: 21 }).reservationMinutes).toBe(30);
  });

  test("a promoted item never earns the long windows", () => {
    const p = policy({ availableStock: 60, unitsSold7d: 0, isPromoted: true });
    expect(p.riskLevel).toBe("NORMAL");
    expect(p.reservationMinutes).toBe(30);
  });

  test("an unknown stock level falls back to the default window, never to a guess", () => {
    // No product row / no inventory row: we cannot judge scarcity, so the
    // standard window is applied and the reason says so.
    const p = policy({ availableStock: null, totalStock: null, reservedStock: null, itemLines: 0 });
    expect(p.riskLevel).toBe("NORMAL");
    expect(p.reservationMinutes).toBe(30);
    expect(p.reason).toContain("unknown");
  });

  test("the reason is always non-empty and names the branch that fired", () => {
    const cases: Array<[Partial<PaymentReservationSignals>, string]> = [
      [{ availableStock: 1 }, "critical stock"],
      [{ availableStock: 8 }, "tight stock"],
      [{ availableStock: 15 }, "standard stock"],
      [{ availableStock: 40, unitsSold7d: 2 }, "ample stock"],
      [{ availableStock: 100, unitsSold7d: 0 }, "deep stock"],
    ];
    for (const [input, fragment] of cases) {
      const p = policy(input);
      expect(p.reason.length).toBeGreaterThan(0);
      expect(p.reason).toContain(fragment);
    }
  });
});

describe("payment reservation policy V1 — the hard limits", () => {
  test("MIN 10 / MAX 60 / DEFAULT 30 are the documented values", () => {
    expect(PAYMENT_RESERVATION_MIN_MINUTES).toBe(10);
    expect(PAYMENT_RESERVATION_MAX_MINUTES).toBe(60);
    expect(PAYMENT_RESERVATION_DEFAULT_MINUTES).toBe(30);
  });

  test("every level in the risk table is already inside the limits", () => {
    for (const level of PAYMENT_RESERVATION_RISK_LEVELS) {
      const minutes = PAYMENT_RESERVATION_RISK_MINUTES[level];
      expect(minutes).toBeGreaterThanOrEqual(PAYMENT_RESERVATION_MIN_MINUTES);
      expect(minutes).toBeLessThanOrEqual(PAYMENT_RESERVATION_MAX_MINUTES);
      // …and clamping is a no-op on a legal value (the table is a fixed point).
      expect(clampReservationMinutes(minutes)).toBe(minutes);
    }
    expect(Object.keys(PAYMENT_RESERVATION_RISK_MINUTES).sort()).toEqual(
      [...PAYMENT_RESERVATION_RISK_LEVELS].sort(),
    );
  });

  test("the risk → time table is exactly the documented one", () => {
    expect(PAYMENT_RESERVATION_RISK_MINUTES).toEqual({
      CRITICAL: 15,
      HIGH: 20,
      NORMAL: 30,
      LOW: 45,
      VERY_LOW: 60,
    });
  });

  test("clamping can neither go below MIN nor above MAX", () => {
    expect(clampReservationMinutes(-100)).toBe(10);
    expect(clampReservationMinutes(0)).toBe(10);
    expect(clampReservationMinutes(5)).toBe(10);
    expect(clampReservationMinutes(10)).toBe(10);
    expect(clampReservationMinutes(20.4)).toBe(20);
    expect(clampReservationMinutes(60)).toBe(60);
    expect(clampReservationMinutes(61)).toBe(60);
    expect(clampReservationMinutes(10_000)).toBe(60);
    expect(clampReservationMinutes(Number.NaN)).toBe(30);
    expect(clampReservationMinutes(Number.POSITIVE_INFINITY)).toBe(30);
  });

  test("a policy built from ANY signal combination obeys the limits", () => {
    const stocks = [null, 0, 1, 2, 3, 5, 8, 10, 15, 20, 21, 40, 50, 60, 100, 5000];
    const sold = [0, 1, 3, 7, 14, 98, 700];
    for (const availableStock of stocks) {
      for (const unitsSold7d of sold) {
        for (const isPromoted of [false, true]) {
          const p = policy({ availableStock, unitsSold7d, isPromoted });
          expect(p.reservationMinutes).toBeGreaterThanOrEqual(PAYMENT_RESERVATION_MIN_MINUTES);
          expect(p.reservationMinutes).toBeLessThanOrEqual(PAYMENT_RESERVATION_MAX_MINUTES);
          expect(PAYMENT_RESERVATION_RISK_LEVELS).toContain(p.riskLevel);
        }
      }
    }
  });
});

describe("payment reservation policy V1 — determinism, expiry and method scope", () => {
  test("the same signals always produce the same decision", () => {
    const first = policy({ availableStock: 4, unitsSold7d: 14, isPromoted: true });
    const second = policy({ availableStock: 4, unitsSold7d: 14, isPromoted: true });
    expect(second).toEqual(first);
  });

  test("expiresAt is `now` plus exactly the chosen window", () => {
    const now = new Date("2026-09-28T00:00:00.000Z");
    expect(policy({ availableStock: 1 }, now).expiresAt).toBe("2026-09-28T00:15:00.000Z");
    expect(policy({ availableStock: 8 }, now).expiresAt).toBe("2026-09-28T00:20:00.000Z");
    expect(policy({ availableStock: 15 }, now).expiresAt).toBe("2026-09-28T00:30:00.000Z");
    expect(policy({ availableStock: 40, unitsSold7d: 2 }, now).expiresAt).toBe("2026-09-28T00:45:00.000Z");
    expect(policy({ availableStock: 100, unitsSold7d: 0 }, now).expiresAt).toBe("2026-09-28T01:00:00.000Z");
  });

  test("the stored policy survives a JSONB round trip unchanged", () => {
    // `orders.reservation_policy` is JSONB: what the audit trail holds is the
    // serialised policy, so it must be lossless.
    const p = policy({ availableStock: 5, unitsSold7d: 14, reservedStock: 3, totalStock: 20, itemLines: 2 });
    const roundTripped = JSON.parse(JSON.stringify(p)) as typeof p;
    expect(roundTripped).toEqual(p);
    expect(roundTripped.signals.availableStock).toBe(5);
    expect(roundTripped.signals.salesVelocityPerDay).toBeCloseTo(2, 6);
    expect(roundTripped.signals.stockCoverageDays).toBeCloseTo(2.5, 6);
  });

  test("demand metrics derive from the trailing window, and zero demand means no cover figure", () => {
    expect(deriveDemandMetrics(30, 7)).toEqual({ salesVelocityPerDay: 1, stockCoverageDays: 30 });
    expect(deriveDemandMetrics(30, 0)).toEqual({ salesVelocityPerDay: 0, stockCoverageDays: null });
    expect(deriveDemandMetrics(null, 7)).toEqual({ salesVelocityPerDay: 1, stockCoverageDays: null });
    expect(PAYMENT_RESERVATION_THRESHOLDS.velocityWindowDays).toBe(7);
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

  test("the expiry sweep only ever touches pre-payment statuses", () => {
    expect([...PAYMENT_RESERVATION_EXPIRABLE_STATUSES]).toEqual(["pending", "pending_payment"]);
    expect(PAYMENT_RESERVATION_EXPIRED_STATUS).toBe("expired");
    // A sale counts whether it came through Stripe (`paid`) or through the COD /
    // VelRepeat rails (which never pass through `paid`).
    expect([...PAYMENT_RESERVATION_SOLD_STATUSES]).toEqual([
      "paid",
      "confirmed",
      "shipped",
      "delivered",
      "completed",
    ]);
  });
});
