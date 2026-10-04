/**
 * PAYMENT INTEGRITY — a captured Stripe charge must settle, even on a database
 * that predates the checkout-group migration.
 *
 * THE REPORTED SYMPTOM
 * --------------------
 *   1. the customer pressed Checkout;
 *   2. the first attempt was seen as failed;
 *   3. they tried again;
 *   4. the NEW Stripe attempt SUCCEEDED — the money really was captured;
 *   5. Velnox still showed "รอดำเนินการชำระ" and offered payment AGAIN.
 *
 * THE ROOT CAUSE THIS FILE PINS (failure class H → D)
 * ---------------------------------------------------
 * `checkoutGroupIdForAttempt()` (`backend/routes/stripe.ts`) decided which parent
 * a charge belongs to. It read `payments.checkout_group_id` — a column added by
 * `db/migrations/054_checkout_groups_numeric_order_number.sql` — with a bare
 * column reference. A statement naming a column the table does not have raises
 * `undefined_column` (42703), which is a THROWN ERROR, and it was thrown on the
 * one query EVERY order's settlement runs, before the order or payment row is
 * touched. So on a production database without that column:
 *
 *   payment_intent.succeeded
 *     → checkoutGroupIdForAttempt() throws 42703
 *     → handleStripeEvent() throws
 *     → payment_events.status = 'failed'
 *     → HTTP 500  (Stripe retries — and hits the identical error every time)
 *     → payments.status and orders.status NEVER move
 *     → the storefront keeps polling a genuinely unpaid order and keeps offering
 *       payment for a purchase that was already paid for.
 *
 * Retrying made it worse, not better: every retry captured another real charge
 * that also could not settle. The whole path is proven by
 * `db/verify-reconciler.sh` scenario H, which raises 42703 from this exact
 * statement with the column dropped and resolves the group once it is present.
 *
 * THE FIX, AND WHY IT IS NOT A WORKAROUND
 * ---------------------------------------
 * The column is read as a JSON KEY — `to_jsonb(p) ->> 'checkout_group_id'` —
 * which yields NULL when the column is absent and when it is present-and-NULL,
 * so ONE statement is correct against both schemas and cannot raise 42703 at
 * all. This is the pattern `selectOrderPaymentRow()` already uses for
 * `orders.payment_expires_at` in `lib/payment-reservation.ts`; it is NOT a
 * bypass: the signature check, the `payment_events` claim, the 500-on-failure
 * redelivery policy and the `status IN ('pending','pending_payment')` settlement
 * guards are all unchanged. NULL is also the safe answer rather than a silently
 * dropped feature — the column is what links a payment to a purchase, so on a
 * database without it there is no group payment to route.
 *
 * WHAT IS PROVEN HERE
 * -------------------
 *   1. STATIC — the group-routing read names no bare column, still routes by the
 *      provider identifiers the event carries, and warns once when it finds the
 *      column absent (naming the reconciler) instead of failing per delivery.
 *   2. LIVE — that EXACT SQL, extracted from `routes/stripe.ts` rather than
 *      retyped, executed against a `payments`-shaped table WITHOUT the column:
 *      it returns NULL and does not raise. The pre-fix statement raises 42703 on
 *      the same probe, so the regression is demonstrated, not asserted.
 *   3. LIVE, DB-gated — the REAL webhook route, driven with locally signed Stripe
 *      events, for the payment-integrity cases the sibling suites do not already
 *      cover: attempt A failed then attempt B succeeds; a duplicate delivery; an
 *      unpaid `checkout.session.completed`; an event that identifies no attempt;
 *      a processing failure answering 500; and Stripe's retry of that same event
 *      id afterwards re-processing it.
 *
 * No real Stripe call is made and no payment is ever invented: these are
 * locally signed events against a disposable TEST_DATABASE_URL, which is the
 * suite's established substitute for a live round trip — NOT a substitute for
 * the real Stripe TEST E2E, which stays BLOCKED without test credentials.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { createHmac } from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import { readFileSync } from "fs";
import { join } from "path";

import { stripeWebhookRawBody } from "../middleware/stripe-raw-body.js";
import { setupStripeRoutes } from "../routes/stripe.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");
const STRIPE_ROUTE = "backend/routes/stripe.ts";

/**
 * The backtick SQL string inside a declaration — the statement production runs,
 * read out of the route so this file cannot drift from the query it pins.
 */
