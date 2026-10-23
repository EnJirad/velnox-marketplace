/**
 * Order status contract — regression tests.
 *
 * Why this file exists
 * --------------------
 * Production velShop threw
 *   `Cannot read properties of undefined (reading 'badge')`
 * from MyOrders. The page did:
 *
 *   const meta = ORDER_STATUS_META[order.status];
 *   … meta.badge / meta.dot / meta.label
 *
 * `orders.status` is a superset of the fulfilment state machine: the Stripe
 * routes write their own payment-lifecycle values ('pending_payment', 'paid',
 * 'payment_failed', 'refunded') into the same column. That column is constrained
 * since audit MEDIUM #9 (migration V0050, `orders_status_check` in db/schema.sql)
 * to exactly the union of those two lifecycles — so a row in the database can no
 * longer carry a value this build has never heard of, but the UI contract is
 * unchanged and must stay defensive: an older backend, a hand-written row or a
 * future release can still put a value in front of this build, and the render
 * must never throw on it.
 *
 * What is pinned here
 * -------------------
 *   1. every status the backend can write has complete display metadata;
 *   2. the literals stripe.ts writes are re-derived from that file, so a new
 *      backend status fails this test instead of crashing a page;
 *   3. an unknown / missing / hostile status resolves to a neutral badge —
 *      never `undefined`, never a prototype member;
 *   4. a MIXED list (valid + unknown + null) renders end to end, which is the
 *      exact `.map()` shape that crashed;
 *   5. the seller-facing status set stays renderable.
 *
 * Presentation only — no test here changes or asserts business state.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import {
  NEXT_ORDER_STATUSES,
  ORDER_STATUS_META,
  UNKNOWN_ORDER_STATUS_META,
  getOrderStatusMeta,
  type StoreOrderStatus,
} from "../../packages/shared/src/lib/commerce.ts";
import { normalizeSellerOrderStatus } from "../routes/seller-orders.js";
import {
  FULFILLMENT_AXIS_STATUSES,
  LEGACY_ORDER_STATUSES,
  ORDER_STATES,
  PAYMENT_STATES,
  axesForFulfillmentStatus,
  projectOrderStatus,
} from "../lib/order-state.js";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/**
 * Every status the backend writes to `orders.status`, with its writing site.
 * Exhaustive as of this commit — see the stripe.ts cross-check below for the
 * payment-lifecycle half.
 */
const BACKEND_ORDER_STATUSES: StoreOrderStatus[] = [
  "pending", // cart.ts checkout INSERT / velrepeat-scheduler.ts
  "pending_payment", // stripe.ts: Checkout Session created
  "paid", // stripe.ts: confirming webhook
  "payment_failed", // stripe.ts: failed charge
  "refunded", // stripe.ts: full refund
  "confirmed", // seller-orders.ts + center.ts transitions
  "shipped",
  "delivered",
  "completed",
  "cancelled", // cart.ts customer cancel, stripe.ts expiry, seller/center
];

/**
 * The PAYMENT-axis states stripe.ts projects, scraped from the projection
 * authority the file now calls instead of writing a literal itself:
 * `projectOrderStatusSql("'x'")`.
 *
 * Before the order-state migration this scraped `UPDATE orders SET status = 'x'`
 * — the file no longer contains that shape at all, which `no bare status write`
 * below asserts, so the scrape had to move to the new authority rather than be
 * widened into something that matches anything.
 */
/**
 * The four GUARDED payment writers (checkout session opened, settled, failed) and
 * the refund: they project inside the statement, so the scrape is their
 * payment-state argument.
 */
function stripeAxisStatesViaSql(): string[] {
  const src = read("backend/routes/stripe.ts");
  return [...src.matchAll(/projectOrderStatusSql\("'([a-z_]+)'"\)/g)].map((m) => m[1] as string);
}

/**
 * The HAND-OFF writer (a lapsed Checkout Session): it passes the payment state
 * through the TypeScript function because it moves the order and fulfilment axes
 * in the same statement — the order really is over.
 */
