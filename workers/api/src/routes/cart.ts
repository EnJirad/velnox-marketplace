import { Hono } from "hono";
import { addToCartInputSchema, updateCartItemInputSchema } from "@velnox/api-contract";
import { authMiddleware } from "../middleware/auth.js";
import { createNeonClient } from "../core/database/db-client.js";
import {
  type ICartRepository,
  MockCartRepository,
  NeonCartRepository,
} from "../modules/cart/cart-repository.js";
import { CartService } from "../modules/cart/cart-service.js";
import type { Bindings, Variables } from "../types.js";

export const cartRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

let cartServiceInstance: CartService | null = null;

export function getCartService(c: any): CartService {
  if (cartServiceInstance) return cartServiceInstance;

  const env = c.env as Bindings | undefined;
  let repo: ICartRepository;

  if (env?.DATABASE_URL) {
    const dbClient = createNeonClient(env.DATABASE_URL, env.ENVIRONMENT);
    repo = new NeonCartRepository(dbClient);
  } else {
    repo = new MockCartRepository();
  }

  cartServiceInstance = new CartService(repo);
  return cartServiceInstance;
}

export function setCartService(service: CartService | null) {
  cartServiceInstance = service;
}

// Protected: Cart operations require authenticated user
cartRoutes.use("*", authMiddleware);

/**
 * GET /api/v1/cart
 * Retrieve current user's shopping cart grouped by shop
 */
cartRoutes.get("/", async (c) => {
  const user = c.get("user");
  const service = getCartService(c);
  const cart = await service.getCart(user.sub);

  return c.json({
    success: true,
    data: cart,
  });
});

/**
 * POST /api/v1/cart/items
 * Add an item to shopping cart
 */
cartRoutes.post("/items", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);
  const input = addToCartInputSchema.parse(body);

  const service = getCartService(c);
  const updatedCart = await service.addItem(user.sub, input);

  return c.json(
    {
      success: true,
      data: updatedCart,
    },
    201,
  );
});

/**
 * PATCH /api/v1/cart/items/:id
 * Update quantity of a cart item
 */
cartRoutes.patch("/items/:id", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("id");
  const body = await c.req.json().catch(() => null);
  const input = updateCartItemInputSchema.parse(body);

  const service = getCartService(c);
  const updatedCart = await service.updateItemQuantity(user.sub, itemId, input.quantity);

  return c.json({
    success: true,
    data: updatedCart,
  });
});

/**
 * DELETE /api/v1/cart/items/:id
 * Remove an item from cart
 */
cartRoutes.delete("/items/:id", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("id");

  const service = getCartService(c);
  const updatedCart = await service.removeItem(user.sub, itemId);

  return c.json({
    success: true,
    data: updatedCart,
  });
});

/**
 * DELETE /api/v1/cart
 * Clear all items in shopping cart
 */
cartRoutes.delete("/", async (c) => {
  const user = c.get("user");
  const service = getCartService(c);
  const emptyCart = await service.clearCart(user.sub);

  return c.json({
    success: true,
    data: emptyCart,
  });
});
