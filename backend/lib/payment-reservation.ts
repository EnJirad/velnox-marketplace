import type pg from "pg";

/**
 * Payment reservation — the ONE place that decides how long an unpaid order may
 * hold its reserved stock.
 *
 * WHY THIS EXISTS
 * Stock is reserved inside the order-creation transaction (see
 * `lib/inventory.ts`). Before this module the reservation had NO deadline: an
 * order abandoned at Stripe held its units forever (until someone cancelled or
 * Stripe expired the session ~24 h later). That starves the catalog — the last
 * unit of a scarce product sits behind an abandoned order while other customers
 * are told it is out of stock.
 *
 * PART 1 — THE WINDOW IS FIXED AT 30 MINUTES, ON PURPOSE
 * Every eligible order gets `payment_expires_at = created_at + 30 minutes`, and
 * nothing else. This is a deliberate scope decision, not a missing feature:
 *
 *   • the duration must NOT depend on popularity, product views or clicks, sales
 *     velocity, demand/starvation scores, customer behaviour or any other
 *     learned signal — those signals belong to the VelRepeat phase, and a
 *     customer must be able to predict the deal they are being offered;
 *   • a constant window is trivially auditable: the countdown in the storefront
 *     always starts at 30:00 and the backend always enforces the same deadline;
 *   • it keeps this module PURE arithmetic — no extra query, no reading of any
 *     behaviour table at order creation (checkout stays as cheap as possible).
 *
 * HISTORY — v1 of this module derived the window from risk signals (stock cover,
 * trailing 7-day sales velocity, `products.featured`) and returned 15/20/30/45/60
 * minutes. That behaviour was replaced here. The `orders.reservation_policy`
 * column is KEPT: it still records which policy produced a deadline, so a v1 row
 * (`version: "v1"`, carries `riskLevel` + `signals`) stays distinguishable from a
 * Part-1 row (`version: "v2"`, a constant 30 minutes).
 */

export const PAYMENT_RESERVATION_POLICY_VERSION = "v2" as const;

/**
 * THE reservation duration. Exactly 30 minutes — the value the storefront
 * countdown starts from and the value the expiry sweep and the Stripe checkout
 * guard both enforce. Exported so every consumer (and every test) reads the same
 * number instead of re-typing it.
 */
export const PAYMENT_RESERVATION_MINUTES = 30;

/** The same window in the units the API and the countdown actually use. */
export const PAYMENT_RESERVATION_SECONDS = PAYMENT_RESERVATION_MINUTES * 60;
export const PAYMENT_RESERVATION_MS = PAYMENT_RESERVATION_MINUTES * 60_000;

/** Why a deadline exists — stored with the order so the audit trail explains itself. */
export const PAYMENT_RESERVATION_REASON = `fixed ${PAYMENT_RESERVATION_MINUTES}-minute payment reservation`;

/**
 * Order statuses an expired payment reservation may be moved FROM. An order in
 * any other status has already been decided (paid, cancelled, shipped, …) and
 * must never be rewritten by the expiry sweep.
 */
export const PAYMENT_RESERVATION_EXPIRABLE_STATUSES = ["pending", "pending_payment"] as const;

/** The terminal status an expired reservation writes. */
export const PAYMENT_RESERVATION_EXPIRED_STATUS = "expired";

/**
 * Payment methods that do NOT wait on an online payment, so they get no
 * reservation window: COD (and VelRepeat's COD orders) are settled by the
 * carrier, and expiring them would cancel a legitimate order.
 */
const METHODS_WITHOUT_RESERVATION = new Set(["cod", "cash_on_delivery"]);

/**
 * Does this payment method need a payment reservation window?
 *
 * Unknown / missing methods answer `true`: an order whose rail we cannot
 * classify is treated as waiting on an online payment, which is the safe
 * direction (a window exists, so the stock cannot leak forever).
 */
export function paymentMethodNeedsReservation(method: unknown): boolean {
  if (typeof method !== "string") return true;
  return !METHODS_WITHOUT_RESERVATION.has(method.trim().toLowerCase());
}

export interface PaymentReservationPolicy {
  version: typeof PAYMENT_RESERVATION_POLICY_VERSION;
  /** Always `PAYMENT_RESERVATION_MINUTES` (30). Kept as a field so the stored
   *  JSONB record is self-describing and a future change is visible per row. */
  reservationMinutes: number;
  /** Human-readable why — stored with the order for later audit. */
  reason: string;
  /** ISO timestamp; the backend's source of truth for the deadline. */
  expiresAt: string;
}

/**
 * The policy itself — pure, deterministic and constant.
 *
 * `now` is injectable so tests can assert the computed `expiresAt` exactly.
 */
export function calculatePaymentReservationPolicy(now: Date = new Date()): PaymentReservationPolicy {
  return {
    version: PAYMENT_RESERVATION_POLICY_VERSION,
    reservationMinutes: PAYMENT_RESERVATION_MINUTES,
    reason: PAYMENT_RESERVATION_REASON,
    expiresAt: new Date(now.getTime() + PAYMENT_RESERVATION_MS).toISOString(),
  };
}

/**
 * Decide the window for an order and write it to the order row.
 *
 * Call INSIDE the order-creation transaction: if the order rolls back, no
 * deadline is stored, so an order can never carry a window that its stock
 * reservation does not have.
 *
 * Returns the policy, or `null` when the order's payment method does not wait on
 * an online payment (COD) and therefore gets no window.
 */
