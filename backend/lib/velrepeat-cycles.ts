/**
 * VelRepeat V2 — Phase 5: Delivery Cycle lifecycle & per-cycle order creation.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THIS MODULE IS
 * ───────────────────
 * The two halves of "a prepaid Repeat Plan produces deliveries":
 *
 *   1. `createCycleSchedule` — at `draft → active`, mint the cycle SCHEDULE
 *      for the whole commitment (cycle 1..N) and nothing else. No order, no
 *      inventory, no shipment, no fulfillment.
 *
 *   2. `processDueCycles` / `processCycle` — when a cycle reaches its
 *      `scheduled_at`, generate THAT cycle's normal order(s) from the frozen
 *      snapshot, once, ever.
 *
 * HARD ARCHITECTURE RULE (the owner's rule for this phase)
 * ──────────────────────────────────────────────────────
 *   Normal Commerce : Product → Cart → Payment → Order → Fulfillment
 *   VelRepeat V2    : Package → Repeat Plan → Prepaid Payment → Plan Active
 *                     → Cycle → Order → EXISTING Fulfillment
 *
 * A cycle's order is a row in the CANONICAL `orders` / `order_items` tables
 * and is fulfilled by the canonical `order-fulfillment.ts` state machine.
 * There is no repeat-specific order table, no repeat-specific fulfillment
 * machine, and no repeat-specific inventory module.
 *
 * WHAT IS DELIBERATELY ABSENT, AND WHY (contract §48/§50/§51, decisions Q14/Q16/Q17/Q2)
 * ─────────────────────────────────────────────────────────────────────────────────────
 *   • NO PAYMENT ROW PER CYCLE. Q14: the customer pays ONCE for the whole
 *     commitment. A cycle order has no charge of its own, so it must not be
 *     pushed through `pending_payment`/`paid` and must not get a pseudo-payment
 *     row. (The V1 scheduler does create one — `velrepeat-scheduler.ts:350` —
 *     and that is a V1 behavior this phase does not copy.)
 *   • NO `sold_count` WRITE. Q2's recognition MOMENT ("is a sale recognized
 *     when the cycle's order obligation is claimed, or when goods are
 *     delivered?") is an open OWNER DECISION and it conflicts with this
 *     repository's payment-settlement recognition. Writing it here would
 *     invent that policy. Phase 6 owns it; this phase leaves the counter
 *     exactly where the canonical settlement path left it.
 *   • NO `commitOrderInventory`. Inventory is HELD (reserved) when the cycle's
 *     order is created and released by `releaseOrderInventory` if that order
 *     ends cancelled/expired — the canonical reserve→settle xor release
 *     contract. Converting the hold into a completed sale is
 *     `commitOrderInventory`, reached only from payment settlement, and a cycle
 *     order has no payment to settle it. See "INVENTORY, precisely" below.
 *   • NO CYCLE AT `scheduled_at` FROM ACTIVATION. Cycle 1's `scheduled_at` is
 *     the plan's `next_run_at`, which Phase 4 sets to one full interval AFTER
 *     activation. That is why activation creates a schedule and no orders.
 *   • NO `velrepeat_runs` WRITE. Decision-closure §9.2 makes `velrepeat_cycles`
 *     the canonical cycle identity and `velrepeat_runs` the execution attempt
 *     (Phase 7). This phase creates no run row; `orders.velrepeat_run_id` is
 *     left NULL.
 *
 * INVENTORY, precisely (owner rule §6: "when the cycle reaches its fulfillment
 * stage, under the rules the system already uses")
 * ─────────────────────────────────────────────────────────────────────────────
 *   • AT ACTIVATION → nothing is reserved. A 4-cycle plan does not hold 4
 *     cycles of stock at purchase time; holding it is Decision A / Q1
 *     (plan-level vs. per-cycle reservation), still an OWNER DECISION, and
 *     Phase 6.
 *   • AT ORDER CREATION → the canonical checkout reservation, and only then:
 *     `reserveInventoryStock` for a non-variant product, the guarded
 *     `UPDATE product_variants SET stock = stock - $1 WHERE stock >= $1` for a
 *     variant. Both are the exact statements `routes/cart.ts` uses.
 *   • NO DOUBLE RESERVATION. Reservation happens inside the same transaction
 *     that claims the cycle row, so a scheduler retry cannot re-reserve: the
 *     claim either already succeeded (the cycle is no longer `scheduled`) or
 *     the whole transaction rolled back and nothing was reserved.
 *   • RELEASE IS REACHABLE. A cycle order is created `pending`, which is in
 *     `RELEASABLE_STATUSES`, so the canonical cancel/expire paths hand the
 *     hold back exactly as they do for any other unpaid order.
 *
 * SCHEDULE SEMANTICS (Q16 — CLOSED, not guessed)
 * ──────────────────────────────────────────────
 * Decision Q16 fixes the scheduling authority as UTC with `TIMESTAMPTZ`
 * canonical; `velrepeat_plans.timezone` is display preference only. This
 * module therefore calls the ONE existing schedule authority,
 * `calculateNextRunAt` (`backend/jobs/velrepeat-scheduler.ts`), which is the
 * canonical UTC derivation with month day-clamping (Jan 31 + 1 month → Feb
 * 28/29). It is reused, never duplicated and never re-implemented, per
 * contract §42 ("preserved, not duplicated").
 *
 * IDEMPOTENCY — TWO INDEPENDENT DATABASE GUARANTEES
 * ──────────────────────────────────────────────────
 *   1. THE ROW CLAIM (decision-closure §9.3 step 4). The cycle row is locked
 *      `FOR UPDATE` and moved `scheduled → processing` with `status =
 *      'scheduled'` in the WHERE clause. A second worker therefore blocks on
 *      the lock, re-reads, sees a status it did not expect and returns
 *      `already_claimed` having written nothing. This reuses the existing
 *      order-lock discipline (`backend/lib/order-lock.ts`), it does not
 *      introduce a second one, and it is never an in-memory flag.
 *   2. THE UNIQUE CONSTRAINT (`idx_orders_velrepeat_cycle_seller_unique`,
 *      migration V0053). Even if a cycle were somehow reached twice, a second
 *      order for the same `(cycle, shop)` is rejected by PostgreSQL with 23505.
 *   Both matter: the claim makes the common case clean, the constraint makes
 *   the invariant true regardless of the code path.
 *
 * CYCLE STATE MACHINE (separate axis from the order's — contract §49.1)
 * ────────────────────────────────────────────────────────────────────────
 *   scheduled → processing → ordered → completed
 *                     ↘ out_of_stock | item_unavailable   (deterministic refusals)
 *
 *   These are `velrepeat_cycles.status` values, NOT `orders.status` values,
 *   and the canonical order vocabulary (`pending → confirmed → packing →
 *   shipped → delivered → completed`) is untouched. `fulfilled` is NOT added:
 *   `completed` is its domain name, and a second word for one state is the
 *   duplicate-state-machine hazard the owner named. `skipped` and `cancelled`
 *   exist in the vocabulary but have NO writer here — their monetary
 *   consequence is owner decision C / Phase 9.
 *
 * THE TWO NON-EQUIVALENCES THIS MODULE ENFORCES
 * ──────────────────────────────────────────────
 *   • "Plan active" ≠ "any fulfillment happened". Activation writes cycles and
 *     zero orders; a plan whose every cycle is `ordered` is still not
 *     `completed`.
 *   • "Payment success" ≠ "any order exists". Payment settled in Phase 4; the
 *     first order appears only when cycle 1's `scheduled_at` arrives.
 */
