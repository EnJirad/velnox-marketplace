import type pg from "pg";

/**
 * Dynamic Payment Reservation Policy V1 — the ONE place that decides how long an
 * unpaid order may hold its reserved stock.
 *
 * WHY THIS EXISTS
 * Stock is reserved inside the order-creation transaction (see
 * `lib/inventory.ts`). Before this module the reservation had NO deadline: an
 * order abandoned at Stripe held its units forever (until someone cancelled or
 * Stripe expired the session ~24 h later). That starves the catalog — the last
 * unit of a scarce product sits behind an abandoned order while other customers
 * are told it is out of stock.
 *
 * WHAT THIS IS
 * A deterministic, rule-based, auditable policy. NO machine learning, NO
 * randomness, NO hidden state: the same signals always produce the same window,
 * and the window is recorded on the order (`orders.reservation_policy`) so the
 * reason is inspectable afterwards.
 *
 * The window is derived ONLY from data this schema actually stores:
 *   • `inventory.quantity` / `inventory.reserved` (non-variant stock),
 *   • `product_variants.stock` (variant stock — decremented at order creation),
 *   • `products.featured` (the platform's promotion/spotlight flag — the only
 *     "this item is being pushed" signal that exists; there is NO flash-sale /
 *     limited-edition column in `db/schema.sql`, so none is invented),
 *   • real sales velocity from `order_items` JOIN `orders` over the last 7 days.
 *
 * HARD LIMITS (V1): MIN 10 minutes, MAX 60 minutes, DEFAULT 30 minutes.
 */

export const PAYMENT_RESERVATION_POLICY_VERSION = "v1" as const;

/** Every policy must land inside these bounds, whatever the signals say. */
export const PAYMENT_RESERVATION_MIN_MINUTES = 10;
export const PAYMENT_RESERVATION_MAX_MINUTES = 60;
export const PAYMENT_RESERVATION_DEFAULT_MINUTES = 30;

export const PAYMENT_RESERVATION_RISK_LEVELS = [
  "CRITICAL",
  "HIGH",
  "NORMAL",
  "LOW",
  "VERY_LOW",
] as const;

export type PaymentReservationRiskLevel = (typeof PAYMENT_RESERVATION_RISK_LEVELS)[number];

/** Risk level → reservation window. The single risk→time table. */
export const PAYMENT_RESERVATION_RISK_MINUTES: Record<PaymentReservationRiskLevel, number> = {
  CRITICAL: 15,
  HIGH: 20,
  NORMAL: 30,
  LOW: 45,
  VERY_LOW: 60,
};

/**
 * Named thresholds. Exported so tests and docs pin the numbers instead of
 * re-deriving them from the branches below.
 */
export const PAYMENT_RESERVATION_THRESHOLDS = {
  /** ≤ this many sellable units is critical on its own. */
  criticalStock: 2,
  /** ≤ this many sellable units counts as scarce. */
  scarceStock: 5,
  /** ≤ this many sellable units counts as tight. */
  tightStock: 10,
  /** ≥ this many sellable units counts as ample. */
  ampleStock: 20,
  /** ≥ this many sellable units counts as deep. */
  deepStock: 50,
  /** units/day at which demand counts as active (shortens the window). */
  activeVelocityPerDay: 1,
  /** units/day below which demand counts as low (lengthens it). */
  lowVelocityPerDay: 1,
  /** units/day at which demand counts as negligible. */
  dormantVelocityPerDay: 0.2,
  /** stock cover ≤ this many days is critical. */
  criticalCoverageDays: 1.5,
  /** stock cover ≤ this many days is tight. */
  tightCoverageDays: 3,
  /** stock cover ≥ this many days is ample. */
  ampleCoverageDays: 10,
  /** stock cover ≥ this many days is deep. */
  deepCoverageDays: 30,
  /** sales velocity is measured over this trailing window. */
  velocityWindowDays: 7,
} as const;

/**
 * Order statuses an expired payment reservation may be moved FROM. An order in
 * any other status has already been decided (paid, cancelled, shipped, …) and
 * must never be rewritten by the expiry sweep.
 */
export const PAYMENT_RESERVATION_EXPIRABLE_STATUSES = ["pending", "pending_payment"] as const;

/** The terminal status an expired reservation writes. */
export const PAYMENT_RESERVATION_EXPIRED_STATUS = "expired";

/**
 * Order statuses that count as a REAL sale when measuring sales velocity.
 * `paid` covers the Stripe rail; `confirmed`/`shipped`/`delivered`/`completed`
 * cover the COD + VelRepeat rails, whose orders never pass through `paid`.
 */
