import { Hono } from "hono";
import { checkoutInputSchema, orderListQuerySchema, orderStatusSchema } from "@velnox/api-contract";
import { authMiddleware } from "../middleware/auth.js";
import { createNeonClient } from "../core/database/db-client.js";
import {
  type IOrderRepository,
  MockOrderRepository,
  NeonOrderRepository,
} from "../modules/orders/order-repository.js";
import { OrderService } from "../modules/orders/order-service.js";
import { getCartService } from "./cart.js";
import { InventoryService } from "../modules/inventory/inventory-service.js";
import type { Bindings, Variables } from "../types.js";

export const orderRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

let orderServiceInstance: OrderService | null = null;

export function getOrderService(c: any): OrderService {
  if (orderServiceInstance) return orderServiceInstance;

  const env = c.env as Bindings | undefined;
  let repo: IOrderRepository;
  let dbClient;

  if (env?.DATABASE_URL) {
    dbClient = createNeonClient(env.DATABASE_URL, env.ENVIRONMENT);
    repo = new NeonOrderRepository(dbClient);
  } else {
    repo = new MockOrderRepository();
  }

  const cartService = getCartService(c);
  const inventoryService = new InventoryService(dbClient);

  orderServiceInstance = new OrderService(repo, cartService, inventoryService);
  return orderServiceInstance;
}

export function setOrderService(service: OrderService | null) {
  orderServiceInstance = service;
}

// Protected: Order operations require authenticated user
orderRoutes.use("*", authMiddleware);

/**
 * POST /api/v1/orders/checkout
 * Checkout from shopping cart, reserve stock, and create multi-vendor orders
 */
orderRoutes.post("/checkout", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  const input = checkoutInputSchema.parse(body);

  const service = getOrderService(c);
  const result = await service.checkout(user.sub, input);

  return c.json(
    {
      success: true,
      data: result,
    },
    201,
  );
});

/**
 * GET /api/v1/orders
 * List orders for current user
 */
orderRoutes.get("/", async (c) => {
  const user = c.get("user");
  const query = c.req.query();
  const validatedQuery = orderListQuerySchema.parse(query);

  const service = getOrderService(c);
  const result = await service.listUserOrders(user.sub, validatedQuery);

  return c.json({
    success: true,
    data: result.items,
    pagination: result.pagination,
  });
});

/**
 * GET /api/v1/orders/:id
 * Retrieve order details
 */
orderRoutes.get("/:id", async (c) => {
  const user = c.get("user");
  const orderId = c.req.param("id");

  const service = getOrderService(c);
  const order = await service.getOrderById(orderId, user.sub, user.role);

  if (!order) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Order not found" },
      },
      404,
    );
  }

  return c.json({
    success: true,
    data: order,
  });
});

/**
 * POST /api/v1/orders/:id/cancel
 * Cancel an unpaid pending order
 */
orderRoutes.post("/:id/cancel", async (c) => {
  const user = c.get("user");
  const orderId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));

  const service = getOrderService(c);
  const updatedOrder = await service.cancelOrder(orderId, user.sub, body?.reason);

  return c.json({
    success: true,
    data: updatedOrder,
  });
});

/**
 * PATCH /api/v1/orders/:id/status
 * Update order status (for seller or admin)
 */
orderRoutes.patch("/:id/status", async (c) => {
  const orderId = c.req.param("id");
  const body = await c.req.json().catch(() => null);

  if (!body || !body.status) {
    return c.json(
      {
        success: false,
        error: { code: "VALIDATION_ERROR", message: "Status field is required" },
      },
      400,
    );
  }

  const targetStatus = orderStatusSchema.parse(body.status);
  const service = getOrderService(c);
  const updatedOrder = await service.updateOrderStatus(orderId, targetStatus);

  return c.json({
    success: true,
    data: updatedOrder,
  });
});
