import type { IDatabaseClient } from "../../core/database/db-client.js";
import type { CreateOrderData, OrderDetailRecord, OrderListFilter, OrderRecord } from "./types.js";
import type { OrderStatus } from "@velnox/api-contract";

export interface IOrderRepository {
  createOrders(orders: CreateOrderData[]): Promise<OrderDetailRecord[]>;
  getOrderById(id: string): Promise<OrderDetailRecord | null>;
  getOrderByNumber(orderNumber: string): Promise<OrderDetailRecord | null>;
  listOrders(filter: OrderListFilter): Promise<{ orders: OrderDetailRecord[]; total: number }>;
  updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    extraUpdates?: { cancellationReason?: string; paidAt?: string; shippedAt?: string; deliveredAt?: string },
  ): Promise<OrderDetailRecord>;
}

export class NeonOrderRepository implements IOrderRepository {
  constructor(private readonly db: IDatabaseClient) {}

  async createOrders(orders: CreateOrderData[]): Promise<OrderDetailRecord[]> {
    return this.db.transaction(async (tx: IDatabaseClient) => {
      const createdOrders: OrderDetailRecord[] = [];
      const now = new Date().toISOString();

      for (const ord of orders) {
        const orderId = crypto.randomUUID();

        // 1. Insert order
        await tx.query(
          `INSERT INTO orders (id, order_number, user_id, shop_id, status, total_amount, shipping_fee, discount_amount,
                               currency, shipping_address, payment_method, payment_status, notes, created_at, updated_at)
           VALUES ($1, $2, $3, $4, 'pending_payment', $5, $6, $7, $8, $9, $10, 'unpaid', $11, $12, $12)`,
          [
            orderId,
            ord.orderNumber,
            ord.userId,
            ord.shopId,
            ord.totalAmountSatang,
            ord.shippingFeeSatang || 0,
            ord.discountAmountSatang || 0,
            ord.currency || "THB",
            JSON.stringify(ord.shippingAddress),
            ord.paymentMethod,
            ord.notes || null,
            now,
          ],
        );

        // 2. Insert items
        const items = [];
        for (const it of ord.items) {
          const itemId = crypto.randomUUID();
          await tx.query(
            `INSERT INTO order_items (id, order_id, product_id, variant_id, product_name, variant_name, unit_price, quantity, subtotal, image_url, created_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              itemId,
              orderId,
              it.productId,
              it.variantId || null,
              it.productName,
              it.variantName || null,
              it.unitPriceSatang,
              it.quantity,
              it.subtotalSatang,
              it.imageUrl || null,
              now,
            ],
          );
          items.push({
            id: itemId,
            orderId,
            productId: it.productId,
            variantId: it.variantId || null,
            productName: it.productName,
            variantName: it.variantName || null,
            unitPrice: it.unitPriceSatang,
            quantity: it.quantity,
            subtotal: it.subtotalSatang,
            imageUrl: it.imageUrl || null,
            createdAt: now,
          });
        }

        createdOrders.push({
          id: orderId,
          orderNumber: ord.orderNumber,
          userId: ord.userId,
          shopId: ord.shopId,
          status: "pending_payment",
          totalAmount: ord.totalAmountSatang,
          shippingFee: ord.shippingFeeSatang || 0,
          discountAmount: ord.discountAmountSatang || 0,
          currency: ord.currency || "THB",
          shippingAddress: ord.shippingAddress,
          paymentMethod: ord.paymentMethod,
          paymentStatus: "unpaid",
          notes: ord.notes || null,
          createdAt: now,
          updatedAt: now,
          items,
        });
      }

      return createdOrders;
    });
  }

  async getOrderById(id: string): Promise<OrderDetailRecord | null> {
    const res = await this.db.query<any>(
      `SELECT o.id, o.order_number as "orderNumber", o.user_id as "userId", o.shop_id as "shopId",
              s.name as "shopName", o.status, o.total_amount as "totalAmount", o.shipping_fee as "shippingFee",
              o.discount_amount as "discountAmount", o.currency, o.shipping_address as "shippingAddress",
              o.payment_method as "paymentMethod", o.payment_status as "paymentStatus", o.notes,
              o.paid_at as "paidAt", o.shipped_at as "shippedAt", o.delivered_at as "deliveredAt",
              o.cancelled_at as "cancelledAt", o.cancellation_reason as "cancellationReason",
              o.created_at as "createdAt", o.updated_at as "updatedAt"
       FROM orders o
       LEFT JOIN shops s ON o.shop_id = s.id
       WHERE o.id = $1`,
      [id],
    );
    if (res.rows.length === 0) return null;
    const order = res.rows[0];

    const itemsRes = await this.db.query<any>(
      `SELECT id, order_id as "orderId", product_id as "productId", variant_id as "variantId",
              product_name as "productName", variant_name as "variantName", unit_price as "unitPrice",
              quantity, subtotal, image_url as "imageUrl", created_at as "createdAt"
       FROM order_items WHERE order_id = $1`,
      [id],
    );

    return {
      ...order,
      items: itemsRes.rows,
    };
  }

  async getOrderByNumber(orderNumber: string): Promise<OrderDetailRecord | null> {
    const res = await this.db.query<any>(
      `SELECT id FROM orders WHERE order_number = $1`,
      [orderNumber],
    );
    if (res.rows.length === 0) return null;
    return this.getOrderById(res.rows[0].id);
  }

  async listOrders(filter: OrderListFilter): Promise<{ orders: OrderDetailRecord[]; total: number }> {
    const conditions: string[] = [];
    const params: any[] = [];
    let idx = 1;

    if (filter.userId) {
      conditions.push(`o.user_id = $${idx++}`);
      params.push(filter.userId);
    }
    if (filter.shopId) {
      conditions.push(`o.shop_id = $${idx++}`);
      params.push(filter.shopId);
    }
    if (filter.status) {
      conditions.push(`o.status = $${idx++}`);
      params.push(filter.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const countRes = await this.db.query<any>(
      `SELECT COUNT(*)::int as count FROM orders o ${whereClause}`,
      params,
    );
    const total = countRes.rows[0]?.count || 0;

    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 20;
    const offset = (page - 1) * limit;

    const listQuery = `
      SELECT o.id, o.order_number as "orderNumber", o.user_id as "userId", o.shop_id as "shopId",
             s.name as "shopName", o.status, o.total_amount as "totalAmount", o.shipping_fee as "shippingFee",
             o.discount_amount as "discountAmount", o.currency, o.shipping_address as "shippingAddress",
             o.payment_method as "paymentMethod", o.payment_status as "paymentStatus", o.notes,
             o.paid_at as "paidAt", o.shipped_at as "shippedAt", o.delivered_at as "deliveredAt",
             o.cancelled_at as "cancelledAt", o.cancellation_reason as "cancellationReason",
             o.created_at as "createdAt", o.updated_at as "updatedAt"
      FROM orders o
      LEFT JOIN shops s ON o.shop_id = s.id
      ${whereClause}
      ORDER BY o.created_at DESC
      LIMIT $${idx} OFFSET $${idx + 1}
    `;
    params.push(limit, offset);

    const ordersRes = await this.db.query<any>(listQuery, params);
    const orders: OrderDetailRecord[] = [];

    for (const ord of ordersRes.rows) {
      const itemsRes = await this.db.query<any>(
        `SELECT id, order_id as "orderId", product_id as "productId", variant_id as "variantId",
                product_name as "productName", variant_name as "variantName", unit_price as "unitPrice",
                quantity, subtotal, image_url as "imageUrl", created_at as "createdAt"
         FROM order_items WHERE order_id = $1`,
        [ord.id],
      );
      orders.push({
        ...ord,
        items: itemsRes.rows,
      });
    }

    return { orders, total };
  }

  async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    extraUpdates?: { cancellationReason?: string; paidAt?: string; shippedAt?: string; deliveredAt?: string },
  ): Promise<OrderDetailRecord> {
    const updates: string[] = ["status = $1", "updated_at = NOW()"];
    const params: any[] = [status];
    let idx = 2;

    if (extraUpdates?.cancellationReason) {
      updates.push(`cancellation_reason = $${idx++}`);
      params.push(extraUpdates.cancellationReason);
      updates.push(`cancelled_at = NOW()`);
    }
    if (extraUpdates?.paidAt) {
      updates.push(`paid_at = $${idx++}`);
      params.push(extraUpdates.paidAt);
      updates.push(`payment_status = 'paid'`);
    }
    if (extraUpdates?.shippedAt) {
      updates.push(`shipped_at = $${idx++}`);
      params.push(extraUpdates.shippedAt);
    }
    if (extraUpdates?.deliveredAt) {
      updates.push(`delivered_at = $${idx++}`);
      params.push(extraUpdates.deliveredAt);
    }

    params.push(orderId);
    await this.db.query(
      `UPDATE orders SET ${updates.join(", ")} WHERE id = $${idx}`,
      params,
    );

    const updated = await this.getOrderById(orderId);
    if (!updated) throw new Error("Order not found after status update");
    return updated;
  }
}

export class MockOrderRepository implements IOrderRepository {
  private orders: Map<string, OrderDetailRecord> = new Map();

  async createOrders(orders: CreateOrderData[]): Promise<OrderDetailRecord[]> {
    const createdList: OrderDetailRecord[] = [];
    const now = new Date().toISOString();

    for (const ord of orders) {
      const orderId = `ord-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const items = ord.items.map((it, idx) => ({
        id: `oi-${orderId}-${idx + 1}`,
        orderId,
        productId: it.productId,
        variantId: it.variantId || null,
        productName: it.productName,
        variantName: it.variantName || null,
        unitPrice: it.unitPriceSatang,
        quantity: it.quantity,
        subtotal: it.subtotalSatang,
        imageUrl: it.imageUrl || null,
        createdAt: now,
      }));

      const record: OrderDetailRecord = {
        id: orderId,
        orderNumber: ord.orderNumber,
        userId: ord.userId,
        shopId: ord.shopId,
        shopName: "Velnox Official Flagship",
        status: "pending_payment",
        totalAmount: ord.totalAmountSatang,
        shippingFee: ord.shippingFeeSatang || 0,
        discountAmount: ord.discountAmountSatang || 0,
        currency: ord.currency || "THB",
        shippingAddress: ord.shippingAddress,
        paymentMethod: ord.paymentMethod,
        paymentStatus: "unpaid",
        notes: ord.notes || null,
        createdAt: now,
        updatedAt: now,
        items,
      };

      this.orders.set(orderId, record);
      createdList.push(record);
    }

    return createdList;
  }

  async getOrderById(id: string): Promise<OrderDetailRecord | null> {
    return this.orders.get(id) || null;
  }

  async getOrderByNumber(orderNumber: string): Promise<OrderDetailRecord | null> {
    return Array.from(this.orders.values()).find((o) => o.orderNumber === orderNumber) || null;
  }

  async listOrders(filter: OrderListFilter): Promise<{ orders: OrderDetailRecord[]; total: number }> {
    let list = Array.from(this.orders.values());

    if (filter.userId) {
      list = list.filter((o) => o.userId === filter.userId);
    }
    if (filter.shopId) {
      list = list.filter((o) => o.shopId === filter.shopId);
    }
    if (filter.status) {
      list = list.filter((o) => o.status === filter.status);
    }

    const total = list.length;
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 20;
    const offset = (page - 1) * limit;

    return {
      orders: list.slice(offset, offset + limit),
      total,
    };
  }

  async updateOrderStatus(
    orderId: string,
    status: OrderStatus,
    extraUpdates?: { cancellationReason?: string; paidAt?: string; shippedAt?: string; deliveredAt?: string },
  ): Promise<OrderDetailRecord> {
    const ord = this.orders.get(orderId);
    if (!ord) throw new Error("Order not found");

    ord.status = status;
    ord.updatedAt = new Date().toISOString();

    if (extraUpdates?.cancellationReason) {
      ord.cancellationReason = extraUpdates.cancellationReason;
      ord.cancelledAt = new Date().toISOString();
    }
    if (extraUpdates?.paidAt) {
      ord.paidAt = extraUpdates.paidAt;
      ord.paymentStatus = "paid";
    }
    if (extraUpdates?.shippedAt) {
      ord.shippedAt = extraUpdates.shippedAt;
    }
    if (extraUpdates?.deliveredAt) {
      ord.deliveredAt = extraUpdates.deliveredAt;
    }

    return ord;
  }
}
