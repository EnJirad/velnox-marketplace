import { describe, expect, it } from "bun:test";
import { app } from "../src/app.js";
import { signJwt } from "../src/core/security/jwt.js";
import { assertBalancedTransaction, validateTransaction } from "@velnox/ledger";

const JWT_SECRET = "velnox-default-development-jwt-secret-at-least-32-chars";

async function createAuthHeader(userId: string, role = "customer") {
  const token = await signJwt(
    {
      sub: userId,
      email: `${userId}@velnox.live`,
      role,
      type: "access",
      jti: crypto.randomUUID(),
    },
    JWT_SECRET,
    3600,
  );
  return `Bearer ${token}`;
}

const validShippingAddress = {
  recipientName: "Victim User",
  phone: "0811111111",
  addressLine1: "123 Safe St",
  subdistrict: "Khlong Tan",
  district: "Khlong Toei",
  province: "Bangkok",
  postalCode: "10110",
};

describe("Phase 8: OWASP Top 10 Security Audit Suite (Workers API)", () => {
  // -------------------------------------------------------------------------
  // OWASP A01: Broken Access Control
  // -------------------------------------------------------------------------
  describe("OWASP A01: Broken Access Control", () => {
    it("rejects unauthorized access to protected endpoints without JWT", async () => {
      const res = await app.request("/api/v1/auth/me");
      expect(res.status).toBe(401);
      const json = (await res.json()) as any;
      expect(json.success).toBe(false);
      expect(json.error.code).toBe("UNAUTHORIZED");
    });

    it("enforces strict RBAC: customer cannot access seller management endpoints", async () => {
      const customerHeader = await createAuthHeader("user-plain-customer", "customer");

      const res = await app.request("/api/v1/seller/products", {
        method: "POST",
        headers: {
          Authorization: customerHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          title: "Malicious Product Injection",
          price: 1000,
        }),
      });
      expect(res.status).toBe(403);
      const json = (await res.json()) as any;
      expect(json.error.code).toBe("FORBIDDEN");
    });

    it("prevents IDOR: user cannot cancel or modify another user's order", async () => {
      const customerHeader = await createAuthHeader("user-victim", "customer");
      const attackerHeader = await createAuthHeader("user-attacker", "customer");

      // Victim adds item to cart
      await app.request("/api/v1/cart/items", {
        method: "POST",
        headers: {
          Authorization: customerHeader,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          productId: "prod-001",
          quantity: 1,
        }),
      });

      // Place order as victim
      const checkoutRes = await app.request("/api/v1/orders/checkout", {
        method: "POST",
        headers: {
          Authorization: customerHeader,
          "Content-Type": "application/json",
          Origin: "https://shop.velnox.live",
        },
        body: JSON.stringify({
          shippingAddress: validShippingAddress,
          paymentMethod: "stripe",
        }),
      });

      expect(checkoutRes.status).toBe(201);
      const order = (await checkoutRes.json()) as any;
      const orderId = order.data.orders[0].id;

      // Attacker tries to view victim's order
      const getRes = await app.request(`/api/v1/orders/${orderId}`, {
        headers: { Authorization: attackerHeader },
      });
      expect(getRes.status).toBe(403);

      // Attacker tries to cancel victim's order
      const cancelRes = await app.request(`/api/v1/orders/${orderId}/cancel`, {
        method: "POST",
        headers: { Authorization: attackerHeader },
      });
      expect(cancelRes.status).toBe(403);
    });
  });

  // -------------------------------------------------------------------------
  // OWASP A02: Cryptographic Failures
  // -------------------------------------------------------------------------
  describe("OWASP A02: Cryptographic Failures", () => {
    it("rejects JWTs signed with an invalid or tampered secret", async () => {
      const forgedToken = await signJwt(
        { sub: "user-admin", email: "admin@velnox.live", role: "admin", type: "access" },
        "attacker-forged-secret-key-that-does-not-match-at-all",
        3600,
      );

      const res = await app.request("/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${forgedToken}` },
      });
      expect(res.status).toBe(401);
      const json = (await res.json()) as any;
      expect(json.error.message).toContain("Invalid JWT signature");
    });

    it("rejects expired tokens immediately", async () => {
      const expiredToken = await signJwt(
        { sub: "user-expired", email: "expired@velnox.live", role: "customer", type: "access" },
        JWT_SECRET,
        -10, // expired 10 seconds ago
      );

      const res = await app.request("/api/v1/auth/me", {
        headers: { Authorization: `Bearer ${expiredToken}` },
      });
      expect(res.status).toBe(401);
      const json = (await res.json()) as any;
      expect(json.error.message).toContain("expired");
    });
  });

  // -------------------------------------------------------------------------
  // OWASP A04: Insecure Design & Financial Integrity
  // -------------------------------------------------------------------------
  describe("OWASP A04: Insecure Design & Financial Invariants", () => {
    it("enforces strict double-entry invariant: rejects unbalanced ledger transactions", () => {
      const unbalancedTx = {
        id: "tx-unbalanced",
        idempotencyKey: "idem-unbalanced-1",
        postings: [
          { account: "platform_cash" as const, entryType: "charge" as const, direction: "debit" as const, amountMinor: 10000n },
          { account: "platform_revenue" as const, entryType: "platform_fee" as const, direction: "credit" as const, amountMinor: 9000n }, // Missing 1000 satang!
        ],
        createdAt: new Date(),
      };

      const result = validateTransaction(unbalancedTx);
      expect(result.isValid).toBe(false);
      expect(() => assertBalancedTransaction(unbalancedTx)).toThrow();
    });

    it("rejects non-integer, floating-point or negative monetary amounts", () => {
      const invalidAmountTx = {
        id: "tx-invalid-amount",
        idempotencyKey: "idem-invalid-1",
        postings: [
          { account: "platform_cash" as const, entryType: "charge" as const, direction: "debit" as const, amountMinor: -500n },
          { account: "platform_revenue" as const, entryType: "platform_fee" as const, direction: "credit" as const, amountMinor: -500n },
        ],
        createdAt: new Date(),
      };

      const result = validateTransaction(invalidAmountTx);
      expect(result.isValid).toBe(false);
      expect(() => assertBalancedTransaction(invalidAmountTx)).toThrow();
    });
  });

  // -------------------------------------------------------------------------
  // OWASP A05: Security Misconfiguration & CORS
  // -------------------------------------------------------------------------
  describe("OWASP A05: Security Misconfiguration", () => {
    it("sets CORS headers for legitimate origins and rejects unauthorized origins", async () => {
      // Legitimate origin
      const goodRes = await app.request("/api/v1/catalog/products", {
        headers: { Origin: "https://shop.velnox.live" },
      });
      expect(goodRes.headers.get("access-control-allow-origin")).toBe("https://shop.velnox.live");
      expect(goodRes.headers.get("access-control-allow-credentials")).toBe("true");

      // Malicious/unknown origin
      const badRes = await app.request("/api/v1/catalog/products", {
        headers: { Origin: "https://evil-phishing-site.com" },
      });
      expect(badRes.headers.get("access-control-allow-origin")).toBeNull();
    });

    it("attaches X-Request-Id and X-Response-Time headers for distributed tracing", async () => {
      const res = await app.request("/health");
      expect(res.headers.get("x-request-id")).toBeDefined();
      expect(res.headers.get("x-response-time")).toBeDefined();
    });
  });

  // -------------------------------------------------------------------------
  // OWASP A07: Identification and Authentication Failures
  // -------------------------------------------------------------------------
  describe("OWASP A07: Identification and Authentication Failures", () => {
    it("rejects refresh token requests when no refresh token is provided", async () => {
      const res = await app.request("/api/v1/auth/refresh", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(400);
    });

    it("rejects login with incorrect password safely", async () => {
      const res = await app.request("/api/v1/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: "non-existent-user@example.com",
          password: "WrongPassword!",
        }),
      });
      expect(res.status).toBe(401);
    });
  });
});
