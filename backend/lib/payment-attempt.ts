/**
 * Which `payments` rows account for ONE order's money — the ONE resolver.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE ROOT CAUSE THIS MODULE EXISTS FOR
 * -------------------------------------
 * A Velnox purchase can span N shops. `POST /api/customer/checkout` writes ONE
 * `checkout_groups` row and ONE order PER SHOP, and the customer is charged ONCE
 * for the whole purchase: a single Stripe Checkout Session whose `payments` row
 * carries `order_id IS NULL, checkout_group_id = <group>`
 * (`routes/stripe.ts` → `openCheckoutGroupSession`).
 *
 * Settlement is correct — `settleCheckoutGroup()` moves EVERY member order to
 * `paid`. What was NOT correct is every READ: each per-order payment lookup
 * resolved the ledger by `payments.order_id = <order>` ALONE. For a multi-shop
 * purchase that predicate matches NOTHING, so the blind subquery returned NULL,
 * `COALESCE(…, 'unpaid')` turned it into the string `'unpaid'`, and the
 * storefront rendered `orders.status = 'paid'` ("ชำระเงินแล้ว") beside a
 * `paymentStatus` of "ยังไม่ชำระ". The customer saw a paid purchase described as
 * unpaid — on a real, settled charge.
 *
 * That is why this module's central idea is the COVERING SET rather than a
 * better `ORDER BY`: the question is never "what is this order's newest payment
 * row", it is "which payment rows account for this order's money".
 *
 *   A `payments` row COVERS order `o` when either
 *     • it names the order directly          — p.order_id = o.id, or
 *     • it names the purchase the order is part of
 *                                            — o.checkout_group_id IS NOT NULL
 *                                              AND p.checkout_group_id = o.checkout_group_id
 *
 * The second clause is the whole fix. An order outside any group has
 * `o.checkout_group_id IS NULL`, so the clause is never true and its covering
 * set is exactly its own rows — every single-order read keeps the behaviour it
 * had before, byte for byte.
 *
 * WHY THE FOLD IS MONOTONIC ("settled wins")
 * ------------------------------------------
 * A covering set can hold MORE than one row, because a retry can open a second
 * attempt before an older one is closed. Taking the newest row is then WRONG and
 * provably so: with the group row `paid` and a newer per-order retry in
 * `requires_action`, `ORDER BY created_at DESC LIMIT 1` answers
 * `requires_action` while `orders.status` is `paid` — the same contradiction,
 * reintroduced from the other side.
 *
 * So the covering set is folded by PRECEDENCE, not by recency:
 *
 *     1. refunded            a covering row is fully refunded
 *     2. partially_refunded  a covering row is partially refunded
 *     3. paid                a covering row is captured
 *     4. processing          a covering row is in flight
 *     5. otherwise           the NEWEST row's status (pending / requires_action /
 *                            failed / cancelled)
 *
 * Every step is a LATTICE JOIN — commutative, associative, idempotent — so the
 * answer does not depend on row order, on how many duplicate rows exist, or on
 * which of two concurrent writers landed first. "Settled wins" is also the only
 * fold that can be reconciled against `orders.status`, which settlement already
 * moves to `paid` for every member order of a group.
 *
 * DELIBERATELY NOT HERE
 * ---------------------
 *   • No new table, no new column, no cached copy of the ledger. The covering
 *     set is read from `payments`, which stays the single source of truth.
 *   • No change to what "settled" MEANS for a gate. `PAYMENT_SETTLED_STATUSES`
 *     is still `['paid','processing']` (lib/order-lock.ts) — those gates ask
 *     "would releasing this stock be a second terminal transition", a different
 *     question from "what should the customer see". The fold's extra
 *     `refunded` / `partially_refunded` states exist because a full refund moves
 *     `orders.status` to `refunded`, so the payment badge must be able to agree
 *     with it.
 *   • No provider knowledge. Nothing here calls Stripe or reads a client value;
 *     it is a pure projection of our own rows.
 *
 * @see docs/PAYMENT_CURRENT_STATE.md
 * @see docs/PAYMENT_TARGET_ARCHITECTURE.md
 */

/** Anything that can run a parameterised statement — a pool or a locked client. */
export interface PaymentSqlRunner {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
}

