/**
 * Velnox Seller Order Management Endpoints
 *
 * Customer order → seller receives order → seller views order → seller
 * updates order status. Multi-vendor safe: the checkout and VelRepeat
 * scheduler both create ONE order PER SHOP, so a seller's orders are the
 * orders containing items from that seller's shops. Every endpoint derives
 * the seller identity from the authenticated session (never from the
 * client), so sellerId spoofing is impossible.
 *
 * Endpoints:
 *   GET   /api/seller/orders              — seller's orders (paginated)
 *   GET   /api/seller/orders/:id          — seller's order detail (IDOR-safe)
 *   PATCH /api/seller/orders/:id/status   — transition order status (state machine)
 *   GET   /api/seller/subscriptions       — recurring VelRepeat plans for the seller
 *   POST  /api/subscriptions/process-due  — manually run the due-plan worker
 *
 * Authorization:
 *   - All endpoints require authentication (requireAuth).
 *   - The seller row is resolved from req.user.userId via sellers.user_id.
 *   - Only sellers with status 'approved' (or legacy 'active') may manage
 *     orders; anyone else gets 403.
 *   - Order access is scoped through order_items.shop_id → shops.seller_id,
 *     so a seller can never see or mutate another seller's order.
 *
 * FULFILMENT vs PAYMENT — the rule this module enforces
 * -----------------------------------------------------
 * The seller's status action is a FULFILMENT action; it is never a way to say
 * "the customer paid". Starting fulfilment (`pending` → `confirmed`) is gated:
 *
 *   COD                → confirmation allowed. The carrier collects, so a
 *                        `pending` payment row is the NORMAL state for COD.
 *   CARD / PROMPTPAY   → allowed only once a payment has actually SUCCEEDED
 *                        (`payments.status = 'paid'`, written by the Stripe
 *                        webhook — no seller action can mark a Stripe payment
 *                        paid, by design).
 *   no recorded method → refused. Nothing proves the money arrived, and the
 *                        customer can still pay, so the seller waits (and may
 *                        still cancel the order).
 *
 * A refusal is `409 PAYMENT_REQUIRED`. The customer details a seller is shown come
 * from the order's OWN shipping snapshot (`orders.shipping_address`) — including
 * the phone number; the account's phone is never substituted for it.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query, withTransaction } from "../db/index.js";
import { processPlan } from "../jobs/velrepeat-scheduler.js";
import { releaseOrderInventory } from "../lib/inventory.js";
import { normalizePaymentMethod } from "../lib/payment-config.js";
import { broadcast, CHANNELS } from "../realtime/index.js";

function param(req: Request, key: string): string {
  return (req.params as Record<string, string>)[key] ?? "";
}

// ─── Order status state machine (single source of truth) ─────────────────────
// Mirrors NEXT_ORDER_STATUSES in packages/shared/src/lib/commerce.ts — the
// backend enforces the same transitions so the client can never skip states.
export const SELLER_ORDER_STATUSES = [
  "pending",
  "confirmed",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
] as const;

export type SellerOrderStatus = (typeof SELLER_ORDER_STATUSES)[number];

export const SELLER_ORDER_STATUS_TRANSITIONS: Record<SellerOrderStatus, SellerOrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: ["completed"],
  completed: [],
  cancelled: [],
};

export function isSellerOrderStatus(value: unknown): value is SellerOrderStatus {
  return typeof value === "string" && (SELLER_ORDER_STATUSES as readonly string[]).includes(value);
}

/** Whether an order may move from `from` to `to` under the business rules. */
export function canTransitionOrderStatus(from: string, to: string): boolean {
  if (!isSellerOrderStatus(from) || !isSellerOrderStatus(to)) return false;
  return SELLER_ORDER_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Map a raw orders.status value to the seller-facing status set.
 * The Stripe flow writes its own lifecycle statuses ('pending_payment',
 * 'paid', 'payment_failed', 'refunded') that are NOT part of the fulfillment
 * state machine — the seller UI and `canTransitionOrderStatus()` understand
 * only the six fulfillment statuses, so a raw value must be translated before
 * it is displayed or validated.
 *
 * `refunded` is grouped with `cancelled`: stripe.ts only marks the order
 * `refunded` on a FULL refund ("a full refund is terminal for the order"), so
 * there is nothing left to fulfil — and treating it as `pending` would offer
 * the seller a transition that silently un-refunds the order's status.
 */
// ─── Fulfilment payment gate (the ONE rule) ──────────────────────────────────
// Mirrors `orderFulfillmentPaymentGate()` in packages/shared/src/lib/commerce.ts,
// which the seller UI reads to lock its own confirm button. The backend copy is
// the authority: a client that skips the UI still cannot confirm an unpaid order.

export const PAYMENT_REQUIRED_CODE = "PAYMENT_REQUIRED";

export interface FulfillmentPaymentGate {
  ok: boolean;
  /** Non-null exactly when `ok` is false. */
  code: string | null;
}

/**
 * Decide whether the recorded payment state allows starting fulfilment.
 *
 * Deliberately takes BOTH the method and the status. `pending` means "waiting for
 * the customer" on a card and "normal" on COD, so the status alone can never
 * answer this question (and `unpaid` — the value for an order with no payment row
 * at all — always blocks). The method is normalized through the canonical
 * `normalizePaymentMethod()`, so `online`, `qr` and `cash_on_delivery` are judged
 * as the rails they mean.
 */
export function sellerConfirmationPaymentGate(
  method: unknown,
  paymentStatus: unknown,
): FulfillmentPaymentGate {
  const rail = normalizePaymentMethod(method);
  const status = typeof paymentStatus === "string" ? paymentStatus.trim().toLowerCase() : "";

  // COD is settled by the carrier: fulfilment starts now, and the payment row's
  // `pending` status is the normal state for the whole delivery.
  if (rail === "COD") return { ok: true, code: null };

  return status === "paid" ? { ok: true, code: null } : { ok: false, code: PAYMENT_REQUIRED_CODE };
}

export function normalizeSellerOrderStatus(dbStatus: string): SellerOrderStatus {
  switch (dbStatus) {
    case "pending":
    case "pending_payment":
    case "paid":
      return "pending"; // awaiting seller confirmation (payment state lives in payments)
    case "confirmed":
      return "confirmed";
    case "shipped":
      return "shipped";
    case "delivered":
      return "delivered";
    case "completed":
      return "completed";
    case "cancelled":
    case "payment_failed":
    case "refunded":
    case "expired":
      // `expired` is the payment reservation window lapsing (its stock was
      // released by the expiry sweep): the seller has nothing to fulfil, and
      // falling through to `pending` would invite a confirmation of an order
      // that can never be paid.
      return "cancelled"; // nothing to fulfill
    default:
      return "pending";
  }
}

// ─── Subscription (VelRepeat plan) display mapping ───────────────────────────
// velrepeat_plans.status → the compact status the seller UI understands.
// Non-active plan states that can still recover (out_of_stock, payment_failed)
// display as paused so sellers see they are not auto-running.
export function mapPlanStatusToSubscriptionStatus(
  planStatus: string,
): "active" | "paused" | "cancelled" {
  if (planStatus === "active" || planStatus === "processing") return "active";
  if (planStatus === "cancelled" || planStatus === "completed") return "cancelled";
  return "paused"; // paused / payment_failed / out_of_stock / draft
}

/** velrepeat_plans.frequency_type → StoreSubscription.frequency. */
export function mapFrequencyType(frequencyType: string): "daily" | "weekly" | "monthly" | "custom" {
  if (frequencyType === "days") return "daily";
  if (frequencyType === "weeks") return "weekly";
  if (frequencyType === "months") return "monthly";
  return "custom";
}

// ─── HTTP error helper (used inside transactions where we must roll back) ────
class HttpError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Resolve the seller id for an authenticated user.
 * Never trusts a sellerId from the client — only the session.
 * Returns null when the user is not an approved seller.
 */
async function resolveApprovedSellerId(userId: string): Promise<string | null> {
  const res = await query(
    `SELECT id, status FROM sellers WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  const row = res.rows[0];
  if (!row) return null;
  // 'active' is tolerated for legacy rows; 011_seller_status_constraint
  // normalizes active → approved, but never trust a non-approved seller.
  if (row.status !== "approved" && row.status !== "active") return null;
  return row.id as string;
}

function parseShippingAddress(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/**
 * The order's shipping contact, taken ONLY from the checkout snapshot.
 *
 * WHY THE PROFILE IS NOT A FALLBACK: a customer may keep several addresses, each
 * with its own recipient and phone. The snapshot is the pair chosen at checkout —
 * the parcel is addressed to it — so filling a missing snapshot phone from
 * `users.phone` would print a number the customer never gave for this order, and
 * would silently rewrite an old order whenever the profile is edited. A legacy
 * order with no phone therefore reports NO phone, and the seller UI says so.
 */
function shippingContact(snapshot: Record<string, unknown> | null): { name: string | null; phone: string | null } {
  const text = (value: unknown): string | null =>
    typeof value === "string" && value.trim() ? value.trim() : null;
  return { name: text(snapshot?.recipientName), phone: text(snapshot?.phone) };
}

/**
 * Load the seller's items for one or more orders. Only items belonging to
 * the seller's shops are returned — an order that also contains another
 * seller's items only exposes this seller's portion.
 */
export async function fetchSellerItemsForOrders(
  orderIds: string[],
  sellerId: string,
): Promise<Record<string, any[]>> {
  if (orderIds.length === 0) return {};

  const itemsRes = await query(
    `SELECT oi.id, oi.order_id, oi.product_id, oi.shop_id, oi.variant_id,
            oi.quantity, oi.price, oi.subtotal,
            COALESCE(NULLIF(oi.product_name_snapshot, ''), NULLIF(oi.product_name, ''), p.name, '') AS product_name,
            oi.variant_name_snapshot AS variant_name_snapshot,
            COALESCE(oi.image_url_snapshot,
                     (SELECT url FROM product_images WHERE product_id = oi.product_id ORDER BY sort_order ASC LIMIT 1)) AS image_url,
            p.unit AS unit, p.status AS product_status, sh.seller_id AS seller_id
     FROM order_items oi
     LEFT JOIN products p ON oi.product_id = p.id
     JOIN shops sh ON oi.shop_id = sh.id
     WHERE oi.order_id = ANY($1) AND sh.seller_id = $2
     ORDER BY oi.created_at ASC`,
    [orderIds, sellerId],
  );

  // Resolve current variant labels when the purchased snapshot is missing
  // (legacy orders created before snapshots were stored).
  const variantIds = [...new Set(itemsRes.rows.map((r: any) => r.variant_id).filter(Boolean))];
  const variantLabels = new Map<string, string>();
  if (variantIds.length > 0) {
    try {
      const varRes = await query(
        `SELECT pvv.variant_id,
                (SELECT string_agg(pov.label, ' / ' ORDER BY pog.sort_order)
                 FROM product_variant_values pvv2
                 JOIN product_option_values pov ON pvv2.option_value_id = pov.id
                 JOIN product_option_groups pog ON pov.option_group_id = pog.id
                 WHERE pvv2.variant_id = pvv.variant_id) AS option_labels
         FROM product_variant_values pvv
         WHERE pvv.variant_id = ANY($1)
         GROUP BY pvv.variant_id`,
        [variantIds],
      );
      for (const row of varRes.rows) {
        if (row.option_labels) variantLabels.set(row.variant_id, row.option_labels);
      }
    } catch {
      // Variant tables may not exist on legacy databases — snapshots cover most cases.
    }
  }

  const byOrder = new Map<string, any[]>();
  for (const r of itemsRes.rows) {
    const unitPrice = parseFloat(r.price) || 0;
    const item = {
      id: r.id,
      orderId: r.order_id,
      productId: r.product_id,
      shopId: r.shop_id,
      sellerId: r.seller_id,
      variantId: r.variant_id,
      productName: r.product_name || "สินค้า",
      unit: r.unit ?? "",
      unitPrice,
      price: unitPrice,
      quantity: r.quantity,
      subtotal: parseFloat(r.subtotal) || unitPrice * r.quantity,
      commissionRate: 0,
      variantName: r.variant_name_snapshot || variantLabels.get(r.variant_id) || null,
      imageUrl: r.image_url || null,
      productStatus: r.product_status,
    };
    const list = byOrder.get(r.order_id) ?? [];
    list.push(item);
    byOrder.set(r.order_id, list);
  }
  return Object.fromEntries(byOrder);
}

/** Load shipments + tracking events for an order (defensive for legacy DBs). */
async function fetchShipmentsForOrder(orderId: string): Promise<any[]> {
  const sRes = await query(
    `SELECT id, carrier, tracking_number, status, estimated_delivery_date
     FROM shipments WHERE order_id = $1 ORDER BY created_at DESC`,
    [orderId],
  );
  const shipments = sRes.rows.map((r: any) => ({
    id: r.id,
    carrier: r.carrier,
    trackingNumber: r.tracking_number,
    status: r.status,
    estimatedDeliveryDate: r.estimated_delivery_date,
    events: [] as any[],
  }));
  if (shipments.length === 0) return shipments;
  try {
    const eventsRes = await query(
      `SELECT te.id, te.shipment_id, te.status, te.description, te.location, te.occurred_at
       FROM tracking_events te
       WHERE te.shipment_id = ANY($1)
       ORDER BY te.occurred_at ASC`,
      [shipments.map((s) => s.id)],
    );
    const byShipment = new Map<string, any[]>();
    for (const e of eventsRes.rows) {
      const list = byShipment.get(e.shipment_id) ?? [];
      list.push({
        id: e.id,
        status: e.status,
        description: e.description,
        location: e.location,
        occurredAt: e.occurred_at,
      });
      byShipment.set(e.shipment_id, list);
    }
    for (const s of shipments) s.events = byShipment.get(s.id) ?? [];
  } catch {
    // tracking_events may not exist on legacy databases.
  }
  return shipments;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export function setupSellerOrderRoutes(app: Express): void {
  // ── GET /api/seller/orders ───────────────────────────────────────────────
  // Seller's orders (paginated, stable ordering, seller-scoped).
  // Only orders containing products from the authenticated seller's shops
  // are returned; totals/items are limited to that seller's portion.
  app.get("/api/seller/orders", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerId = await resolveApprovedSellerId(req.user!.userId);
      if (!sellerId) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit as string) || 50, 1), 100);
      const offset = Math.max(parseInt(req.query.offset as string) || 0, 0);
      // Also accept page/pageSize for conventional pagination.
      const page = Math.max(parseInt(req.query.page as string) || 1, 1);
      const pageSize = Math.min(Math.max(parseInt(req.query.pageSize as string) || limit, 1), 100);
      const finalLimit = pageSize;
      const finalOffset = page > 1 ? (page - 1) * pageSize : offset;

      const statusFilter = req.query.status as string | undefined;

      let whereSql = "WHERE sh.seller_id = $1";
      const whereParams: unknown[] = [sellerId];
      if (statusFilter && isSellerOrderStatus(statusFilter)) {
        whereSql += " AND o.status = $2";
        whereParams.push(statusFilter);
      }

      const countRes = await query(
        `SELECT COUNT(DISTINCT o.id)::int AS count
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN shops sh ON oi.shop_id = sh.id
         ${whereSql}`,
        whereParams,
      );
      const total = countRes.rows[0]?.count ?? 0;

      const orderRes = await query(
        `SELECT DISTINCT o.id, o.user_id, o.order_number, o.status, o.subtotal,
                o.shipping_fee, o.discount, o.total_amount, o.currency,
                o.shipping_address, o.notes, o.created_at, o.updated_at,
                sh.name AS shop_name, sh.slug AS shop_slug,
                COALESCE((SELECT status FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1), 'unpaid') AS payment_status,
                (SELECT method FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) AS payment_method,
                COALESCE((SELECT status FROM shipments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1), 'none') AS shipping_status
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN shops sh ON oi.shop_id = sh.id
         ${whereSql}
         ORDER BY o.created_at DESC
         LIMIT $${whereParams.length + 1} OFFSET $${whereParams.length + 2}`,
        [...whereParams, finalLimit, finalOffset],
      );

      const rows = orderRes.rows;
      const orderIds = rows.map((r: any) => r.id as string);
      const itemsByOrder = await fetchSellerItemsForOrders(orderIds, sellerId);

      // Batch the ACCOUNT NAME only — the phone number a seller needs is the one
      // on the order's shipping snapshot, never the account's.
      const userIds = [...new Set(rows.map((r: any) => r.user_id).filter(Boolean))];
      const customers = new Map<string, { name: string | null }>();
      if (userIds.length > 0) {
        const uRes = await query(
          `SELECT id, name FROM users WHERE id = ANY($1)`,
          [userIds],
        );
        for (const u of uRes.rows) customers.set(u.id, { name: u.name });
      }

      const orders = rows.map((r: any) => {
        const items = itemsByOrder[r.id] ?? [];
        const customer = customers.get(r.user_id);
        const snapshot = parseShippingAddress(r.shipping_address);
        const contact = shippingContact(snapshot);
        return {
          id: r.id,
          orderNumber: r.order_number || r.id,
          parentOrderId: r.id,
          customerUserId: r.user_id,
          status: normalizeSellerOrderStatus(r.status),
          paymentStatus: r.payment_status,
          // The rail the customer chose — needed to tell "waiting for a card"
          // from "COD, nothing owed yet" (see `sellerConfirmationPaymentGate`).
          paymentMethod: r.payment_method ?? null,
          shippingStatus: r.shipping_status,
          shippingMethod: null,
          trackingNumber: null,
          subtotal: parseFloat(r.subtotal) || 0,
          discount: parseFloat(r.discount) || 0,
          shippingFee: parseFloat(r.shipping_fee) || 0,
          total: parseFloat(r.total_amount) || 0,
          currency: r.currency ?? "THB",
          addressSnapshot: snapshot,
          note: r.notes,
          shopId: r.shop_id,
          shopName: r.shop_name,
          shopSlug: r.shop_slug,
          // Recipient first (the shipping name), account name only as a label —
          // and NEVER an account phone in place of the snapshot's.
          customerName: contact.name ?? customer?.name ?? null,
          customerPhone: contact.phone,
          createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
          items,
          itemCount: items.reduce((s: number, i: any) => s + i.quantity, 0),
        };
      });

      res.json({ success: true, data: orders });
    } catch (err) {
      console.error("[seller-orders] list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch seller orders" } });
    }
  });

  // ── GET /api/seller/orders/:id ───────────────────────────────────────────
  // Seller order detail — ownership verified, IDOR-safe. Only the seller's
  // items are returned; another seller's portion of the order is never exposed.
  app.get("/api/seller/orders/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerId = await resolveApprovedSellerId(req.user!.userId);
      if (!sellerId) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }
      const orderId = param(req, "id");

      const orderRes = await query(
        `SELECT DISTINCT o.*, sh.name AS shop_name, sh.slug AS shop_slug,
                COALESCE((SELECT status FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1), 'unpaid') AS payment_status,
                (SELECT method FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1) AS payment_method,
                COALESCE((SELECT status FROM shipments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1), 'none') AS shipping_status
         FROM orders o
         JOIN order_items oi ON oi.order_id = o.id
         JOIN shops sh ON oi.shop_id = sh.id
         WHERE o.id = $1 AND sh.seller_id = $2`,
        [orderId, sellerId],
      );
      if (orderRes.rows.length === 0) {
        // Same response for unknown/foreign orders — never leak existence.
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Order not found" } });
        return;
      }
      const order = orderRes.rows[0];

      const [itemsByOrder, shipments, paymentsRes, customerRes] = await Promise.all([
        fetchSellerItemsForOrders([orderId], sellerId),
        fetchShipmentsForOrder(orderId),
        query(
          `SELECT id, method, status, amount, provider FROM payments
           WHERE order_id = $1 ORDER BY created_at DESC`,
          [orderId],
        ),
        // Account NAME only: the shipping phone comes from the order snapshot.
        query(`SELECT name FROM users WHERE id = $1`, [order.user_id]),
      ]);
      const items = itemsByOrder[orderId] ?? [];
      const customer = customerRes.rows[0];
      const snapshot = parseShippingAddress(order.shipping_address);
      const contact = shippingContact(snapshot);

      res.json({
        success: true,
        data: {
          id: order.id,
          orderNumber: order.order_number || order.id,
          parentOrderId: order.id,
          customerUserId: order.user_id,
          status: normalizeSellerOrderStatus(order.status),
          paymentStatus: order.payment_status,
          paymentMethod: order.payment_method ?? null,
          shippingStatus: order.shipping_status,
          shippingMethod: null,
          trackingNumber: shipments[0]?.trackingNumber ?? null,
          subtotal: parseFloat(order.subtotal) || 0,
          discount: parseFloat(order.discount) || 0,
          shippingFee: parseFloat(order.shipping_fee) || 0,
          total: parseFloat(order.total_amount) || 0,
          currency: order.currency ?? "THB",
          addressSnapshot: snapshot,
          note: order.notes,
          shopId: order.shop_id,
          shopName: order.shop_name,
          shopSlug: order.shop_slug,
          customerName: contact.name ?? customer?.name ?? null,
          customerPhone: contact.phone,
          createdAt: order.created_at ? new Date(order.created_at).getTime() : Date.now(),
          updatedAt: order.updated_at ? new Date(order.updated_at).getTime() : Date.now(),
          items,
          itemCount: items.reduce((s: number, i: any) => s + i.quantity, 0),
          shipments,
          payments: paymentsRes.rows.map((p: any) => ({
            id: p.id,
            method: p.method,
            status: p.status,
            amount: parseFloat(p.amount) || 0,
          })),
        },
      });
    } catch (err) {
      console.error("[seller-orders] detail error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch order" } });
    }
  });

  // ── PATCH /api/seller/orders/:id/status ──────────────────────────────────
  // Transition an order status. Backend enforces the state machine; the seller
  // must own (at least one item of) the order. Starting fulfilment is gated on
  // the payment rail (409 PAYMENT_REQUIRED for an unpaid CARD/PROMPTPAY order —
  // see `sellerConfirmationPaymentGate`), and cancelling returns the stock
  // through the canonical `releaseOrderInventory()` inside the same transaction.
  app.patch("/api/seller/orders/:id/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerId = await resolveApprovedSellerId(req.user!.userId);
      if (!sellerId) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }
      const orderId = param(req, "id");
      const status = req.body?.status;

      if (!isSellerOrderStatus(status)) {
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_STATUS",
            message: `Invalid status. Must be one of: ${SELLER_ORDER_STATUSES.join(", ")}`,
          },
        });
        return;
      }

      // Captured inside the transaction so the broadcast after COMMIT can
      // report the real previous status without a second read.
      let previousStatus = "";
      try {
        await withTransaction(async (client) => {
          // Lock the order row; re-check ownership inside the transaction.
          const orderRes = await client.query(
            `SELECT o.id, o.status, o.user_id, o.order_number
             FROM orders o WHERE o.id = $1 FOR UPDATE`,
            [orderId],
          );
          if (orderRes.rows.length === 0) {
            throw new HttpError(404, "NOT_FOUND", "Order not found");
          }
          const order = orderRes.rows[0];

          const ownRes = await client.query(
            `SELECT oi.id FROM order_items oi
             JOIN shops sh ON oi.shop_id = sh.id
             WHERE oi.order_id = $1 AND sh.seller_id = $2
             LIMIT 1`,
            [orderId, sellerId],
          );
          if (ownRes.rows.length === 0) {
            throw new HttpError(404, "NOT_FOUND", "Order not found");
          }

          // Normalize the raw DB status before validating the transition so
          // Stripe lifecycle statuses ('paid', 'pending_payment', ...) are
          // judged by their fulfillment meaning, not their raw value.
          const fromStatus = normalizeSellerOrderStatus(order.status);
          previousStatus = fromStatus;
          if (!canTransitionOrderStatus(fromStatus, status)) {
            throw new HttpError(
              400,
              "INVALID_TRANSITION",
              `Cannot change order from '${fromStatus}' to '${status}'`,
            );
          }

          // ── FULFILMENT IS GATED ON PAYMENT ────────────────────────────────
          // Starting fulfilment (`pending` → `confirmed`) is the seller's promise
          // to ship, and for a card/PromptPay order that promise may only be made
          // once the money has actually arrived. Read under the row lock taken
          // above, so a webhook that marks the payment `paid` at the same instant
          // is serialized with this decision rather than racing it. COD passes
          // unconditionally (the carrier collects), and a seller has no action
          // anywhere that could mark a Stripe payment paid — the webhook is the
          // only writer of `paid`.
          if (status === "confirmed") {
            const paymentRes = await client.query(
              `SELECT method, status FROM payments
                WHERE order_id = $1 ORDER BY created_at DESC LIMIT 1`,
              [orderId],
            );
            const payment = paymentRes.rows[0];
            const gate = sellerConfirmationPaymentGate(payment?.method, payment?.status);
            if (!gate.ok) {
              throw new HttpError(
                409,
                gate.code ?? PAYMENT_REQUIRED_CODE,
                "This order cannot be confirmed until payment is completed.",
              );
            }
          }

          await client.query(
            `UPDATE orders SET status = $1, updated_at = NOW() WHERE id = $2`,
            [status, orderId],
          );

          // Cancellation restores the stock through the ONE release path
          // (`releaseOrderInventory`) — the same function the customer cancel,
          // the payment-failure and the reservation-expiry paths use. It claims
          // the order's `inventory_released` flag atomically inside THIS
          // transaction, so a seller cancel that races a customer cancel (or a
          // retried request) restores stock at most once, and never invents a
          // second stock-adjustment system. Checkout creates ONE order per shop,
          // so the order's items are exactly this seller's items.
          if (status === "cancelled") {
            await releaseOrderInventory(client, orderId);
          }
        });
      } catch (err) {
        if (err instanceof HttpError) {
          res.status(err.status).json({ success: false, error: { code: err.code, message: err.message } });
          return;
        }
        throw err;
      }

      // Publish the transition on the ONE order channel so every other open
      // session follows it (VelCenter orders tab, the buyer's order list) —
      // this route previously reached them only through its audit event.
      try {
        broadcast(CHANNELS.ORDER_UPDATED, "order:updated", {
          orderId,
          from: previousStatus,
          to: status,
        });
      } catch { /* best-effort — a committed transition never fails on a socket error */ }

      res.json({ success: true, data: { id: orderId, status } });
    } catch (err) {
      console.error("[seller-orders] status update error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update order status" } });
    }
  });

  // ── GET /api/seller/subscriptions ────────────────────────────────────────
  // Recurring VelRepeat plans that include this seller's products. Reuses the
  // V2 velrepeat_plans/velrepeat_items tables (the real recurring engine) —
  // no duplicate subscription tables.
  app.get("/api/seller/subscriptions", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerRes = await query(
        `SELECT id, status FROM sellers WHERE user_id = $1 LIMIT 1`,
        [req.user!.userId],
      );
      const seller = sellerRes.rows[0];
      if (!seller || (seller.status !== "approved" && seller.status !== "active")) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }
      const sellerId = seller.id as string;

      const result = await query(
        `SELECT vp.id AS plan_id, vp.user_id, vp.status AS plan_status,
                vp.frequency_type, vp.interval_value, vp.next_run_at,
                vp.created_at, vp.updated_at, vp.timezone,
                vi.product_id, vi.shop_id, vi.seller_id, vi.quantity, vi.unit_price,
                p.name AS product_name,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url,
                u.name AS customer_name, u.email AS customer_email,
                to_char(vp.next_run_at AT TIME ZONE COALESCE(vp.timezone, 'Asia/Bangkok'), 'YYYY-MM-DD') AS next_order_date
         FROM velrepeat_plans vp
         JOIN velrepeat_items vi ON vi.plan_id = vp.id
         JOIN products p ON vi.product_id = p.id
         JOIN users u ON vp.user_id = u.id
         WHERE vi.seller_id = $1
           AND vp.status IN ('active', 'paused', 'processing', 'payment_failed',
                             'out_of_stock', 'cancelled', 'completed')
         ORDER BY vp.next_run_at ASC`,
        [sellerId],
      );

      const subscriptions = result.rows.map((r: any) => {
        const status = mapPlanStatusToSubscriptionStatus(r.plan_status as string);
        const frequency = mapFrequencyType(r.frequency_type as string);

        return {
          id: r.plan_id,
          customerUserId: r.user_id,
          productId: r.product_id,
          shopId: r.shop_id,
          sellerId: r.seller_id,
          quantity: r.quantity,
          unitPriceSnapshot: parseFloat(r.unit_price) || 0,
          frequency,
          intervalDays: r.interval_value,
          // Date-only value in the plan's own timezone (to_char above) — the
          // UI appends T00:00:00 when comparing, so a timezone-shifted date
          // would be off by one day. Fall back to UTC slice for legacy rows.
          nextOrderDate: r.next_order_date
            ? String(r.next_order_date)
            : r.next_run_at
              ? String(
                  (r.next_run_at instanceof Date ? r.next_run_at : new Date(r.next_run_at))
                    .toISOString()
                    .slice(0, 10),
                )
              : null,
          status,
          productName: r.product_name ?? null,
          productImageUrl: r.product_image_url ?? null,
          customerName: r.customer_name ?? null,
          customerEmail: r.customer_email ?? null,
          createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
        };
      });

      res.json({ success: true, data: subscriptions });
    } catch (err: any) {
      // velrepeat_plans may not exist on legacy databases — treat as empty.
      if (err?.code === "42P01" || String(err?.message ?? "").includes("does not exist")) {
        console.warn("[seller-orders] velrepeat_plans table not found — returning empty subscriptions");
        res.json({ success: true, data: [] });
        return;
      }
      console.error("[seller-orders] subscriptions error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch subscriptions" } });
    }
  });

  // ── POST /api/subscriptions/process-due ───────────────────────────────────
  // Manually run the due-plan worker (the same engine the VelRepeat scheduler
  // polls). Reuses processPlan from jobs/velrepeat-scheduler.ts — one order
  // per shop, idempotent runs, no duplicate subscription systems.
  app.post("/api/subscriptions/process-due", requireAuth, async (req: Request, res: Response) => {
    try {
      const sellerRes = await query(
        `SELECT id, status FROM sellers WHERE user_id = $1 LIMIT 1`,
        [req.user!.userId],
      );
      const seller = sellerRes.rows[0];
      if (!seller || (seller.status !== "approved" && seller.status !== "active")) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller access required" } });
        return;
      }

      const limit = Math.min(Math.max(parseInt(req.body?.limit as string) || 25, 1), 100);
      const due = await query(
        `SELECT id FROM velrepeat_plans
         WHERE status = 'active' AND next_run_at <= NOW()
         ORDER BY next_run_at ASC
         LIMIT $1`,
        [limit],
      );

      let created = 0;
      let skipped = 0;
      for (const row of due.rows) {
        try {
          const outcome = await processPlan(row.id as string);
          if (outcome === null) skipped++; // claimed by a concurrent worker
          else if (outcome === "success") created++;
          else skipped++; // out_of_stock / item_unavailable / payment_failed / failed
        } catch (err) {
          console.error(`[seller-orders] process-due plan ${row.id} failed:`, err);
          skipped++;
        }
      }

      res.json({ success: true, data: { created, skipped, due: due.rows.length } });
    } catch (err: any) {
      if (err?.code === "42P01" || String(err?.message ?? "").includes("does not exist")) {
        console.warn("[seller-orders] velrepeat_plans table not found — nothing to process");
        res.json({ success: true, data: { created: 0, skipped: 0, due: 0 } });
        return;
      }
      console.error("[seller-orders] process-due error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to process due subscriptions" } });
    }
  });
}