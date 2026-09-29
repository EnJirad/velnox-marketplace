/**
 * LATE / UNRECORDABLE PAYMENT — a durable operator incident (audit HIGH #5).
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `.ai/context/payment.md` already states the policy this file must not
 * contradict:
 *
 *   "a late payment can never resurrect an expired order or reclaim another
 *   customer's stock: `markPaymentSucceeded` requires a pre-payment status AND
 *   `inventory_released = FALSE`, records the money on the payment row (which
 *   is what makes it refundable) and logs `manual review/refund required` with
 *   the reason. **No refund is invented in code — an operator decides.**"
 *
 * So the ORDER-level half was already right and is NOT changed here: a captured
 * charge never resurrects a `cancelled` / `expired` / `completed` order, and
 * never touches inventory a second time.
 *
 * What was missing is the last link in that sentence. The only signal was a
 * `console.warn` on one Render log line, with no durable record, no query
 * surface, and nothing an operator can acknowledge. Worse, the warning does
 * not even fire in the sharpest case (Case A below): the order IS still
 * payable, so `moved` is true, the `!moved` branch is skipped, the stock is
 * committed — and the money is captured in Stripe while OUR payment row stays
 * `failed`, so `POST /api/admin/orders/:orderId/refund` refuses it
 * (`PAYMENT_NOT_REFUNDABLE`, which requires `status = 'paid'`). That case is
 * completely silent.
 *
 * THE RULE THIS FILE PINS
 *   money received  →  can settle safely   →  settle through the existing flow
 *                   →  cannot settle       →  DO NOT resurrect, DO NOT touch
 *                                               inventory again, DO NOT drop
 *                                               the event  →  UPSERT a durable
 *                                               operator incident.
 *
 * NO refund or reopen policy is created here. The incident records WHAT an
 * operator must look at; what they then do stays the existing documented
 * process.
 *
 * Structure mirrors the sibling suites: a DB-free contract block that runs in
 * any workspace, and a DB-gated block that drives the REAL webhook and the
 * REAL VelCenter routes against `TEST_DATABASE_URL`.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import { readFileSync } from "fs";
import jwt from "jsonwebtoken";
import { join } from "path";

import { stripeWebhookRawBody } from "../middleware/stripe-raw-body.js";
import { setupCenterRoutes } from "../routes/center.js";
import { setupStripeRoutes } from "../routes/stripe.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const STRIPE_ROUTE = "backend/routes/stripe.ts";
const CENTER_ROUTE = "backend/routes/center.ts";
const INCIDENT_LIB = "backend/lib/payment-incidents.ts";
const SCHEMA = "db/schema.sql";
const BOOTSTRAP = "db/run-sqleditor.sql";

function bodyOf(source: string, startMarker: string): string {
  const start = source.indexOf(startMarker);
  expect(start, `missing declaration: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start + startMarker.length);
  const next = rest.search(/\n(export )?(async )?function |\napp\.(get|post|patch|put|delete)\(/);
  return next < 0 ? rest : rest.slice(0, next);
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The contract (structural — runs with no database)
// ═══════════════════════════════════════════════════════════════════════════

describe("money that cannot settle becomes a durable operator incident", () => {
  test("there is ONE incident authority, and it is idempotent", () => {
    const lib = read(INCIDENT_LIB);
    expect(lib).toContain("export async function recordLatePaymentIncident(");
    // One definition only — a second copy would be a second source of truth.
    expect((lib.match(/export async function recordLatePaymentIncident\(/g) ?? []).length).toBe(1);
    // Idempotency is DETERMINISTIC and database-enforced, not "check then
    // insert" (which two concurrent deliveries would both pass).
    expect(lib).toContain("ON CONFLICT");
    expect(lib).toContain("dedupe_key");
  });

  test("the incident is keyed by what the system already knows", () => {
    const lib = read(INCIDENT_LIB);
    // A deterministic key built from the real identifiers — provider, order,
    // the attempt the event named, and the reason. Never from a timestamp.
    expect(lib).toContain("buildLatePaymentDedupeKey");
    expect(lib).toContain("providerPaymentIntentId");
    expect(lib).toContain("checkoutSessionId");
    expect(lib).toContain("reason");
  });

  test("the webhook records the incident instead of only logging it", () => {
    const stripe = read(STRIPE_ROUTE);
    expect(stripe).toContain("recordLatePaymentIncident");
    const body = bodyOf(stripe, "async function markPaymentSucceeded(");
    // It must be reachable from the success path, and the existing warning
    // must survive next to it — the log line is still useful, it is just no
    // longer the ONLY record.
    expect(body).toContain("recordLatePaymentIncident");
    expect(body).toContain("manual review/refund required");
  });

  test("the exceptional case is DETECTED, not just the order-level one", () => {
    const stripe = read(STRIPE_ROUTE);
    const body = bodyOf(stripe, "async function markPaymentSucceeded(");
    // Case A: the order moves but the ATTEMPT could not be recorded as paid
    // (it was already `failed`). That is "cannot settle" too, and it is the
    // case the old `!moved`-only warning missed entirely.
    expect(body).toContain("attemptRecorded");
    expect(body).toContain("ORDER_NOT_SETTLEABLE");
    expect(body).toContain("ATTEMPT_NOT_RECORDED");
    // The decision must consult BOTH facts — order moved AND attempt recorded —
    // and must exclude a duplicate delivery, because Stripe fires
    // `checkout.session.completed` AND `payment_intent.succeeded` for ONE
    // charge; calling that an incident would bury the real cases.
    const decision = body.slice(
      body.indexOf("duplicateDelivery"),
      body.indexOf("if (lateReason)"),
    );
    expect(decision).toContain("!moved");
    expect(decision).toContain("!attemptRecorded");
  });

  test("a late payment can never resurrect an order, and never touches stock twice", () => {
    const stripe = read(STRIPE_ROUTE);
    const body = bodyOf(stripe, "async function markPaymentSucceeded(");
    // The guards are UNCHANGED — this file must not weaken them.
    expect(body).toContain("status IN ('pending', 'pending_payment')");
    expect(body).toContain("inventory_released = FALSE");
    // Commit happens only on the order claim, exactly as before.
    expect(body).toContain("if (moved) {");
    expect(body).toContain("await commitOrderInventory(client, orderId);");
    // …and the incident is recorded INSIDE the same transaction, so an incident
    // can never be recorded for a settlement that then rolled back.
    expect(body).toContain("withTransaction");
  });

  test("the incident write is schema-tolerant — a webhook must never 500 on it", () => {
    const lib = read(INCIDENT_LIB);
    // `payment_incidents` ships in a migration that is NOT applied in production
    // (the Neon quota blocker, audit #6), exactly like `orders.payment_expires_at`
    // in 048. A webhook that throws would make Stripe retry a payment forever,
    // so the missing-table/undefined-column cases are caught, named once, and
    // swallowed — the same posture `payment-reservation.ts` takes.
    expect(lib).toContain("isUndefinedTableError");
    expect(lib).toContain("isUndefinedColumnError");
  });

  test("the operator surface reuses the EXISTING permission catalog", () => {
    const center = read(CENTER_ROUTE);
    // No new permission code, no new authentication, no role invention.
    expect(center).toContain('app.get("/api/admin/payment-incidents"');
    expect(center).toContain('app.patch("/api/admin/payment-incidents/:incidentId"');
    expect(center).toContain('userHasPermission(req.user!.userId, "orders.view")');
    expect(center).toContain('userHasPermission(req.user!.userId, "orders.manage")');
    // Both routes require a session like every other VelCenter route.
    expect(center).toContain('app.get("/api/admin/payment-incidents", requireAuth');
    expect(center).toContain('app.patch("/api/admin/payment-incidents/:incidentId", requireAuth');
  });

  test("resolving an incident is bookkeeping ONLY — no money, no order, no stock", () => {
    const center = read(CENTER_ROUTE);
    const body = bodyOf(center, 'app.patch("/api/admin/payment-incidents/:incidentId"');
    // It may update `payment_incidents` and write an audit row. It may never
    // touch the order, the payment, refunds, or inventory: "resolved" must not
    // mean "refunded" or "reopened".
    expect(body).toContain("UPDATE payment_incidents");
    expect(body).toContain("writeAuditLog");
    expect(body).not.toMatch(/UPDATE orders SET/);
    expect(body).not.toMatch(/UPDATE payments/);
    expect(body).not.toMatch(/UPDATE refunds/);
    expect(body).not.toMatch(/releaseOrderInventory|commitOrderInventory|inventory/);
  });

  test("the table is additive, deduplicated, and present in BOTH canonical files", () => {
    const schema = read(SCHEMA);
    const bootstrap = read(BOOTSTRAP);
    for (const sql of [schema, bootstrap]) {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS payment_incidents");
      expect(sql).toContain("payment_incidents_dedupe_key");
    }
    // The two canonical files must not drift.
    expect(schema).toBe(bootstrap);
  });

  test("the incident carries no secret and no raw provider payload", () => {
    const lib = read(INCIDENT_LIB);
    const logged = lib
      .split("\n")
      .filter((line) => /console\.(log|warn|error)/.test(line))
      .join("\n")
      .toLowerCase();
    for (const token of [
      "stripe_secret",
      "webhook_secret",
      "client_secret",
      "access_token",
      "cookie",
      "authorization",
    ]) {
      expect(logged).not.toContain(token);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Database-gated: the real webhook and the real VelCenter routes
// ═══════════════════════════════════════════════════════════════════════════

const describeDb = hasTestDatabase() ? describe : describe.skip;
const testFn = hasTestDatabase() ? test : test.skip;

describeDb("late / unrecordable payment (requires TEST_DATABASE_URL)", () => {
  const PAYMENT_ENV_KEYS = [
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_MODE",
  ] as const;
  const WEBHOOK_SECRET = "whsec_000000000000000000000000";
  const JWT_SECRET = process.env.JWT_SECRET!;

  afterEach(() => {
    for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
  });

  function token(userId: string): string {
    return jwt.sign({ userId, email: `${userId}@test.local` }, JWT_SECRET, { expiresIn: "1h" });
  }

  function stripeSignature(payload: string, secret: string, timestamp = Math.floor(Date.now() / 1000)): string {
    const signature = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    return `t=${timestamp},v1=${signature}`;
  }

  function buildApp(): express.Express {
    const app = express();
    app.use(stripeWebhookRawBody);
    app.use(express.json());
    app.use(cookieParser());
    setupStripeRoutes(app);
    setupCenterRoutes(app);
    return app;
  }

  async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
    const server = buildApp().listen(0);
    const port = (server.address() as { port: number }).port;
    try {
      return await fn(`http://127.0.0.1:${port}`);
    } finally {
      server.close();
    }
  }

  async function seedOrder(opts: {
    orderStatus: string;
    inventoryReleased?: boolean;
    attemptStatus: string;
    quantity?: number;
  }) {
    const { query } = await import("../db/index.js");
    const quantity = opts.quantity ?? 3;
    const tag = `late-${crypto.randomUUID()}`;

    const owner = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-owner@test.local`,
      "Late Owner",
    ]);
    const ownerId = owner.rows[0].id as string;
    const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-seller@test.local`,
      "Late Seller",
    ]);
    const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [
      sellerUser.rows[0].id,
    ]);
    const shop = await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
      seller.rows[0].id,
      `${tag} shop`,
      tag,
    ]);
    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status, sold_count)
       VALUES ($1, $2, $3, 120.00, 'published', 0) RETURNING id`,
      [shop.rows[0].id, `${tag} product`, `${tag}-p`],
    );
    const productId = product.rows[0].id as string;
    await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 50, $2)`, [
      productId,
      quantity,
    ]);

    const order = await query(
      `INSERT INTO orders (user_id, shop_id, order_number, status, total_amount, currency, inventory_released)
       VALUES ($1, $2, $3, $4, 360.00, 'THB', $5) RETURNING id`,
      [ownerId, shop.rows[0].id, `LT-${tag.slice(-12)}`, opts.orderStatus, opts.inventoryReleased ?? false],
    );
    const orderId = order.rows[0].id as string;
    await query(
      `INSERT INTO order_items (order_id, product_id, shop_id, product_name, quantity, price, subtotal)
       VALUES ($1, $2, $3, $4, $5, 120.00, $6)`,
      [orderId, productId, shop.rows[0].id, `${tag} product`, quantity, quantity * 120],
    );
    const intentId = `pi_${tag}`;
    await query(
      `INSERT INTO payments
         (order_id, provider, method, status, amount, currency,
          provider_checkout_session_id, provider_payment_id, failure_code)
       VALUES ($1, 'stripe', 'CARD', $2, 360.00, 'THB', $3, $4, $5)`,
      [
        orderId,
        opts.attemptStatus,
        `cs_${tag}`,
        intentId,
        opts.attemptStatus === "failed" ? "SESSION_NOT_REUSABLE" : null,
      ],
    );
    return { orderId, ownerId, productId, quantity, intentId };
  }

  async function stateOf(orderId: string, productId: string) {
    const { query } = await import("../db/index.js");
    const order = (
      await query(`SELECT status, inventory_released FROM orders WHERE id = $1`, [orderId])
    ).rows[0];
    const inventory = (
      await query(`SELECT quantity, reserved FROM inventory WHERE product_id = $1`, [productId])
    ).rows[0];
    const product = (await query(`SELECT sold_count FROM products WHERE id = $1`, [productId])).rows[0];
    const payments = (
      await query(`SELECT status FROM payments WHERE order_id = $1 ORDER BY created_at ASC`, [orderId])
    ).rows as Array<{ status: string }>;
    return {
      orderStatus: order.status as string,
      inventoryReleased: order.inventory_released as boolean,
      quantity: Number(inventory.quantity),
      reserved: Number(inventory.reserved),
      soldCount: Number(product.sold_count),
      paymentStatuses: payments.map((p) => p.status),
    };
  }

  async function incidents(orderId?: string) {
    const { query } = await import("../db/index.js");
    const res = orderId
      ? await query(`SELECT * FROM payment_incidents WHERE order_id = $1 ORDER BY created_at ASC`, [orderId])
      : await query(`SELECT * FROM payment_incidents ORDER BY created_at ASC`);
    return res.rows as Array<Record<string, unknown>>;
  }

  async function deliverWebhook(event: Record<string, unknown>): Promise<number> {
    process.env.STRIPE_SECRET_KEY = "sk_test_000000000000000000000000";
    process.env.STRIPE_WEBHOOK_SECRET = WEBHOOK_SECRET;
    const payload = JSON.stringify(event);
    return withServer(async (base) => {
      const res = await fetch(`${base}/api/payments/stripe/webhook`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "stripe-signature": stripeSignature(payload, WEBHOOK_SECRET),
        },
        body: payload,
      });
      return res.status;
    });
  }

  const succeededEvent = (orderId: string, intentId: string, eventId?: string) => ({
    id: eventId ?? `evt_${crypto.randomUUID()}`,
    object: "event",
    type: "payment_intent.succeeded",
    data: { object: { id: intentId, object: "payment_intent", metadata: { orderId } } },
  });

  // ── CASE A: the attempt is terminal `failed`, the provider reports captured ──

  testFn("Case A — a captured charge for a FAILED attempt records an incident and never rewrites the attempt", async () => {
    const { orderId, ownerId, productId, quantity, intentId } = await seedOrder({
      orderStatus: "pending_payment",
      attemptStatus: "failed",
    });
    try {
      expect(await deliverWebhook(succeededEvent(orderId, intentId))).toBe(200);

      // Invariant A: history is not rewritten through a webhook.
      const state = await stateOf(orderId, productId);
      expect(state.paymentStatuses).toEqual(["failed"]);

      // …and the money is NOT silently dropped: a durable incident exists,
      // carrying the identifiers an operator needs.
      const rows = await incidents(orderId);
      expect(rows.length).toBe(1);
      const inc = rows[0];
      expect(inc.order_id).toBe(orderId);
      expect(inc.provider_payment_intent_id).toBe(intentId);
      expect(inc.reason).toBe("ATTEMPT_NOT_RECORDED");
      expect(inc.status).toBe("open");
      // Amount/currency come from OUR row (a trusted source), never the payload.
      expect(Number(inc.amount)).toBe(360);
      expect(inc.currency).toBe("THB");
    } finally {
      await purgeUsers([ownerId]);
    }
  });

  testFn("Case A — a NORMAL success records NO incident and commits stock exactly once", async () => {
    const { orderId, ownerId, productId, quantity, intentId } = await seedOrder({
      orderStatus: "pending_payment",
      attemptStatus: "requires_action",
    });
    try {
      expect(await deliverWebhook(succeededEvent(orderId, intentId))).toBe(200);

      const state = await stateOf(orderId, productId);
      expect(state.orderStatus).toBe("paid");
      expect(state.paymentStatuses).toEqual(["paid"]);
      expect(state.quantity).toBe(50 - quantity);
      expect(state.reserved).toBe(0);
      expect(state.soldCount).toBe(quantity);
      // The ordinary path must stay silent.
      expect(await incidents(orderId)).toEqual([]);
    } finally {
      await purgeUsers([ownerId]);
    }
  });

  // ── CASE B: the order is already dead ──

  for (const deadStatus of ["cancelled", "expired"] as const) {
    testFn(`Case B — a captured charge for a ${deadStatus} order records an incident and does NOT resurrect it`, async () => {
      const { orderId, ownerId, productId, quantity, intentId } = await seedOrder({
        orderStatus: deadStatus,
        attemptStatus: "requires_action",
      });
      try {
        expect(await deliverWebhook(succeededEvent(orderId, intentId))).toBe(200);

        const state = await stateOf(orderId, productId);
        // NO resurrection, and stock is never committed for a dead order.
        expect(state.orderStatus).toBe(deadStatus);
        expect(state.quantity).toBe(50);
        expect(state.reserved).toBe(quantity);
        expect(state.soldCount).toBe(0);

        const rows = await incidents(orderId);
        expect(rows.length).toBe(1);
        expect(rows[0].reason).toBe("ORDER_NOT_SETTLEABLE");
        expect(rows[0].order_status).toBe(deadStatus);
      } finally {
        await purgeUsers([ownerId]);
      }
    });
  }

  // ── CASE D: duplicates must not pile up ──

  testFn("Case D — repeated late-success events for one attempt produce ONE incident", async () => {
    const { orderId, ownerId, productId, intentId } = await seedOrder({
      orderStatus: "cancelled",
      attemptStatus: "requires_action",
    });
    try {
      for (let i = 0; i < 3; i++) {
        expect(await deliverWebhook(succeededEvent(orderId, intentId))).toBe(200);
      }
      // Same attempt + same reason → exactly one row, however many events.
      expect((await incidents(orderId)).length).toBe(1);
    } finally {
      await purgeUsers([ownerId]);
    }
  });

  // ── Operator surface: authorization ──

  async function seedOperator(opts: { role: "staff" | "none"; permissions?: string[] }) {
    const { query } = await import("../db/index.js");
    const tag = `op-${crypto.randomUUID()}`;
    const user = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}@test.local`,
      "Center Operator",
    ]);
    const userId = user.rows[0].id as string;
    if (opts.role === "staff") {
      // `employees.permissions` is a JSONB array, and only `staff` has its
      // permissions read from the row (owner/admin hold every code implicitly,
      // and a user with no employee row holds none) — backend/lib/permissions.ts.
      await query(
        `INSERT INTO employees (user_id, employee_id, role, permissions) VALUES ($1, $2, 'staff', $3::jsonb)`,
        [userId, `EMP-${tag.slice(-6).toUpperCase()}`, JSON.stringify(opts.permissions ?? [])],
      );
    }
    return userId;
  }

  testFn("the incident list is refused to an account without orders.view", async () => {
    const staff = await seedOperator({ role: "none" });
    try {
      const status = await withServer(async (base) => {
        const res = await fetch(`${base}/api/admin/payment-incidents`, {
          headers: { Cookie: `velnox_session=${token(staff)}` },
        });
        return res.status;
      });
      // A real authorization boundary, not a hidden tab.
      expect(status).toBe(403);
    } finally {
      await purgeUsers([staff]);
    }
  });

  testFn("orders.view may list; only orders.manage may resolve", async () => {
    const viewer = await seedOperator({ role: "staff", permissions: ["orders.view"] });
    const manager = await seedOperator({ role: "staff", permissions: ["orders.view", "orders.manage"] });
    const { orderId, ownerId, intentId } = await seedOrder({
      orderStatus: "cancelled",
      attemptStatus: "requires_action",
    });
    try {
      expect(await deliverWebhook(succeededEvent(orderId, intentId))).toBe(200);
      const inc = (await incidents(orderId))[0];

      const listed = await withServer(async (base) => {
        const res = await fetch(`${base}/api/admin/payment-incidents`, {
          headers: { Cookie: `velnox_session=${token(viewer)}` },
        });
        return { status: res.status, body: (await res.json()) as any };
      });
      expect(listed.status).toBe(200);
      expect(listed.body.data.total).toBeGreaterThanOrEqual(1);

      // A read-only operator cannot resolve.
      const refused = await withServer(async (base) => {
        const res = await fetch(`${base}/api/admin/payment-incidents/${inc.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: `velnox_session=${token(viewer)}` },
          body: JSON.stringify({ note: "nope" }),
        });
        return res.status;
      });
      expect(refused).toBe(403);

      // The managing operator can.
      const resolved = await withServer(async (base) => {
        const res = await fetch(`${base}/api/admin/payment-incidents/${inc.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json", Cookie: `velnox_session=${token(manager)}` },
          body: JSON.stringify({ note: "refunded via the operator refund route" }),
        });
        return res.status;
      });
      expect(resolved).toBe(200);
    } finally {
      await purgeUsers([viewer, manager, ownerId]);
    }
  });

  // ── Resolving is bookkeeping only ──

  testFn("resolving is idempotent and changes NOTHING but the incident", async () => {
    const manager = await seedOperator({ role: "staff", permissions: ["orders.view", "orders.manage"] });
    const { orderId, ownerId, productId, quantity, intentId } = await seedOrder({
      orderStatus: "cancelled",
      attemptStatus: "requires_action",
    });
    try {
      expect(await deliverWebhook(succeededEvent(orderId, intentId))).toBe(200);
      const inc = (await incidents(orderId))[0];
      const before = await stateOf(orderId, productId);

      const resolve = () =>
        withServer(async (base) => {
          const res = await fetch(`${base}/api/admin/payment-incidents/${inc.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", Cookie: `velnox_session=${token(manager)}` },
            body: JSON.stringify({ note: "handled" }),
          });
          return res.status;
        });

      expect(await resolve()).toBe(200);
      // Twice: a second acknowledgement must not fail or double-apply.
      expect(await resolve()).toBe(200);

      const after = await stateOf(orderId, productId);
      // The order is NOT reopened, the stock is NOT moved, the attempt is NOT
      // rewritten — "resolved" is a bookkeeping word and nothing more.
      expect(after.orderStatus).toBe(before.orderStatus);
      expect(after.orderStatus).toBe("cancelled");
      expect(after.quantity).toBe(before.quantity);
      expect(after.reserved).toBe(before.reserved);
      expect(after.soldCount).toBe(before.soldCount);
      expect(after.paymentStatuses).toEqual(before.paymentStatuses);

      const rows = await incidents(orderId);
      expect(rows.length).toBe(1);
      expect(rows[0].status).toBe("resolved");
      expect(rows[0].resolved_by).toBe(manager);
      expect(rows[0].resolved_at).not.toBeNull();
    } finally {
      await purgeUsers([manager, ownerId]);
    }
  });
});
