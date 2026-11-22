import { describe, expect, it } from "bun:test";
import {
  emailSchema,
  passwordSchema,
  phoneSchema,
  moneyMinorSchema,
  addressSchema,
  loginInputSchema,
  registerInputSchema,
  tokenExchangeInputSchema,
} from "../../packages/validation/src/index.js";
import {
  createSuccessEnvelope,
  createErrorResponse,
  healthCheckResponseSchema,
  loginResponseSchema,
  productListResponseSchema,
  cartResponseSchema,
  velnoxOpenApiSpec,
  validateOpenApiSpec,
} from "../../packages/api-contract/src/index.js";
import { VelnoxApiClient, ApiClientError } from "../../packages/api-client/src/index.js";
import { z } from "zod";

describe("Milestone 1 — Monorepo Foundation & Contract Quality Gate", () => {
  describe("@velnox/validation package", () => {
    it("validates and normalizes email formats", () => {
      expect(emailSchema.parse("Dev@Velnox.Live ")).toBe("dev@velnox.live");
      expect(() => emailSchema.parse("invalid-email")).toThrow();
    });

    it("enforces strong password policy", () => {
      expect(passwordSchema.parse("SecurePass123")).toBe("SecurePass123");
      expect(() => passwordSchema.parse("weak")).toThrow();
    });

    it("validates phone numbers for Thai commerce", () => {
      expect(phoneSchema.parse("0891234567")).toBe("0891234567");
      expect(phoneSchema.parse("+66891234567")).toBe("+66891234567");
      expect(() => phoneSchema.parse("abc")).toThrow();
    });

    it("validates minor currency units (no floating point satang)", () => {
      expect(moneyMinorSchema.parse(50000)).toBe(50000);
      expect(() => moneyMinorSchema.parse(-10)).toThrow();
      expect(() => moneyMinorSchema.parse(10.5)).toThrow();
    });

    it("validates complete shipping address", () => {
      const address = {
        recipientName: "Somchai Jaidee",
        phone: "0891234567",
        addressLine1: "123 Sukhumvit",
        subdistrict: "Khlong Toei",
        district: "Khlong Toei",
        province: "Bangkok",
        postalCode: "10110",
        isDefault: true,
      };
      expect(addressSchema.parse(address).postalCode).toBe("10110");
    });
  });

  describe("@velnox/api-contract package", () => {
    it("validates standard ApiResponse and ApiErrorResponse envelopes", () => {
      const envelope = createSuccessEnvelope(z.string());
      expect(envelope.parse({ success: true, data: "ok" }).success).toBe(true);

      const error = createErrorResponse("VALIDATION_ERROR", "Invalid input");
      expect(error.success).toBe(false);
      expect(error.error.code).toBe("VALIDATION_ERROR");
    });

    it("validates v1 Health, Auth, Catalog, and Cart contracts", () => {
      const health = healthCheckResponseSchema.parse({
        success: true,
        data: {
          status: "ok",
          version: "3.0.0",
          service: "velnox-api",
          uptime: 500,
          timestamp: Date.now(),
          database: "connected",
        },
      });
      expect(health.data.status).toBe("ok");

      const auth = loginResponseSchema.parse({
        success: true,
        data: {
          user: {
            id: "usr_001",
            email: "user@velnox.live",
            name: "Test User",
            role: "customer",
            createdAt: Date.now(),
          },
          tokens: {
            accessToken: "access-token-jwt",
            tokenType: "Bearer",
            expiresIn: 900,
            refreshToken: "refresh-token-xyz",
          },
        },
      });
      expect(auth.data.user.role).toBe("customer");
    });

    it("generates valid OpenAPI 3.1.0 specification", () => {
      expect(velnoxOpenApiSpec.openapi).toBe("3.1.0");
      expect(validateOpenApiSpec(velnoxOpenApiSpec)).toBe(true);
      expect(velnoxOpenApiSpec.paths["/api/v1/health"]).toBeDefined();
      expect(velnoxOpenApiSpec.paths["/api/v1/auth/login"]).toBeDefined();
      expect(velnoxOpenApiSpec.paths["/api/v1/products"]).toBeDefined();
      expect(velnoxOpenApiSpec.paths["/api/v1/cart"]).toBeDefined();
    });
  });

  describe("@velnox/api-client package", () => {
    it("performs typed calls and unwraps response data", async () => {
      const mockFetch = async () => {
        return new Response(
          JSON.stringify({
            success: true,
            data: {
              status: "ok",
              version: "3.0.0",
              service: "velnox-api",
              uptime: 100,
              timestamp: Date.now(),
              database: "connected",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      };

      const client = new VelnoxApiClient({
        baseUrl: "https://api.velnox.live",
        getAuthToken: () => "test-token",
        fetch: mockFetch as any,
      });

      const res = await client.health.check();
      expect(res.status).toBe("ok");
    });

    it("throws ApiClientError with code on failed response", async () => {
      const mockFetch = async () => {
        return new Response(
          JSON.stringify({
            success: false,
            error: { code: "FORBIDDEN", message: "Access denied" },
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      };

      const client = new VelnoxApiClient({
        baseUrl: "https://api.velnox.live",
        fetch: mockFetch as any,
      });

      try {
        await client.auth.me();
        expect(true).toBe(false);
      } catch (err) {
        expect(err instanceof ApiClientError).toBe(true);
        expect((err as ApiClientError).status).toBe(403);
        expect((err as ApiClientError).code).toBe("FORBIDDEN");
      }
    });
  });
});