function sqlOf(source: string, startMarker: string, index = 0): string {
  const start = source.indexOf(startMarker);
  expect(start, `missing declaration: ${startMarker}`).toBeGreaterThanOrEqual(0);
  const rest = source.slice(start);
  const matches = [...rest.matchAll(/`([^`]*)`/g)].map((m) => m[1]!);
  expect(matches.length, `${startMarker} has no SQL string`).toBeGreaterThan(0);
  return matches[index]!;
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The routing read cannot raise on a database without the column
//    (static — runs in any workspace)
// ═══════════════════════════════════════════════════════════════════════════

describe("group routing survives a database that predates migration 054", () => {
  test("the read names NO bare checkout_group_id column, so it cannot raise 42703", () => {
    const stripe = read(STRIPE_ROUTE);
    const sql = sqlOf(stripe, "async function checkoutGroupIdForAttempt(");
    expect(sql).toContain("to_jsonb(p) ->> 'checkout_group_id'");
    // Quoting the name as a STRING VALUE is the point; referencing it as a
    // column — bare or qualified — is exactly what 42703 comes from. An output
    // ALIAS is neither (it names this result, not a column of `payments`), so
    // `AS <name>` is removed before the scan.
    const withoutLiterals = sql
      .replace(/'(?:[^']|'')*'/g, "''")
      .replace(/\bAS\s+[A-Za-z_][A-Za-z0-9_]*/g, "AS");
    expect(
      withoutLiterals,
      "the group-routing read still references checkout_group_id as a COLUMN — on a " +
        "database without it this throws 42703 and no payment can ever settle",
    ).not.toContain("checkout_group_id");
    // …and it must not be "fixed" by a catch either: the transaction context
    // means a retried statement would fail 25P02, and the read must simply not
    // raise in the first place.
    expect(sql).not.toContain("SELECT checkout_group_id FROM payments");
  });

  test("routing still uses the identifiers the event carries", () => {
    const stripe = read(STRIPE_ROUTE);
    const sql = sqlOf(stripe, "async function checkoutGroupIdForAttempt(");
    expect(sql).toContain("provider_checkout_session_id = $1");
    expect(sql).toContain("provider_payment_id = $2");
  });

  test("an absent column is reported ONCE, naming the reconciler — not per delivery", () => {
    const stripe = read(STRIPE_ROUTE);
    expect(stripe).toContain("checkoutGroupColumnWarned");
    expect(stripe).toContain("db/run-sqleditor.sql");
    // The warning must not fire on the ordinary single-order payment: only a
    // row whose jsonb LACKS the key proves the column itself is missing.
    expect(sqlOf(stripe, "async function checkoutGroupIdForAttempt(")).toContain(
      "has_checkout_group_column",
    );
  });

  test("the settlement authority is untouched — signature, claim and 500 all stand", () => {
    const stripe = read(STRIPE_ROUTE);
    // The fix must not have become a way to acknowledge unverified events.
    expect(stripe).toContain("constructEventAsync");
    expect(stripe).toContain("ON CONFLICT (event_id) DO NOTHING");
    // A processing failure must still answer 500 so Stripe redelivers.
    expect(stripe).toContain(`res.status(500).json({ error: "Webhook processing failed" })`);
    expect(stripe).not.toContain(`status(200).json({ error: "Webhook processing failed" })`);
    // …and the settlement guards are still the pre-payment statuses.
    expect(stripe).toContain("status IN ('pending', 'pending_payment')");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. + 3. The real webhook route against a real database
// ═══════════════════════════════════════════════════════════════════════════

const describeDb = hasTestDatabase() ? describe : describe.skip;
const testFn = hasTestDatabase() ? test : test.skip;

describeDb("payment integrity (requires TEST_DATABASE_URL)", () => {
  const PAYMENT_ENV_KEYS = [
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_MODE",
  ] as const;
  const WEBHOOK_SECRET = "whsec_000000000000000000000000";

  afterEach(() => {
    for (const key of PAYMENT_ENV_KEYS) delete process.env[key];
  });

  /** Stripe's own signature scheme, computed locally — no network, no SDK. */
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

  interface Attempt {
    status: string;
    providerPaymentId: string;
    checkoutSessionId: string;
    failureCode?: string;
  }

  /**
   * owner → seller → shop → product → inventory → order (+ item) → attempts, in
   * the order they were created. Stock is reserved the way checkout reserves it
   * (`inventory.reserved += qty`), so a settlement is visible as
   * `quantity -q` / `reserved -q` / `sold_count +q` and a release as
   * `reserved -q` with `quantity` unchanged.
   */
  async function seedOrder(attempts: Attempt[], quantity = 3) {
    const { query } = await import("../db/index.js");
    const tag = `integ-${crypto.randomUUID()}`;

    const owner = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-owner@test.local`,
      "Integrity Owner",
    ]);
    const ownerId = owner.rows[0].id as string;
    const sellerUser = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}-seller@test.local`,
      "Integrity Seller",
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
       VALUES ($1, $2, $3, 'pending_payment', 360.00, 'THB', FALSE) RETURNING id`,
      [ownerId, shop.rows[0].id, `IN-${tag.slice(-12)}`],
    );
    const orderId = order.rows[0].id as string;
    await query(
      `INSERT INTO order_items (order_id, product_id, shop_id, product_name, quantity, price, subtotal)
       VALUES ($1, $2, $3, $4, $5, 120.00, $6)`,
      [orderId, productId, shop.rows[0].id, `${tag} product`, quantity, quantity * 120],
    );
    for (const attempt of attempts) {
      await query(
        `INSERT INTO payments
           (order_id, provider, method, status, amount, currency,
            provider_checkout_session_id, provider_payment_id, failure_code)
         VALUES ($1, 'stripe', 'CARD', $2, 360.00, 'THB', $3, $4, $5)`,
        [orderId, attempt.status, attempt.checkoutSessionId, attempt.providerPaymentId, attempt.failureCode ?? null],
      );
    }
    return { orderId, ownerId, productId, quantity };
  }

  /** Everything a settlement, a failure or a retry can change. */
  async function stateOf(orderId: string, productId: string) {
    const { query } = await import("../db/index.js");
    const order = (
      await query(
        `SELECT status, inventory_released FROM orders WHERE id = $1`,
        [orderId],
      )
    ).rows[0];
    const inventory = (
      await query(`SELECT quantity, reserved FROM inventory WHERE product_id = $1`, [productId])
    ).rows[0];
    const product = (await query(`SELECT sold_count FROM products WHERE id = $1`, [productId])).rows[0];
    const payments = (
      await query(
        `SELECT provider_payment_id, status, paid_at
           FROM payments WHERE order_id = $1 ORDER BY created_at ASC, id ASC`,
        [orderId],
      )
    ).rows as Array<{ provider_payment_id: string; status: string; paid_at: Date | null }>;
    const events = (
      await query(
        `SELECT event_type, status FROM payment_events
          WHERE payload ->> 'id' IS NOT NULL AND created_at > NOW() - INTERVAL '1 hour'
          ORDER BY created_at ASC`,
      )
    ).rows as Array<{ event_type: string; status: string }>;
    return {
      orderStatus: order.status as string,
      inventoryReleased: order.inventory_released as boolean,
      quantity: Number(inventory.quantity),
      reserved: Number(inventory.reserved),
      soldCount: Number(product.sold_count),
      /** Keyed by PaymentIntent id, so an assertion can name the ATTEMPT. */
      payments: Object.fromEntries(
        payments.map((p) => [p.provider_payment_id, { status: p.status, paidAt: p.paid_at }]),
      ),
      events,
    };
  }

  /** Deliver a locally signed Stripe event to the real webhook route. */
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

  const succeededEvent = (orderId: string, intentId: string) => ({
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    type: "payment_intent.succeeded",
    data: { object: { id: intentId, object: "payment_intent", metadata: { orderId } } },
  });

  const failedEvent = (orderId: string, intentId: string, code = "card_declined") => ({
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    type: "payment_intent.payment_failed",
    data: {
      object: {
        id: intentId,
        object: "payment_intent",
        metadata: { orderId },
        last_payment_error: { code, message: "The card was declined." },
      },
    },
  });

  const completedSessionEvent = (
    orderId: string,
    sessionId: string,
    intentId: string,
    paymentStatus: string,
  ) => ({
    id: `evt_${crypto.randomUUID()}`,
    object: "event",
    type: "checkout.session.completed",
    data: {
      object: {
        id: sessionId,
        object: "checkout.session",
        payment_status: paymentStatus,
        payment_intent: intentId,
        metadata: { orderId },
      },
    },
  });

  // ── the routing read, executed against a payments table WITHOUT the column ──

  testFn("the production routing SQL does not raise on a payments table lacking the column", async () => {
    const { query } = await import("../db/index.js");
    const sql = sqlOf(read(STRIPE_ROUTE), "async function checkoutGroupIdForAttempt(")
      // `payments` → the probe table; the statement is otherwise verbatim.
      .replace(/\bpayments\b/g, "velnox_payments_without_group_probe");
    const probe = "velnox_payments_without_group_probe";

    await query(`DROP TABLE IF EXISTS ${probe}`);
    await query(
      `CREATE TABLE ${probe} (
         id uuid,
         provider text,
         provider_checkout_session_id text,
         provider_payment_id text
       )`,
    );
    try {
      await query(
        `INSERT INTO ${probe} (id, provider, provider_checkout_session_id, provider_payment_id)
         VALUES ('11111111-1111-4111-8111-111111111111', 'stripe', 'cs_probe', 'pi_probe')`,
      );

      // THE REGRESSION, executed: the statement as it was before the fix raises
      // 42703 on this table, so the failure was never hypothetical.
      let preFixCode = "";
      try {
        await query(
          `SELECT checkout_group_id FROM ${probe}
            WHERE checkout_group_id IS NOT NULL
              AND (provider_checkout_session_id = $1 OR provider_payment_id = $2)
            LIMIT 1`,
          ["cs_probe", null],
        );
      } catch (err: any) {
        preFixCode = String(err?.code ?? "");
      }
      expect(preFixCode).toBe("42703");

      // THE FIX, on the same table: no group, no throw, and the missing column
      // is DETECTED (so the process can say so once) rather than guessed at.
      const row = await query(sql, ["cs_probe", null]);
      expect(row.rows.length).toBe(1);
      expect(row.rows[0].checkout_group_id).toBeNull();
      expect(row.rows[0].has_checkout_group_column).toBe(false);

      // The catalog agrees, which is the only thing that separates "no group"
      // from "no column" (both read as NULL in SQL).
      const cols = await query(
        `SELECT count(*)::int AS n FROM information_schema.columns
          WHERE table_schema='public' AND table_name=$1 AND column_name='checkout_group_id'`,
        [probe],
      );
      expect(cols.rows[0].n).toBe(0);
    } finally {
      await query(`DROP TABLE IF EXISTS ${probe}`);
    }
  });

  testFn("a REAL group payment is still routed to its group", async () => {
    // The tolerant read must not have become "always null": with the column
    // present, a group charge still finds its parent and settles through it.
    const { query } = await import("../db/index.js");
    const sql = sqlOf(read(STRIPE_ROUTE), "async function checkoutGroupIdForAttempt(");
    const tag = `integ-group-${crypto.randomUUID()}`;

    const owner = await query(`INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`, [
      `${tag}@test.local`,
      "Group Owner",
    ]);
    const group = await query(
      `INSERT INTO checkout_groups (user_id, total_amount, currency, item_count, shop_count)
       VALUES ($1, 360.00, 'THB', 3, 1) RETURNING id`,
      [owner.rows[0].id],
    );
    const groupId = group.rows[0].id as string;
    try {
      await query(
        `INSERT INTO payments (checkout_group_id, provider, method, status, amount, currency,
                                provider_checkout_session_id, provider_payment_id)
         VALUES ($1, 'stripe', 'CARD', 'requires_action', 360.00, 'THB', $2, $3)`,
        [groupId, `cs_${tag}`, `pi_${tag}`],
      );
      const bySession = await query(sql, [`cs_${tag}`, null]);
      expect(bySession.rows[0].checkout_group_id).toBe(groupId);
      expect(bySession.rows[0].has_checkout_group_column).toBe(true);
      // The PaymentIntent identifier resolves the same charge.
      const byIntent = await query(sql, [null, `pi_${tag}`]);
      expect(byIntent.rows[0].checkout_group_id).toBe(groupId);
    } finally {
      await query(`DELETE FROM payments WHERE checkout_group_id = $1`, [groupId]);
      await query(`DELETE FROM checkout_groups WHERE id = $1`, [groupId]);
      await purgeUsers([owner.rows[0].id]);
    }
  });

  // ── attempt A fails, attempt B succeeds: the reported scenario ──

  testFn("attempt A failed then attempt B succeeds: B is paid and the order settles", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const { orderId, ownerId, productId, quantity } = await seedOrder([
      {
        status: "failed",
        providerPaymentId: `pi_${tag}_A`,
        checkoutSessionId: `cs_${tag}_A`,
        failureCode: "SESSION_NOT_REUSABLE",
      },
      { status: "requires_action", providerPaymentId: `pi_${tag}_B`, checkoutSessionId: `cs_${tag}_B` },
    ]);
    try {
      expect(await deliverWebhook(succeededEvent(orderId, `pi_${tag}_B`))).toBe(200);

      const state = await stateOf(orderId, productId);
      // The attempt that was actually CHARGED is the one recorded as paid…
      expect(state.payments[`pi_${tag}_B`].status).toBe("paid");
      expect(state.payments[`pi_${tag}_B`].paidAt).not.toBeNull();
      // …the retired one keeps its history, and the order settles.
      expect(state.payments[`pi_${tag}_A`].status).toBe("failed");
      expect(state.orderStatus).toBe("paid");
      expect(state.inventoryReleased).toBe(false);
      expect(state.quantity).toBe(50 - quantity);
      expect(state.reserved).toBe(0);
      expect(state.soldCount).toBe(quantity);
    } finally {
      await purgeUsers([ownerId]);
    }
  });

  testFn("a duplicate delivery of B's success settles nothing a second time", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const { orderId, ownerId, productId, quantity } = await seedOrder([
      { status: "requires_action", providerPaymentId: `pi_${tag}_B`, checkoutSessionId: `cs_${tag}_B` },
    ]);
    try {
      const event = succeededEvent(orderId, `pi_${tag}_B`);
      expect(await deliverWebhook(event)).toBe(200);
      const first = await stateOf(orderId, productId);
      // Same event id → the `payment_events` claim refuses the re-run.
      expect(await deliverWebhook(event)).toBe(200);
      const second = await stateOf(orderId, productId);

      expect(second.orderStatus).toBe("paid");
      expect(second.payments[`pi_${tag}_B`].status).toBe("paid");
      expect(String(second.payments[`pi_${tag}_B`].paidAt)).toBe(
        String(first.payments[`pi_${tag}_B`].paidAt),
      );
      // Stock consumed exactly once — not twice.
      expect(second.quantity).toBe(50 - quantity);
      expect(second.reserved).toBe(0);
      expect(second.soldCount).toBe(quantity);
      expect(second.soldCount).toBe(first.soldCount);
    } finally {
      await purgeUsers([ownerId]);
    }
  });

  testFn("an UNPAID checkout.session.completed never marks the order paid", async () => {
    // PromptPay: the session completes while the money is still on its way.
    const tag = crypto.randomUUID().slice(0, 8);
    const { orderId, ownerId, productId, quantity } = await seedOrder([
      { status: "requires_action", providerPaymentId: `pi_${tag}_B`, checkoutSessionId: `cs_${tag}_B` },
    ]);
    try {
      expect(
        await deliverWebhook(
          completedSessionEvent(orderId, `cs_${tag}_B`, `pi_${tag}_B`, "unpaid"),
        ),
      ).toBe(200);

      const state = await stateOf(orderId, productId);
      expect(state.orderStatus).toBe("pending_payment");
      expect(state.payments[`pi_${tag}_B`].status).toBe("requires_action");
      expect(state.payments[`pi_${tag}_B`].paidAt).toBeNull();
      // The stock stays reserved for the window — an unpaid session releases nothing.
      expect(state.inventoryReleased).toBe(false);
      expect(state.reserved).toBe(quantity);
      expect(state.quantity).toBe(50);
    } finally {
      await purgeUsers([ownerId]);
    }
  });

  testFn("an event that identifies no attempt updates no payment at all", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const { orderId, ownerId, productId, quantity } = await seedOrder([
      {
        status: "failed",
        providerPaymentId: `pi_${tag}_A`,
        checkoutSessionId: `cs_${tag}_A`,
        failureCode: "SESSION_NOT_REUSABLE",
      },
      { status: "requires_action", providerPaymentId: `pi_${tag}_B`, checkoutSessionId: `cs_${tag}_B` },
    ]);
    try {
      // No `metadata.orderId` and no stored attempt: there is nothing to write,
      // and "pick the newest row" is exactly what must not happen instead.
      expect(
        await deliverWebhook({
          id: `evt_${crypto.randomUUID()}`,
          object: "event",
          type: "payment_intent.succeeded",
          data: { object: { id: `pi_${tag}_unknown`, object: "payment_intent", metadata: {} } },
        }),
      ).toBe(200);

      const state = await stateOf(orderId, productId);
      expect(state.payments[`pi_${tag}_B`].status).toBe("requires_action");
      expect(state.payments[`pi_${tag}_B`].paidAt).toBeNull();
      expect(state.payments[`pi_${tag}_A`].status).toBe("failed");
      expect(state.orderStatus).toBe("pending_payment");
      expect(state.reserved).toBe(quantity);
      expect(state.quantity).toBe(50);
      expect(state.soldCount).toBe(0);
    } finally {
      await purgeUsers([ownerId]);
    }
  });

  testFn("a processing failure answers 500 and records the event as failed", async () => {
    const { query } = await import("../db/index.js");
    // A verified event whose payload object is unusable makes the handler throw.
    // The answer must be 500 so Stripe REDELIVERS: acknowledging it with 200
    // would lose the payment for good while looking like a success.
    const eventId = `evt_broken_${crypto.randomUUID()}`;
    const status = await deliverWebhook({
      id: eventId,
      object: "event",
      type: "payment_intent.succeeded",
      data: { object: null },
    });
    expect(status).toBe(500);

    const rows = await query(`SELECT status FROM payment_events WHERE event_id = $1`, [eventId]);
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].status).toBe("failed");
    await query(`DELETE FROM payment_events WHERE event_id = $1`, [eventId]);
  });

  testFn("Stripe's retry of a FAILED event re-processes it instead of being ignored", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const { orderId, ownerId, productId, quantity } = await seedOrder([
      { status: "requires_action", providerPaymentId: `pi_${tag}_B`, checkoutSessionId: `cs_${tag}_B` },
    ]);
    const eventId = `evt_retry_${crypto.randomUUID()}`;
    try {
      // First delivery dies mid-processing (the broken payload) → `failed`.
      expect(
        await deliverWebhook({
          id: eventId,
          object: "event",
          type: "payment_intent.succeeded",
          data: { object: null },
        }),
      ).toBe(500);

      // Stripe retries the SAME event id with the real payload. A claim that
      // ignored a `failed` row would acknowledge the retry and the money would
      // never settle — the exact shape of the reported bug.
      const retried = {
        ...succeededEvent(orderId, `pi_${tag}_B`),
        id: eventId,
      };
      expect(await deliverWebhook(retried)).toBe(200);

      const { query } = await import("../db/index.js");
      const rows = await query(`SELECT status FROM payment_events WHERE event_id = $1`, [eventId]);
      expect(rows.rows[0].status).toBe("processed");

      const state = await stateOf(orderId, productId);
      expect(state.payments[`pi_${tag}_B`].status).toBe("paid");
      expect(state.orderStatus).toBe("paid");
      expect(state.quantity).toBe(50 - quantity);
      expect(state.soldCount).toBe(quantity);
    } finally {
      const { query } = await import("../db/index.js");
      await query(`DELETE FROM payment_events WHERE event_id = $1`, [eventId]);
      await purgeUsers([ownerId]);
    }
  });
});