/** One `payments` row as a payment-state decision needs it. */
export interface PaymentCoveringRow {
  id: string;
  order_id: string | null;
  checkout_group_id: string | null;
  method: string | null;
  status: string;
  amount: string | null;
  currency: string | null;
  provider: string | null;
  provider_checkout_session_id: string | null;
  provider_payment_id: string | null;
  refunded_amount: string | null;
  refund_status: string | null;
  created_at: string | Date;
  paid_at: string | Date | null;
}

/** The columns every covering-set read selects, in ONE place. */
const COVERING_COLUMNS = `p.id, p.order_id, p.checkout_group_id, p.method, p.status,
            p.amount, p.currency, p.provider, p.provider_checkout_session_id,
            p.provider_payment_id, p.refunded_amount, p.refund_status,
            p.created_at, p.paid_at`;

/**
 * The covering-set predicate for a query that ALREADY has the order row in
 * scope — a correlated gate, or either of the `o`-aliased fragments below.
 *
 * Both arguments are identifiers chosen by our own call sites — never a
 * user-supplied string — so interpolating them cannot carry an injection. The
 * scope is deliberately narrow: the alternative (deriving the alias from
 * context) would spread a dynamic identifier across the read routes for no
 * benefit, and a parameterised identifier is not a thing SQL has.
 *
 * Exported so the correlated gates in `lib/inventory.ts`,
 * `lib/order-fulfillment.ts` and `jobs/payment-reservation-scheduler.ts` read
 * the SAME definition of "covers" as the display fold. Two copies of this
 * predicate is exactly how the two surfaces would drift apart again.
 */
export function coveringPaymentsPredicate(paymentsAlias: string, ordersAlias: string): string {
  return (
    `(${paymentsAlias}.order_id = ${ordersAlias}.id OR ` +
    `(${ordersAlias}.checkout_group_id IS NOT NULL AND ` +
    `${paymentsAlias}.checkout_group_id = ${ordersAlias}.checkout_group_id))`
  );
}

/**
 * The same predicate for a query where the only order identifier available is a
 * PLACEHOLDER (`$1`) — the row-level reads that fetch one order's covering set
 * without joining `orders`.
 *
 * The group side has to be a scalar subquery rather than a column reference,
 * because the predicate is applied to `payments` alone. It is still ONE
 * statement and still one primary-key probe on `orders` per candidate row, so
 * the plan is not materially worse than the correlated form.
 */
export function coveringPaymentsPredicateForOrderId(paymentsAlias: string, orderIdExpr: string): string {
  const group = `(SELECT o.checkout_group_id FROM orders o WHERE o.id = ${orderIdExpr})`;
  return (
    `(${paymentsAlias}.order_id = ${orderIdExpr} OR ` +
    `(${group} IS NOT NULL AND ${paymentsAlias}.checkout_group_id = ${group}))`
  );
}

/**
 * The covering set for the order row aliased `o`, as a derived table.
 *
 * BOUND TO THE ALIAS `o` BY CONTRACT. Every call site using this fragment must
 * alias `orders` as `o` — the alternative (taking the alias as an argument)
 * would spread a dynamic identifier across the read routes for no benefit.
 *
 * Newest first, with `id` as the tiebreaker so the order is TOTAL: two rows
 * written in the same transaction can share `created_at` to the microsecond, and
 * an unstable sort would make the fold's step 5 non-deterministic.
 */
export const ORDER_COVERING_PAYMENTS_SQL = `SELECT ${COVERING_COLUMNS}
            FROM payments p
           WHERE ${coveringPaymentsPredicate("p", "o")}
           ORDER BY p.created_at DESC, p.id DESC`;

/**
 * The displayed payment status for the order row aliased `o`.
 *
 * `'unpaid'` is the pre-existing sentinel for "no payment row at all" and is
 * preserved verbatim: `PAYMENT_STATUS_BADGE` in `packages/shared` (and all three
 * locales) already defines it, and it is not a value any `payments.status` row
 * can hold — so it stays unambiguously distinguishable from a real state.
 */
