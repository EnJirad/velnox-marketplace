import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  authenticateRequest,
  assertUserRole,
  extractAuthToken,
} from "../../src/core/middleware/auth-middleware.ts";
import { DualTokenService } from "../../src/core/security/tokens.ts";
import { TokenRepository } from "../../src/modules/identity/repository/token-repository.ts";
import { ForbiddenError, UnauthorizedError } from "../../src/core/errors/app-error.ts";
import type { DbQueryable } from "../../../database/src/types.ts";

describe("Identity Module — Auth Middleware", () => {
  const secret = "test-jwt-secret-very-secure-key-1234567890";
  let revokedList: string[] = [];

  const mockDb: DbQueryable = {
    async query(sql: string, params?: any[]) {
      if (sql.includes("SELECT 1 FROM revoked_tokens WHERE token_id = $1")) {
        const found = revokedList.includes(params?.[0]);
        return { rows: found ? [{ exists: 1 }] : [] };
      }
      return { rows: [] };
    },
  };

  beforeEach(() => {
    revokedList = [];
    TokenRepository.clearCache();
  });

  it("extracts token from Authorization: Bearer header", () => {
    const token = extractAuthToken({ authorization: "Bearer my-jwt-token" });
    assert.equal(token, "my-jwt-token");
  });

  it("extracts token from Cookie header", () => {
    const token = extractAuthToken({ cookie: "other=123; velnox_session=cookie-jwt-token; theme=dark" });
    assert.equal(token, "cookie-jwt-token");
  });

  it("authenticates valid Bearer token", async () => {
    const tokens = DualTokenService.mintTokenPair(
      { id: "usr_100", email: "auth@velnox.live", role: "customer" },
      secret,
    );

    const user = await authenticateRequest(
      mockDb,
      { authorization: `Bearer ${tokens.accessToken}` },
      secret,
    );

    assert.equal(user.userId, "usr_100");
    assert.equal(user.email, "auth@velnox.live");
    assert.equal(user.role, "customer");
  });

  it("authenticates valid Cookie session token", async () => {
    const tokens = DualTokenService.mintTokenPair(
      { id: "usr_200", email: "cookie@velnox.live", role: "seller" },
      secret,
    );

    const user = await authenticateRequest(
      mockDb,
      { cookie: `velnox_session=${tokens.accessToken}` },
      secret,
    );

    assert.equal(user.userId, "usr_200");
    assert.equal(user.role, "seller");
  });

  it("rejects revoked access token", async () => {
    const tokens = DualTokenService.mintTokenPair(
      { id: "usr_300", email: "revoked@velnox.live", role: "customer" },
      secret,
    );
    const claims = DualTokenService.verifyAccessToken(tokens.accessToken, secret);
    revokedList.push(claims.jti);

    await assert.rejects(
      () =>
        authenticateRequest(
          mockDb,
          { authorization: `Bearer ${tokens.accessToken}` },
          secret,
        ),
      (err: any) => err instanceof UnauthorizedError && err.code === "TOKEN_REVOKED",
    );
  });

  it("assertUserRole approves allowed roles and rejects forbidden roles", () => {
    const customer = { userId: "1", email: "c@velnox.live", role: "customer" as const, jti: "j1" };
    const admin = { userId: "2", email: "a@velnox.live", role: "admin" as const, jti: "j2" };

    assert.doesNotThrow(() => assertUserRole(customer, ["customer", "seller"]));
    assert.doesNotThrow(() => assertUserRole(admin, ["admin", "owner"]));

    assert.throws(
      () => assertUserRole(customer, ["admin", "owner"]),
      ForbiddenError,
    );
  });
});