function stripeAxisStatesViaTs(): string[] {
  const src = read("backend/routes/stripe.ts");
  return [...src.matchAll(/projectOrderStatus\(\{\s*paymentState:\s*"([a-z_]+)"/g)].map(
    (m) => m[1] as string,
  );
}

function stripePaymentAxisStates(): string[] {
  return [...stripeAxisStatesViaSql(), ...stripeAxisStatesViaTs()];
}

/**
 * The legacy statuses those payment-axis states produce on the axes a PAYMENT
 * writer can actually be looking at — the two pre-fulfilment pairs.
 *
 * The restriction is the point, not a convenience: every payment statement is
 * guarded to the unfulfilled/ready rows, and if one were ever widened onto a
 * shipped order the projection keeps `shipped` (asserted separately below), so
 * the two pre-fulfilment pairs are exactly the reachable set. Sweeping all axes
 * here would assert that the projection returns a payment status for an order
 * that already shipped, which is the defect this migration removed.
 */
/**
 * The axes every GUARDED payment writer can see: `status IN ('pending',
 * 'pending_payment')` is the WHERE clause they all carry, so nothing past the
 * start of the order is reachable from them.
 */
const PAYMENT_WRITER_AXES = { orderState: "pending", fulfillmentStatus: "unfulfilled" };

/**
 * Every legacy status stripe.ts can publish, derived from the file rather than
 * hardcoded: the guarded writers project on the start-of-order axes, the
 * hand-off writer lands on the cancelled pair (`order_state` AND
 * `fulfillment_status` both `cancelled`) in the same statement.
 */
function stripeProjectedOrderStatuses(): Set<string> {
  const produced = new Set<string>();
  for (const paymentState of stripeAxisStatesViaSql()) {
    produced.add(projectOrderStatus({ paymentState, ...PAYMENT_WRITER_AXES }));
  }
  for (const paymentState of stripeAxisStatesViaTs()) {
    produced.add(projectOrderStatus({ paymentState, ...axesForFulfillmentStatus("cancelled") }));
  }
  return produced;
}

// ─── 1. every backend status is displayable ──────────────────────────────────

describe("order status contract — backend statuses are all displayable", () => {
  test("every status the backend writes has complete metadata", () => {
    for (const status of BACKEND_ORDER_STATUSES) {
      const meta = getOrderStatusMeta(status);
      expect(meta).not.toBe(UNKNOWN_ORDER_STATUS_META);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.badge.length).toBeGreaterThan(0);
      expect(meta.dot.length).toBeGreaterThan(0);
      // The direct lookup MyOrders used must work for these values.
      expect(ORDER_STATUS_META[status]).toBeDefined();
    }
  });

  test("the Stripe payment statuses are real contract members, not fallbacks", () => {
    for (const status of ["pending_payment", "paid", "payment_failed", "refunded"] as const) {
      expect(getOrderStatusMeta(status)).toBe(ORDER_STATUS_META[status]);
    }
  });

  test("payment-lifecycle statuses stay distinguishable from the fulfilment ones", () => {
    // A neutral fallback for 'paid' would hide a real payment from the customer,
    // so these must not collapse onto pending/completed.
    expect(ORDER_STATUS_META.paid.label).not.toBe(ORDER_STATUS_META.pending.label);
    expect(ORDER_STATUS_META.paid.label).not.toBe(ORDER_STATUS_META.completed.label);
    expect(ORDER_STATUS_META.pending_payment.label).not.toBe(ORDER_STATUS_META.pending.label);
    expect(ORDER_STATUS_META.payment_failed.dot).not.toBe(ORDER_STATUS_META.cancelled.dot);
  });
});

// ─── 2. backend ↔ shared contract cross-check ────────────────────────────────

describe("order status contract — the backend cannot write a status we cannot render", () => {
  test("stripe.ts no longer writes a bare orders.status literal", () => {
    // The order-state migration (P0-1) moved every writer onto the projection
    // authority. A literal coming back would silently reintroduce the fourth
    // opinion the axes exist to remove — so the absence is asserted, not assumed.
    //
    // Full-line comments are stripped first: this file's own migration comment
    // QUOTES the statement it replaced, and a scan that cannot tell the quote
    // from the code would either fail on the documentation or have to be
    // widened until it matched nothing.
    const src = read("backend/routes/stripe.ts")
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    // Scoped to `orders`: the file legitimately writes literal statuses to
    // `payments` and `payment_events`, which are the OTHER two axes' own tables.
    expect(src).not.toMatch(/UPDATE orders[\s\S]{0,80}?SET status = '/);
  });

  test("stripe.ts projects payment states the shared contract can render", () => {
    const written = stripePaymentAxisStates();
    // Guard the scrape itself: a refactor of the SQL shape must fail loudly
    // rather than silently matching nothing.
    expect(written.length).toBeGreaterThanOrEqual(4);
    for (const state of written) {
      expect(PAYMENT_STATES).toContain(state as (typeof PAYMENT_STATES)[number]);
    }
    // The payments the payment engine moves, expressed on its OWN axis.
    expect(new Set(written)).toEqual(
      new Set(["pending", "paid", "failed", "cancelled", "refunded"]),
    );
  });

  test("every status stripe.ts can project is one the UI renders", () => {
    // The FULL sweep: for each payment state stripe.ts passes, over EVERY order /
    // fulfilment pair the schema allows, the projected value must be a real
    // legacy status with complete display metadata. A payment statement can be
    // widened onto a shipped row tomorrow; this is what keeps that safe.
    for (const paymentState of stripePaymentAxisStates()) {
      for (const orderState of ORDER_STATES) {
        for (const fulfillmentStatus of FULFILLMENT_AXIS_STATUSES) {
          const status = projectOrderStatus({ paymentState, orderState, fulfillmentStatus });
          expect(LEGACY_ORDER_STATUSES).toContain(status as (typeof LEGACY_ORDER_STATUSES)[number]);
          expect(getOrderStatusMeta(status)).not.toBe(UNKNOWN_ORDER_STATUS_META);
        }
      }
    }
  });

  test("stripe.ts reproduces exactly the legacy statuses it wrote before the migration", () => {
    // Nothing a frontend could see has disappeared: the payment engine still
    // produces the same five statuses on the orders it can actually reach.
    expect(stripeProjectedOrderStatuses()).toEqual(
      new Set(["pending_payment", "paid", "payment_failed", "cancelled", "refunded"]),
    );
    // The refund writer's guard is wider than the other four (it excludes only
    // the already-refunded rows), so it can also reach an ACCEPTED order — which
    // must still read `refunded`, because nothing has shipped yet.
    expect(
      projectOrderStatus({ paymentState: "refunded", orderState: "confirmed", fulfillmentStatus: "ready" }),
    ).toBe("refunded");
  });

  test("a shipped order is never projected away by a payment state", () => {
    // The regression this migration exists for: the refund used to overwrite a
    // `shipped`/`delivered` order with `refunded`.
    expect(projectOrderStatus({ paymentState: "refunded", orderState: "processing", fulfillmentStatus: "shipped" })).toBe("shipped");
    expect(projectOrderStatus({ paymentState: "refunded", orderState: "processing", fulfillmentStatus: "delivered" })).toBe("delivered");
    expect(projectOrderStatus({ paymentState: "refunded", orderState: "completed", fulfillmentStatus: "delivered" })).toBe("completed");
  });

  test("the pinned backend status list still matches what stripe.ts produces", () => {
    for (const status of stripeProjectedOrderStatuses()) {
      expect(BACKEND_ORDER_STATUSES).toContain(status as StoreOrderStatus);
    }
  });
});

// ─── 3. the crash: unknown / missing / hostile values ────────────────────────

describe("order status contract — an unknown status never crashes a render", () => {
  test("documents the original defect: the raw lookup returns undefined", () => {
    const raw = ORDER_STATUS_META as unknown as Record<string, { badge: string } | undefined>;
    // This is exactly what produced `undefined.badge` in MyOrders.
    expect(raw["a_status_from_a_newer_backend"]).toBeUndefined();
    // …and what the helper must return instead.
    expect(getOrderStatusMeta("a_status_from_a_newer_backend").badge.length).toBeGreaterThan(0);
  });

  test("unknown, missing and non-string statuses fall back to a neutral badge", () => {
    const hostile = [
      "a_status_from_a_newer_backend",
      "PENDING", // case matters — no silent case-folding
      " pending",
      "",
      "  ",
      undefined,
      null,
      0,
      123,
      true,
      {},
      [],
      ["pending"],
      { status: "pending" },
      Symbol("pending"),
      () => "pending",
    ];
    for (const status of hostile) {
      const meta = getOrderStatusMeta(status);
      expect(meta).toBe(UNKNOWN_ORDER_STATUS_META);
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.badge.length).toBeGreaterThan(0);
      expect(meta.dot.length).toBeGreaterThan(0);
    }
  });

  test("inherited Object.prototype members are not treated as statuses", () => {
    // `status in ORDER_STATUS_META` or a bare index would return a function
    // here, and rendering it would be worse than the original crash.
    for (const key of ["constructor", "toString", "hasOwnProperty", "__proto__", "valueOf"]) {
      expect(getOrderStatusMeta(key)).toBe(UNKNOWN_ORDER_STATUS_META);
    }
  });

  test("the unknown fallback says it is unknown instead of claiming a real status", () => {
    expect(UNKNOWN_ORDER_STATUS_META.label).not.toBe(ORDER_STATUS_META.pending.label);
    expect(UNKNOWN_ORDER_STATUS_META.label).not.toBe(ORDER_STATUS_META.completed.label);
    expect(UNKNOWN_ORDER_STATUS_META.label).not.toBe(ORDER_STATUS_META.cancelled.label);
  });
});

// ─── 4. the MyOrders list shape, valid + unknown together ────────────────────

describe("order status contract — a mixed order list renders every row", () => {
  /** The exact derivation MyOrders.tsx performs per row. */
  const renderRow = (order: { id: string; status: unknown }) => {
    const meta = getOrderStatusMeta(order.status);
    return { id: order.id, status: order.status, badge: meta.badge, dot: meta.dot, label: meta.label };
  };

  const mixedList = [
    ...BACKEND_ORDER_STATUSES.map((status, i) => ({ id: `known-${i}`, status: status as unknown })),
    { id: "future", status: "a_status_from_a_newer_backend" },
    { id: "missing", status: undefined },
    { id: "null", status: null },
  ];

  test("renders every row without throwing and with a complete badge", () => {
    const rows = mixedList.map(renderRow);
    expect(rows).toHaveLength(BACKEND_ORDER_STATUSES.length + 3);
    for (const row of rows) {
      expect(typeof row.badge).toBe("string");
      expect(typeof row.dot).toBe("string");
      expect(typeof row.label).toBe("string");
      expect(row.badge.length).toBeGreaterThan(0);
      expect(row.dot.length).toBeGreaterThan(0);
      expect(row.label.length).toBeGreaterThan(0);
    }
  });

  test("known rows keep their exact existing metadata", () => {
    const rows = mixedList
      .filter((o) => typeof o.status === "string" && BACKEND_ORDER_STATUSES.includes(o.status as StoreOrderStatus))
      .map(renderRow);
    expect(rows).toHaveLength(BACKEND_ORDER_STATUSES.length);
    for (const row of rows) {
      const expected = ORDER_STATUS_META[row.status as StoreOrderStatus];
      expect(row.badge).toBe(expected.badge);
      expect(row.dot).toBe(expected.dot);
      expect(row.label).toBe(expected.label);
    }
  });

  test("only the unrecognised rows fall back — the known ones keep their own label", () => {
    const rows = mixedList.map(renderRow);
    const unknownRows = rows.filter((r) => r.label === UNKNOWN_ORDER_STATUS_META.label);
    expect(unknownRows.map((r) => r.id)).toEqual(["future", "missing", "null"]);
  });
});

// ─── 5. seller-facing invariants ─────────────────────────────────────────────

describe("order status contract — seller-facing status set stays renderable", () => {
  test("every status the seller UI can transition to has metadata", () => {
    // SellerOrders.tsx renders `ORDER_STATUS_META[s].label` for each `s` in
    // NEXT_ORDER_STATUSES[order.status].
    for (const [from, list] of Object.entries(NEXT_ORDER_STATUSES)) {
      expect(ORDER_STATUS_META[from as StoreOrderStatus]).toBeDefined();
      for (const to of list) {
        expect(ORDER_STATUS_META[to]).toBeDefined();
      }
    }
  });

  test("every backend status normalises to a renderable seller status", () => {
    for (const status of BACKEND_ORDER_STATUSES) {
      const sellerStatus = normalizeSellerOrderStatus(status);
      expect(ORDER_STATUS_META[sellerStatus]).toBeDefined();
      expect(getOrderStatusMeta(sellerStatus)).not.toBe(UNKNOWN_ORDER_STATUS_META);
    }
  });

  test("a refunded order is terminal for the seller, not 'awaiting confirmation'", () => {
    // stripe.ts marks the order `refunded` only on a full refund, so there is
    // nothing left to fulfil. Mapping it to `pending` previously offered the
    // seller a confirm/cancel action that silently un-refunded the status.
    expect(normalizeSellerOrderStatus("refunded")).toBe("cancelled");
    expect(NEXT_ORDER_STATUSES.cancelled).toEqual([]);
    expect(NEXT_ORDER_STATUSES.refunded).toEqual([]);
  });

  test("a paid order is offered the same next steps the backend accepts", () => {
    // normalizeSellerOrderStatus('paid') === 'pending', so the seller actions
    // for a paid-but-unconfirmed order must match the `pending` transitions.
    expect(normalizeSellerOrderStatus("paid")).toBe("pending");
    expect(NEXT_ORDER_STATUSES.paid).toEqual(NEXT_ORDER_STATUSES.pending);
    expect(normalizeSellerOrderStatus("pending_payment")).toBe("pending");
    expect(NEXT_ORDER_STATUSES.pending_payment).toEqual(NEXT_ORDER_STATUSES.pending);
    expect(normalizeSellerOrderStatus("payment_failed")).toBe("cancelled");
    expect(NEXT_ORDER_STATUSES.payment_failed).toEqual([]);
  });
});
