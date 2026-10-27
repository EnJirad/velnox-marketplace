/**
 * Order-scoped realtime events — the ONE publisher.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * `order:created`, `order:updated` and `shipment:updated` used to be fanned out
 * with the platform-wide `broadcast()`: every connected socket that had
 * subscribed to the channel name received `{ orderId, to }` for orders it had
 * nothing to do with, and an anonymous socket could subscribe to the very same
 * channel. Two of the three had no publisher (or no deliverable channel) at all.
 *
 * An order event is not a public feed. Its audience is exactly:
 *
 *   • the CUSTOMER who bought the order      (`orders.user_id`),
 *   • the SELLER who owns the order's shop   (`shops.seller_id → sellers.user_id`),
 *   • every connected VelCenter session      (owner/admin/staff, role resolved by
 *                                             the socket from `users.role`).
 *
 * Both halves of that audience are resolved HERE, from Neon, from the order id
 * alone — no caller passes a recipient, so no client-supplied identifier can
 * widen the audience. Delivery is then ADDRESSED (`sendToUsers` /
 * `sendToCenter`): the customer and the seller do not have to subscribe to
 * anything, and no order channel is subscribable at all (`realtime/index.ts`).
 *
 * The payload is IDENTIFIERS AND STATUS ONLY. Customer PII (name, phone,
 * address), payment secrets, provider ids and amounts never belong in one of
 * these events — the consumer's job is to re-read the authoritative row from
 * the API (Neon is the source of truth; the event is a signal).
 *
 * Delivery is best-effort and NEVER fatal: the business mutation has already
 * committed by the time this runs, so a socket or lookup failure is logged and
 * swallowed rather than turned into a failed request. There is no outbox
 * dispatcher in this repository (`outbox_events` exists as a table but has no
 * writer or drain worker), so a process crash in the window between COMMIT and
 * the publish below can lose the signal — consumers reconnect and refetch, and
 * a durable drain worker is a separate, owner-approved change.
 */
import { query } from "../db/index.js";
import { CHANNELS, sendToCenter, sendToUsers } from "../realtime/index.js";

/**
 * The three order-scoped events, taken from the ONE channel vocabulary rather
 * than re-spelled. Channel === event name for each of them.
 */
export type OrderEventName =
  | typeof CHANNELS.ORDER_CREATED
  | typeof CHANNELS.ORDER_UPDATED
  | typeof CHANNELS.SHIPMENT_UPDATED;

export interface OrderParties {
  /** The buying customer — `orders.user_id`. */
  customerId: string | null;
  /** The order's shop owner — `shops.seller_id → sellers.user_id`. */
  sellerUserId: string | null;
  /** Human-readable reference, for notification copy. */
  orderNumber: string | null;
}

/**
 * Who is entitled to this order's events, read from the DATABASE.
 *
 * `orders.shop_id` is nullable in the schema (historical rows), so the seller
 * side is a LEFT JOIN chain and a missing shop simply yields no seller — it
 * never throws and never falls back to "everyone".
 */
export async function resolveOrderParties(orderId: string): Promise<OrderParties> {
  const res = await query(
    `SELECT o.user_id AS customer_id, o.order_number,
            sl.user_id AS seller_user_id
       FROM orders o
       LEFT JOIN shops sh ON sh.id = o.shop_id
       LEFT JOIN sellers sl ON sl.id = sh.seller_id
      WHERE o.id = $1`,
    [orderId],
  );
  const row = res.rows[0];
  return {
    customerId: (row?.customer_id as string | undefined) ?? null,
    sellerUserId: (row?.seller_user_id as string | undefined) ?? null,
    orderNumber: (row?.order_number as string | undefined) ?? null,
  };
}

/**
 * Publish an order-scoped event to the order's entitled sessions.
 *
 * Call this ONLY after the authoritative mutation has committed (and only for a
 * real change): a rolled-back order must never produce an event, and a repeat
 * shipment move (`moved === false`) or a replayed checkout request must not
 * produce a second one. Never throws.
 */
export async function publishOrderEvent(
  event: OrderEventName,
  orderId: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!orderId) return;
  try {
    const parties = await resolveOrderParties(orderId);
    const recipients = [parties.customerId, parties.sellerUserId].filter(
      (id): id is string => typeof id === "string" && id.length > 0,
    );
    sendToUsers(recipients, event, event, data);
    sendToCenter(event, event, data);
  } catch (err) {
    // Delivery is a signal; a committed transition never fails on a socket error.
    console.warn(
      `[order-events] ${event} for ${orderId} could not be delivered (non-fatal):`,
      err instanceof Error ? err.message : err,
    );
  }
}
