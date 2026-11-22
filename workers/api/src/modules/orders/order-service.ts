import type { IOrderRepository } from "./order-repository.js";
import type { CartService } from "../cart/cart-service.js";
import type { InventoryService } from "../inventory/inventory-service.js";
import type { CheckoutInput, OrderDetail, OrderListQuery, OrderStatus, OrderSummary } from "@velnox/api-contract";
import type { CreateOrderData, OrderDetailRecord } from "./types.js";

export class OrderService {
  constructor(
    private readonly repo: IOrderRepository,
    private readonly cartService: CartService,
    private readonly inventoryService: InventoryService,
  ) {}

  async checkout(
    userId: string,
    input: CheckoutInput,
  ): Promise<{ orders: OrderDetail[]; totalSatang: number }> {
    // 1. Fetch user's cart
    const cart = await this.cartService.getCart(userId);
    if (!cart.shopGroups || cart.shopGroups.length === 0 || cart.itemCount === 0) {
      throw new Error("Cannot checkout with an empty shopping cart");
    }

    // 2. Prepare items for stock reservation
    const allReservationItems = [];
    for (const group of cart.shopGroups) {
      for (const item of group.items) {
        allReservationItems.push({
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
        });
      }
    }

    // 3. Atomically reserve inventory
    await this.inventoryService.reserveStock(allReservationItems);

    // 4. Create multi-vendor orders (1 per shopGroup)
    const orderDatas: CreateOrderData[] = [];
    let totalSatangAll = 0;

    const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, "");

    for (const group of cart.shopGroups) {
      const randomSuffix = crypto.randomUUID().slice(0, 6).toUpperCase();
      const orderNumber = `ORD-${dateStr}-${randomSuffix}`;
      const subtotalSatang = Math.round(group.shopSubtotal * 100);
      const shippingSatang = 0; // Flat or promo shipping in satang
      const totalSatang = subtotalSatang + shippingSatang;
      totalSatangAll += totalSatang;

      orderDatas.push({
        orderNumber,
        userId,
        shopId: group.shopId,
        totalAmountSatang: totalSatang,
        shippingFeeSatang: shippingSatang,
        discountAmountSatang: 0,
        currency: cart.currency || "THB",
        shippingAddress: input.shippingAddress,
        paymentMethod: input.paymentMethod,
        notes: input.notes,
        items: group.items.map((it) => ({
          productId: it.productId,
          variantId: it.variantId || null,
          productName: it.productName,
          variantName: it.variantName || null,
          unitPriceSatang: Math.round(it.unitPrice * 100),
          quantity: it.quantity,
          subtotalSatang: Math.round(it.subtotal * 100),
          imageUrl: it.imageUrl || null,
        })),
      });
    }

    const createdRecords = await this.repo.createOrders(orderDatas);

    // 5. Clear the user's cart
    await this.cartService.clearCart(userId);