import type { PoolClient } from "pg";

import { query, withTransaction } from "../db/index.js";
import { calculateNextRunAt, type FrequencyType } from "../jobs/velrepeat-scheduler.js";
import { reserveInventoryStock } from "./inventory.js";
// Every customer-visible order needs a public number — including one minted by
// the cycle scheduler, which never went through the cart checkout path.
import { generateOrderNumber, isOrderNumberCollision } from "./order-number.js";
// The ONE order-state authority: a cycle order writes the three lifecycle axes
// and derives the legacy `orders.status` from them (see the module header).
import { NEW_ORDER_AXES, projectOrderStatus } from "./order-state.js";

/** Refusal reasons this module can end a cycle with. */
export type CycleOutcome =
  | "ordered"
  | "already_claimed"
  | "already_terminal"
  | "plan_not_active"
  | "out_of_stock"
  | "item_unavailable"
  | "snapshot_missing";

/** The owner's Phase 5 cycle vocabulary, as a type. */
export type CycleStatus =
  | "scheduled"
  | "processing"
  | "ordered"
  | "completed"
  | "skipped"
  | "cancelled"
  | "out_of_stock"
  | "item_unavailable";

/** The sellable catalog state. Taken from `routes/cart.ts:1641`, not invented. */
const SELLABLE_PRODUCT_STATUS = "published";

/** The active variant state, from the `product_variants.status` CHECK. */
const ACTIVE_VARIANT_STATUS = "active";

