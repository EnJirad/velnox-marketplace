/**
 * MEDIUM #8 — the duplicated reservation-urgency contracts in `commerce.ts`.
 *
 * WHAT THIS FILE IS ABOUT
 * ----------------------
 * `packages/shared/src/lib/commerce.ts` used to carry TWO independent urgency
 * scales for the same 30-minute payment reservation:
 *
 *   1. `PAYMENT_RESERVATION_URGENT_MS = 3 min` → `paymentReservationPhase()`
 *      answered `"urgent"` for the last three minutes;
 *   2. `PAYMENT_RESERVATION_YELLOW_MS = 15 min` / `PAYMENT_RESERVATION_RED_MS =
 *      5 min` → `paymentReservationTone()` answered green / yellow / red.
 *
 * The audit's expectation was "ONE urgency authority". Before removing
 * anything, the question had to be answered from source rather than from the
 * names:
 *
 *   • Both were live exports, and both order surfaces (`MyOrders.tsx`,
 *     `ShopOrderDetail.tsx`) imported both.
 *   • But EVERY comparison against the phase value in the repository read
 *     `phase === "active" || phase === "urgent"` — no consumer ever
 *     distinguished the two. The 3-minute tier could therefore not change a
 *     single pixel.
 *   • The urgency that users actually see (colour + the translated
 *     `windowNote` / `urgentNote` / `criticalNote`) is selected from the TONE,
 *     which escalates at 15 min and 5 min.
 *
 * §38 of the handoff shipped the 3-minute phase tier; §39 added the tone tiers
 * and the progress bar but left the old tier behind. It was a superseded
 * remnant, so it was removed. The countdown now runs continuously from 30:00
 * to 00:01 and the NOTE/COLOUR escalate instead.
 *
 * WHAT IS PINNED HERE
 * -------------------
 *   1. the tone is the single urgency authority, and both real surfaces use it;
 *   2. the removed 3-minute tier has NO consumer left anywhere in the repo;
 *   3. `paymentExpiresAt` keeps its exact parsing / window / expiry semantics;
 *   4. `reservationMinutes` keeps its exact meaning (the progress denominator
 *      only — never a fabricated value);
 *   5. the 30-minute policy is unchanged and still has exactly ONE definition,
 *      in the backend;
 *   6. payment state (`orderStripePayability`) is unchanged;
 *   7. order state (`isOrderPayable` / cancellation) is unchanged;
 *   8. no second source of truth was introduced.
 *
 * These are behavioural and cross-file assertions, not "read a constant and
 * assert it equals itself": every urgency claim is checked against what the
 * pages actually do with it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

import {
  CUSTOMER_CANCELABLE_ORDER_STATUSES,
  isOrderCancelableByCustomer,
  isOrderPayable,
  orderStripePayability,
  PAYMENT_RESERVATION_RED_MS,
  PAYMENT_RESERVATION_YELLOW_MS,
  paymentReservationPhase,
  paymentReservationProgress,
  paymentReservationState,
  paymentReservationTone,
  type PaymentReservationPhase,
  type PaymentReservationTone,
} from "../../packages/shared/src/lib/commerce.ts";
import {
  PAYMENT_RESERVATION_MINUTES,
  PAYMENT_RESERVATION_MS,
} from "../lib/payment-reservation.ts";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const MY_ORDERS_PAGE = "apps/velshop/src/pages/MyOrders.tsx";
const ORDER_DETAIL_PAGE = "apps/velshop/src/pages/ShopOrderDetail.tsx";
const COMMERCE = "packages/shared/src/lib/commerce.ts";

/** Every `.ts`/`.tsx` file under a directory, skipping build output. */
function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(root, dir))) {
    if (entry === "node_modules" || entry === "dist") continue;
    const rel = `${dir}/${entry}`;
    if (statSync(join(root, rel)).isDirectory()) out.push(...sourceFiles(rel));
    else if (/\.tsx?$/.test(rel) && !rel.endsWith(".d.ts")) out.push(rel);
  }
  return out;
}

const APP_SOURCE = [...sourceFiles("apps"), ...sourceFiles("packages/shared/src")];