export const PAYMENT_RESERVATION_SOLD_STATUSES = [
  "paid",
  "confirmed",
  "shipped",
  "delivered",
  "completed",
] as const;

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

/** The risk inputs, all derived from real rows (never fabricated). */
export interface PaymentReservationSignals {
  /** Sellable units of the SCARCEST line (available = total − reserved). */
  availableStock: number | null;
  /** Total units of the scarcest line, including reserved ones. */
  totalStock: number | null;
  /** Highest `inventory.reserved` across the order's lines (non-variant only). */
  reservedStock: number | null;
  /** Units of these products sold in the trailing velocity window. */
  unitsSold7d: number;
  /** `unitsSold7d / velocityWindowDays`, or null when the window is unknown. */
  salesVelocityPerDay: number | null;
  /** `availableStock / salesVelocityPerDay` — null when demand is zero/unknown. */
  stockCoverageDays: number | null;
  /** `products.featured` on any line (the platform's promotion signal). */
  isPromoted: boolean;
  /** How many order lines the decision was made from. */
  itemLines: number;
}

export interface PaymentReservationPolicy {
  version: typeof PAYMENT_RESERVATION_POLICY_VERSION;
  riskLevel: PaymentReservationRiskLevel;
  reservationMinutes: number;
  /** Human-readable why — stored with the order for later audit. */
  reason: string;
  /** ISO timestamp; the backend's source of truth for the deadline. */
  expiresAt: string;
  signals: PaymentReservationSignals;
}

/** Keep any configured window inside the V1 hard limits. */
export function clampReservationMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return PAYMENT_RESERVATION_DEFAULT_MINUTES;
  return Math.min(
    PAYMENT_RESERVATION_MAX_MINUTES,
    Math.max(PAYMENT_RESERVATION_MIN_MINUTES, Math.round(minutes)),
  );
}

function decideRiskLevel(signals: PaymentReservationSignals): {
  riskLevel: PaymentReservationRiskLevel;
  reason: string;
} {
  const t = PAYMENT_RESERVATION_THRESHOLDS;
  const available = signals.availableStock;
  const velocity = signals.salesVelocityPerDay ?? 0;
  const coverage = signals.stockCoverageDays;

  // No stock reading at all (e.g. a product row that vanished mid-checkout):
  // keep the standard window rather than guessing scarcity.
  if (available === null) {
    return { riskLevel: "NORMAL", reason: "stock level unknown — default window" };
  }

  if (available <= t.criticalStock) {
    return { riskLevel: "CRITICAL", reason: `critical stock (${available} available)` };
  }
  if (available <= t.scarceStock && velocity >= t.activeVelocityPerDay) {
    return {
      riskLevel: "CRITICAL",
      reason: `scarce stock (${available} available) with active demand (${velocity.toFixed(2)} units/day)`,
    };
  }
  if (coverage !== null && coverage <= t.criticalCoverageDays) {
    return {
      riskLevel: "CRITICAL",
      reason: `under ${t.criticalCoverageDays} days of stock cover (${coverage.toFixed(2)} days)`,
    };
  }
  if (signals.isPromoted && available <= t.scarceStock) {
    return {
      riskLevel: "CRITICAL",
      reason: `promoted item with scarce stock (${available} available)`,
    };
  }

  if (available <= t.tightStock) {
    return { riskLevel: "HIGH", reason: `tight stock (${available} available)` };
  }
  if (available <= t.ampleStock && velocity >= t.activeVelocityPerDay) {
    return {
      riskLevel: "HIGH",
      reason: `moderate stock (${available} available) with active demand (${velocity.toFixed(2)} units/day)`,
    };
  }
  if (coverage !== null && coverage <= t.tightCoverageDays) {
    return {
      riskLevel: "HIGH",
      reason: `under ${t.tightCoverageDays} days of stock cover (${coverage.toFixed(2)} days)`,
    };
  }

  if (
    available >= t.deepStock &&
    !signals.isPromoted &&
    velocity <= t.dormantVelocityPerDay &&
    (coverage === null || coverage >= t.deepCoverageDays)
  ) {
    return {
      riskLevel: "VERY_LOW",
      reason: `deep stock (${available} available) with negligible demand (${velocity.toFixed(2)} units/day)`,
    };
  }
  if (
    available >= t.ampleStock &&
    !signals.isPromoted &&
    velocity < t.lowVelocityPerDay &&
    (coverage === null || coverage >= t.ampleCoverageDays)
  ) {
    return {
      riskLevel: "LOW",
      reason: `ample stock (${available} available) with low demand (${velocity.toFixed(2)} units/day)`,
    };
  }

  return { riskLevel: "NORMAL", reason: "standard stock and demand" };
}