export interface CreatedCycle {
  readonly id: string;
  readonly cycleNumber: number;
  readonly scheduledAt: string;
  readonly pricingSnapshotId: string | null;
}

export interface CycleScheduleResult {
  readonly planId: string;
  readonly pricingSnapshotId: string;
  readonly cycles: readonly CreatedCycle[];
}

export interface ProcessedCycle {
  readonly cycleId: string;
  readonly outcome: CycleOutcome;
  /** Populated only on `ordered` — the orders this cycle actually produced. */
  readonly orderIds: readonly string[];
  readonly detail: string | null;
}

export interface CycleRunReport {
  readonly due: number;
  readonly processed: readonly ProcessedCycle[];
}

/**
 * A snapshot line joined to the plan composition that owns its shop.
 *
 * `line_id` is the PRIMARY KEY of `velrepeat_pricing_snapshot_items` and is
 * the line's exact identity. It is what the per-shop money sum is keyed on, so
 * a product that appears in more than one line is counted once per line and
 * never counted twice because of a join.
 */
interface SnapshotLine {
  readonly line_id: string;
  readonly product_id: string | null;
  readonly variant_id: string | null;
  /** `velrepeat_items.shop_id` is NOT NULL, so a null here means the plan
   *  composition row is gone — the line cannot be attributed to a seller. */
  readonly shop_id: string | null;
  readonly quantity: number;
  readonly unit_price: string;
  readonly line_total: string;
  readonly product_name: string | null;
  readonly image_url: string | null;
  readonly product_status: string | null;
  readonly variant_status: string | null;
}

// ─── Cycle schedule (activation) ───────────────────────────────────────────

/**
 * Build the commitment's cycle schedule from the plan's own cadence.
 *
 * Cycle 1's instant is the plan's `next_run_at` — which Phase 4 already set
 * to `calculateNextRunAt(activationInstant)` when it wrote `draft → active`.
 * Every later cycle is one further interval from the previous one, so a
 * months-cadence plan clamps the same way the rest of the system clamps and a
 * days/weeks plan steps uniformly. Deriving cycle 1 from `next_run_at` rather
 * than recomputing from `NOW()` is what keeps the schedule identical whether
 * it is read a second time or created after a delay.
 */
export function planCycleInstants(
  firstInstant: Date,
  frequencyType: FrequencyType,
  intervalValue: number,
  cycleCount: number,
): Date[] {
  if (!Number.isInteger(cycleCount) || cycleCount < 1) {
    throw new CycleScheduleError(
      "COMMITMENT_CYCLES_INVALID",
      `A prepaid plan must commit to at least one cycle; got ${cycleCount}.`,
    );
  }
  const instants: Date[] = [];
  let cursor = new Date(firstInstant.getTime());
  for (let index = 0; index < cycleCount; index += 1) {
    if (index > 0) {
      cursor = calculateNextRunAt(cursor, frequencyType, intervalValue);
    }
    instants.push(new Date(cursor.getTime()));
  }
  return instants;
}

/** Raised for a plan that cannot be given a schedule at all. */
export class CycleScheduleError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CycleScheduleError";
    this.code = code;
  }
}

/**
 * Mint cycles 1..`commitment_cycles` for an ACTIVE plan.
 *
 * MUST run inside the caller's transaction — it is invoked from the Phase 4
 * activation, so "the plan went active" and "its schedule exists" are one unit
 * of work and neither can exist without the other.
 *
 * Creates SCHEDULE ROWS ONLY. Deliberately performs no order insert, no
 * inventory statement, no shipment and no status write beyond the cycles
 * themselves. Idempotent: the insert is `ON CONFLICT (plan_id, cycle_number)
 * DO NOTHING`, so a repeated call is a no-op rather than a second schedule.
 *
 * `pricingSnapshotId` is normally passed in by the caller, which has already
 * resolved the commitment snapshot for the charge it just settled. When it is
 * omitted the newest snapshot for the plan is read, which is the same row the
 * settlement path uses.
 */