    const orders = createdRecords.map((r) => this.mapOrderDetail(r));
    return { orders, totalSatang: totalSatangAll };
  }

  async getOrderById(orderId: string, userId: string, userRole: string): Promise<OrderDetail | null> {
    const record = await this.repo.getOrderById(orderId);
    if (!record) return null;

    // Authorization: User must own the order, or be staff/admin
    const isOwner = record.userId === userId;
    const isPrivileged = ["center_staff", "center_admin", "center_superadmin"].includes(userRole);

    if (!isOwner && !isPrivileged) {
      throw new Error("Forbidden: You do not have permission to view this order");
    }

    return this.mapOrderDetail(record);
  }

  async listUserOrders(
    userId: string,
    query: OrderListQuery,
  ): Promise<{ items: OrderSummary[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const pageNum = query.page !== undefined && query.page !== null ? Number(query.page) : 1;
    const limitNum = query.limit !== undefined && query.limit !== null ? Number(query.limit) : 20;
    const page = pageNum > 0 ? pageNum : 1;
    const limit = limitNum > 0 ? limitNum : 20;

    const { orders, total } = await this.repo.listOrders({
      userId,
      status: query.status,
      page,
      limit,
    });

    const totalPages = Math.ceil(total / limit) || 1;
    const items = orders.map((o) => this.mapOrderSummary(o));

    return {
      items,
      pagination: { page, limit, total, totalPages },
    };
  }

  async listShopOrders(
    shopId: string,
    query: OrderListQuery,
  ): Promise<{ items: OrderSummary[]; pagination: { page: number; limit: number; total: number; totalPages: number } }> {
    const pageNum = query.page !== undefined && query.page !== null ? Number(query.page) : 1;
    const limitNum = query.limit !== undefined && query.limit !== null ? Number(query.limit) : 20;
    const page = pageNum > 0 ? pageNum : 1;
    const limit = limitNum > 0 ? limitNum : 20;

    const { orders, total } = await this.repo.listOrders({
      shopId,
      status: query.status,
      page,
      limit,
    });

    const totalPages = Math.ceil(total / limit) || 1;
    const items = orders.map((o) => this.mapOrderSummary(o));

    return {
      items,
      pagination: { page, limit, total, totalPages },
    };
  }

  async cancelOrder(orderId: string, userId: string, reason?: string): Promise<OrderDetail> {
    const record = await this.repo.getOrderById(orderId);
    if (!record) throw new Error("Order not found");

    if (record.userId !== userId) {
      throw new Error("Forbidden: You do not own this order");
    }

    if (record.status !== "pending_payment") {
      throw new Error(`Cannot cancel order in status '${record.status}'. Only unpaid pending orders can be cancelled.`);
    }

    // Release reserved inventory
    await this.inventoryService.releaseReservation(orderId);

    const updated = await this.repo.updateOrderStatus(orderId, "cancelled", {
      cancellationReason: reason || "Cancelled by customer",
    });

    return this.mapOrderDetail(updated);
  }

  async updateOrderStatus(orderId: string, newStatus: OrderStatus): Promise<OrderDetail> {
    const record = await this.repo.getOrderById(orderId);
    if (!record) throw new Error("Order not found");

    // Validate State Transition
    this.validateStateTransition(record.status, newStatus);

    const extraUpdates: any = {};
    if (newStatus === "paid") {
      extraUpdates.paidAt = new Date().toISOString();
      await this.inventoryService.commitReservation(orderId);
    } else if (newStatus === "shipped") {
      extraUpdates.shippedAt = new Date().toISOString();
    } else if (newStatus === "delivered") {
      extraUpdates.deliveredAt = new Date().toISOString();
    } else if (newStatus === "cancelled") {
      await this.inventoryService.releaseReservation(orderId);
    }

    const updated = await this.repo.updateOrderStatus(orderId, newStatus, extraUpdates);
    return this.mapOrderDetail(updated);
  }

  private validateStateTransition(current: OrderStatus, target: OrderStatus): void {
    const allowedTransitions: Record<OrderStatus, OrderStatus[]> = {
      pending_payment: ["paid", "cancelled"],
      paid: ["processing", "cancelled", "refunded"],
      processing: ["shipped", "cancelled"],
      shipped: ["delivered"],
      delivered: ["refunded"],
      cancelled: [],
      refunded: [],
    };

    const validNextStates = allowedTransitions[current] || [];
    if (!validNextStates.includes(target)) {
      throw new Error(`Invalid order state transition from '${current}' to '${target}'`);
    }
  }

  private mapOrderSummary(r: OrderDetailRecord): OrderSummary {
    const totalSatang = typeof r.totalAmount === "bigint" ? Number(r.totalAmount) : r.totalAmount;
    const shippingSatang = typeof r.shippingFee === "bigint" ? Number(r.shippingFee) : r.shippingFee;
    const discountSatang = typeof r.discountAmount === "bigint" ? Number(r.discountAmount) : r.discountAmount;

    return {
      id: r.id,
      orderNumber: r.orderNumber,
      shopId: r.shopId,
      shopName: r.shopName || "Velnox Seller",
      status: r.status,
      totalAmount: totalSatang / 100,
      shippingFee: shippingSatang / 100,
      discountAmount: discountSatang / 100,
      currency: r.currency || "THB",
      itemCount: r.items.reduce((acc, it) => acc + it.quantity, 0),
      paymentMethod: r.paymentMethod,
      paymentStatus: r.paymentStatus,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    };
  }

  private mapOrderDetail(r: OrderDetailRecord): OrderDetail {
    const summary = this.mapOrderSummary(r);
    return {
      ...summary,
      shippingAddress: r.shippingAddress,
      notes: r.notes || undefined,
      paidAt: r.paidAt || undefined,
      shippedAt: r.shippedAt || undefined,
      deliveredAt: r.deliveredAt || undefined,
      cancelledAt: r.cancelledAt || undefined,
      cancellationReason: r.cancellationReason || undefined,
      items: r.items.map((it) => {
        const unitSatang = typeof it.unitPrice === "bigint" ? Number(it.unitPrice) : it.unitPrice;
        const subSatang = typeof it.subtotal === "bigint" ? Number(it.subtotal) : it.subtotal;
        return {
          id: it.id,
          productId: it.productId,
          variantId: it.variantId || undefined,
          productName: it.productName,
          variantName: it.variantName || undefined,
          unitPrice: unitSatang / 100,
          quantity: it.quantity,
          subtotal: subSatang / 100,
          imageUrl: it.imageUrl || undefined,
        };
      }),
    };
  }
}
