/**
 * Payment-UX contract (2026-11-02).
 *
 * SOURCE-LEVEL guards for the countdown + typed-error work. They do not replace
 * behavioural tests: a real countdown needs a browser clock and a real resume
 * needs a live Stripe session, and both are reported as NOT RUN where they could
 * not be executed. What is pinned here is that the ONE countdown source is still
 * `paymentExpiresAt`, that the pay action stays gated by server payability, and
 * that the two backend error codes get specific copy + a resume path instead of a
 * generic "payment failed".
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const DETAIL = "apps/velshop/src/pages/ShopOrderDetail.tsx";
const ORDERS = "apps/velshop/src/pages/MyOrders.tsx";
const RESUME = "apps/velshop/src/components/shop/ResumePaymentButton.tsx";
const LOCALES = "packages/shared/src/lib/i18n/locales/index.ts";

describe("countdown uses the server deadline, once", () => {
  test("order detail renders the reservation remaining time from the API", () => {
    const src = read(DETAIL);
    // `reservation.remainingMs` is derived from `order.paymentExpiresAt`; the
    // component never invents a deadline from a client timestamp.
    expect(src).toContain("reservation.remainingMs");
    expect(src).toContain("paymentReservationProgress(");
    expect(src).toContain("paymentExpiresAt");
  });

  test("the pay action is gated by server payability, not by the clock", () => {
    const src = read(DETAIL);
    // An expired/lapsed reservation refuses the button: no blind reuse.
    expect(src).toContain("payability.payable");
    expect(src).toContain("orderStripePayability(order)");
    // The hero and the footer action both come from that one decision.
    expect(src.split("payability.payable").length - 1).toBeGreaterThanOrEqual(2);
  });

  test("the order list keeps its own ticking clock (one per-order deadline)", () => {
    const src = read(ORDERS);
    expect(src).toContain("setInterval(() => setNow(Date.now()), 1000)");
    expect(src).toContain("paymentExpiresAt");
  });
});

describe("payment errors map to specific copy and a resume path", () => {
  const src = read(RESUME);

  test("the machine-readable code is read, not the raw server text", () => {
    expect(src).toContain("ApiError");
    expect(src).toContain('firstErr.code === "DUPLICATE_PAYMENT_IN_PROGRESS"');
  });

  test("a duplicate attempt resumes instead of failing generically", () => {
    // One retry with the SAME rail: the backend answers with the open session.
    expect(src.split("await createStripeCheckout({").length - 1).toBe(2);
    expect(src).toContain('t("checkout.paymentAlreadyInProgress")');
  });

  test("INVALID_STATUS explains the closed window", () => {
    expect(src).toContain('code === "INVALID_STATUS"');
    expect(src).toContain('t("checkout.paymentNoLongerAvailable")');
  });

  test("a session is never assumed paid client-side", () => {
    expect(src).not.toContain('status = "paid"');
    expect(src).not.toContain("markPaid");
  });
});

describe("the new copy exists in all three locales", () => {
  test("th/en/my carry both payment-UX strings", () => {
    const src = read(LOCALES);
    for (const key of ["paymentNoLongerAvailable", "paymentAlreadyInProgress"]) {
      // One definition per locale patch = three occurrences of each key.
      expect(src.split(key).length - 1).toBe(3);
    }
  });
});