export async function createCycleSchedule(
  client: PoolClient,
  planId: string,
  options: { readonly pricingSnapshotId?: string } = {},
): Promise<CycleScheduleResult> {
  const planRes = await client.query(
    `SELECT id, status, frequency_type, interval_value, commitment_cycles,
            next_run_at, currency
       FROM velrepeat_plans
      WHERE id = $1`,
    [planId],
  );
  const plan = planRes.rows[0];
  if (!plan) {
    throw new CycleScheduleError("PLAN_NOT_FOUND", `No repeat plan ${planId}.`);
  }
  if (plan.status !== "active") {
    throw new CycleScheduleError(
      "PLAN_NOT_ACTIVE",
      `Only an active plan can be given a cycle schedule; plan ${planId} is ${plan.status}.`,
    );
  }
  if (plan.commitment_cycles === null || plan.commitment_cycles === undefined) {
    // A V1 pay-per-run plan has no prepaid commitment. Minting cycles for it
    // would invent a commitment the customer never bought.
    throw new CycleScheduleError(
      "COMMITMENT_CYCLES_MISSING",
      `Plan ${planId} records no commitment_cycles; it is not a prepaid V2 plan.`,
    );
  }

  // The snapshot is the authority for what each cycle delivers and what it
  // cost, so every cycle of the commitment points at the SAME frozen snapshot.
  let snapshotId = options.pricingSnapshotId ?? null;
  if (!snapshotId) {
    const snapshotRes = await client.query(
      `SELECT id
         FROM velrepeat_pricing_snapshots
        WHERE plan_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [planId],
    );
    snapshotId = (snapshotRes.rows[0]?.id as string | undefined) ?? null;
  }
  if (!snapshotId) {
    throw new CycleScheduleError(
      "PRICING_SNAPSHOT_MISSING",
      `Plan ${planId} has no pricing snapshot, so its cycles cannot be priced.`,
    );
  }
  const snapshot: string = snapshotId;

  const instants = planCycleInstants(
    new Date(plan.next_run_at as string),
    String(plan.frequency_type) as FrequencyType,
    Number(plan.interval_value),
    Number(plan.commitment_cycles),
  );

  const created: CreatedCycle[] = [];
  for (const [index, instant] of instants.entries()) {
    const inserted = await client.query(
      `INSERT INTO velrepeat_cycles (plan_id, cycle_number, scheduled_at, pricing_snapshot_id, status)
       VALUES ($1, $2, $3, $4, 'scheduled')
       ON CONFLICT (plan_id, cycle_number) DO NOTHING
       RETURNING id, cycle_number, scheduled_at, pricing_snapshot_id`,
      [planId, index + 1, instant.toISOString(), snapshot],
    );
    // A conflict means this cycle already exists. It is still reported as part
    // of the schedule so a caller sees the full commitment, but nothing was
    // written — the `UNIQUE (plan_id, cycle_number)` from Phase 1 is the
    // reason a repeated call is a no-op instead of a second schedule.
    const row = inserted.rows[0] ?? (await readCycleRow(client, planId, index + 1));
    if (row) {
      created.push({
        id: String(row.id),
        cycleNumber: Number(row.cycle_number),
        scheduledAt: new Date(row.scheduled_at as string).toISOString(),
        pricingSnapshotId: (row.pricing_snapshot_id as string | null) ?? null,
      });
    }
  }

  return { planId, pricingSnapshotId: snapshot, cycles: created };
}

// ─── Due-cycle execution ───────────────────────────────────────────────────

/**
 * Generate the order(s) for ONE cycle, exactly once, in ITS OWN TRANSACTION.
 *
 * Owning the transaction here — rather than accepting a caller-supplied
 * client — is what makes `processDueCycles` give each cycle an independent unit
 * of work. A cycle whose order creation fails rolls back only its own claim
 * and only its own inventory holds; the cycles that already succeeded keep
 * theirs. It also means the claim, the order rows, the order lines and the
 * inventory holds are atomic: any failure returns the cycle to `scheduled` for
 * a later retry rather than leaving a cycle that claims progress it does not
 * have, and no reservation can survive a rolled-back order.
 */
export async function processCycle(cycleId: string): Promise<ProcessedCycle> {
  return withTransaction((client) => processCycleInTransaction(client, cycleId));
}

/**
 * The body of `processCycle`, for callers that already hold a transaction.
 *
 * Exported for the same reason `commitOrderInventory` is: the invariant only
 * holds if the claim and the writes share one transaction, so a caller that
 * needs to compose this with other work must be able to pass its own client.
 */
export async function processCycleInTransaction(
  client: PoolClient,
  cycleId: string,
): Promise<ProcessedCycle> {
  // ── 1. THE CLAIM ────────────────────────────────────────────────────────
  // Lock the cycle row for the rest of the transaction. A concurrent worker
  // blocks here, then re-evaluates `status` against the committed row.
  const claim = await client.query(
    `SELECT c.id, c.plan_id, c.cycle_number, c.status, c.pricing_snapshot_id,
            p.status AS plan_status, p.user_id, p.currency, p.shipping_address_id,
            p.shipping_address, p.notes
       FROM velrepeat_cycles c
       JOIN velrepeat_plans p ON p.id = c.plan_id
      WHERE c.id = $1
      FOR UPDATE OF c`,
    [cycleId],
  );
  const cycle = claim.rows[0];
  if (!cycle) {
    return {
      cycleId,
      outcome: "already_terminal",
      orderIds: [],
      detail: "cycle not found",
    };
  }
  if (cycle.status !== "scheduled") {
    // The exactly-once answer. A worker that arrives second, or a retry after
    // a success, stops here having written nothing.
    return {
      cycleId,
      outcome: "already_claimed",
      orderIds: [],
      detail: `cycle ${cycle.cycle_number} is ${cycle.status}`,
    };
  }
  if (cycle.plan_status !== "active") {
    // A draft or cancelled plan never generates orders. The V1 scheduler's
    // equivalent guard is its `status = 'active'` due query; this is the same
    // rule on the cycle axis.
    return {
      cycleId,
      outcome: "plan_not_active",
      orderIds: [],
      detail: `plan is ${cycle.plan_status}`,
    };
  }
  if (!cycle.pricing_snapshot_id) {
    return markRefusal(
      client,
      cycle,
      "snapshot_missing",
      "cycle has no pricing snapshot",
    );
  }

  const moved = await client.query(
    `UPDATE velrepeat_cycles
        SET status = 'processing', started_at = NOW(), updated_at = NOW()
      WHERE id = $1 AND status = 'scheduled'
      RETURNING id`,
    [cycleId],
  );
  if ((moved.rowCount ?? 0) === 0) {
    return { cycleId, outcome: "already_claimed", orderIds: [], detail: "claim lost" };
  }

  // ── 2. WHAT THIS CYCLE DELIVERS — from the frozen snapshot ──────────────
  const snapshotId = String(cycle.pricing_snapshot_id);
  const lines = await readSnapshotLines(client, snapshotId, String(cycle.plan_id));

  if (lines.length === 0) {
    return markRefusal(
      client,
      cycle,
      "item_unavailable",
      "pricing snapshot records no deliverable lines",
    );
  }

  // A product that no longer exists / is no longer published, a variant that is
  // gone or inactive, or a line whose plan composition can no longer be
  // attributed to a shop, is a DETERMINISTIC refusal: retrying cannot fix it,
  // so it must not be retried forever.
  //
  // The shop check is not cosmetic. `velrepeat_items.shop_id` is NOT NULL, so a
  // null means the composition row is gone; an order inserted without a shop
  // would also fall OUTSIDE the `(cycle, shop)` unique index, which silently
  // removes the database half of the exactly-once guarantee. Refusing is the
  // only response that keeps the invariant true.
  for (const line of lines) {
    if (!line.product_id || line.product_status === null) {
      return markRefusal(client, cycle, "item_unavailable", "product no longer exists");
    }
    if (line.product_status !== SELLABLE_PRODUCT_STATUS) {
      return markRefusal(
        client,
        cycle,
        "item_unavailable",
        `product is ${line.product_status}`,
      );
    }
    if (!line.shop_id) {
      return markRefusal(
        client,
        cycle,
        "item_unavailable",
        "line can no longer be attributed to a shop",
      );
    }
    if (line.variant_id && line.variant_status !== ACTIVE_VARIANT_STATUS) {
      return markRefusal(
        client,
        cycle,
        "item_unavailable",
        `variant is ${line.variant_status ?? "missing"}`,
      );
    }
  }

  // ── 3. ORDER GENERATION, ONE ORDER PER SHOP ─────────────────────────────
  // Decision Q17: a plan may span sellers, and a cycle splits into one order
  // per seller. The representable key on the canonical `orders` row is
  // `shop_id` (there is no `seller_id` column on `orders` or `order_items`),
  // so the split is by shop — which is also exactly the key the unique index
  // on `(velrepeat_cycle_id, shop_id)` constrains.
  //
  // A SAVEPOINT keeps a business refusal from discarding the claim already
  // taken above: stock trouble ends the cycle as `out_of_stock` and still
  // commits that terminal state, instead of rolling back into an endless retry
  // of a cycle that can never succeed. Everything after it is rolled back to
  // the savepoint, so a refusal leaves NO half-written order and NO stranded
  // inventory hold.
  await client.query("SAVEPOINT cycle_order_build");
  const orderIds: string[] = [];
  try {
    const byShop = new Map<string, SnapshotLine[]>();
    for (const line of lines) {
      const key = line.shop_id as string;
      byShop.set(key, [...(byShop.get(key) ?? []), line]);
    }

    for (const [shopId, shopLines] of byShop) {
      // Money comes from the snapshot's own line totals, summed in PostgreSQL
      // over EXACTLY this shop's line ids. It is a NUMERIC sum, so no float
      // ever touches this figure, and no current product price is consulted —
      // the customer prepaid the snapshot, not today's catalog.
      const orderTotal = await sumShopLineTotal(
        client,
        snapshotId,
        shopLines.map((line) => line.line_id),
      );

      // The public order number. A cycle order is a real order the customer
      // tracks, quotes to support and a seller fulfils, so it carries the same
      // numeric-only number as a cart order — generated here, server-side, and
      // retried on the ONE collision the unique index can raise. Retrying
      // inside the SAVEPOINT above keeps a collision from discarding the cycle
      // claim taken before it.
      let orderRes;
      for (let attempt = 1; ; attempt += 1) {
        await client.query("SAVEPOINT cycle_order_number_attempt");
        try {
          orderRes = await client.query(
            // GROUP A of the order-state migration (P0-1): a cycle order records
            // ALL THREE axes and derives the legacy `status` from them, through
            // the ONE order-state authority — never as a fourth opinion.
            `INSERT INTO orders
               (user_id, shop_id, order_number, status, order_state, fulfillment_status, subtotal, total_amount, currency,
                shipping_address_id, shipping_address, notes, velrepeat_cycle_id)
             VALUES ($1, $2, $3, $10, $11, $12, $4, $4, $5, $6, $7, $8, $9)
             RETURNING id`,
            [
              cycle.user_id,
              shopId,
              generateOrderNumber(),
              orderTotal,
              cycle.currency ?? "THB",
              cycle.shipping_address_id ?? null,
              cycle.shipping_address ?? null,
              `VelRepeat cycle ${cycle.cycle_number} of plan ${cycle.plan_id}`,
              cycle.id,
              projectOrderStatus({ paymentState: "unpaid", ...NEW_ORDER_AXES }),
              NEW_ORDER_AXES.orderState,
              NEW_ORDER_AXES.fulfillmentStatus,
            ],
          );
          await client.query("RELEASE SAVEPOINT cycle_order_number_attempt");
          break;
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT cycle_order_number_attempt");
          if (attempt >= 5 || !isOrderNumberCollision(err)) throw err;
        }
      }
      const orderId = String(orderRes.rows[0].id);
      orderIds.push(orderId);

      for (const line of shopLines) {
        await client.query(
          `INSERT INTO order_items
             (order_id, product_id, shop_id, variant_id, product_name_snapshot,
              variant_name_snapshot, image_url_snapshot, product_name,
              quantity, price, subtotal)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            orderId,
            line.product_id,
            shopId,
            line.variant_id ?? null,
            // Name and image are a DESCRIPTION snapshot taken now; they are
            // not money and never change what the customer prepaid.
            line.product_name ?? "",
            null,
            line.image_url ?? null,
            line.product_name ?? "",
            line.quantity,
            line.unit_price,
            line.line_total,
          ],
        );

        // The canonical checkout reservation, per cycle. Variant stock is
        // decremented under the same guarded UPDATE `routes/cart.ts` uses;
        // a non-variant product holds units on its `inventory` row. Both
        // throw when the hold cannot be made, which the savepoint above turns
        // into a terminal `out_of_stock` with no order and no stranded hold.
        if (line.variant_id) {
          const upd = await client.query(
            `UPDATE product_variants
                SET stock = stock - $1, updated_at = NOW()
              WHERE id = $2 AND stock >= $1
              RETURNING id`,
            [line.quantity, line.variant_id],
          );
          if (upd.rows.length === 0) {
            throw new Error(`INSUFFICIENT_STOCK: variant ${line.variant_id}`);
          }
        } else {
          await reserveInventoryStock(client, line.product_id as string, line.quantity);
        }
      }
      // NO payment row: Q14. NO commitOrderInventory: the hold stays a hold
      // until the canonical settlement path can prove money settled.
      // NO sold_count write: Q2's recognition moment is still open.
    }

    await client.query("RELEASE SAVEPOINT cycle_order_build");
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT cycle_order_build");
    const message = error instanceof Error ? error.message : String(error);
    return markRefusal(client, cycle, "out_of_stock", message);
  }

  // ── 4. THE ORDER EXISTS — NOW THE CYCLE MAY SAY SO ──────────────────────
  // Reached only when the order rows above committed, so "cycle is `ordered`"
  // and "an order identity exists" are the same statement.
  const marked = await client.query(
    `UPDATE velrepeat_cycles
        SET status = 'ordered',
            metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{orderIds}', $2::jsonb),
            updated_at = NOW()
      WHERE id = $1 AND status = 'processing'
      RETURNING id`,
    [cycleId, JSON.stringify(orderIds)],
  );
  if ((marked.rowCount ?? 0) === 0) {
    // The cycle left `processing` under us inside our own transaction, which
    // no writer does. Rolling back is the honest response: an order exists
    // that no cycle accounts for.
    throw new Error(`CYCLE_STATE_LOST: cycle ${cycleId} left processing during order build`);
  }

  await client.query(
    `INSERT INTO velrepeat_events (plan_id, event_type, metadata)
     VALUES ($1, 'CYCLE_ORDERED', $2::jsonb)`,
    [
      cycle.plan_id,
      JSON.stringify({
        cycle_id: cycleId,
        cycle_number: cycle.cycle_number,
        pricing_snapshot_id: snapshotId,
        order_ids: orderIds,
        order_count: orderIds.length,
      }),
    ],
  );

  console.log(
    `[velrepeat-v2] cycle ${cycle.cycle_number} of plan ${cycle.plan_id} → order(s) ${orderIds.join(", ")}`,
  );
  return { cycleId, outcome: "ordered", orderIds, detail: null };
}

