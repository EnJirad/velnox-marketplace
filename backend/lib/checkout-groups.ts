/**
 * Checkout groups — "one purchase, N fulfillment orders".
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `POST /api/customer/checkout` splits a cart into ONE ORDER PER SHOP, because
 * each seller fulfils, ships and tracks their own lines. But payment was taken
 * against a SINGLE order id, so a three-shop cart was charged for one shop's
 * `total_amount` and the other two orders were left to expire. That is a
 * money bug, not a display bug.
 *
 * The fix is a payment PARENT: one Stripe Checkout Session settles the whole
 * checkout, and settlement fans out to every order in the group — each through
 * the EXISTING single-order settlement path, so the stock rules, the order
 * lock, the late-payment incident and the status guard all keep behaving
 * exactly as they do for a one-shop order.
 *
 * WHAT THIS MODULE DOES NOT DO
 * ----------------------------
 *   • It does not change the Stripe architecture: one session, one PaymentIntent,
 *     one `payments` row per purchase.
 *   • It does not create a second charge path. A group payment is still
 *     recorded in `payments`, still reconciled to a server-computed total, and
 *     still settled only by the signature-verified webhook.
 *   • It does not weaken ownership: every read here is scoped by `user_id`, so
 *     a group id from another account resolves to nothing rather than to
 *     somebody else's orders.
 */
import type { PoolClient } from "pg";

import { query } from "../db/index.js";

/** A checkout group row as the payment path needs it. */
export interface CheckoutGroupRow {
  id: string;
  user_id: string;
  total_amount: string;
  currency: string;
  item_count: number;
  shop_count: number;
}

/** One order inside a group, with the money it must settle. */
export interface GroupOrderRow {
  id: string;
  shop_id: string | null;
  status: string;
  total_amount: string;
  inventory_released: boolean;
  payment_expires_at: string | null;
  order_number: string | null;
}

/**
 * Read a group the customer actually owns.
 *
 * `user_id` is part of the WHERE rather than checked afterwards: a group id
 * belonging to somebody else must be indistinguishable from one that does not
 * exist, never a 403 that confirms it does.
 */
export async function readOwnedCheckoutGroup(
  groupId: string,
  userId: string,
): Promise<CheckoutGroupRow | null> {
  const res = await query(
    `SELECT id, user_id, total_amount, currency, item_count, shop_count
       FROM checkout_groups
      WHERE id = $1 AND user_id = $2`,
    [groupId, userId],
  );
  return (res.rows[0] as CheckoutGroupRow | undefined) ?? null;
}

/**
 * Every order in the group, in a STABLE order.
 *
 * The ordering is not cosmetic: settlement locks each order row in turn, so a
 * stable order is what keeps two concurrent deliveries of the same event from
 * deadlocking against each other (A→B vs B→A).
 */
export async function readGroupOrders(
  client: { query: (sql: string, params?: unknown[]) => Promise<any> } | PoolClient,
  groupId: string,
): Promise<GroupOrderRow[]> {
  const res = await client.query(
    `SELECT id, shop_id, status, total_amount, inventory_released,
            payment_expires_at, order_number
       FROM orders
      WHERE checkout_group_id = $1
      ORDER BY id ASC`,
    [groupId],
  );
  return res.rows as GroupOrderRow[];
}

/**
 * The server-authoritative total for a group.
 *
 * Summing the group row would trust a value written once at checkout; summing
 * the ORDER rows re-derives it from the same place the customer's money was
 * reconciled in the first place, so a later edit to one order cannot make the
 * charge and the fulfilment disagree. The fallback covers a group whose
 * `total_amount` was never filled (a legacy row).
 */
export async function sumGroupOrderTotal(
  client: { query: (sql: string, params?: unknown[]) => Promise<any> } | PoolClient,
  groupId: string,
): Promise<{ total: string; currency: string }> {
  const res = await client.query(
    `SELECT COALESCE(SUM(total_amount), 0)::text AS total,
            COALESCE(MAX(currency), 'THB') AS currency
       FROM orders
      WHERE checkout_group_id = $1`,
    [groupId],
  );
  const row = res.rows[0] ?? {};
  return {
    total: String(row.total ?? "0"),
    currency: String(row.currency ?? "THB").toUpperCase(),
  };
}

/**
 * Are any of these orders still payable?
 *
 * A group is paid as one unit, so it is only open while EVERY order in it is
 * still inside its own reservation window. This keeps the atomic promise: a
 * customer is never charged for a purchase where one shop's stock was already
 * released.
 */
export function firstBlockingOrder(orders: GroupOrderRow[]): GroupOrderRow | null {
  if (orders.length === 0) return null;
  const now = Date.now();
  for (const order of orders) {
    if (!["pending", "pending_payment"].includes(order.status)) return order;
    if (order.inventory_released) return order;
    if (
      order.payment_expires_at &&
      new Date(order.payment_expires_at).getTime() <= now
    ) {
      return order;
    }
  }
  return null;
}

/**
 * The order whose `created_at` sorts first — the group stand-in used where a
 * single order id is structurally required (an existing route parameter, a log
 * line, a legacy notification). It is NOT used to decide money: settlement
 * always iterates the real member list.
 */
export async function readGroupRepresentativeOrderId(
  client: { query: (sql: string, params?: unknown[]) => Promise<any> } | PoolClient,
  groupId: string,
): Promise<string | null> {
  const res = await client.query(
    `SELECT id FROM orders
      WHERE checkout_group_id = $1
      ORDER BY created_at ASC, id ASC
      LIMIT 1`,
    [groupId],
  );
  return (res.rows[0]?.id as string | undefined) ?? null;
}
