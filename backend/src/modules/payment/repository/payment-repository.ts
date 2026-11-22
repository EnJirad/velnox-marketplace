import type { DbQueryable } from "../../../../database/src/types.ts";
import type {
  PaymentAttempt,
  PaymentStatus,
  PaymentMethodId,
  PaymentProvider,
  RefundStatus,
} from "../domain/payment.ts";

export interface CreatePaymentRowParams {
  readonly orderId?: string | null;
  readonly checkoutGroupId?: string | null;
  readonly amount: string;
  readonly currency: string;
  readonly method: PaymentMethodId;
  readonly provider: PaymentProvider;
  readonly status?: PaymentStatus;
  readonly providerCheckoutSessionId?: string | null;
  readonly providerPaymentId?: string | null;
}

export interface LockedOrderRow {
  readonly id: string;
  readonly shop_id: string;
  readonly status: string;
  readonly total_amount: string;
  readonly checkout_group_id: string | null;
  readonly inventory_released: boolean;
}

export interface OrderItemRow {
  readonly id: string;
  readonly order_id: string;
  readonly product_id: string;
  readonly variant_id: string | null;
  readonly quantity: number;
}

export class PaymentRepository {
  /**
   * Creates a payment attempt record in `payments`.
   * Enforces single-domain constraint (either order_id OR checkout_group_id).
   */
  public static async createPayment(
    db: DbQueryable,
    params: CreatePaymentRowParams,
  ): Promise<PaymentAttempt> {
    const status = params.status ?? "pending";
    const res = await db.query(
      `INSERT INTO payments (
         order_id,
         checkout_group_id,
         amount,
         currency,
         method,
         status,
         provider,
         provider_checkout_session_id,
         provider_payment_id,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
       RETURNING *;`,
      [
        params.orderId ?? null,
        params.checkoutGroupId ?? null,
        params.amount,
        params.currency,
        params.method.toLowerCase(),
        status,
        params.provider,
        params.providerCheckoutSessionId ?? null,
        params.providerPaymentId ?? null,
      ],
    );

    return this.mapPaymentRow(res.rows[0]);
  }

  public static async findPaymentById(
    db: DbQueryable,
    id: string,
  ): Promise<PaymentAttempt | null> {
    const res = await db.query(`SELECT * FROM payments WHERE id = $1 LIMIT 1;`, [id]);
    if (!res.rows || res.rows.length === 0) return null;
    return this.mapPaymentRow(res.rows[0]);
  }

  public static async findPaymentBySessionId(
    db: DbQueryable,
    sessionId: string,
  ): Promise<PaymentAttempt | null> {
    const res = await db.query(
      `SELECT * FROM payments WHERE provider_checkout_session_id = $1 ORDER BY created_at DESC LIMIT 1;`,
      [sessionId],
    );
    if (!res.rows || res.rows.length === 0) return null;
    return this.mapPaymentRow(res.rows[0]);
  }

  public static async findPaymentByProviderPaymentId(
    db: DbQueryable,
    providerPaymentId: string,
  ): Promise<PaymentAttempt | null> {
    const res = await db.query(
      `SELECT * FROM payments WHERE provider_payment_id = $1 ORDER BY created_at DESC LIMIT 1;`,
      [providerPaymentId],
    );
    if (!res.rows || res.rows.length === 0) return null;
    return this.mapPaymentRow(res.rows[0]);
  }

  public static async findPaymentForOrder(
    db: DbQueryable,
    orderId: string,
  ): Promise<PaymentAttempt | null> {
    const res = await db.query(
      `SELECT p.* FROM payments p
       WHERE p.order_id = $1
          OR (p.checkout_group_id IS NOT NULL AND p.checkout_group_id = (SELECT checkout_group_id FROM orders WHERE id = $1))
       ORDER BY
         CASE p.status
           WHEN 'refunded' THEN 1
           WHEN 'partially_refunded' THEN 2
           WHEN 'paid' THEN 3
           WHEN 'processing' THEN 4
           ELSE 5
         END ASC,
         p.created_at DESC
       LIMIT 1;`,
      [orderId],
    );
    if (!res.rows || res.rows.length === 0) return null;
    return this.mapPaymentRow(res.rows[0]);
  }