/**
 * Find every cycle that is due and process it, each in its OWN transaction.
 *
 * The candidate list is read WITHOUT a lock and the real claim happens per
 * cycle inside `processCycle`, so a long due-list read never holds a row lock
 * and a worker that loses a race simply gets `already_claimed` and moves on.
 * One transaction per cycle is deliberate: a single bad cycle must not roll
 * back the orders of the cycles that already succeeded.
 *
 * `now` is injectable so a caller (and the tests) can evaluate "due" against a
 * fixed instant instead of wall-clock time.
 */
export async function processDueCycles(
  options: { readonly limit?: number; readonly now?: Date } = {},
): Promise<CycleRunReport> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 500));
  const now = options.now ?? new Date();
  const due = await query(
    `SELECT c.id
       FROM velrepeat_cycles c
       JOIN velrepeat_plans p ON p.id = c.plan_id
      WHERE c.status = 'scheduled'
        AND c.scheduled_at <= $2
        AND p.status = 'active'
      ORDER BY c.scheduled_at ASC
      LIMIT $1`,
    [limit, now.toISOString()],
  );

  const processed: ProcessedCycle[] = [];
  for (const row of due.rows) {
    processed.push(await processCycle(String(row.id)));
  }
  return { due: due.rows.length, processed };
}