export const ORDER_PAYMENT_STATUS_SQL = `COALESCE((
                SELECT CASE
                         WHEN bool_or(cp.refund_status = 'refunded') THEN 'refunded'
                         WHEN bool_or(cp.refund_status = 'partially_refunded') THEN 'partially_refunded'
                         WHEN bool_or(cp.status = 'paid') THEN 'paid'
                         WHEN bool_or(cp.status = 'processing') THEN 'processing'
                         ELSE (array_agg(cp.status ORDER BY cp.created_at DESC, cp.id DESC))[1]
                       END
                  FROM (${ORDER_COVERING_PAYMENTS_SQL}) cp
              ), 'unpaid')`;

/**
 * The method behind the displayed status: the newest covering row's `method`.
 *
 * The method is NOT folded by precedence the way the status is. A method is a
 * property of an ATTEMPT, not a fact about the money: once a purchase is
 * settled, the rail that settled it is the newest row's rail, and a later
 * abandoned retry through a different rail must not relabel the payment the
 * customer actually made.
 */
export const ORDER_PAYMENT_METHOD_SQL = `(SELECT cp.method
                FROM (${ORDER_COVERING_PAYMENTS_SQL}) cp
               ORDER BY cp.created_at DESC, cp.id DESC
               LIMIT 1)`;

/**
 * The checkout session id of a covering row that is still OPEN for the customer
 * (`pending` / `requires_action`).
 *
 * Used by the storefront's "continue payment" affordance and by the reservation
 * sweep, which must expire exactly the session it is abandoning — and must NEVER
 * expire one while a settled row covers the same purchase.
 */
export const ORDER_OPEN_SESSION_SQL = `(SELECT cp.provider_checkout_session_id
                FROM (${ORDER_COVERING_PAYMENTS_SQL}) cp
               WHERE cp.provider = 'stripe'
                 AND cp.status IN ('pending', 'requires_action')
                 AND cp.provider_checkout_session_id IS NOT NULL
               ORDER BY cp.created_at DESC, cp.id DESC
               LIMIT 1)`;

/** Settlement states that OUTRANK a cancellation / a stock release. */
export const PAYMENT_SETTLED_STATUSES = ["paid", "processing"] as const;

/** Refund states a payment can be in once money has moved and come back. */
export const PAYMENT_REFUNDED_STATUSES = ["partially_refunded", "refunded"] as const;

/**
 * The covering set for ONE order, newest first. The single read every
 * single-order payment decision is built on.
 *
 * Deliberately NOT schema-tolerant (`checkout_group_id` is read by name): this
 * is a read of OUR core ledger, and a database missing the column is a database
 * whose checkout cannot run at all — `db/run-sqleditor.sql` is the repair, and
 * faking a degraded answer here would hide the condition that repair exists for.
 */
export async function coveringPaymentsForOrder(
  client: PaymentSqlRunner,
  orderId: string,
): Promise<PaymentCoveringRow[]> {
  const res = await client.query(
    `SELECT ${COVERING_COLUMNS}
       FROM payments p
      WHERE ${coveringPaymentsPredicateForOrderId("p", "$1")}
      ORDER BY p.created_at DESC, p.id DESC`,
    [orderId],
  );
  return res.rows as PaymentCoveringRow[];
}

/**
 * Fold a covering set into the ONE status the customer sees.
 *
 * Pure, exported, and the ONLY implementation of the rule: the SQL fragment
 * above is its relational twin for the list routes, and
 * `backend/tests/checkout-group-payment-visibility.test.ts` pins the two against
 * each other on a real database.
 *
 * Returns `null` for an empty set, so a caller can distinguish "no payment yet"
 * from a real state and choose its own sentinel.
 */
export function foldPaymentStatus(rows: PaymentCoveringRow[]): string | null {
  if (rows.length === 0) return null;
  const has = (predicate: (row: PaymentCoveringRow) => boolean): boolean => rows.some(predicate);
  if (has((row) => row.refund_status === "refunded")) return "refunded";
  if (has((row) => row.refund_status === "partially_refunded")) return "partially_refunded";
  if (has((row) => row.status === "paid")) return "paid";
  if (has((row) => row.status === "processing")) return "processing";
  // Step 5: the newest row decides. `rows` arrives newest-first, but the fold
  // does not rely on that — a caller may pass any order, so it re-derives.
  return [...rows].sort(byRecencyDesc)[0]?.status ?? null;
}