/**
 * The source with comments removed, so a scan for a removed symbol is not
 * satisfied (or defeated) by prose that legitimately explains its removal.
 */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/^\s*\/\/.*$/gm, " ");
}

const NOW = 1_800_000_000_000;
/** An order `remainingMs` from the deadline, at a fixed clock. */
const at = (remainingMs: number, status: unknown = "pending_payment") => ({
  status,
  paymentExpiresAt: NOW + remainingMs,
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. The tone is the ONE urgency authority, and both surfaces use it
// ═══════════════════════════════════════════════════════════════════════════

describe("MEDIUM #8 — paymentReservationTone is the single urgency authority", () => {
  test("it answers four tiers on the documented boundaries", () => {
    expect(paymentReservationTone(PAYMENT_RESERVATION_MS + 1)).toBe("green");
    expect(paymentReservationTone(PAYMENT_RESERVATION_YELLOW_MS + 1)).toBe("green");
    expect(paymentReservationTone(PAYMENT_RESERVATION_YELLOW_MS)).toBe("yellow");
    expect(paymentReservationTone(PAYMENT_RESERVATION_RED_MS + 1)).toBe("yellow");
    expect(paymentReservationTone(PAYMENT_RESERVATION_RED_MS)).toBe("red");
    expect(paymentReservationTone(1)).toBe("red");
    // …and it is monotonic: more time is never more alarming.
    const tiers: PaymentReservationTone[] = [
      paymentReservationTone(30 * 60_000),
      paymentReservationTone(14 * 60_000),
      paymentReservationTone(4 * 60_000),
      paymentReservationTone(0),
    ];
    expect(tiers).toEqual(["green", "yellow", "red", "expired"]);
  });

  test("BOTH order surfaces select the translated note from the tone", () => {
    // This is what makes the tone the real authority rather than a dangling
    // export: the note the customer reads is chosen by the tier, on both pages.
    for (const page of [MY_ORDERS_PAGE, ORDER_DETAIL_PAGE]) {
      const src = read(page);
      expect(src).toContain("paymentReservationTone(");
      expect(src).toMatch(/=== "red"\s*\?\s*t\(\s*"orderReservation\.criticalNote"\s*\)/);
      expect(src).toMatch(/=== "yellow"\s*\?\s*t\(\s*"orderReservation\.urgentNote"\s*\)/);
      expect(src).toContain('t("orderReservation.windowNote")');
    }
  });

  test("BOTH order surfaces colour the clock from the tone", () => {
    for (const page of [MY_ORDERS_PAGE, ORDER_DETAIL_PAGE]) {
      // Whitespace-tolerant: the list keys one `Record<…, string>` per aspect,
      // the detail page one `Record<…, {…}>`.
      expect(read(page)).toMatch(/Record<\s*PaymentReservationTone\s*,/);
    }
  });

  test("the four tone tiers are exhaustive, so no UI branch is unreachable", () => {
    const tiers: PaymentReservationTone[] = ["green", "yellow", "red", "expired"];
    // Every tier is reachable from a real remaining time…
    for (const tier of tiers) {
      const ms = { green: PAYMENT_RESERVATION_MS, yellow: 10 * 60_000, red: 60_000, expired: 0 }[tier];
      expect(paymentReservationTone(ms)).toBe(tier);
    }
    // …and every one has a style entry on both pages, or a tier could render
    // unstyled (undefined) the moment a fourth colour was ever added.
    for (const page of [MY_ORDERS_PAGE, ORDER_DETAIL_PAGE]) {
      const src = read(page);
      // Anchor on the style map itself, not the import (the list and the detail
      // page format `Record<PaymentReservationTone, …>` differently).
      const anchor = /Record<\s*PaymentReservationTone/.exec(src);
      expect(anchor).not.toBeNull();
      const mapBlock = src.slice(anchor!.index, anchor!.index + 2000);
      for (const tier of tiers) {
        expect(mapBlock).toContain(`${tier}:`);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The removed 3-minute tier has NO consumer left
// ═══════════════════════════════════════════════════════════════════════════

describe("MEDIUM #8 — the second urgency scale is gone, with no consumer left", () => {
  test("`PAYMENT_RESERVATION_URGENT_MS` no longer exists in any production source", () => {
    // Tests are excluded on purpose: this file has to NAME the removed symbol to
    // prove it is gone, and the shared module's doc comment explains WHY it was
    // removed. Comments are stripped, so what is asserted is that no shipped
    // file DECLARES, imports or calls it.
    const shipped = [...APP_SOURCE, ...sourceFiles("backend").filter((f) => !f.includes("/tests/"))];
    for (const file of shipped) {
      expect(code(file)).not.toContain("PAYMENT_RESERVATION_URGENT_MS");
    }
  });

  test("`\"urgent\"` is not a phase any consumer can produce or test for", () => {
    // Type-level: the union no longer has the member…
    const phases: PaymentReservationPhase[] = ["none", "active", "expired"];
    expect(phases).toHaveLength(3);
    // …and behaviourally the function never returns it.
    for (const remainingMs of [
      PAYMENT_RESERVATION_MS,
      3 * 60_000,
      2 * 60_000 + 13_000,
      1_000,
      -1,
    ]) {
      expect(phases).toContain(paymentReservationPhase(at(remainingMs), NOW));
    }
    // No source file anywhere still compares a phase against "urgent".
    for (const file of APP_SOURCE) {
      expect(read(file)).not.toMatch(/Phase\s*===\s*"urgent"|phase\s*===\s*"urgent"/i);
    }
  });

  test("the phase is now a pure window-visibility predicate", () => {
    // Exactly the three states the storefront branches on, and nothing else.
    expect(paymentReservationPhase(at(PAYMENT_RESERVATION_MS), NOW)).toBe("active");
    expect(paymentReservationPhase(at(-1), NOW)).toBe("expired");
    expect(paymentReservationPhase(at(PAYMENT_RESERVATION_MS, "paid"), NOW)).toBe("none");
    expect(paymentReservationPhase(null, NOW)).toBe("none");
  });

  test("a running window renders CONTINUOUSLY, so no second threshold can be hiding", () => {
    // The user-visible promise of removing the 3-minute tier: the countdown is
    // never switched off early, and it never becomes "urgent" as a state.
    const samples = [30, 25, 15, 10, 5, 3, 2, 1, 0.5].map((m) => m * 60_000);
    for (const remainingMs of samples) {
      expect(paymentReservationPhase(at(remainingMs), NOW)).toBe("active");
    }
    // Meanwhile the alarm escalates smoothly across those same samples.
    expect(samples.map((ms) => paymentReservationTone(ms))).toEqual([
      "green",
      "green",
      "yellow",
      "yellow",
      "red",
      "red",
      "red",
      "red",
      "red",
    ]);
  });

  test("both surfaces gate the countdown on the single open phase", () => {
    const list = read(MY_ORDERS_PAGE);
    const detail = read(ORDER_DETAIL_PAGE);
    expect(list).toContain('reservationPhase === "active"');
    expect(detail).toContain('const reservationOpen = reservationPhase === "active";');
    // A paid order (phase "none") still cannot render a countdown.
    for (const src of [list, detail]) {
      expect(src).toContain('reservationPhase === "expired"');
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. `paymentExpiresAt` keeps its exact semantics
// ═══════════════════════════════════════════════════════════════════════════

describe("MEDIUM #8 — paymentExpiresAt semantics are unchanged", () => {
  test("it is read as epoch ms", () => {
    const state = paymentReservationState({ paymentExpiresAt: NOW + 60_000 }, NOW);
    expect(state.hasWindow).toBe(true);
    expect(state.expiresAt).toBe(NOW + 60_000);
    expect(state.remainingMs).toBe(60_000);
    expect(state.expired).toBe(false);
  });

  test("it is read as an ISO string identically", () => {
    const iso = new Date(NOW + 60_000).toISOString();
    const state = paymentReservationState({ paymentExpiresAt: iso }, NOW);
    expect(state.expiresAt).toBe(NOW + 60_000);
    expect(state.remainingMs).toBe(60_000);
  });

  test("junk yields NO window rather than a wrong one", () => {
    for (const raw of [null, undefined, "not-a-date", Number.NaN, Infinity, {}, []]) {
      const state = paymentReservationState({ paymentExpiresAt: raw }, NOW);
      expect(state.hasWindow).toBe(false);
      expect(state.expiresAt).toBeNull();
      expect(state.remainingMs).toBe(0);
      expect(paymentReservationPhase({ status: "pending_payment", paymentExpiresAt: raw }, NOW)).toBe("none");
    }
  });

  test("remaining time never goes negative, and a lapsed window is `expired`", () => {
    const state = paymentReservationState(at(-25_000), NOW);
    expect(state.remainingMs).toBe(0);
    expect(state.expired).toBe(true);
    expect(state.hasWindow).toBe(true);
    expect(paymentReservationPhase(at(-25_000), NOW)).toBe("expired");
  });

  test("a decided order keeps its deadline but is not a countdown", () => {
    for (const status of ["paid", "cancelled", "shipped", "refunded"]) {
      const state = paymentReservationState(at(20 * 60_000, status), NOW);
      expect(state.hasWindow).toBe(false);
      expect(state.expired).toBe(true);
      expect(state.remainingMs).toBe(0);
      // The stored deadline is still readable for audit.
      expect(state.expiresAt).toBe(NOW + 20 * 60_000);
    }
  });

  test("the deadline is the only clock — no page recomputes it", () => {
    // The UI must not fabricate a deadline (that is how a client clock became a
    // second source of truth in the first place).
    for (const page of [MY_ORDERS_PAGE, ORDER_DETAIL_PAGE]) {
      const src = read(page);
      expect(src).not.toMatch(/paymentExpiresAt\s*:/);
      expect(src).not.toMatch(/paymentExpiresAt\s*=\s*Date\.now/);
    }
    // And both read routes still map the column onto the camelCase field.
    const cart = read("backend/routes/cart.ts");
    expect(cart).toMatch(/paymentExpiresAt\s*:/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. `reservationMinutes` keeps its exact meaning: the bar's denominator only
// ═══════════════════════════════════════════════════════════════════════════

describe("MEDIUM #8 — reservationMinutes semantics are unchanged", () => {
  test("it is the progress denominator, and nothing else", () => {
    const total = 30 * 60_000;
    expect(paymentReservationProgress(total, total)).toBe(1);
    expect(paymentReservationProgress(total / 2, total)).toBe(0.5);
    expect(paymentReservationProgress(0, total)).toBe(0);
    expect(paymentReservationProgress(total * 4, total)).toBe(1);
  });

  test("an unknown window yields NO bar rather than an invented denominator", () => {
    // `reservationMinutes` is nullable precisely so a missing value draws no
    // bar; the clock keeps running off the backend deadline regardless.
    for (const unknown of [null, undefined, 0, -1, Number.NaN, Infinity]) {
      expect(paymentReservationProgress(60_000, unknown)).toBeNull();
    }
  });

  test("the pages take the denominator from the API, never from a literal 30", () => {
    for (const page of [MY_ORDERS_PAGE, ORDER_DETAIL_PAGE]) {
      const src = read(page);
      expect(src).toMatch(
        /reservationMinutes\s*\?\s*order\.reservationMinutes \* 60_000\s*:\s*null/,
      );
      // No hard-coded 30-minute denominator may creep into the progress bar.
      expect(src).not.toMatch(/reservationProgress\([^)]*,\s*30\s*\*\s*60_000/);
      expect(src).not.toMatch(/reservationProgress\([^)]*,\s*1_800_000/);
    }
  });

  test("both read routes expose the window length from the stored policy", () => {
    const cart = read("backend/routes/cart.ts");
    const hits = cart.match(/reservationMinutes:\s*[^,]+,/g) ?? [];
    expect(hits.length).toBeGreaterThanOrEqual(2);
    for (const hit of hits) {
      expect(hit).toContain("reservation_policy");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. The 30-minute policy is unchanged and has exactly one definition
// ═══════════════════════════════════════════════════════════════════════════

describe("MEDIUM #8 — the 30-minute policy is untouched and single-sourced", () => {
  test("the backend still declares exactly 30 minutes", () => {
    expect(PAYMENT_RESERVATION_MINUTES).toBe(30);
    expect(PAYMENT_RESERVATION_MS).toBe(30 * 60_000);
  });

  test("no frontend re-declares the policy", () => {
    // The storefront must never own a reservation length. A 30-minute literal
    // outside the backend would be a second source of truth.
    for (const file of [...sourceFiles("apps"), ...sourceFiles("packages/shared/src")]) {
      const src = read(file);
      expect(src).not.toMatch(/RESERVATION_(MINUTES|MS)\s*=/);
      expect(src).not.toMatch(/PAYMENT_RESERVATION_MINUTES/);
    }
  });

  test("the derived units stay consistent with the declared policy", () => {
    const lib = read("backend/lib/payment-reservation.ts");
    expect(lib).toContain("export const PAYMENT_RESERVATION_MINUTES = 30;");
    expect(lib).toMatch(/PAYMENT_RESERVATION_MS\s*=\s*PAYMENT_RESERVATION_MINUTES \* 60_000/);
    expect(lib).toMatch(/PAYMENT_RESERVATION_SECONDS\s*=\s*PAYMENT_RESERVATION_MINUTES \* 60/);
  });

  test("a fresh window starts at 30:00, exactly as before", () => {
    // `formatPaymentCountdown` is untouched; prove the unchanged head of the bar.
    const state = paymentReservationState(at(PAYMENT_RESERVATION_MS), NOW);
    expect(state.remainingMs).toBe(PAYMENT_RESERVATION_MS);
    expect(paymentReservationTone(state.remainingMs)).toBe("green");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. Payment state is unchanged
// ═══════════════════════════════════════════════════════════════════════════

describe("MEDIUM #8 — payment state is untouched", () => {
  test("payability still follows the reservation deadline", () => {
    // `orderStripePayability` reads the wall clock itself (it takes no `now`),
    // so these deadlines are anchored to the real clock, not the fixed NOW.
    const real = Date.now();
    const open = orderStripePayability({
      status: "pending_payment",
      paymentExpiresAt: real + 600_000,
      paymentMethod: "CARD",
    });
    expect(open.payable).toBe(true);
    expect(open.expired).toBe(false);

    const lapsed = orderStripePayability({
      status: "pending_payment",
      paymentExpiresAt: real - 1_000,
      paymentMethod: "CARD",
    });
    expect(lapsed.payable).toBe(false);
    expect(lapsed.expired).toBe(true);
  });

  test("a `paid` payment still hides the pay button, window or not", () => {
    expect(
      orderStripePayability({
        status: "pending_payment",
        paymentStatus: "paid",
        paymentExpiresAt: Date.now() + 600_000,
      }).payable,
    ).toBe(false);
  });

  test("a non-payable order status is still not payable", () => {
    for (const status of ["paid", "cancelled", "shipped", "delivered", "completed", "expired"]) {
      expect(isOrderPayable(status)).toBe(false);
      expect(
        orderStripePayability({ status, paymentExpiresAt: Date.now() + 600_000 }).payable,
      ).toBe(false);
    }
    expect(isOrderPayable("pending")).toBe(true);
    expect(isOrderPayable("pending_payment")).toBe(true);
  });

  test("no payment-status value was introduced, removed or renamed", () => {
    const commerce = read(COMMERCE);
    const block = commerce.slice(
      commerce.indexOf("export const PAYABLE_ORDER_STATUSES"),
      commerce.indexOf(";", commerce.indexOf("export const PAYABLE_ORDER_STATUSES")),
    );
    expect(block).toContain('"pending"');
    expect(block).toContain('"pending_payment"');
    // `payments.status` values stay a separate axis and must not leak in here.
    for (const paymentOnly of ["paid", "failed", "processing", "refunded", "requires_action"]) {
      expect(block).not.toContain(`"${paymentOnly}"`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Order state is untouched
// ═══════════════════════════════════════════════════════════════════════════

describe("MEDIUM #8 — order state is untouched", () => {
  test("the customer-cancellable order statuses are unchanged", () => {
    expect([...CUSTOMER_CANCELABLE_ORDER_STATUSES]).toEqual([
      "pending",
      "pending_payment",
      "confirmed",
    ]);
    for (const status of ["pending", "pending_payment", "confirmed"]) {
      expect(isOrderCancelableByCustomer(status)).toBe(true);
    }
    for (const status of ["packing", "shipped", "delivered", "completed", "cancelled"]) {
      expect(isOrderCancelableByCustomer(status)).toBe(false);
    }
  });

  test("no order status value was added or removed by this change", () => {
    const commerce = read(COMMERCE);
    const start = commerce.indexOf("export type StoreOrderStatus =");
    const end = commerce.indexOf("export type StorePaymentStatus =");
    expect(start).toBeGreaterThan(-1);
    expect(end).toBeGreaterThan(start);
    // The union carries per-member JSDoc, so slice to the next declaration
    // rather than to the first `;`.
    const union = commerce.slice(start, end);
    for (const status of [
      "pending",
      "pending_payment",
      "paid",
      "confirmed",
      "packing",
      "shipped",
      "delivered",
      "completed",
      "payment_failed",
      "refunded",
      "cancelled",
      "expired",
    ]) {
      expect(union).toContain(`"${status}"`);
    }
    // The order axis still has no `failed` (audit LOW #12) and no payments-only value.
    expect(union).not.toContain('"failed"');
    expect(union).not.toContain('"processing"');
    expect(union).not.toContain('"requires_action"');
  });

  test("the order state machine was not touched by this task", () => {
    // `paymentReservationPhase` is presentation only; the machine that actually
    // moves an order lives in the backend module and is byte-for-byte unrelated.
    const fulfillment = read("backend/lib/order-fulfillment.ts");
    for (const status of [
      "pending",
      "confirmed",
      "packing",
      "shipped",
      "delivered",
      "completed",
      "cancelled",
    ]) {
      expect(fulfillment).toContain(`"${status}"`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. No new duplicate source of truth
// ═══════════════════════════════════════════════════════════════════════════

describe("MEDIUM #8 — no second source of truth was introduced", () => {
  test("`commerce.ts` declares each reservation threshold exactly once", () => {
    const src = read(COMMERCE);
    for (const name of [
      "PAYMENT_RESERVATION_YELLOW_MS",
      "PAYMENT_RESERVATION_RED_MS",
    ]) {
      const declarations = src.match(new RegExp(`export const ${name} =`, "g")) ?? [];
      expect(declarations).toHaveLength(1);
    }
  });

  test("`commerce.ts` defines no reservation threshold that the tone does not use", () => {
    // Any `*_MS` constant left in this module must either be a tone boundary or
    // be read by `paymentReservationTone` — otherwise it is a second scale again.
    const src = read(COMMERCE);
    const msConstants = [...src.matchAll(/export const ([A-Z_]*_MS) = ([^;]+);/g)];
    expect(msConstants.length).toBeGreaterThan(0);
    for (const [, name, value] of msConstants) {
      const body = src.slice(src.indexOf("export function paymentReservationTone"));
      expect(body).toContain(name as string);
      expect(String(value)).toMatch(/\d+/);
    }
  });

  test("the tone's thresholds are the only urgency numbers the pages read", () => {
    for (const page of [MY_ORDERS_PAGE, ORDER_DETAIL_PAGE]) {
      const src = code(page);
      // A page may not import or reference a reservation threshold constant —
      // the tiers belong to the shared module alone.
      expect(src).not.toMatch(/PAYMENT_RESERVATION_(URGENT|YELLOW|RED)_MS/);
      expect(src).not.toMatch(/\b(URGENT_MS|YELLOW_MS|RED_MS)\b/);
      // …nor compute a threshold of its own.
      expect(src).not.toMatch(/reservationTone\([^)]*\d/);
    }
  });

  test("the shared module and the backend each own one thing, and they do not overlap", () => {
    // The backend owns the POLICY (how long a window is); the shared package
    // owns the PRESENTATION (how alarming it looks). Neither re-declares the
    // other's job.
    const backend = read("backend/lib/payment-reservation.ts");
    const commerce = read(COMMERCE);
    expect(backend).toContain("PAYMENT_RESERVATION_MINUTES = 30");
    // The presentation module never names a window length…
    expect(commerce).not.toMatch(/RESERVATION_(MINUTES|SECONDS)\b/);
    // …and the policy module never names a presentation tier.
    expect(backend).not.toMatch(/YELLOW|RED_MS|URGENT|Tone/);
  });
});