/** The plan's cycles in schedule order. Read-only; never mutates. */
export async function readPlanCycles(
  planId: string,
): Promise<
  Array<{
    id: string;
    cycle_number: number;
    status: string;
    scheduled_at: string;
    started_at: string | null;
    completed_at: string | null;
    pricing_snapshot_id: string | null;
  }>
> {
  const res = await query(
    `SELECT id, cycle_number, status, scheduled_at, started_at, completed_at, pricing_snapshot_id
       FROM velrepeat_cycles
      WHERE plan_id = $1
      ORDER BY cycle_number ASC`,
    [planId],
  );
  return res.rows as never;
}

// ─── internals ────────────────────────────────────────────────────────────

/** One cycle row by `(plan_id, cycle_number)`, used for the ON CONFLICT path. */
async function readCycleRow(
  client: PoolClient,
  planId: string,
  cycleNumber: number,
): Promise<Record<string, unknown> | null> {
  const res = await client.query(
    `SELECT id, cycle_number, scheduled_at, pricing_snapshot_id
       FROM velrepeat_cycles
      WHERE plan_id = $1 AND cycle_number = $2`,
    [planId, cycleNumber],
  );
  return (res.rows[0] as Record<string, unknown> | undefined) ?? null;
}

/**
 * The immutable snapshot lines for a cycle, joined to the plan composition
 * only for the SHOP that fulfils each line.
 *
 * Money and quantity are read from `velrepeat_pricing_snapshot_items` and
 * never from `products.price`. The live join supplies only catalog STATE (does
 * the product/variant still exist and is it sellable) and the descriptive
 * name/image the canonical `order_items` columns require.
 *
 * `DISTINCT ON (i.id)` is belt-and-braces. The canonical schema DOES constrain
 * `velrepeat_items` to one row per `(plan_id, product_id, variant_id)` per
 * partial index (`idx_velrepeat_items_unique_variant` for variant lines,
 * `idx_velrepeat_items_unique_no_variant` for the rest), so the join cannot
 * fan out today. `DISTINCT ON` guarantees one row per snapshot line anyway, so
 * relaxing that constraint later can never silently duplicate an order line or
 * double-charge a shop total. The join is also scoped by `plan_id` so another
 * customer's plan holding the same product can never leak in.
 *
 * The join deliberately matches on product and variant ONLY. It must NOT also
 * match on quantity or price: the snapshot is the FROZEN, commitment-DISCOUNTED
 * price, while `velrepeat_items.unit_price` is the plan's base price. The two
 * differ whenever a commitment discount applies — which is the normal case —
 * and matching on them would drop the line, leave its shop unattributed, and
 * refuse a perfectly deliverable cycle.
 */