/**
 * The covering row a MONEY action must be built from — a refund, an operator
 * lookup, a settlement attribution.
 *
 * "Settled wins" again: prefer a captured row, because a per-order retry opened
 * after the purchase was charged must not become the row a refund is built from
 * (`provider_payment_intent` on an abandoned attempt is not the money).
 * Falls back to the newest row when nothing is captured yet.
 */
export function foldPaymentRow(rows: PaymentCoveringRow[]): PaymentCoveringRow | null {
  if (rows.length === 0) return null;
  const ordered = [...rows].sort(byRecencyDesc);
  return (
    ordered.find((row) => row.status === "paid") ??
    ordered.find(
      (row) => row.refund_status === "refunded" || row.refund_status === "partially_refunded",
    ) ??
    ordered[0] ??
    null
  );
}

/** Total order on the covering set: newest first, id as the tiebreaker. */
function byRecencyDesc(a: PaymentCoveringRow, b: PaymentCoveringRow): number {
  const left = new Date(a.created_at).getTime();
  const right = new Date(b.created_at).getTime();
  if (left !== right) return right - left;
  return String(b.id).localeCompare(String(a.id));
}

/** Everything a single-order payment decision needs, read in ONE round trip. */
export interface OrderPaymentState {
  /** The order's purchase, when it is one of several orders for one payment. */
  checkoutGroupId: string | null;
  /** The folded, displayed status — `null` when no row covers the order. */
  status: string | null;
  /** `'unpaid'`-style sentinel: what the API surfaces expose. */
  displayStatus: string;
  /** The newest covering row's rail, for display next to the status. */
  method: string | null;
  /** The row a money action must use (settled wins). */
  row: PaymentCoveringRow | null;
  /** Every covering row, newest first. */
  rows: PaymentCoveringRow[];
  /** A live Stripe session the customer can still complete, if any. */
  openSessionId: string | null;
  /** Money has moved: `paid` / `processing` present in the covering set. */
  settled: boolean;
}

/**
 * Resolve ONE order's authoritative payment state, group-aware.
 *
 * One statement for the covering set plus one for the order's group link, both
 * on the caller's client — so inside a transaction it reads under the caller's
 * lock (lib/order-lock.ts) and cannot be overtaken by a concurrent webhook.
 */
export async function orderPaymentState(
  client: PaymentSqlRunner,
  orderId: string,
): Promise<OrderPaymentState> {
  const [rows, orderRes] = await Promise.all([
    coveringPaymentsForOrder(client, orderId),
    client.query(`SELECT checkout_group_id FROM orders WHERE id = $1`, [orderId]),
  ]);
  const checkoutGroupId = (orderRes.rows[0]?.checkout_group_id as string | undefined) ?? null;
  const status = foldPaymentStatus(rows);
  const settled = rows.some((row) =>
    (PAYMENT_SETTLED_STATUSES as readonly string[]).includes(row.status),
  );
  return {
    checkoutGroupId,
    status,
    displayStatus: status ?? "unpaid",
    method: newestMethod(rows),
    row: foldPaymentRow(rows),
    rows,
    openSessionId: openSessionFor(rows),
    settled,
  };
}

/** The newest covering row's rail. See `ORDER_PAYMENT_METHOD_SQL` for why. */
export function newestMethod(rows: PaymentCoveringRow[]): string | null {
  if (rows.length === 0) return null;
  return [...rows].sort(byRecencyDesc)[0]?.method ?? null;
}

/** The id of a still-open Stripe session in the covering set, if there is one. */
export function openSessionFor(rows: PaymentCoveringRow[]): string | null {
  const open = [...rows]
    .sort(byRecencyDesc)
    .find(
      (row) =>
        row.provider === "stripe" &&
        ["pending", "requires_action"].includes(row.status) &&
        typeof row.provider_checkout_session_id === "string" &&
        row.provider_checkout_session_id !== "",
    );
  return open?.provider_checkout_session_id ?? null;
}

/**
 * The same resolution, from the pool rather than a transaction — for the read
 * routes (`routes/cart.ts`, `routes/seller-orders.ts`, `routes/center.ts`).
 */
