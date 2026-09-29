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

/** The statuses stripe.ts writes as SQL literals: `UPDATE orders SET status = 'x'`. */
function stripeOrderStatusWrites(): string[] {
  const src = read("backend/routes/stripe.ts");
  const matches = src.matchAll(/UPDATE orders SET status = '([a-z_]+)'/g);
  return [...matches].map((m) => m[1] as string);
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
  test("stripe.ts writes only statuses the shared contract knows", () => {
    const written = stripeOrderStatusWrites();
    // Guard the scrape itself: a refactor of the SQL shape must fail loudly
    // rather than silently matching nothing.
    expect(written.length).toBeGreaterThanOrEqual(4);

    for (const status of written) {
      expect(getOrderStatusMeta(status)).not.toBe(UNKNOWN_ORDER_STATUS_META);
    }
    // The four lifecycle transitions the payment engine performs.
    expect(new Set(written)).toEqual(
      new Set(["pending_payment", "paid", "payment_failed", "cancelled", "refunded"]),
    );
  });

  test("the pinned backend status list matches the source literals", () => {
    for (const status of stripeOrderStatusWrites()) {
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