  /**
   * Atomically claims a webhook event with replay protection.
   */
  public static async claimPaymentEvent(
    db: DbQueryable,
    provider: string,
    eventId: string,
    eventType: string,
    payload: any,
  ): Promise<{ claimed: boolean; status: string; isDuplicate: boolean }> {
    const insertRes = await db.query(
      `INSERT INTO payment_events (provider, event_id, event_type, payload, status, processed_at, created_at, updated_at)
       VALUES ($1, $2, $3, $4::jsonb, 'processing', NOW(), NOW(), NOW())
       ON CONFLICT (event_id) DO NOTHING
       RETURNING id, status;`,
      [provider, eventId, eventType, JSON.stringify(payload ?? {})],
    );

    if (insertRes.rows && insertRes.rows.length > 0) {
      return { claimed: true, status: "processing", isDuplicate: false };
    }

    // Row already exists - check its status
    const existingRes = await db.query(
      `SELECT id, status FROM payment_events WHERE event_id = $1;`,
      [eventId],
    );
    const existing = existingRes.rows[0];
    if (!existing) {
      return { claimed: false, status: "unknown", isDuplicate: true };
    }

    // Re-arm failed deliveries so retry actually runs
    if (existing.status === "failed") {
      const rearmRes = await db.query(
        `UPDATE payment_events
         SET status = 'processing', error = NULL, updated_at = NOW()
         WHERE id = $1 AND status = 'failed'
         RETURNING id;`,
        [existing.id],
      );
      if (rearmRes.rows && rearmRes.rows.length > 0) {
        return { claimed: true, status: "processing", isDuplicate: false };
      }
    }

    return { claimed: false, status: existing.status, isDuplicate: true };
  }

  public static async updatePaymentEventStatus(
    db: DbQueryable,
    eventId: string,
    status: "processed" | "failed",
    error?: string | null,
  ): Promise<void> {
    await db.query(
      `UPDATE payment_events
       SET status = $2, error = $3, updated_at = NOW()
       WHERE event_id = $1;`,
      [eventId, status, error ?? null],
    );
  }

  /**
   * Lock order rows in deterministic ID sequence (id ASC) to guarantee AB-BA deadlock prevention.
   */
  public static async lockOrders(
    db: DbQueryable,
    orderIds: string[],
  ): Promise<LockedOrderRow[]> {
    if (orderIds.length === 0) return [];
    const res = await db.query(
      `SELECT id, shop_id, status, total_amount, checkout_group_id, inventory_released
       FROM orders
       WHERE id = ANY($1::uuid[])
       ORDER BY id ASC
       FOR UPDATE;`,
      [orderIds],
    );
    return res.rows as LockedOrderRow[];
  }

  public static async lockOrdersForCheckoutGroup(
    db: DbQueryable,
    checkoutGroupId: string,
  ): Promise<LockedOrderRow[]> {
    const res = await db.query(
      `SELECT id, shop_id, status, total_amount, checkout_group_id, inventory_released
       FROM orders
       WHERE checkout_group_id = $1
       ORDER BY id ASC
       FOR UPDATE;`,
      [checkoutGroupId],
    );
    return res.rows as LockedOrderRow[];
  }

  /**
   * Transitions orders to 'paid' status.
   * Only transitions orders in ('pending', 'pending_payment') with inventory_released = FALSE.
   */
  public static async markOrdersPaid(
    db: DbQueryable,
    orderIds: string[],
  ): Promise<LockedOrderRow[]> {
    if (orderIds.length === 0) return [];
    const res = await db.query(
      `UPDATE orders
       SET status = 'paid', updated_at = NOW()
       WHERE id = ANY($1::uuid[])
         AND status IN ('pending', 'pending_payment')
         AND inventory_released = FALSE
       RETURNING id, shop_id, status, total_amount, checkout_group_id, inventory_released;`,
      [orderIds],
    );
    return res.rows as LockedOrderRow[];
  }

  /**
   * Transitions orders to terminal failure ('payment_failed' or 'cancelled').
   */
  public static async markOrdersFailed(
    db: DbQueryable,
    orderIds: string[],
    newStatus: "payment_failed" | "cancelled",
  ): Promise<LockedOrderRow[]> {
    if (orderIds.length === 0) return [];
    const res = await db.query(
      `UPDATE orders
       SET status = $2, inventory_released = TRUE, updated_at = NOW()
       WHERE id = ANY($1::uuid[])
         AND status IN ('pending', 'pending_payment')
       RETURNING id, shop_id, status, total_amount, checkout_group_id, inventory_released;`,
      [orderIds, newStatus],
    );
    return res.rows as LockedOrderRow[];
  }

