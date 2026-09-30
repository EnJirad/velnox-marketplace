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
  formatPaymentCountdown,
  getOrderStatusMeta,
  getPaymentStatusBadge,
  ORDER_PROGRESS_STAGES,
  ORDER_STATUS_META,
  orderProgressStageI18nKey,
  orderProgressStageIndex,
  orderStatusI18nKey,
  paymentReservationPhase,
  paymentReservationProgress,
  paymentReservationState,
  paymentReservationTone,
  PAYMENT_RESERVATION_RED_MS,
  PAYMENT_RESERVATION_YELLOW_MS,
} from "../../packages/shared/src/lib/commerce.ts";
import { translations } from "../../packages/shared/src/lib/i18n/locales/index";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const ORDER_DETAIL_PAGE = "apps/velshop/src/pages/ShopOrderDetail.tsx";
const MY_ORDERS_PAGE = "apps/velshop/src/pages/MyOrders.tsx";
const ORDER_STATUS_BADGE_COMPONENT = "packages/shared/src/components/order/OrderStatusBadge.tsx";
const LOCALES = ["th", "en", "my"] as const;

const locale = (lang: (typeof LOCALES)[number]) =>
  translations[lang] as unknown as Record<string, Record<string, string>>;

/**
 * Resolve a dotted i18n key in one dictionary (`orderFulfillment.packing`).
 *
 * The order copy is split across two namespaces on purpose — the `packing` label
 * lives in `orderFulfillment`, because the `orderStatus` / `orderSteps` blocks of
 * the large th/my dictionaries sit past those files' safe edit window — so a test
 * that only indexed `orderStatus[status]` would miss the one status that moved.
 */
const lookup = (lang: (typeof LOCALES)[number], key: string): unknown =>
  key
    .split(".")
    .reduce<unknown>((acc, part) => (acc as Record<string, unknown> | undefined)?.[part], locale(lang));