export async function applyPaymentReservationPolicy(
  client: pg.PoolClient,
  orderId: string,
  paymentMethod: unknown,
  now: Date = new Date(),
): Promise<PaymentReservationPolicy | null> {
  if (!paymentMethodNeedsReservation(paymentMethod)) return null;

  const policy = calculatePaymentReservationPolicy(now);

  // ── Deploy-order safety ────────────────────────────────────────────────
  // The two columns arrive with `db/migrations/048_payment_reservation.sql`, and
  // a backend deploy can reach production BEFORE that migration is applied (the
  // host deploys on push). Without this guard the missing column would abort the
  // caller's order-creation transaction and break EVERY checkout — turning a
  // missing deadline into lost sales. The write therefore runs inside a
  // SAVEPOINT: only "undefined_column" is swallowed (with a loud, actionable
  // log) and the order simply stays without a window — exactly like a legacy row,
  // which the sweep ignores. Every other error still aborts the transaction.
  await client.query("SAVEPOINT velnox_payment_reservation");
  try {
    await client.query(
      `UPDATE orders
          SET payment_expires_at = $2::timestamptz,
              reservation_policy = $3::jsonb,
              updated_at = NOW()
        WHERE id = $1`,
      [orderId, policy.expiresAt, JSON.stringify(policy)],
    );
    await client.query("RELEASE SAVEPOINT velnox_payment_reservation");
  } catch (err) {
    await client.query("ROLLBACK TO SAVEPOINT velnox_payment_reservation");
    if (isUndefinedColumnError(err)) {
      warnReservationSchemaMissing(
        "this order has NO reservation window (stock is held until it is cancelled, as before)",
      );
      return null;
    }
    throw err;
  }

  return policy;
}

/**
 * `undefined_column` — the schema predates the migration that adds the column.
 * Distinguished from every other failure so only this one is tolerated.
 */
export function isUndefinedColumnError(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "42703";
}

/**
 * Say it once per process, name the migration, and never repeat: a backend that
 * is ahead of its database is a deploy condition, not a per-request fault, so
 * repeating the line for every order would bury the one that matters.
 */
let reservationSchemaWarned = false;

export function warnReservationSchemaMissing(effect: string): void {
  if (reservationSchemaWarned) return;
  reservationSchemaWarned = true;
  console.error(
    "[reservation] orders.payment_expires_at/reservation_policy are missing — apply " +
      `db/migrations/048_payment_reservation.sql; ${effect}.`,
  );
}

/**
 * The order columns the payment path reads — a superset of what each caller
 * needs, so one read serves both the checkout and the webhook.
 */
export interface OrderPaymentRow {
  id: string;
  user_id: string;
  order_number: string | null;
  status: string;
  total_amount: string | number;
  currency: string | null;
  inventory_released: boolean;
  /** The reservation deadline, or null when the order holds no window. */
  payment_expires_at: string | Date | null;
}

/**
 * Read an order for the payment path without depending on the schema version.
 *
 * WHY THIS IS NOT OPTIONAL — deploy order is not guaranteed here. The host
 * deploys on push, so a backend that NAMES `payment_expires_at` can reach
 * production before `db/migrations/048_payment_reservation.sql` has been
 * applied. A statement naming a missing column fails with `undefined_column`
 * (42703), and on this path that does not degrade, it stops trading: production
 * logged `[stripe] checkout error: column "payment_expires_at" does not exist`
 * (2026-09-28) and no Checkout Session could be opened for ANY order — the
 * missing deadline took the whole checkout down instead of simply not being
 * enforced. A missing deadline must never cost a sale.
 *
 * HOW — the deadline is taken from the row's JSON form rather than named as a
 * column. `to_jsonb(o) ->> 'payment_expires_at'` is a key lookup: it yields NULL
 * when the column does not exist, exactly as it does when the column exists and
 * is NULL. ONE statement therefore reads correctly against both schemas, and it
 * cannot raise `undefined_column` at all.
 *
 * WHY NOT "catch 42703 and retry without the column" — the write path can do
 * that because it owns a SAVEPOINT, but a caller here may already be inside its
 * own transaction (`withTransaction` issues BEGIN, and the Stripe webhook sync
 * runs inside one). PostgreSQL aborts the ENTIRE transaction on the first failed
 * statement, so a retry would fail with `25P02` and take the webhook sync down
 * with it — replacing a broken checkout with a broken webhook. A read that never
 * fails needs no recovery, so it is safe in both contexts and costs no extra
 * round trip.
 *
 * The result is the legacy-row meaning this module already assigns to an order
 * that holds no window — the state the expiry sweep ignores — so callers behave
 * as they did before the feature existed and start enforcing real deadlines the
 * moment the migration lands. Nothing is cached, so nothing has to be restarted.
 */
export async function selectOrderPaymentRow(
  run: (sql: string, params: unknown[]) => Promise<{ rows: any[] }>,
  orderId: string,
): Promise<OrderPaymentRow | undefined> {
  const result = await run(
    `SELECT o.id, o.user_id, o.order_number, o.status, o.total_amount, o.currency,
            o.inventory_released,
            to_jsonb(o) ->> 'payment_expires_at' AS payment_expires_at
       FROM orders o
      WHERE o.id = $1`,
    [orderId],
  );
  return result.rows[0] as OrderPaymentRow | undefined;
}
