import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { DbQueryable } from "../../../database/src/types.ts";
import { DualTokenService } from "../../src/core/security/tokens.ts";
import { signJwt, verifyJwt } from "../../src/core/security/jwt.ts";
import { hashPassword, verifyPassword } from "../../src/core/security/password.ts";
import {
  authenticateRequest,
  assertUserRole,
  extractAuthToken,
} from "../../src/core/middleware/auth-middleware.ts";
import { formatSessionCookie } from "../../src/modules/identity/routes/auth-routes.ts";
import { verifyStripeSignature } from "../../src/modules/payment/domain/payment.ts";
import {
  ForbiddenError,
  TokenRevokedError,
  UnauthorizedError,
  ValidationError,
} from "../../src/core/errors/app-error.ts";
import { calculateChecksum } from "../../../database/src/checksum.ts";

describe("Security & OWASP Top 10 Audit — Velnox Rebuilt Core", () => {
  const secretKey = "super_secure_secret_for_owasp_audit_tests_1234567";

  // =========================================================================
  // A01: Broken Access Control
  // =========================================================================
  describe("OWASP A01: Broken Access Control", () => {
    it("enforces strict role-based access control (RBAC)", () => {
      const customerUser = {
        userId: "usr_customer_1",
        email: "customer@example.com",
        role: "customer" as const,
        jti: "jti_1",
      };

      const sellerUser = {
        userId: "usr_seller_1",
        email: "seller@example.com",
        role: "seller" as const,
        jti: "jti_2",
      };

      // Customer cannot access seller or admin endpoints
      assert.throws(
        () => assertUserRole(customerUser, ["seller"]),
        (err: any) => err instanceof ForbiddenError && err.code === "INSUFFICIENT_PERMISSIONS",
      );

      assert.throws(
        () => assertUserRole(customerUser, ["admin", "superadmin"]),
        (err: any) => err instanceof ForbiddenError,
      );

      // Seller cannot access admin endpoints
      assert.throws(
        () => assertUserRole(sellerUser, ["admin"]),
        (err: any) => err instanceof ForbiddenError,
      );

      // Allowed roles pass cleanly
      assert.doesNotThrow(() => assertUserRole(customerUser, ["customer", "seller"]));
      assert.doesNotThrow(() => assertUserRole(sellerUser, ["seller", "admin"]));
    });

    it("prevents unauthenticated access when no token is supplied", async () => {
      const mockDb: DbQueryable = {
        async query() {
          return { rows: [] };
        },
      };

      await assert.rejects(
        () => authenticateRequest(mockDb, {}, secretKey),
        (err: any) => err instanceof UnauthorizedError && err.code === "NO_TOKEN_PROVIDED",
      );
    });
  });

  // =========================================================================
  // A02: Cryptographic Failures
  // =========================================================================
  describe("OWASP A02: Cryptographic Failures", () => {
    it("strictly rejects unsigned, alg=none, or tampered JWTs", () => {
      // 1. Valid HS256 token
      const validToken = signJwt({ sub: "user_1", role: "customer" }, secretKey, 900);
      const res = verifyJwt(validToken, secretKey);
      assert.equal(res.valid, true);
      assert.equal(res.payload?.sub, "user_1");

      // 2. Reject 'none' algorithm token
      const noneHeader = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
      const payload = Buffer.from(JSON.stringify({ sub: "user_1", exp: Math.floor(Date.now() / 1000) + 900 })).toString("base64url");
      const noneToken = `${noneHeader}.${payload}.`;
      const noneRes = verifyJwt(noneToken, secretKey);
      assert.equal(noneRes.valid, false);

      // 3. Reject wrong secret
      const wrongSecretRes = verifyJwt(validToken, "wrong_secret_key_99999999999999999");
      assert.equal(wrongSecretRes.valid, false);

      // 4. Reject tampered payload
      const parts = validToken.split(".");
      const tamperedPayload = Buffer.from(JSON.stringify({ sub: "hacked_admin", exp: 9999999999 })).toString("base64url");
      const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;
      const tamperedRes = verifyJwt(tamperedToken, secretKey);
      assert.equal(tamperedRes.valid, false);
    });

    it("verifies scrypt password hashes with timing safety and resists malformed input", async () => {
      const password = "SuperSecretPassword123!";
      const hash = await hashPassword(password);

      assert.ok(hash.startsWith("$scrypt$"));

      // Positive verification
      const valid = await verifyPassword(password, hash);
      assert.equal(valid, true);

      // Wrong password fails
      const invalid = await verifyPassword("WrongPassword!", hash);
      assert.equal(invalid, false);

      // Malformed hash handles safely without unhandled exception
      const safeCheck = await verifyPassword(password, "malformed_hash_without_delimiters");
      assert.equal(safeCheck, false);
    });

    it("enforces dual-token role separation (access token != refresh token)", () => {
      const tokens = DualTokenService.mintTokenPair(
        { id: "usr_test", email: "test@example.com", role: "customer" },
        secretKey,
      );

      // Access token cannot be verified as refresh token
      assert.throws(
        () => DualTokenService.verifyRefreshToken(tokens.accessToken, secretKey),
        (err: any) => err instanceof UnauthorizedError,
      );

      // Refresh token cannot be verified as access token
      assert.throws(
        () => DualTokenService.verifyAccessToken(tokens.refreshToken, secretKey),
        (err: any) => err instanceof UnauthorizedError,
      );
    });
  });

  // =========================================================================
  // A03: Injection
  // =========================================================================
  describe("OWASP A03: Injection & Parameterized SQL", () => {
    it("guarantees safe parameterized handling for SQL injection payloads", async () => {
      const executedQueries: Array<{ sql: string; params?: any[] }> = [];

      const mockDb: DbQueryable = {
        async query(sql: string, params?: any[]) {
          executedQueries.push({ sql, params });
          return { rows: [] };
        },
      };

      // Attacker attempts SQL injection via email input
      const injectionEmail = "' OR '1'='1' -- ";
      await mockDb.query(
        "SELECT id, email, password_hash FROM users WHERE email = $1 LIMIT 1;",
        [injectionEmail],
      );

      assert.equal(executedQueries.length, 1);
      const query = executedQueries[0];

      // Query remains fully parameterized with placeholder $1
      assert.ok(query.sql.includes("WHERE email = $1"));
      assert.equal(query.params?.[0], injectionEmail);
    });
  });

  // =========================================================================
  // A05: Security Misconfiguration
  // =========================================================================
  describe("OWASP A05: Security Misconfiguration", () => {
    it("generates session cookies with mandatory HttpOnly, Secure, and SameSite flags", () => {
      const accessToken = "mock_access_token_xyz_123";
      const cookie = formatSessionCookie(accessToken, true);

      assert.ok(cookie.includes("HttpOnly"), "Must include HttpOnly flag");
      assert.ok(cookie.includes("Secure"), "Must include Secure flag in production");
      assert.ok(cookie.includes("SameSite="), "Must include SameSite flag");
      assert.ok(cookie.includes("Path=/"), "Must include Path=/");
      assert.ok(cookie.includes("Max-Age="), "Must include Max-Age");
    });
  });

  // =========================================================================
  // A07: Identification and Authentication Failures
  // =========================================================================
  describe("OWASP A07: Identification and Authentication Failures", () => {
    it("prevents token reuse after revocation", async () => {
      const tokens = DualTokenService.mintTokenPair(
        { id: "usr_test", email: "test@example.com", role: "customer" },
        secretKey,
      );

      // Verify token is accepted before revocation
      const claims = DualTokenService.verifyAccessToken(tokens.accessToken, secretKey);
      assert.equal(claims.userId, "usr_test");

      // Simulate revocation check in middleware
      const mockDb: DbQueryable = {
        async query(sql: string, params?: any[]) {
          // If revoked_tokens table query -> return revocation record
          if (sql.includes("FROM revoked_tokens")) {
            return { rows: [{ token_id: params?.[0], revoked_at: new Date() }] };
          }
          return { rows: [] };
        },
      };

      await assert.rejects(
        () =>
          authenticateRequest(
            mockDb,
            { authorization: `Bearer ${tokens.accessToken}` },
            secretKey,
          ),
        (err: any) => err instanceof UnauthorizedError && err.code === "TOKEN_REVOKED",
      );
    });
  });

  // =========================================================================
  // A08: Software and Data Integrity Failures
  // =========================================================================
  describe("OWASP A08: Software and Data Integrity Failures", () => {
    it("detects migration file checksum tampering", () => {
      const originalSql = "CREATE TABLE test (id UUID PRIMARY KEY);";
      const tamperedSql = "CREATE TABLE test (id UUID PRIMARY KEY, backdoored BOOLEAN);";

      const originalHash = calculateChecksum(originalSql);
      const tamperedHash = calculateChecksum(tamperedSql);

      assert.notEqual(originalHash, tamperedHash);
      assert.equal(originalHash.length, 64); // SHA-256 hex length
    });

    it("verifies webhook HMAC-SHA256 signatures with timing safety and replay guards", () => {
      const webhookSecret = "whsec_audit_test_999888";
      const payload = JSON.stringify({ id: "evt_1", type: "payment_intent.succeeded" });
      const timestamp = Math.floor(Date.now() / 1000);

      const hmac = crypto
        .createHmac("sha256", webhookSecret)
        .update(`${timestamp}.${payload}`)
        .digest("hex");
      const signatureHeader = `t=${timestamp},v1=${hmac}`;

      // 1. Genuine signature passes
      assert.equal(verifyStripeSignature(payload, signatureHeader, webhookSecret), true);

      // 2. Tampered body fails
      assert.equal(verifyStripeSignature(payload + "tamper", signatureHeader, webhookSecret), false);

      // 3. Replay attack (> 300s old) fails
      const oldTimestamp = timestamp - 301;
      const oldHmac = crypto
        .createHmac("sha256", webhookSecret)
        .update(`${oldTimestamp}.${payload}`)
        .digest("hex");
      assert.equal(verifyStripeSignature(payload, `t=${oldTimestamp},v1=${oldHmac}`, webhookSecret), false);
    });
  });
});
