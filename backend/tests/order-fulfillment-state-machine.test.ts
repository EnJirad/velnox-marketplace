/**
 * Order FULFILMENT state machine — the rules, the gates and the races.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `orders.status` is the fulfilment chain and `payments.status` is the payment
 * chain: two axes that a seller, a customer and an admin can all push on at the
 * same time. Before this task the chain had no `packing` state, so `confirmed`
 * meant both "the shop accepted it" and "the shop is preparing it" — which made
 * the customer's cancel rule ("you may cancel until it ships") wrong, and it let
 * a seller dispatch an order with no shipment behind it.
 *
 * What is pinned here:
 *
 *    1. THE CHAIN — `pending → confirmed → packing → shipped → delivered →
 *       completed`, plus `cancelled`, with NO edge out of a terminal state and NO
 *       edge from `packing` to `cancelled` (fulfilment has started: the return
 *       flow owns it now). One authority: `backend/lib/order-fulfillment.ts`.
 *    2. PAYMENT IS A SEPARATE AXIS — a Card/PromptPay order can only be CONFIRMED
 *       once a `paid` payment row proves the money moved (written by the Stripe
 *       webhook, never by a seller), so an unpaid order cannot enter fulfilment.
 *       COD only passes while its rail is enabled — and it is DISABLED.
 *    3. `shipped` NEEDS A REAL SHIPMENT — a `shipments` row carrying a carrier and
 *       a tracking number, written in the SAME transaction as the status change.
 *    4. CANCELLATION — the customer may cancel `pending` / `pending_payment` /
 *       `confirmed` and nothing later, enforced by the guarded UPDATE in
 *       `PATCH /api/customer/orders/:orderId/cancel` (the UI button only mirrors
 *       it), and the two paths serialize on the order row.
 *    5. ORDER SNAPSHOT — the recipient name/phone a seller contacts come from
 *       `orders.shipping_address`, so editing a profile later never rewrites the
 *       details of an order that was already placed.
 *
 * The pure rules run everywhere; the DB-gated cases (`hasTestDatabase()`) run
 * against the real Postgres test database, so the SQL — not just the table — is
 * exercised. `bun test` refuses to run them against a production database.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import {
  CUSTOMER_CANCELABLE_FULFILLMENT_STATUSES,
  FULFILLMENT_STATUSES,
  FULFILLMENT_TRANSITIONS,
  FulfillmentError,
  PAID_PAYMENT_STATUSES,
  assertNoSettledPaymentForCancellation,
  assertPaymentConfirmedForConfirmation,
  canTransitionFulfillment,
  ensureShipmentForShipping,
  isCodPaymentMethod,
  isFulfillmentStatus,
  normalizeOrderStatusToFulfillment,
  paymentAllowsConfirmation,
} from "../lib/order-fulfillment.js";
import { assertPaymentMethodUsable, isCodEnabled } from "../lib/payment-config.js";
import { orderContact } from "../routes/seller-orders.js";
import { translations } from "../../packages/shared/src/lib/i18n/locales/index";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const FULFILLMENT_LIB = "backend/lib/order-fulfillment.ts";
const SELLER_ROUTE = "backend/routes/seller-orders.ts";
const CENTER_ROUTE = "backend/routes/center.ts";
const CANCEL_ROUTE = "backend/routes/cart.ts";
const SELLER_DETAIL_PAGE = "apps/velseller/src/pages/SellerOrderDetail.tsx";
const SELLER_LIST_PAGE = "apps/velseller/src/pages/SellerOrders.tsx";
const CUSTOMER_DETAIL_PAGE = "apps/velshop/src/pages/ShopOrderDetail.tsx";
const CENTER_SHIP_DIALOG = "apps/velcenter/src/components/OrderShipDialog.tsx";

// ═══════════════════════════════════════════════════════════════════════════
// 1. The chain itself
// ═══════════════════════════════════════════════════════════════════════════

describe("fulfilment state machine — the chain", () => {
  test("has exactly the seven fulfilment statuses, in order", () => {
    expect([...FULFILLMENT_STATUSES]).toEqual([
      "pending",
      "confirmed",
      "packing",
      "shipped",
      "delivered",
      "completed",
      "cancelled",
    ]);
    for (const status of FULFILLMENT_STATUSES) expect(isFulfillmentStatus(status)).toBe(true);
    for (const other of ["paid", "pending_payment", "expired", "refunded", "", null, 42]) {
      expect(isFulfillmentStatus(other)).toBe(false);
    }
  });

  test("allows every documented forward transition", () => {
    expect(canTransitionFulfillment("pending", "confirmed")).toBe(true);
    expect(canTransitionFulfillment("pending", "cancelled")).toBe(true);
    expect(canTransitionFulfillment("confirmed", "packing")).toBe(true);
    expect(canTransitionFulfillment("confirmed", "cancelled")).toBe(true);
    expect(canTransitionFulfillment("packing", "shipped")).toBe(true);
    expect(canTransitionFulfillment("shipped", "delivered")).toBe(true);
    expect(canTransitionFulfillment("delivered", "completed")).toBe(true);
  });

  test("rejects every transition that skips a state", () => {
    expect(canTransitionFulfillment("pending", "packing")).toBe(false);
    expect(canTransitionFulfillment("pending", "shipped")).toBe(false);
    expect(canTransitionFulfillment("pending", "delivered")).toBe(false);
    expect(canTransitionFulfillment("pending", "completed")).toBe(false);
    // `confirmed` no longer jumps to `shipped`: fulfilment must be STARTED.
    expect(canTransitionFulfillment("confirmed", "shipped")).toBe(false);
    expect(canTransitionFulfillment("confirmed", "delivered")).toBe(false);
    expect(canTransitionFulfillment("confirmed", "completed")).toBe(false);
    expect(canTransitionFulfillment("packing", "delivered")).toBe(false);
    expect(canTransitionFulfillment("packing", "completed")).toBe(false);
    expect(canTransitionFulfillment("shipped", "completed")).toBe(false);
    // …and nothing may jump backwards.
    expect(canTransitionFulfillment("shipped", "confirmed")).toBe(false);
    expect(canTransitionFulfillment("delivered", "packing")).toBe(false);
  });

  test("`packing` is the point of no return for cancellation", () => {
    expect(canTransitionFulfillment("packing", "cancelled")).toBe(false);
    expect(canTransitionFulfillment("shipped", "cancelled")).toBe(false);
    expect(canTransitionFulfillment("delivered", "cancelled")).toBe(false);
    expect(canTransitionFulfillment("completed", "cancelled")).toBe(false);
    // Whether the customer may still cancel is the same rule, one state earlier.
    expect([...CUSTOMER_CANCELABLE_FULFILLMENT_STATUSES]).toEqual(["pending", "confirmed"]);
    expect(CUSTOMER_CANCELABLE_FULFILLMENT_STATUSES).not.toContain("packing");
  });

  test("terminal states are terminal — a late request cannot resurrect an order", () => {
    expect(FULFILLMENT_TRANSITIONS.completed).toEqual([]);
    expect(FULFILLMENT_TRANSITIONS.cancelled).toEqual([]);
    for (const to of FULFILLMENT_STATUSES) {
      if (to === "completed" || to === "cancelled") continue;
      expect(canTransitionFulfillment("completed", to)).toBe(false);
      expect(canTransitionFulfillment("cancelled", to)).toBe(false);
    }
  });

  test("a raw orders.status is judged by its fulfilment meaning", () => {
    // The payment lifecycle is translated, never treated as fulfilment.
    expect(normalizeOrderStatusToFulfillment("pending_payment")).toBe("pending");
    expect(normalizeOrderStatusToFulfillment("paid")).toBe("pending");
    expect(normalizeOrderStatusToFulfillment("packing")).toBe("packing");
    expect(normalizeOrderStatusToFulfillment("confirmed")).toBe("confirmed");
    expect(normalizeOrderStatusToFulfillment("shipped")).toBe("shipped");
    // `expired` already released its stock; a refund is terminal for the order.
    expect(normalizeOrderStatusToFulfillment("expired")).toBe("cancelled");
    expect(normalizeOrderStatusToFulfillment("payment_failed")).toBe("cancelled");
    expect(normalizeOrderStatusToFulfillment("refunded")).toBe("cancelled");
    // An unknown value still has to pass a real confirmation.
    expect(normalizeOrderStatusToFulfillment("who-knows")).toBe("pending");
  });

  test("both write paths use that ONE module, under a row lock", () => {
    const lib = read(FULFILLMENT_LIB);
    expect(lib).toContain("export function canTransitionFulfillment(");
    // The seller route owns nothing of the machine itself any more…
    const seller = read(SELLER_ROUTE);
    expect(seller).toContain('from "../lib/order-fulfillment.js"');
    expect(seller).toContain("export const SELLER_ORDER_STATUS_TRANSITIONS = FULFILLMENT_TRANSITIONS;");
    expect(seller).not.toContain('pending: ["confirmed", "cancelled"],\n  confirmed: ["shipped"');
    // …and neither does the center route.
    const center = read(CENTER_ROUTE);
    expect(center).toContain('from "../lib/order-fulfillment.js"');
    expect(center).toContain("canTransitionFulfillment(from, to)");
    // Both lock the order row before deciding, so the two paths serialize.
    for (const route of [seller, center]) {
      expect(route).toContain("FOR UPDATE");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Payment gate — an unpaid order cannot enter fulfilment
// ═══════════════════════════════════════════════════════════════════════════

describe("payment gate — confirming requires settled money", () => {
  test("only a `paid` payment lets an order be confirmed", () => {
    expect([...PAID_PAYMENT_STATUSES]).toEqual(["paid"]);
    expect(paymentAllowsConfirmation([{ method: "CARD", status: "paid" }]).allowed).toBe(true);
    for (const status of ["pending", "requires_action", "processing", "unpaid", "failed", "cancelled", "refunded"]) {
      expect(paymentAllowsConfirmation([{ method: "CARD", status }]).allowed).toBe(false);
    }
    // No payment row at all (e.g. an order that never reached Stripe) is refused.
    expect(paymentAllowsConfirmation([]).allowed).toBe(false);
    // A PAID row anywhere in the order's history proves the money moved, even
    // when a later attempt is pending again.
    expect(
      paymentAllowsConfirmation([
        { method: "CARD", status: "pending" },
        { method: "CARD", status: "paid" },
      ]).allowed,
    ).toBe(true);
  });

  test("COD only passes while its (disabled) rail is enabled", () => {
    expect(isCodPaymentMethod("cod")).toBe(true);
    expect(isCodPaymentMethod("COD")).toBe(true);
    expect(isCodPaymentMethod("cash_on_delivery")).toBe(true);
    expect(isCodPaymentMethod("CARD")).toBe(false);

    // The rail is read from the environment at call time, so this test clears
    // the flag itself instead of inheriting whatever another suite left behind.
    const previous = process.env.COD_ENABLED;
    delete process.env.COD_ENABLED;
    try {
      // COD is DISABLED, so a COD order cannot bypass the payment gate…
      expect(isCodEnabled()).toBe(false);
      expect(paymentAllowsConfirmation([{ method: "cod", status: "pending" }]).allowed).toBe(false);
      // …and the rail stays closed to the customer/API too.
      expect(assertPaymentMethodUsable("COD")).toMatchObject({
        ok: false,
        code: "PAYMENT_METHOD_DISABLED",
        status: 403,
      });
      // A deployment that DID turn the rail on would let a COD order through —
      // which is exactly why the flag is the switch, never the method alone.
      expect(paymentAllowsConfirmation([{ method: "cod", status: "pending" }], true).allowed).toBe(true);
    } finally {
      if (previous === undefined) delete process.env.COD_ENABLED;
      else process.env.COD_ENABLED = previous;
    }
  });

  test("the route runs the gate INSIDE the transaction, before the status change", () => {
    const seller = read(SELLER_ROUTE);
    const route = seller.slice(seller.indexOf('app.patch("/api/seller/orders/:id/status"'));
    const lock = route.indexOf("FOR UPDATE");
    const gate = route.indexOf("await assertPaymentConfirmedForConfirmation(client, orderId)");
    const update = route.indexOf("UPDATE orders SET status = $1, updated_at = NOW()");
    expect(lock).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(lock);
    expect(update).toBeGreaterThan(gate);
    // The refusal answers with its own code, so the UI can explain it.
    expect(route).toContain("err instanceof FulfillmentError");
    // A seller never writes payment state anywhere in this module.
    expect(seller).not.toContain("INSERT INTO payments");
    expect(seller).not.toMatch(/UPDATE payments/);
    // The admin path applies the same gate.
    const center = read(CENTER_ROUTE);
    expect(center).toContain("await assertPaymentConfirmedForConfirmation(client, orderId)");
  });

  test("the cod rail is off exactly as the payment foundation requires", () => {
    // `isCodEnabled()` fails closed: only an explicit true/1 opens it, so the
    // COD branch above cannot be reached in production today.
    const config = read("backend/lib/payment-config.ts");
    expect(config).toContain('raw === "true" || raw === "1"');
    expect(config).toContain("export function isCodEnabled(): boolean");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Shipment gate — `shipped` means a real parcel
// ═══════════════════════════════════════════════════════════════════════════

describe("shipment gate — `shipped` needs a carrier and a tracking number", () => {
  test("the refusal is a typed, catchable error", () => {
    const lib = read(FULFILLMENT_LIB);
    expect(lib).toContain('"SHIPMENT_REQUIRED"');
    expect(lib).toContain('"PAYMENT_NOT_CONFIRMED"');
    expect(new FulfillmentError(400, "SHIPMENT_REQUIRED", "x").code).toBe("SHIPMENT_REQUIRED");
  });

  test("both routes ask for the shipment inside the same transaction", () => {
    const seller = read(SELLER_ROUTE);
    const route = seller.slice(seller.indexOf('app.patch("/api/seller/orders/:id/status"'));
    expect(route).toContain("await ensureShipmentForShipping(client, orderId, { carrier, trackingNumber });");
    expect(route.indexOf("ensureShipmentForShipping")).toBeLessThan(
      route.indexOf("UPDATE orders SET status = $1, updated_at = NOW()"),
    );
    expect(read(CENTER_ROUTE)).toContain("await ensureShipmentForShipping(client, orderId, { carrier, trackingNumber });");
    // The shipment is written to the EXISTING table — no second shipment system.
    const lib = read(FULFILLMENT_LIB);
    expect(lib).toContain("INSERT INTO shipments");
    expect(lib).not.toContain("CREATE TABLE");
  });

  test("the seller UI collects the details and sends them with the transition", () => {
    const detail = read(SELLER_DETAIL_PAGE);
    expect(detail).toContain("handleStatusChange(\"shipped\"");
    expect(detail).toContain("carrier: shipment.carrier, trackingNumber: shipment.trackingNumber");
    expect(detail).toContain('t("orderFulfillment.trackingField")');
    expect(detail).toContain('t("orderFulfillment.carrier")');
    // The admin surface can dispatch too (one dialog, mounted once).
    const centerDialog = read(CENTER_SHIP_DIALOG);
    expect(centerDialog).toContain('status: "shipped"');
    expect(centerDialog).toContain("carrier: carrier.trim()");
    expect(read("apps/velcenter/src/main.tsx")).toContain("<OrderShipDialogHost />");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Customer cancellation — backend authority, not a hidden button
// ═══════════════════════════════════════════════════════════════════════════

describe("customer cancellation — enforced server-side", () => {
  test("the cancel route's list is still exactly the shared cancelable set", () => {
    const cart = read(CANCEL_ROUTE);
    const match = cart.match(/const CANCELABLE_STATUSES = \[([^\]]+)\];/);
    expect(match).not.toBeNull();
    const listed = [...match![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(listed).toEqual(["pending", "pending_payment", "confirmed"]);
    // The fulfilment rule and the route's literal list agree: `pending_payment`
    // is the payment-lifecycle twin of `pending` (an abandoned Checkout
    // Session), so the two lists differ by exactly that one value.
    expect([...CUSTOMER_CANCELABLE_FULFILLMENT_STATUSES]).toEqual(["pending", "confirmed"]);
    expect([...listed].sort()).toEqual([...CUSTOMER_CANCELABLE_FULFILLMENT_STATUSES, "pending_payment"].sort());
    // `packing` is neither listed nor reachable through the guarded UPDATE.
    expect(listed).not.toContain("packing");
    expect(cart).toContain("WHERE id = $1 AND status = ANY($2::text[])");
  });

  test("the customer UI hides the button, but the backend still decides", () => {
    const page = read(CUSTOMER_DETAIL_PAGE);
    expect(page).toContain("orderCustomerCancelability(order)");
    // The refusal copy exists for a customer who reloads a packed order.
    expect(read("packages/shared/src/lib/commerce.ts")).toContain("CUSTOMER_CANCELABLE_ORDER_STATUSES");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Order snapshot — history is not the current profile
// ═══════════════════════════════════════════════════════════════════════════

describe("order snapshot — the seller ships to the ORDER's recipient", () => {
  test("the snapshot wins over the account, which is only a legacy fallback", () => {
    const snapshot = { recipientName: "สมชาย ใจดี", phone: "0812345678" };
    // The customer has since changed their display name and phone.
    const account = { name: "สมชาย ใหม่", phone: "0899999999" };
    expect(orderContact(snapshot, account)).toEqual({ name: "สมชาย ใจดี", phone: "0812345678" });
    // A legacy order whose snapshot has no phone falls back to the account…
    expect(orderContact({ recipientName: "สมชาย" }, account)).toEqual({
      name: "สมชาย",
      phone: "0899999999",
    });
    // …and a blank snapshot value is treated as missing, never rendered as "".
    expect(orderContact({ recipientName: "   ", phone: "" }, account)).toEqual({
      name: "สมชาย ใหม่",
      phone: "0899999999",
    });
    expect(orderContact(null, undefined)).toEqual({ name: null, phone: null });
  });

  test("both seller reads use it (list and detail), from the order's own column", () => {
    const seller = read(SELLER_ROUTE);
    const uses = seller.match(/orderContact\(addressSnapshot, customer\)/g) ?? [];
    expect(uses.length).toBe(2); // the list route and the detail route
    expect(seller).toContain("o.shipping_address"); // selected by both reads
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. UI wiring: the packing status reaches every surface
// ═══════════════════════════════════════════════════════════════════════════

describe("packing reaches every order surface", () => {
  test("the progress line, the badge and the seller filter know it", () => {
    const commerce = read("packages/shared/src/lib/commerce.ts");
    expect(commerce).toContain('ORDER_PROGRESS_STAGES = ["placed", "payment", "processing", "packing", "shipped", "delivered"]');
    expect(commerce).toContain('packing: ["shipped"],');
    expect(commerce).toContain("orderProgressStageI18nKey");
    expect(read("packages/shared/src/components/order/OrderStatusBadge.tsx")).toContain("packing: PackageOpen");
    expect(read(SELLER_LIST_PAGE)).toContain('"packing"');
    expect(read(CUSTOMER_DETAIL_PAGE)).toContain("orderProgressStageI18nKey(stage)");
    expect(read("packages/shared/src/lib/shop.ts")).toContain("packing: {");
  });

  test("the packing label and the ship dialog exist in th, en and my", () => {
    for (const lang of ["th", "en", "my"] as const) {
      const fulfillment = translations[lang].orderFulfillment;
      expect(fulfillment.packing.trim().length).toBeGreaterThan(0);
      expect(fulfillment.shipTitle.trim().length).toBeGreaterThan(0);
      expect(fulfillment.shipDesc.trim().length).toBeGreaterThan(0);
      expect(fulfillment.carrier.trim().length).toBeGreaterThan(0);
      expect(fulfillment.trackingField.trim().length).toBeGreaterThan(0);
      expect(fulfillment.shipConfirm.trim().length).toBeGreaterThan(0);
      expect(fulfillment.shipRequired.trim().length).toBeGreaterThan(0);
      expect(fulfillment.paymentNotConfirmed.trim().length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. Database — `packing` is a real, constrained orders.status value
// ═══════════════════════════════════════════════════════════════════════════

describe("database", () => {
  test("orders.status carries a CHECK that admits `packing`", () => {
    // This used to assert the column was FREE TEXT ("no CHECK on orders.status"),
    // which was true until audit MEDIUM #9 and is now deliberately false: the
    // column is constrained, and adding the state machine's `packing` state to a
    // constrained column DOES require a schema change — migration V0050, which is
    // exactly that. The concern this test protects is unchanged: `packing` must
    // be storable. What changed is only that the schema now has to say so.
    for (const file of ["db/schema.sql", "db/run-sqleditor.sql"]) {
      const sql = read(file);
      expect(sql).toContain("status TEXT NOT NULL DEFAULT 'pending'");
      const ordersTable = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS orders ("));
      const block = ordersTable.slice(0, ordersTable.indexOf(");"));
      expect(block).toContain("CHECK (status");
      // The constraint must admit the whole fulfilment chain, `packing` above
      // all — it is the state the fulfilment machine added and the reason this
      // assertion was ever written.
      for (const status of FULFILLMENT_STATUSES) {
        expect(block).toContain(`'${status}'`);
      }
    }
    // The deprecated bootstrap file is never a dependency of this feature.
    const checked = [...new Bun.Glob("backend/**/*.ts").scanSync({ cwd: root })]
      .filter((file) => !file.includes("/tests/"))
      .filter((file) => read(file).includes("run-update.sql"));
    expect(checked).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 8. Real database: the gates and the races