export async function orderPaymentStateFromPool(
  pool: PaymentSqlRunner,
  orderId: string,
): Promise<OrderPaymentState> {
  return orderPaymentState(pool, orderId);
}

/**
 * The order's purchase scope: which group (if any) the order belongs to, and
 * that group's server-authoritative total.
 *
 * Read out of `to_jsonb(o)` so a database whose `orders` table predates
 * migration 054 answers "no group" instead of raising `undefined_column`
 * (42703) — the same deploy-order tolerance `routes/stripe.ts`
 * (`checkoutGroupIdForAttempt`) and `lib/payment-reservation.ts`
 * (`selectOrderPaymentRow`) already apply to a payment read. A missing column
 * genuinely means there are no groups to route, so "no group" is the SAFE
 * answer, and it is the single-order branch every existing caller follows.
 */
export async function readOrderPurchaseScope(
  client: PaymentSqlRunner,
  orderId: string,
): Promise<{ checkoutGroupId: string | null; userId: string | null }> {
  const res = await client.query(
    `SELECT to_jsonb(o) ->> 'checkout_group_id' AS checkout_group_id, o.user_id
       FROM orders o
      WHERE o.id = $1`,
    [orderId],
  );
  const row = res.rows[0];
  return {
    checkoutGroupId: (row?.checkout_group_id as string | undefined) ?? null,
    userId: (row?.user_id as string | undefined) ?? null,
  };
}

/**
 * Every order in a purchase, in a STABLE order (id ASC), as settlement and
 * expiry lock them.
 *
 * The ordering is not cosmetic: the caller locks these rows `FOR UPDATE`, so a
 * stable sequence is what keeps two concurrent writers from forming an AB-BA
 * deadlock (A→B on one side, B→A on the other).
 */
export async function readPurchaseOrderIds(
  client: PaymentSqlRunner,
  checkoutGroupId: string,
): Promise<string[]> {
  const res = await client.query(
    `SELECT id FROM orders WHERE checkout_group_id = $1 ORDER BY id ASC`,
    [checkoutGroupId],
  );
  return res.rows.map((row: { id: string }) => row.id);
}

// ─── Observability ──────────────────────────────────────────────────────────
//
// Phase 20 of the rebuild brief asks for named events traceable by order id,
// payment id, checkout session id and Stripe event id. One JSON line per event
// is enough to make a payment traceable in production logs, with no metrics
// dependency, no new table, and — critically — NO SECRET: the field list below
// is closed, so a caller cannot leak a payload or a credential into a log by
// passing one.

/** The named payment events this system emits. */
export type PaymentEvent =
  | "checkout.created"
  | "payment.created"
  | "payment.pending"
  | "payment.succeeded"
  | "payment.failed"
  | "payment.canceled"
  | "webhook.received"
  | "webhook.processed"
  | "webhook.duplicate"
  | "webhook.failed"
  | "order.paid"
  | "inventory.reserved"
  | "inventory.committed"
  | "inventory.released"
  | "refund.created"
  | "refund.succeeded"
  | "refund.failed";

/** The only fields an event may carry. Every one is a safe, non-secret scalar. */
export interface PaymentEventFields {
  order_id?: string | null;
  order_ids?: string[] | null;
  payment_id?: string | null;
  checkout_group_id?: string | null;
  checkout_session_id?: string | null;
  provider_payment_id?: string | null;
  stripe_event_id?: string | null;
  status?: string | null;
  method?: string | null;
  amount?: string | null;
  currency?: string | null;
  reason?: string | null;
  count?: number | null;
}

/**
 * Emit ONE structured payment event.
 *
 * Never throws — an observability line must not be able to fail a settlement —
 * and never includes a value the caller did not name in `PaymentEventFields`.
 */
export function logPaymentEvent(event: PaymentEvent, fields: PaymentEventFields = {}): void {
  try {
    const line: Record<string, unknown> = { event, at: new Date().toISOString() };
    for (const [key, value] of Object.entries(fields)) {
      if (value === undefined || value === null) continue;
      line[key] = value;
    }
    console.log(`[payment-event] ${JSON.stringify(line)}`);
  } catch {
    /* an observability line is never allowed to break the write it describes */
  }
}
