import { describe, expect, it } from "bun:test";
import {
  createSuccessEnvelope,
  createErrorResponse,
  healthCheckResponseSchema,
  loginResponseSchema,
  productListResponseSchema,
  cartResponseSchema,
  velnoxOpenApiSpec,
  validateOpenApiSpec,
} from "../src/index.js";
import { z } from "zod";

describe("@velnox/api-contract common schemas", () => {
  it("formats standard success response envelope", () => {
    const stringEnvelope = createSuccessEnvelope(z.string());
    const result = stringEnvelope.parse({
      success: true,
      data: "ok",
    });
    expect(result.success).toBe(true);
    expect(result.data).toBe("ok");
  });

  it("creates structured API error response with valid codes", () => {
    const errorRes = createErrorResponse("VALIDATION_ERROR", "Invalid input", [
      { field: "email", issue: "Must be a valid email" },
    ]);
    expect(errorRes.success).toBe(false);
    expect(errorRes.error.code).toBe("VALIDATION_ERROR");
    expect(errorRes.error.message).toBe("Invalid input");
    expect(errorRes.error.details).toBeDefined();
  });
});

describe("@velnox/api-contract v1 domain contracts", () => {
  it("validates health check response contract", () => {
    const valid = healthCheckResponseSchema.parse({
      success: true,
      data: {
        status: "ok",
        version: "3.0.0",
        service: "velnox-api",
        uptime: 12345,
        timestamp: Date.now(),
        database: "connected",
      },
    });
    expect(valid.data.status).toBe("ok");
    expect(valid.data.database).toBe("connected");
  });

  it("validates login response contract", () => {
    const valid = loginResponseSchema.parse({
      success: true,
      data: {
        user: {
          id: "usr_123456",
          email: "customer@velnox.live",
          name: "John Doe",
          role: "customer",
          createdAt: Date.now(),
        },
        tokens: {
          accessToken: "jwt-access-token",
          tokenType: "Bearer",
          expiresIn: 900,
          refreshToken: "refresh-token-xyz",
        },
      },
    });
    expect(valid.data.user.email).toBe("customer@velnox.live");
    expect(valid.data.tokens.tokenType).toBe("Bearer");
  });

  it("validates product list and cart response contracts", () => {
    const productList = productListResponseSchema.parse({
      success: true,
      data: [
        {
          id: "prod_001",
          shopId: "shop_001",
          shopName: "Velnox Official",
          name: "Wireless Earbuds",
          slug: "wireless-earbuds",
          price: 1290,
          currency: "THB",
          rating: 4.8,
          reviewCount: 120,
          isAvailable: true,
        },
      ],
      meta: {
        page: 1,
        limit: 20,
        total: 1,
        totalPages: 1,
        hasMore: false,
        timestamp: Date.now(),
      },
    });
    expect(productList.data.length).toBe(1);
    expect(productList.data[0].name).toBe("Wireless Earbuds");

    const cart = cartResponseSchema.parse({
      success: true,
      data: {
        id: "cart_001",
        shopGroups: [
          {
            shopId: "shop_001",
            shopName: "Velnox Official",
            items: [
              {
                id: "item_001",
                productId: "prod_001",
                productName: "Wireless Earbuds",
                unitPrice: 1290,
                quantity: 2,
                subtotal: 2580,
                shopId: "shop_001",
                shopName: "Velnox Official",
                stockAvailable: 50,
              },
            ],
            shopSubtotal: 2580,
          },
        ],
        totalAmount: 2580,
        currency: "THB",
        itemCount: 2,
        shopCount: 1,
      },
    });
    expect(cart.data.totalAmount).toBe(2580);
  });
});

describe("@velnox/api-contract OpenAPI 3.1.0 generation", () => {
  it("generates valid OpenAPI 3.1.0 specification", () => {
    expect(velnoxOpenApiSpec.openapi).toBe("3.1.0");
    expect(velnoxOpenApiSpec.info.title).toContain("Velnox Marketplace");
    expect(validateOpenApiSpec(velnoxOpenApiSpec)).toBe(true);

    // Verify key paths exist
    expect(velnoxOpenApiSpec.paths["/api/v1/health"]).toBeDefined();
    expect(velnoxOpenApiSpec.paths["/api/v1/auth/login"]).toBeDefined();
    expect(velnoxOpenApiSpec.paths["/api/v1/products"]).toBeDefined();
    expect(velnoxOpenApiSpec.paths["/api/v1/cart"]).toBeDefined();

    // Verify security schemes exist
    expect(velnoxOpenApiSpec.components.securitySchemes.bearerAuth).toBeDefined();
    expect(velnoxOpenApiSpec.components.securitySchemes.cookieAuth).toBeDefined();
  });
});