async function readSnapshotLines(
  client: PoolClient,
  snapshotId: string,
  planId: string,
): Promise<SnapshotLine[]> {
  const res = await client.query(
    `SELECT DISTINCT ON (i.id)
            i.id AS line_id,
            i.product_id, i.variant_id, i.quantity, i.unit_price, i.line_total,
            vi.shop_id,
            p.name AS product_name, p.status AS product_status,
            (SELECT pi.url FROM product_images pi
              WHERE pi.product_id = p.id
              ORDER BY pi.sort_order ASC, pi.id ASC LIMIT 1) AS image_url,
            pv.status AS variant_status
       FROM velrepeat_pricing_snapshot_items i
       LEFT JOIN velrepeat_items vi
              ON vi.plan_id = $2
             AND vi.product_id = i.product_id
             AND vi.variant_id IS NOT DISTINCT FROM i.variant_id
       LEFT JOIN products p ON p.id = i.product_id
       LEFT JOIN product_variants pv ON pv.id = i.variant_id
      WHERE i.snapshot_id = $1
      ORDER BY i.id ASC, vi.id ASC`,
    [snapshotId, planId],
  );
  return res.rows as SnapshotLine[];
}

/**
 * The one shop's money, summed from the snapshot by EXACT line identity.
 *
 * Summing `line_total` over `id = ANY(...)` cannot over-count the way a join on
 * `product_id` would, and it is a NUMERIC sum performed by PostgreSQL, so no
 * float arithmetic is involved anywhere in the order total.
 */