  public static async updatePaymentStatus(
    db: DbQueryable,
    paymentId: string,
    status: PaymentStatus,
    providerPaymentId?: string | null,
    failureCode?: string | null,
    failureMessage?: string | null,
  ): Promise<PaymentAttempt | null> {
    const res = await db.query(
      `UPDATE payments
       SET status = $2,
           provider_payment_id = COALESCE($3, provider_payment_id),
           paid_at = CASE WHEN $2 = 'paid' THEN COALESCE(paid_at, NOW()) ELSE paid_at END,
           failure_code = $4,
           failure_message = $5,
           updated_at = NOW()
       WHERE id = $1
       RETURNING *;`,
      [
        paymentId,
        status,
        providerPaymentId ?? null,
        failureCode ?? null,
        failureMessage ?? null,
      ],
    );
    if (!res.rows || res.rows.length === 0) return null;
    return this.mapPaymentRow(res.rows[0]);
  }

  public static async getOrderItems(
    db: DbQueryable,
    orderIds: string[],
  ): Promise<OrderItemRow[]> {
    if (orderIds.length === 0) return [];
    const res = await db.query(
      `SELECT id, order_id, product_id, variant_id, quantity
       FROM order_items
       WHERE order_id = ANY($1::uuid[]);`,
      [orderIds],
    );
    return res.rows as OrderItemRow[];
  }

  public static async getSellerIdForShop(
    db: DbQueryable,
    shopId: string,
  ): Promise<string | null> {
    const res = await db.query(`SELECT seller_id FROM shops WHERE id = $1 LIMIT 1;`, [shopId]);
    return res.rows[0]?.seller_id ?? null;
  }

  public static async createCommissionRecord(
    db: DbQueryable,
    orderId: string,
    sellerId: string,
    amountSatang: bigint,
    rate = 0.05,
  ): Promise<string> {
    const amountThb = (Number(amountSatang) / 100).toFixed(2);
    const res = await db.query(
      `INSERT INTO commissions (order_id, seller_id, amount, rate, created_at)
       VALUES ($1, $2, $3, $4, NOW())
       RETURNING id;`,
      [orderId, sellerId, amountThb, rate],
    );
    return res.rows[0]?.id;
  }

  public static async createSettlementRecord(
    db: DbQueryable,
    sellerId: string,
    amountSatang: bigint,
    status = "pending",
  ): Promise<string> {
    const amountThb = (Number(amountSatang) / 100).toFixed(2);
    const res = await db.query(
      `INSERT INTO settlements (seller_id, amount, status, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id;`,
      [sellerId, amountThb, status],
    );
    return res.rows[0]?.id;
  }

  public static async updateSettlementStatus(
    db: DbQueryable,
    settlementId: string,
    status: string,
  ): Promise<void> {
    await db.query(`UPDATE settlements SET status = $2 WHERE id = $1;`, [settlementId, status]);
  }

  public static async recordRefund(
    db: DbQueryable,
    params: {
      orderId?: string | null;
      paymentId?: string | null;
      checkoutGroupId?: string | null;
      amountSatang: bigint;
      status: RefundStatus;
      providerRefundId?: string | null;
    },
  ): Promise<string> {
    const amountThb = (Number(params.amountSatang) / 100).toFixed(2);
    const res = await db.query(
      `INSERT INTO refunds (
         order_id,
         payment_id,
         checkout_group_id,
         amount,
         status,
         provider_refund_id,
         created_at,
         updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id;`,
      [
        params.orderId ?? null,
        params.paymentId ?? null,
        params.checkoutGroupId ?? null,
        amountThb,
        params.status,
        params.providerRefundId ?? null,
      ],
    );
    return res.rows[0]?.id;
  }

  private static mapPaymentRow(row: any): PaymentAttempt {
    return {
      id: row.id,
      orderId: row.order_id ?? null,
      checkoutGroupId: row.checkout_group_id ?? null,
      amount: String(row.amount ?? "0.00"),
      currency: row.currency ?? "THB",
      method: (row.method ?? "card").toUpperCase() as PaymentMethodId,
      status: row.status as PaymentStatus,
      provider: row.provider as PaymentProvider,
      providerPaymentId: row.provider_payment_id ?? null,
      providerCheckoutSessionId: row.provider_checkout_session_id ?? null,
      paidAt: row.paid_at ? new Date(row.paid_at).toISOString() : null,
      refundedAmount: String(row.refunded_amount ?? "0.00"),
      refundStatus: (row.refund_status as RefundStatus) ?? null,
      failureCode: row.failure_code ?? null,
      failureMessage: row.failure_message ?? null,
      createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
      updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : new Date().toISOString(),
    };
  }
}
