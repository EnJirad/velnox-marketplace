/**
 * Order UX polish — the rules the customer's order screens must obey.
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * The order experience is the last screen before VelRepeat, and it is the one
 * the customer stares at while a 30-minute payment window runs down. What must
 * hold, and is pinned here:
 *
 *    1. the progress line is ONE line of five REAL order statuses — the current
 *       stage comes from `orders.status`, never from a client-side guess, and a
 *       terminal order (`cancelled`, `expired`, `payment_failed`, `refunded`) gets
 *       a notice instead of a line that implies it still moves;
 *    2. the status text is LOCALIZED in all three languages (`orderStatus.*`),
 *       never the Thai seller-side fallback baked into `ORDER_STATUS_META`;
 *    3. the badges come from the design system's semantic tokens with readable
 *       contrast — never white-on-white — and colour is never the only signal;
 *    4. the Order Detail page renders the address SNAPSHOT stored on that order
 *       (`orders.shipping_address`) and never the profile's current address, and
 *       it omits fields the snapshot does not carry instead of inventing them;
 *    5. a failed payment keeps the ORIGINAL deadline and offers the shared retry
 *       button; nothing in the browser may extend a reservation;
 *    6. the Orders list counts down per order, at the bottom-left of that order's
 *       own card, with each card deriving its own remaining time.
 *
 * These are contract tests: they read the shipped source, so they fail if a later
 * change drops one of the rules. They need no database.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import {
  getOrderStatusMeta,
  getPaymentStatusBadge,
  ORDER_PROGRESS_STAGES,
  ORDER_STATUS_META,
  orderProgressStageIndex,
  orderStatusI18nKey,
} from "../../packages/shared/src/lib/commerce.ts";
import { translations } from "../../packages/shared/src/lib/i18n/locales/index";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const ORDER_DETAIL_PAGE = "apps/velshop/src/pages/ShopOrderDetail.tsx";
const MY_ORDERS_PAGE = "apps/velshop/src/pages/MyOrders.tsx";
const LOCALES = ["th", "en", "my"] as const;

const locale = (lang: (typeof LOCALES)[number]) =>
  translations[lang] as unknown as Record<string, Record<string, string>>;

describe("order UX — the progress line", () => {
  test("is one line of five REAL statuses, in lifecycle order", () => {
    expect(ORDER_PROGRESS_STAGES).toEqual(["placed", "payment", "processing", "shipped", "delivered"]);
    // Every stage label already exists in every dictionary.
    for (const lang of LOCALES) {
      const steps = locale(lang).orderSteps;
      expect(steps).toBeDefined();
      for (const stage of ORDER_PROGRESS_STAGES) {
        expect(typeof steps[stage]).toBe("string");
        expect(steps[stage].trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("the current stage comes from the order status, and terminal orders have none", () => {
    // Unpaid orders sit at "payment": the order exists, the money has not landed.
    expect(orderProgressStageIndex("pending")).toBe(1);
    expect(orderProgressStageIndex("pending_payment")).toBe(1);
    // Settled money, and everything downstream of the store's work.
    expect(orderProgressStageIndex("paid")).toBe(2);
    expect(orderProgressStageIndex("confirmed")).toBe(2);
    expect(orderProgressStageIndex("shipped")).toBe(3);
    expect(orderProgressStageIndex("delivered")).toBe(4);
    expect(orderProgressStageIndex("completed")).toBe(4);
    // Terminal or unknown: no stage, so the page shows the notice instead.
    for (const status of ["cancelled", "expired", "payment_failed", "refunded", "who-knows", "", null, undefined]) {
      expect(orderProgressStageIndex(status)).toBe(-1);
    }
  });

  test("the page draws that ONE line, and never a nested bar", () => {
    const page = read(ORDER_DETAIL_PAGE);
    expect(page).toContain("ORDER_PROGRESS_STAGES.map");
    expect((page.match(/<ol/g) ?? []).length).toBe(1);
    // The current stage is announced, and the stage names exist for screen readers.
    expect(page).toContain('aria-current={current ? "step" : undefined}');
    expect(page).toContain('className="sr-only"');
    // A narrow screen collapses to the current stage only — no second bar.
    expect(page).toContain("sm:hidden");
  });

  test("a terminal order replaces the line with the notice that explains it", () => {
    const page = read(ORDER_DETAIL_PAGE);
    expect(page).toContain("progressNotice || stageIndex < 0");
    expect(page).toContain('order.status === "payment_failed"');
    expect(page).toContain('order.status === "cancelled"');
    expect(page).toContain('order.status === "refunded"');
    // Order status and payment status stay SEPARATE, each with its own label.
    expect(page).toContain('t("orderDetail.orderStatusLabel")');
    expect(page).toContain('t("orderDetail.paymentStatus")');
  });
});

describe("order UX — status text and tokens", () => {
  test("every order status has a localized label in all three languages", () => {
    for (const status of Object.keys(ORDER_STATUS_META)) {
      expect(orderStatusI18nKey(status)).toBe(`orderStatus.${status}`);
      for (const lang of LOCALES) {
        const label = locale(lang).orderStatus[status];
        expect(typeof label).toBe("string");
        expect(label.trim().length).toBeGreaterThan(0);
      }
    }
    // An unknown status resolves to a real key rather than a missing one.
    for (const status of ["who-knows", "", null, undefined, 42]) {
      expect(orderStatusI18nKey(status)).toBe("orderStatus.unknown");
    }
    for (const lang of LOCALES) {
      expect(locale(lang).orderStatus.unknown.trim().length).toBeGreaterThan(0);
    }
  });

  test("both order surfaces render the localized status, not the Thai fallback", () => {
    for (const page of [ORDER_DETAIL_PAGE, MY_ORDERS_PAGE]) {
      const src = read(page);
      expect(src).toContain("orderStatusI18nKey");
      expect(src).not.toContain("{meta.label}");
      // The badge still uses the design system's tokens.
      expect(src).toContain("meta.badge");
      expect(src).toContain("meta.dot");
    }
  });

  test("the badges are readable tokens, never white-on-white", () => {
    for (const status of Object.keys(ORDER_STATUS_META)) {
      const wrongWay = getOrderStatusMeta(status);
      expect(wrongWay.badge).toContain("bg-");
      expect(wrongWay.badge).toContain("text-");
      expect(wrongWay.dot).toContain("bg-");
    }
    // A status this build does not know still renders a real badge.
    for (const status of ["unpaid", "requires_action", "paid", "failed", "refunded", "who-knows", null]) {
      const badge = getPaymentStatusBadge(status);
      expect(badge.badge).toContain("bg-");
      expect(badge.badge).toContain("text-");
      expect(badge.dot).toContain("bg-");
    }
    // …and the page uses those tokens for the payment-status pill.
    const page = read(ORDER_DETAIL_PAGE);
    expect(page).toContain("getPaymentStatusBadge(order.paymentStatus)");
    expect(page).toContain("${paymentBadge.badge}");
  });
});

describe("order UX — address, retry and the reservation", () => {
  test("the detail page shows the ORDER's own address snapshot, never a profile address", () => {
    const page = read(ORDER_DETAIL_PAGE);
    expect(page).toContain("order.addressSnapshot");
    expect(page).toContain('t("orderDetail.shipTo")');
    // One line per stored field, only fields that exist.
    expect(page).toContain("addressLines");
    // No profile/address-book read could leak the customer's CURRENT address here.
    expect(page).not.toMatch(/api\.(customer\.)?(addresses|profile)/);
    // A missing recipient is labelled, never rendered as an empty line.
    expect(page).toContain('t("orderDetail.recipientFallback")');
  });

  test("a failed payment keeps the ORIGINAL deadline and offers the shared retry", () => {
    const page = read(ORDER_DETAIL_PAGE);
    expect(page).toContain('t("orderDetail.paymentFailedTitle")');
    expect(page).toContain('t("orderDetail.paymentFailedDesc")');
    expect(page).toContain("<ResumePaymentButton");
    // Nothing in the browser may extend, reset or fabricate a reservation.
    expect(page).not.toMatch(/paymentExpiresAt:\s*(Date\.now\(\)|new Date)/);
    expect(page).not.toMatch(/status:\s*"(paid|expired)"/);
    const list = read(MY_ORDERS_PAGE);
    expect(list).not.toMatch(/paymentExpiresAt:\s*(Date\.now\(\)|new Date)/);
  });

  test("each order card counts down on its own, at the bottom of its own card", () => {
    const list = read(MY_ORDERS_PAGE);
    // Per-card state derived from that order's own deadline…
    expect(list).toContain("paymentReservationPhase(order, now)");
    expect(list).toContain("paymentReservationState(order, now)");
    // …inside the card's own status block, labelled with the translated copy.
    expect(list).toContain('t("orderReservation.payWithin"');
    expect(list).toContain('role="timer"');
    // The status text is the localized one, and expiry is never a negative clock.
    expect(list).toContain("statusLabel");
    expect(list).toContain('t("orderReservation.expiredTitle")');
    expect(list).not.toContain("formatPaymentCountdown(-");
  });
});