async function sumShopLineTotal(
  client: PoolClient,
  snapshotId: string,
  lineIds: readonly string[],
): Promise<string> {
  if (lineIds.length === 0) return "0";
  const res = await client.query(
    `SELECT COALESCE(SUM(line_total), 0)::text AS total
       FROM velrepeat_pricing_snapshot_items
      WHERE snapshot_id = $1 AND id = ANY($2::uuid[])`,
    [snapshotId, lineIds as string[]],
  );
  return String(res.rows[0]?.total ?? "0");
}

/**
 * End a cycle in a deterministic refusal state.
 *
 * The cycle is moved off `processing` to a TERMINAL status and an event is
 * recorded, but NO order exists — so "the cycle is not `ordered`" and "no order
 * identity exists" are the same statement. What happens NEXT to such a cycle
 * (postpone, substitute, credit, refund) is owner decision F and Phase 9; this
 * phase records the refusal and stops, rather than inventing a monetary policy.
 *
 * `snapshot_missing` maps to `item_unavailable` rather than `out_of_stock`:
 * an unpriceable cycle has nothing to deliver, and labelling it "out of stock"
 * would assert a stock fact that was never checked.
 */
async function markRefusal(
  client: PoolClient,
  cycle: { id: string; plan_id: string; cycle_number: number },
  outcome: Extract<
    CycleOutcome,
    "out_of_stock" | "item_unavailable" | "snapshot_missing"
  >,
  detail: string,
): Promise<ProcessedCycle> {
  const status: CycleStatus = outcome === "out_of_stock" ? "out_of_stock" : "item_unavailable";
  await client.query(
    `UPDATE velrepeat_cycles
        SET status = $2,
            metadata = jsonb_set(COALESCE(metadata, '{}'::jsonb), '{refusal}', to_jsonb($3::text)),
            updated_at = NOW()
      WHERE id = $1 AND status IN ('scheduled', 'processing')`,
    [cycle.id, status, detail],
  );
  await client.query(
    `INSERT INTO velrepeat_events (plan_id, event_type, metadata)
     VALUES ($1, $2, $3::jsonb)`,
    [
      cycle.plan_id,
      `CYCLE_${status.toUpperCase()}`,
      JSON.stringify({ cycle_id: cycle.id, outcome, detail }),
    ],
  );
  console.warn(
    `[velrepeat-v2] cycle ${cycle.cycle_number} of plan ${cycle.plan_id} refused: ${outcome} (${detail})`,
  );
  return { cycleId: cycle.id, outcome, orderIds: [], detail };
}
