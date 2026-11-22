import { Hono } from "hono";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { createNeonClient } from "../core/database/db-client.js";
import {
  type ISellerRepository,
  MockSellerRepository,
  NeonSellerRepository,
} from "../modules/sellers/seller-repository.js";
import { SellerService } from "../modules/sellers/seller-service.js";
import type { Bindings, Variables } from "../types.js";

export const sellerRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

let sellerServiceInstance: SellerService | null = null;

function getSellerService(c: any): SellerService {
  if (sellerServiceInstance) return sellerServiceInstance;

  const env = c.env as Bindings | undefined;
  let repo: ISellerRepository;

  if (env?.DATABASE_URL) {
    const dbClient = createNeonClient(env.DATABASE_URL, env.ENVIRONMENT);
    repo = new NeonSellerRepository(dbClient);
  } else {
    repo = new MockSellerRepository();
  }

  sellerServiceInstance = new SellerService(repo);
  return sellerServiceInstance;
}

export function setTestSellerService(service: SellerService | null) {
  sellerServiceInstance = service;
}

// Protected routes: All require valid session/JWT
sellerRoutes.use("*", authMiddleware);

/**
 * POST /api/v1/seller/apply
 * Apply to become a seller and create initial shop
 */
sellerRoutes.post("/apply", async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Request body is required" } },
      400,
    );
  }

  const service = getSellerService(c);
  const result = await service.applySeller(user.sub, body);

  return c.json(
    {
      success: true,
      data: result,
    },
    201,
  );
});

/**
 * GET /api/v1/seller/profile
 * Get seller profile and shop
 */
sellerRoutes.get("/profile", async (c) => {
  const user = c.get("user");
  const service = getSellerService(c);
  const profile = await service.getSellerProfile(user.sub);

  if (!profile) {
    return c.json(
      {
        success: false,
        error: { code: "NOT_FOUND", message: "Seller profile not found. Please apply first." },
      },
      404,
    );
  }

  return c.json({
    success: true,
    data: profile,
  });
});

/**
 * PATCH /api/v1/seller/shop
 * Update shop profile
 */
sellerRoutes.patch("/shop", requireRole("seller", "admin"), async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Request body is required" } },
      400,
    );
  }

  const service = getSellerService(c);
  const updatedShop = await service.updateShop(user.sub, body);

  return c.json({
    success: true,
    data: updatedShop,
  });
});

/**
 * POST /api/v1/seller/products
 * Create new product
 */
sellerRoutes.post("/products", requireRole("seller", "admin"), async (c) => {
  const user = c.get("user");
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Request body is required" } },
      400,
    );
  }

  const service = getSellerService(c);
  const product = await service.createProduct(user.sub, body);

  return c.json(
    {
      success: true,
      data: product,
    },
    201,
  );
});

/**
 * PUT /api/v1/seller/products/:id
 * Update product
 */
sellerRoutes.put("/products/:id", async (c) => {
  const user = c.get("user");
  const productId = c.req.param("id");
  const body = await c.req.json().catch(() => null);

  if (!body) {
    return c.json(
      { success: false, error: { code: "VALIDATION_ERROR", message: "Request body is required" } },
      400,
    );
  }

  const service = getSellerService(c);
  const product = await service.updateProduct(user.sub, productId, body);

  return c.json({
    success: true,
    data: product,
  });
});

/**
 * DELETE /api/v1/seller/products/:id
 * Delist product
 */
sellerRoutes.delete("/products/:id", async (c) => {
  const user = c.get("user");
  const productId = c.req.param("id");

  const service = getSellerService(c);
  const success = await service.deleteProduct(user.sub, productId);

  return c.json({
    success,
    data: { id: productId, status: "delisted" },
  });
});