describe("order UX — the progress line", () => {
  test("is one line of six REAL statuses, in lifecycle order", () => {
    expect(ORDER_PROGRESS_STAGES).toEqual([
      "placed",
      "payment",
      "processing",
      "packing",
      "shipped",
      "delivered",
    ]);
    // Every stage label exists in every dictionary — `packing` resolves through
    // `orderProgressStageI18nKey()`, the ONE mapping, instead of being assumed
    // to live in `orderSteps`.
    for (const lang of LOCALES) {
      const steps = locale(lang).orderSteps;
      expect(steps).toBeDefined();
      for (const stage of ORDER_PROGRESS_STAGES) {
        const key = orderProgressStageI18nKey(stage);
        expect(key).toBe(stage === "packing" ? "orderFulfillment.packing" : `orderSteps.${stage}`);
        const label = lookup(lang, key);
        expect(typeof label).toBe("string");
        expect(String(label).trim().length).toBeGreaterThan(0);
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
    // `packing` is a REAL stage of its own: the shop has started fulfilling the
    // order, which is why the customer can no longer cancel from it.
    expect(orderProgressStageIndex("packing")).toBe(3);
    expect(orderProgressStageIndex("shipped")).toBe(4);
    expect(orderProgressStageIndex("delivered")).toBe(5);
    expect(orderProgressStageIndex("completed")).toBe(5);
    // Terminal or unknown: no stage, so the page shows the notice instead.
    for (const status of ["cancelled", "expired", "payment_failed", "refunded", "who-knows", "", null, undefined]) {
      expect(orderProgressStageIndex(status)).toBe(-1);
    }
  });

  test("the page draws that ONE line, and never a nested bar", () => {
    const page = read(ORDER_DETAIL_PAGE);
    expect(page).toContain("ORDER_PROGRESS_STAGES.map");
    // Exactly one ordered list — no second bar, no nested progress indicator.
    expect((page.match(/<ol/g) ?? []).length).toBe(1);
    // The current stage is announced, and the stage names exist for screen readers.
    expect(page).toContain('aria-current={current ? "step" : undefined}');
    expect(page).toContain('className="sr-only"');
    // The SAME list re-lays-out for a narrow screen (vertical rail) instead of
    // collapsing to the current stage or spawning a second bar; five labels cannot
    // sit side by side on a phone, so they stack and all five stay readable.
    expect(page).toContain("sm:hidden");
    expect(page).toContain("sm:flex-row");
    expect(page).toContain("flex-col");
  });

  test("every stage marker carries an icon, and shape — not colour — says which", () => {
    const page = read(ORDER_DETAIL_PAGE);
    // The current stage draws the stage's OWN icon, a finished stage a check, and
    // one that has not been reached an empty outline.
    expect(page).toContain("orderProgressStageIcon(stage)");
    expect(page).toContain("<CheckCircle2");
    expect(page).toContain("<Circle");
    // Every stage AND every status of the order contract has an icon in the shared
    // module, so a marker or a badge can never render blank. Read as a contract on
    // the shipped source, the same way the page assertions in this file work.
    const badge = read(ORDER_STATUS_BADGE_COMPONENT);
    const statusIconKeys = [...badge.matchAll(/^  (\w+): \w+,$/gm)].map((m) => m[1]);
    for (const status of Object.keys(ORDER_STATUS_META)) {
      expect(statusIconKeys).toContain(status);
    }
    const stageMap = badge.slice(badge.indexOf("ORDER_PROGRESS_STAGE_ICONS"));
    for (const stage of ORDER_PROGRESS_STAGES) {
      expect(stageMap).toMatch(new RegExp(`\\b${stage}:\\s*\\w+,`));
    }
    // An unknown status resolves to a real icon rather than nothing.
    expect(badge).toContain("return CircleDashed;");
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
      const key = orderStatusI18nKey(status);
      // `packing` is the one status that reads from another namespace — see the
      // comment at the top of the Thai dictionary (and `orderStatusI18nKey`).
      expect(key).toBe(status === "packing" ? "orderFulfillment.packing" : `orderStatus.${status}`);
      for (const lang of LOCALES) {
        const label = lookup(lang, key);
        expect(typeof label).toBe("string");
        expect(String(label).trim().length).toBeGreaterThan(0);
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
      // The badge is the SHARED one, so VelShop and VelSeller cannot drift apart.
      expect(src).toContain("<OrderStatusBadge");
      expect(src).toContain("OrderStatusBadge");
    }
    // …and the shared component is the single place that owns the tokens + icon.
    const badge = read("packages/shared/src/components/order/OrderStatusBadge.tsx");
    expect(badge).toContain("meta.badge");
    expect(badge).toContain("ORDER_STATUS_ICONS");
    expect(badge).toContain("label ?? meta.label");
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

describe("order UX — what each link in the Order list opens", () => {
  test("the order NUMBER opens the order, and a product opens the PRODUCT", () => {
    const list = read(MY_ORDERS_PAGE);
    // The card is no longer one big link to the order: that made every product row
    // open the order too, so a customer could never reach a product from here.
    expect(list).not.toContain('className="block p-5"');
    // The order number is its own link to the order…
    expect(list).toContain("to={`/orders/${order.id}`}");
    // …and each in-stock product row links to the product detail route.
    expect(list).toContain("to={`/products/${item.productId}`}");
    // …while a product that is no longer on sale is rendered unlinked, labelled.
    expect(list).toContain('item.productStatus === "published"');
    expect(list).toContain('t("orderDetail.productUnavailable")');
  });

  test("the order status badge is TOP RIGHT, beside the order number", () => {
    const list = read(MY_ORDERS_PAGE);
    // One header row: number on the left, badge on the right of the SAME row.
    const header = list.slice(list.indexOf("Header: the order number on the LEFT"));
    const row = header.slice(0, header.indexOf("Items —"));
    expect(row).toContain("justify-between");
    expect(row).toContain("<OrderStatusBadge status={order.status} label={statusLabel} />");
    // The badge is not in the money/countdown footer any more.
    const footer = list.slice(list.indexOf('t("orders.total")'));
    expect(footer.slice(0, 200)).not.toContain("<OrderStatusBadge");
  });
});

describe("order UX — the reservation deadline must reach the screen (regression)", () => {
  test("an unpaid order 30 minutes out counts down; one second past it never goes negative", () => {
    const now = Date.now();

    // The happy path the storefront renders for a fresh unpaid order.
    const fresh = paymentReservationState(
      { status: "pending_payment", paymentExpiresAt: now + 30 * 60_000 },
      now,
    );
    expect(fresh.hasWindow).toBe(true);
    expect(fresh.expired).toBe(false);
    expect(fresh.remainingMs).toBe(1_800_000);
    expect(formatPaymentCountdown(fresh.remainingMs)).toBe("30:00");
    expect(
      paymentReservationPhase({ status: "pending_payment", paymentExpiresAt: now + 30 * 60_000 }, now),
    ).toBe("active");

    // A later read of the same order keeps ticking down (no new deadline).
    const later = paymentReservationState(
      { status: "pending_payment", paymentExpiresAt: now + 1_740_000 },
      now,
    );
    expect(later.remainingMs).toBe(1_740_000);
    expect(formatPaymentCountdown(later.remainingMs)).toBe("29:00");

    // The last seconds are still a running window, not an anomaly — the phase
    // carries no urgency scale (audit MEDIUM #8), the TONE does.
    expect(
      paymentReservationPhase({ status: "pending", paymentExpiresAt: now + 10_000 }, now),
    ).toBe("active");
    expect(paymentReservationTone(10_000)).toBe("red");

    // One second past the deadline: expired, zero left, and the clock reads 00:00.
    const lapsed = paymentReservationState(
      { status: "pending_payment", paymentExpiresAt: now - 1_000 },
      now,
    );
    expect(lapsed.hasWindow).toBe(true);
    expect(lapsed.expired).toBe(true);
    expect(lapsed.remainingMs).toBe(0);
    expect(formatPaymentCountdown(lapsed.remainingMs)).toBe("00:00");
    expect(formatPaymentCountdown(lapsed.remainingMs).startsWith("-")).toBe(false);
    expect(
      paymentReservationPhase({ status: "pending_payment", paymentExpiresAt: now - 1_000 }, now),
    ).toBe("expired");
  });

  test("the deadline cannot be lost between the API and the two order pages", () => {
    // 1. BOTH read routes map the column onto the camelCase field the app expects.
    const cart = read("backend/routes/cart.ts");
    const mappings = cart.match(/paymentExpiresAt: \w+\.payment_expires_at \? new Date\(/g) ?? [];
    expect(mappings.length).toBe(2);
    // The reads select `o.*`, so a database that predates migration 048 yields
    // `payment_expires_at: undefined` → `null` instead of taking the route down.
    expect(cart.match(/SELECT o\.\*/g)?.length).toBeGreaterThanOrEqual(2);

    // 2. The client-side type carries the field, so it survives the transformation.
    expect(read("packages/shared/src/lib/commerce.ts")).toContain(
      "paymentExpiresAt?: number | null;",
    );

    // 3. Both pages derive their countdown from the object the API returned.
    expect(read(ORDER_DETAIL_PAGE)).toContain("paymentReservationState(order, now)");
    expect(read(MY_ORDERS_PAGE)).toContain("paymentReservationState(order, now)");

    // 4. Nothing on the client invents a deadline, and no second countdown exists.
    for (const page of [ORDER_DETAIL_PAGE, MY_ORDERS_PAGE]) {
      const src = read(page);
      expect(src).not.toMatch(/paymentExpiresAt:\s*(Date\.now\(\)|new Date)/);
      expect((src.match(/setInterval\(\(\) => setNow\(Date\.now\(\)\), 1000\)/g) ?? []).length).toBe(1);
      expect(src).toContain("clearInterval");
    }
  });

  test("the clock never depends on which payment method the order carries", () => {
    // The reservation is about held stock, not about Stripe's rail: a CARD order,
    // a PromptPay order and an order with no recorded method all count down.
    const detail = read(ORDER_DETAIL_PAGE);
    expect(detail).toContain('const reservationOpen = reservationPhase === "active";');
    expect(detail).not.toMatch(/reservationOpen\s*=.*paymentMethod/);
    const list = read(MY_ORDERS_PAGE);
    expect(list).not.toMatch(/reservationPhase.*paymentMethod/);
    // …and the pay action is offered beside it regardless of the method.
    expect(detail).toContain("<ResumePaymentButton");
  });
});

describe("order UX — urgency states and the progress bar", () => {
  test("the tiers are GREEN past 15:00, YELLOW to 05:01, RED to 00:01, then expired", () => {
    // Spec boundaries, exact.
    expect(PAYMENT_RESERVATION_YELLOW_MS).toBe(15 * 60_000);
    expect(PAYMENT_RESERVATION_RED_MS).toBe(5 * 60_000);
    expect(paymentReservationTone(15 * 60_000 + 1_000)).toBe("green");
    expect(paymentReservationTone(15 * 60_000)).toBe("yellow");
    expect(paymentReservationTone(5 * 60_000 + 1_000)).toBe("yellow");
    expect(paymentReservationTone(5 * 60_000)).toBe("red");
    expect(paymentReservationTone(1_000)).toBe("red");
    expect(paymentReservationTone(0)).toBe("expired");
    expect(paymentReservationTone(-1_000)).toBe("expired");
    expect(paymentReservationTone(Number.NaN)).toBe("expired");
    // A whole 30-minute window starts green.
    expect(paymentReservationTone(30 * 60_000)).toBe("green");
  });

  test("the clock reads 30:00 → 00:00 across every boundary, never negative", () => {
    const cases: Array<[number, string]> = [
      [30 * 60_000, "30:00"],
      [30 * 60_000 - 1_000, "29:59"],
      [15 * 60_000, "15:00"],
      [15 * 60_000 - 1_000, "14:59"],
      [5 * 60_000, "05:00"],
      [5 * 60_000 - 1_000, "04:59"],
      [1_000, "00:01"],
      [0, "00:00"],
      [-1_000, "00:00"],
      [-60_000, "00:00"],
    ];
    for (const [ms, expected] of cases) {
      expect(formatPaymentCountdown(ms)).toBe(expected);
    }
  });

  test("the bar measures the backend's window, and draws nothing when it is unknown", () => {
    const thirty = 30 * 60_000;
    expect(paymentReservationProgress(thirty, thirty)).toBe(1);
    expect(paymentReservationProgress(thirty / 2, thirty)).toBe(0.5);
    expect(paymentReservationProgress(60_000, thirty)).toBeCloseTo(1 / 30, 5);
    expect(paymentReservationProgress(0, thirty)).toBe(0);
    // A window the backend did not report (or a malformed one) draws no bar…
    expect(paymentReservationProgress(thirty, null)).toBeNull();
    expect(paymentReservationProgress(thirty, undefined)).toBeNull();
    expect(paymentReservationProgress(thirty, 0)).toBeNull();
    // …and a clock that somehow outruns its window is clamped, never > 100%.
    expect(paymentReservationProgress(thirty * 2, thirty)).toBe(1);
  });

  test("three unpaid orders keep three independent clocks", () => {
    const now = Date.now();
    const orders = [
      { status: "pending_payment", paymentExpiresAt: now + 25 * 60_000 },
      { status: "pending_payment", paymentExpiresAt: now + 10 * 60_000 },
      { status: "pending_payment", paymentExpiresAt: now + 2 * 60_000 },
    ].map((o) => ({ ...o, reservationMinutes: 30 }));

    const clocks = orders.map((o) => {
      const state = paymentReservationState(o, now);
      return {
        clock: formatPaymentCountdown(state.remainingMs),
        tone: paymentReservationTone(state.remainingMs),
        progress: paymentReservationProgress(
          state.remainingMs,
          o.reservationMinutes ? o.reservationMinutes * 60_000 : null,
        ),
      };
    });

    expect(clocks.map((c) => c.clock)).toEqual(["25:00", "10:00", "02:00"]);
    expect(clocks.map((c) => c.tone)).toEqual(["green", "yellow", "red"]);
    expect(clocks.map((c) => c.progress)).toEqual([
      (25 * 60_000) / (30 * 60_000),
      (10 * 60_000) / (30 * 60_000),
      (2 * 60_000) / (30 * 60_000),
    ]);

    // Reading one order never changes another (no shared mutable countdown).
    const again = orders.map((o) =>
      formatPaymentCountdown(paymentReservationState(o, now).remainingMs),
    );
    expect(again).toEqual(["25:00", "10:00", "02:00"]);
  });

  test("both surfaces render the tier, the bar and the dark expired state — no hard-coded copy", () => {
    for (const page of [ORDER_DETAIL_PAGE, MY_ORDERS_PAGE]) {
      const src = read(page);
      // The tier, not a hard-coded colour decision per page.
      expect(src).toContain("paymentReservationTone(");
      expect(src).toContain("paymentReservationProgress(");
      expect(src).toContain('role="progressbar"');
      // The bar's denominator is the backend's reservation length, never 30 in code.
      expect(src).toContain("reservationMinutes");
      expect(src).not.toMatch(/30 \* 60_000/);
      // Expired is the dark state, and the copy is translated.
      expect(src).toContain("bg-slate-900");
      expect(src).toContain('t("orderReservation.expiredTitle")');
      expect(src).toContain('t("orderReservation.criticalNote")');
      // No Thai/Myanmar literal may appear in a component (i18n rule).
      expect(src).not.toMatch(/[\u0E00-\u0E7F\u1000-\u109F]/);
      // The clock never renders a negative value.
      expect(src).not.toContain("formatPaymentCountdown(-");
    }
  });

  test("every tier has copy in th, en and my", () => {
    for (const lang of ["th", "en", "my"] as const) {
      const ns = locale(lang).orderReservation;
      for (const key of ["windowNote", "urgentNote", "criticalNote", "expiredTitle", "expiredDesc", "expiresIn"]) {
        expect(typeof ns[key]).toBe("string");
        expect(ns[key].trim().length).toBeGreaterThan(0);
      }
      // The countdown label still carries its {time} placeholder everywhere.
      expect(ns.payWithin).toContain("{time}");
    }
  });
});