/**
 * The policy itself — pure and deterministic.
 *
 * `now` is injectable so tests can assert the computed `expiresAt` exactly.
 */
export function calculatePaymentReservationPolicy(
  signals: PaymentReservationSignals,
  now: Date = new Date(),
): PaymentReservationPolicy {
  const { riskLevel, reason } = decideRiskLevel(signals);
  const reservationMinutes = clampReservationMinutes(PAYMENT_RESERVATION_RISK_MINUTES[riskLevel]);
  return {
    version: PAYMENT_RESERVATION_POLICY_VERSION,
    riskLevel,
    reservationMinutes,
    reason,
    expiresAt: new Date(now.getTime() + reservationMinutes * 60_000).toISOString(),
    signals,
  };
}

/** Derive the trailing-window velocity/coverage from raw counts. */
export function deriveDemandMetrics(
  availableStock: number | null,
  unitsSold7d: number,
): Pick<PaymentReservationSignals, "salesVelocityPerDay" | "stockCoverageDays"> {
  const window = PAYMENT_RESERVATION_THRESHOLDS.velocityWindowDays;
  const salesVelocityPerDay = unitsSold7d / window;
  const stockCoverageDays =
    availableStock !== null && salesVelocityPerDay > 0 ? availableStock / salesVelocityPerDay : null;
  return { salesVelocityPerDay, stockCoverageDays };
}

/**
 * Read the REAL signals for an order from the database.
 *
 * One round trip. The predicate is the order's own line items, so an order
 * holding the last unit of a scarce product is judged on THAT product — and the
 * scarcest line wins (`MIN(available_stock)`), because one scarce item is what
 * actually keeps the order risky even when the rest of the basket is abundant.
 *
 * MUST be called inside a transaction that owns the order row (order creation or
 * a sweep), so the numbers read are the ones the reservation was taken against.
 */
export async function gatherOrderReservationSignals(
  client: pg.PoolClient,
  orderId: string,
): Promise<PaymentReservationSignals> {
  const result = await client.query(
    `WITH lines AS (
       SELECT oi.product_id,
              oi.variant_id,
              oi.quantity,
              pv.stock AS variant_stock,
              i.quantity AS inventory_quantity,
              i.reserved AS inventory_reserved,
              COALESCE(p.featured, FALSE) AS is_promoted,
              CASE WHEN oi.variant_id IS NOT NULL THEN COALESCE(pv.stock, 0)
                   ELSE COALESCE(i.quantity, 0) END AS total_stock,
              CASE WHEN oi.variant_id IS NOT NULL THEN COALESCE(pv.stock, 0)
                   ELSE GREATEST(0, COALESCE(i.quantity, 0) - COALESCE(i.reserved, 0)) END AS available_stock
         FROM order_items oi
         LEFT JOIN inventory i ON i.product_id = oi.product_id
         LEFT JOIN product_variants pv ON pv.id = oi.variant_id
         LEFT JOIN products p ON p.id = oi.product_id
        WHERE oi.order_id = $1
     ),
     sold AS (
       SELECT oi.product_id, SUM(oi.quantity)::int AS units
         FROM order_items oi
         JOIN orders o ON o.id = oi.order_id
        WHERE oi.product_id IN (SELECT DISTINCT product_id FROM lines)
          AND o.created_at >= NOW() - ($2 || ' days')::interval
          AND o.status = ANY($3::text[])
        GROUP BY oi.product_id
     )
     SELECT
       (SELECT MIN(available_stock) FROM lines)::int AS available_stock,
       (SELECT MIN(total_stock) FROM lines)::int AS total_stock,
       (SELECT MAX(inventory_reserved) FROM lines)::int AS reserved_stock,
       (SELECT BOOL_OR(is_promoted) FROM lines) AS is_promoted,
       (SELECT COUNT(*) FROM lines)::int AS item_lines,
       COALESCE((SELECT SUM(units) FROM sold), 0)::int AS units_sold`,
    [
      orderId,
      String(PAYMENT_RESERVATION_THRESHOLDS.velocityWindowDays),
      [...PAYMENT_RESERVATION_SOLD_STATUSES],
    ],
  );

  const row = result.rows[0] ?? {};
  const num = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
  const availableStock = num(row.available_stock);
  const unitsSold7d = num(row.units_sold) ?? 0;

  return {
    availableStock,
    totalStock: num(row.total_stock),
    reservedStock: num(row.reserved_stock),
    unitsSold7d,
    ...deriveDemandMetrics(availableStock, unitsSold7d),
    isPromoted: row.is_promoted === true,
    itemLines: num(row.item_lines) ?? 0,
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

  const signals = await gatherOrderReservationSignals(client, orderId);
  const policy = calculatePaymentReservationPolicy(signals, now);

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