// ═══════════════════════════════════════════════════════════════════════════

describe("fulfilment gates and races (requires TEST_DATABASE_URL)", () => {
  const hasDb = hasTestDatabase();
  const testFn = hasDb ? test : test.skip;

  testFn(
    "a Card order cannot be confirmed until the webhook has written `paid`",
    async () => {
      const { query, withTransaction } = await import("../db/index.js");
      const { randomUUID } = await import("crypto");
      const tag = `ful-${randomUUID().slice(0, 8)}`;
      const user = await query(
        `INSERT INTO users (email, name) VALUES ($1, 'Ful Test') RETURNING id`,
        [`${tag}@test.local`],
      );
      const userId = user.rows[0].id as string;
      const order = await query(
        `INSERT INTO orders (user_id, status, total_amount, currency) VALUES ($1, 'pending_payment', 100, 'THB') RETURNING id`,
        [userId],
      );
      const orderId = order.rows[0].id as string;

      try {
        const payment = await query(
          `INSERT INTO payments (order_id, provider, method, amount, currency, status)
           VALUES ($1, 'stripe', 'CARD', 100, 'THB', 'pending') RETURNING id`,
          [orderId],
        );

        // Unpaid → refused, and nothing about the order moves.
        await expect(
          withTransaction((client) => assertPaymentConfirmedForConfirmation(client, orderId)),
        ).rejects.toThrow(/not been paid/i);

        // The webhook settles the payment; now the confirmation is legitimate.
        await query(`UPDATE payments SET status = 'paid' WHERE id = $1`, [payment.rows[0].id]);
        const decision = await withTransaction((client) =>
          assertPaymentConfirmedForConfirmation(client, orderId),
        );
        expect(decision.method).toBe("CARD");

        // A COD order is refused while the rail is off, even with a payment row.
        await query(`UPDATE payments SET method = 'cod', status = 'pending' WHERE id = $1`, [
          payment.rows[0].id,
        ]);
        await expect(
          withTransaction((client) => assertPaymentConfirmedForConfirmation(client, orderId)),
        ).rejects.toThrow(/not been paid/i);
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  testFn(
    "`shipped` writes the shipment row, and is refused without one",
    async () => {
      const { query, withTransaction } = await import("../db/index.js");
      const { randomUUID } = await import("crypto");
      const tag = `ful-${randomUUID().slice(0, 8)}`;
      const user = await query(
        `INSERT INTO users (email, name) VALUES ($1, 'Ful Test') RETURNING id`,
        [`${tag}@test.local`],
      );
      const userId = user.rows[0].id as string;
      const order = await query(
        `INSERT INTO orders (user_id, status, total_amount, currency) VALUES ($1, 'packing', 100, 'THB') RETURNING id`,
        [userId],
      );
      const orderId = order.rows[0].id as string;

      try {
        // Carrier without a tracking number → refused, and NO row is written.
        await expect(
          withTransaction((client) =>
            ensureShipmentForShipping(client, orderId, { carrier: "Kerry", trackingNumber: "  " }),
          ),
        ).rejects.toThrow(/carrier and a tracking number/i);
        let rows = await query(`SELECT id FROM shipments WHERE order_id = $1`, [orderId]);
        expect(rows.rows.length).toBe(0);

        // Nothing at all → refused too (an order with no shipment is not shipped).
        await expect(
          withTransaction((client) => ensureShipmentForShipping(client, orderId, {})),
        ).rejects.toThrow(/carrier and a tracking number/i);

        // With both values the row is created in the SAME transaction…
        const created = await withTransaction((client) =>
          ensureShipmentForShipping(client, orderId, { carrier: " Kerry ", trackingNumber: " TH123 " }),
        );
        expect(created.carrier).toBe("Kerry");
        expect(created.trackingNumber).toBe("TH123");
        rows = await query(`SELECT carrier, tracking_number, status FROM shipments WHERE order_id = $1`, [
          orderId,
        ]);
        expect(rows.rows[0]).toMatchObject({
          carrier: "Kerry",
          tracking_number: "TH123",
          status: "created",
        });

        // An existing valid shipment is accepted unchanged (a retry of the
        // transition, or a tracking number entered by an operator first).
        const reused = await withTransaction((client) => ensureShipmentForShipping(client, orderId, {}));
        expect(reused.trackingNumber).toBe("TH123");

        // …and a missing tracking number can be filled in later — no duplicate row.
        await query(`UPDATE shipments SET tracking_number = NULL WHERE order_id = $1`, [orderId]);
        await expect(
          withTransaction((client) => ensureShipmentForShipping(client, orderId, {})),
        ).rejects.toThrow(/carrier and a tracking number/i);
        await withTransaction((client) =>
          ensureShipmentForShipping(client, orderId, { trackingNumber: "TH999" }),
        );
        rows = await query(`SELECT tracking_number FROM shipments WHERE order_id = $1`, [orderId]);
        expect(rows.rows.length).toBe(1);
        expect(rows.rows[0].tracking_number).toBe("TH999");
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  testFn(
    "cancel vs packing: whoever commits first wins, the loser is refused",
    async () => {
      const { query, withTransaction } = await import("../db/index.js");
      const { randomUUID } = await import("crypto");
      const tag = `ful-${randomUUID().slice(0, 8)}`;
      const user = await query(
        `INSERT INTO users (email, name) VALUES ($1, 'Ful Test') RETURNING id`,
        [`${tag}@test.local`],
      );
      const userId = user.rows[0].id as string;
      const CANCELABLE = ["pending", "pending_payment", "confirmed"];

      const mkOrder = async () => {
        const res = await query(
          `INSERT INTO orders (user_id, status, total_amount, currency) VALUES ($1, 'confirmed', 100, 'THB') RETURNING id`,
          [userId],
        );
        return res.rows[0].id as string;
      };

      try {
        // ── Case A: the seller commits `packing` first ──────────────────────
        const packed = await mkOrder();
        const sellerWon = await withTransaction(async (client) => {
          const current = await client.query(`SELECT status FROM orders WHERE id = $1 FOR UPDATE`, [packed]);
          const from = normalizeOrderStatusToFulfillment(current.rows[0].status);
          expect(canTransitionFulfillment(from, "packing")).toBe(true);
          await client.query(`UPDATE orders SET status = 'packing', updated_at = NOW() WHERE id = $1`, [packed]);
          return true;
        });
        expect(sellerWon).toBe(true);

        // The customer's cancel now finds nothing to move (its guarded UPDATE
        // matches no row), so NO stock is released a second time.
        const cancelOutcome = await withTransaction(async (client) => {
          const claim = await client.query(
            `UPDATE orders SET status = 'cancelled', updated_at = NOW()
              WHERE id = $1 AND status = ANY($2::text[])
              RETURNING id`,
            [packed, CANCELABLE],
          );
          return claim.rows.length > 0;
        });
        expect(cancelOutcome).toBe(false);
        let status = await query(`SELECT status FROM orders WHERE id = $1`, [packed]);
        expect(status.rows[0].status).toBe("packing");

        // ── Case B: the customer commits `cancelled` first ──────────────────
        const cancelled = await mkOrder();
        const customerWon = await withTransaction(async (client) => {
          const claim = await client.query(
            `UPDATE orders SET status = 'cancelled', updated_at = NOW()
              WHERE id = $1 AND status = ANY($2::text[])
              RETURNING id`,
            [cancelled, CANCELABLE],
          );
          return claim.rows.length > 0;
        });
        expect(customerWon).toBe(true);

        // The seller's packing now reads `cancelled` under the row lock and the
        // transition table refuses it — the order is not resurrected.
        const sellerRefused = await withTransaction(async (client) => {
          const current = await client.query(`SELECT status FROM orders WHERE id = $1 FOR UPDATE`, [cancelled]);
          const from = normalizeOrderStatusToFulfillment(current.rows[0].status);
          return !canTransitionFulfillment(from, "packing");
        });
        expect(sellerRefused).toBe(true);
        status = await query(`SELECT status FROM orders WHERE id = $1`, [cancelled]);
        expect(status.rows[0].status).toBe("cancelled");
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  testFn(
    "cancel vs shipment: whoever commits first wins, the loser is refused",
    async () => {
      const { query, withTransaction } = await import("../db/index.js");
      const { randomUUID } = await import("crypto");
      const tag = `ful-${randomUUID().slice(0, 8)}`;
      const user = await query(
        `INSERT INTO users (email, name) VALUES ($1, 'Ful Test') RETURNING id`,
        [`${tag}@test.local`],
      );
      const userId = user.rows[0].id as string;
      const CANCELABLE = ["pending", "pending_payment", "confirmed"];

      const mkOrder = async (status: string) => {
        const res = await query(
          `INSERT INTO orders (user_id, status, total_amount, currency) VALUES ($1, $2, 100, 'THB') RETURNING id`,
          [userId, status],
        );
        return res.rows[0].id as string;
      };

      try {
        // ── Case A: the shipment commits first ──────────────────────────────
        const shipped = await mkOrder("packing");
        await withTransaction((client) =>
          ensureShipmentForShipping(client, shipped, { carrier: "Kerry", trackingNumber: "TH111" }),
        );
        const sellerWon = await withTransaction(async (client) => {
          const current = await client.query(`SELECT status FROM orders WHERE id = $1 FOR UPDATE`, [shipped]);
          const from = normalizeOrderStatusToFulfillment(current.rows[0].status);
          expect(canTransitionFulfillment(from, "shipped")).toBe(true);
          await client.query(`UPDATE orders SET status = 'shipped', updated_at = NOW() WHERE id = $1`, [shipped]);
          return true;
        });
        expect(sellerWon).toBe(true);

        // The customer's cancel now matches no row — `shipped` is outside the
        // cancelable set — so the order stays shipped and the stock is never
        // released a second time.
        const cancelOutcome = await withTransaction(async (client) => {
          const claim = await client.query(
            `UPDATE orders SET status = 'cancelled', updated_at = NOW()
              WHERE id = $1 AND status = ANY($2::text[])
              RETURNING id`,
            [shipped, CANCELABLE],
          );
          return claim.rows.length > 0;
        });
        expect(cancelOutcome).toBe(false);
        let status = await query(`SELECT status FROM orders WHERE id = $1`, [shipped]);
        expect(status.rows[0].status).toBe("shipped");
        let rows = await query(`SELECT id FROM shipments WHERE order_id = $1`, [shipped]);
        expect(rows.rows.length).toBe(1);

        // ── Case B: the cancel commits first ────────────────────────────────
        const cancelled = await mkOrder("confirmed");
        const customerWon = await withTransaction(async (client) => {
          const claim = await client.query(
            `UPDATE orders SET status = 'cancelled', updated_at = NOW()
              WHERE id = $1 AND status = ANY($2::text[])
              RETURNING id`,
            [cancelled, CANCELABLE],
          );
          return claim.rows.length > 0;
        });
        expect(customerWon).toBe(true);

        // The seller's `shipped` is refused under the row lock — and because the
        // transition table is checked BEFORE the shipment is written, a cancelled
        // order never gains a tracking row for a shipment that will not happen.
        const sellerRefused = await withTransaction(async (client) => {
          const current = await client.query(`SELECT status FROM orders WHERE id = $1 FOR UPDATE`, [cancelled]);
          const from = normalizeOrderStatusToFulfillment(current.rows[0].status);
          if (canTransitionFulfillment(from, "shipped")) {
            await ensureShipmentForShipping(client, cancelled, { carrier: "Kerry", trackingNumber: "TH222" });
          }
          return !canTransitionFulfillment(from, "shipped");
        });
        expect(sellerRefused).toBe(true);
        rows = await query(`SELECT id FROM shipments WHERE order_id = $1`, [cancelled]);
        expect(rows.rows.length).toBe(0);
        status = await query(`SELECT status FROM orders WHERE id = $1`, [cancelled]);
        expect(status.rows[0].status).toBe("cancelled");
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );

  // ── The cancellation gate: money outranks a SELLER or CENTER cancel ───────

  testFn(
    "a paid order is refused a staff cancellation; an unpaid one is not",
    async () => {
      const { query, withTransaction } = await import("../db/index.js");
      const { randomUUID } = await import("crypto");
      const tag = `ful-${randomUUID().slice(0, 8)}`;
      const user = await query(
        `INSERT INTO users (email, name) VALUES ($1, 'Ful Test') RETURNING id`,
        [`${tag}@test.local`],
      );
      const userId = user.rows[0].id as string;

      /** The gate as a route calls it, returning the refusal instead of throwing. */
      const attemptCancel = (orderId: string) =>
        withTransaction((client) => assertNoSettledPaymentForCancellation(client, orderId))
          .then(() => null)
          .catch((err) => err as FulfillmentError);

      const mkOrder = async () => {
        const res = await query(
          `INSERT INTO orders (user_id, status, total_amount, currency) VALUES ($1, 'confirmed', 100, 'THB') RETURNING id`,
          [userId],
        );
        return res.rows[0].id as string;
      };
      const pay = (orderId: string, status: string) =>
        query(
          `INSERT INTO payments (order_id, provider, method, amount, currency, status)
           VALUES ($1, 'stripe', 'CARD', 100, 'THB', $2)`,
          [orderId, status],
        );

      try {
        // Nobody paid yet — the "the shop cannot fill it" cancellation, which
        // still releases the held stock.
        const unpaid = await mkOrder();
        await pay(unpaid, "pending");
        expect(await attemptCancel(unpaid)).toBeNull();

        // A charge in flight must be allowed to settle first, so it refuses —
        // and it says WHICH state it is in, without touching the order.
        const inFlight = await mkOrder();
        await pay(inFlight, "processing");
        const inFlightErr = await attemptCancel(inFlight);
        expect(inFlightErr).toBeInstanceOf(FulfillmentError);
        expect(inFlightErr?.code).toBe("PAYMENT_IN_PROGRESS");
        expect(inFlightErr?.status).toBe(409);

        // The money moved: a `paid` payment row is enough on its own, even
        // though the order row still reads `confirmed`.
        const paid = await mkOrder();
        await pay(paid, "paid");
        const paidErr = await attemptCancel(paid);
        expect(paidErr).toBeInstanceOf(FulfillmentError);
        expect(paidErr?.code).toBe("ORDER_ALREADY_PAID");

        // …and so is the raw `paid` ORDER status — the row the webhook wrote.
        // This is the case the audit found: `paid` normalizes to `pending`, and
        // `pending` HAS an edge to `cancelled`.
        const paidRow = await mkOrder();
        await query(`UPDATE orders SET status = 'paid' WHERE id = $1`, [paidRow]);
        expect((await attemptCancel(paidRow))?.code).toBe("ORDER_ALREADY_PAID");

        // The gate is READ-ONLY: neither the three refusals nor the one allowed
        // cancellation moved an order. Each row must still hold the status it was
        // SEEDED with — `confirmed` for the three `mkOrder()` rows, and `paid` for
        // `paidRow`, whose `paid` is this test's own fixture (it proves the raw
        // webhook-written status is refused too), not something the gate wrote.
        const rows = await query(`SELECT id, status FROM orders WHERE id = ANY($1::uuid[])`, [
          [unpaid, inFlight, paid, paidRow],
        ]);
        expect(rows.rows.length).toBe(4);
        const statusById = new Map<string, string>();
        for (const row of rows.rows) statusById.set(row.id as string, row.status as string);
        expect(statusById.get(unpaid)).toBe("confirmed");
        expect(statusById.get(inFlight)).toBe("confirmed");
        expect(statusById.get(paid)).toBe("confirmed");
        expect(statusById.get(paidRow)).toBe("paid");
      } finally {
        await purgeUsers([userId]);
      }
    },
    30_000,
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// 9. Cancellation gate — a PAID order is a refund, not a cancellation
// ═══════════════════════════════════════════════════════════════════════════

describe("cancellation gate — money outranks a staff cancellation", () => {
  test("it answers with the SAME codes the customer's own cancel already uses", () => {
    const lib = read(FULFILLMENT_LIB);
    expect(lib).toContain('"ORDER_ALREADY_PAID"');
    expect(lib).toContain('"PAYMENT_IN_PROGRESS"');
    // The same settled-payment definition the release authority uses, so the
    // gate and `releaseOrderInventory` can never disagree about "the money
    // moved" — and it is read under the caller's lock, never from a fast path.
    expect(lib).toContain('import { PAYMENT_SETTLED_STATUSES } from "./order-lock.js"');
    expect(lib).toContain("[...PAYMENT_SETTLED_STATUSES]");
    expect(lib).toContain("FROM orders o");
    // The customer route keeps its own copy of these two codes — one meaning,
    // one vocabulary, across every surface that can cancel an order.
    expect(read(CANCEL_ROUTE)).toContain('code: "ORDER_ALREADY_PAID"');
    expect(read(CANCEL_ROUTE)).toContain('code: "PAYMENT_IN_PROGRESS"');
  });

  test("both staff routes run it under the lock, BEFORE the status changes", () => {
    const seller = read(SELLER_ROUTE);
    const route = seller.slice(seller.indexOf('app.patch("/api/seller/orders/:id/status"'));
    const lock = route.indexOf("FOR UPDATE");
    const gate = route.indexOf("await assertNoSettledPaymentForCancellation(client, orderId)");
    const update = route.indexOf("UPDATE orders SET status = $1, updated_at = NOW()");
    expect(lock).toBeGreaterThan(-1);
    expect(gate).toBeGreaterThan(lock);
    expect(update).toBeGreaterThan(gate);
    expect(route).toContain('if (status === "cancelled") {');

    const center = read(CENTER_ROUTE);
    const admin = center.slice(center.indexOf('app.patch("/api/admin/orders/:orderId/status"'));
    const adminLock = admin.indexOf("FOR UPDATE");
    const adminGate = admin.indexOf("await assertNoSettledPaymentForCancellation(client, orderId)");
    const adminUpdate = admin.indexOf("UPDATE orders SET status = $1, updated_at = NOW()");
    expect(adminLock).toBeGreaterThan(-1);
    expect(adminGate).toBeGreaterThan(adminLock);
    expect(adminUpdate).toBeGreaterThan(adminGate);
    // Re-selecting the CURRENT status stays the no-op it always was.
    expect(admin).toContain('to === "cancelled" && to !== rawFrom');

    // A cancellation ends the reservation on BOTH staff routes, through the ONE
    // release authority — the admin route used to release nothing at all, so an
    // operator cancelling an unpaid order stranded the held units (the customer
    // can no longer cancel it and the sweep only claims expirable statuses).
    for (const src of [seller, center]) {
      expect(src).toContain("import { releaseOrderInventory } from \"../lib/inventory.js\";");
      expect(src).toContain("await releaseOrderInventory(client, orderId);");
    }
    const adminRelease = admin.indexOf("await releaseOrderInventory(client, orderId);");
    expect(adminRelease).toBeGreaterThan(adminUpdate);
    const sellerRelease = route.indexOf("await releaseOrderInventory(client, orderId);");
    expect(sellerRelease).toBeGreaterThan(update);

    // Neither route writes money state: the gate only reads `payments`.
    for (const src of [seller, center]) {
      expect(src).not.toContain("INSERT INTO payments");
      expect(src).not.toMatch(/UPDATE payments/);
    }
  });

  test("the seller page translates the refusal, in all three locales", () => {
    const detail = read(SELLER_DETAIL_PAGE);
    expect(detail).toContain('err.code === "ORDER_ALREADY_PAID"');
    expect(detail).toContain('err.code === "PAYMENT_IN_PROGRESS"');
    expect(detail).toContain('t("orderFulfillment.cancelPaidOrder")');
    expect(detail).toContain('t("orderFulfillment.cancelPaymentInProgress")');
    for (const lang of ["th", "en", "my"] as const) {
      const fulfillment = translations[lang].orderFulfillment;
      expect(fulfillment.cancelPaidOrder.trim().length).toBeGreaterThan(0);
      expect(fulfillment.cancelPaymentInProgress.trim().length).toBeGreaterThan(0);
    }
  });
});
