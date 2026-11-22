import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { IdentityService } from "../../src/modules/identity/services/identity-service.ts";
import { TokenRepository } from "../../src/modules/identity/repository/token-repository.ts";
import type { DbQueryable } from "../../../database/src/types.ts";
import {
  ConflictError,
  TokenRevokedError,
  UnauthorizedError,
  ValidationError,
} from "../../src/core/errors/app-error.ts";

describe("Identity Module — IdentityService", () => {
  const secret = "test-jwt-secret-very-secure-key-1234567890";

  // In-memory mock database state
  let users: any[] = [];
  let profiles: any[] = [];
  let revokedTokens: any[] = [];

  const mockDb: DbQueryable = {
    async query(sql: string, params?: any[]) {
      const q = sql.trim();

      if (q.includes("SELECT") && q.includes("FROM users WHERE LOWER(email) = LOWER($1)")) {
        const found = users.find((u) => u.email.toLowerCase() === params?.[0]?.toLowerCase());
        return { rows: found ? [found] : [] };
      }

      if (q.includes("SELECT") && q.includes("FROM users WHERE id = $1")) {
        const found = users.find((u) => u.id === params?.[0]);
        return { rows: found ? [found] : [] };
      }

      if (q.includes("INSERT INTO users")) {
        const newUser = {
          id: `usr_${Date.now()}_${Math.random()}`,
          email: params?.[0],
          name: params?.[1],
          password_hash: params?.[2],
          role: params?.[3],
          status: params?.[4],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        users.push(newUser);
        return { rows: [newUser] };
      }

      if (q.includes("INSERT INTO customer_profiles")) {
        profiles.push({ user_id: params?.[0] });
        return { rows: [] };
      }

      if (q.includes("INSERT INTO revoked_tokens")) {
        revokedTokens.push({
          token_id: params?.[0],
          user_id: params?.[1],
          expires_at: params?.[2],
        });
        return { rows: [] };
      }

      if (q.includes("SELECT 1 FROM revoked_tokens WHERE token_id = $1")) {
        const found = revokedTokens.find((r) => r.token_id === params?.[0]);
        return { rows: found ? [{ exists: 1 }] : [] };
      }

      return { rows: [] };
    },
  };

  beforeEach(() => {
    users = [];
    profiles = [];
    revokedTokens = [];
    TokenRepository.clearCache();
  });

  it("registers a new customer user and returns dual tokens", async () => {
    const registerInput = {
      email: "newuser@velnox.live",
      password: "SecurePassword123",
      name: "Somsak Jaidee",
    };

    const result = await IdentityService.register(mockDb, registerInput, secret);

    assert.ok(result.user.id);
    assert.equal(result.user.email, "newuser@velnox.live");
    assert.equal(result.user.name, "Somsak Jaidee");
    assert.equal(result.user.role, "customer");
    assert.ok(result.tokens.accessToken);
    assert.ok(result.tokens.refreshToken);
    assert.equal(result.tokens.tokenType, "Bearer");
    assert.equal(result.tokens.expiresIn, 900);
  });

  it("rejects registration with existing email (ConflictError)", async () => {
    const registerInput = {
      email: "duplicate@velnox.live",
      password: "SecurePassword123",
      name: "First User",
    };

    await IdentityService.register(mockDb, registerInput, secret);

    await assert.rejects(
      () => IdentityService.register(mockDb, registerInput, secret),
      (err: any) => err instanceof ConflictError && err.code === "EMAIL_EXISTS",
    );
  });

  it("authenticates valid credentials and returns dual tokens", async () => {
    await IdentityService.register(
      mockDb,
      {
        email: "login@velnox.live",
        password: "MyPassword123!",
        name: "Login User",
      },
      secret,
    );

    const loginResult = await IdentityService.loginWithPassword(
      mockDb,
      {
        email: "login@velnox.live",
        password: "MyPassword123!",
      },
      secret,
    );

    assert.equal(loginResult.user.email, "login@velnox.live");
    assert.ok(loginResult.tokens.accessToken);
    assert.ok(loginResult.tokens.refreshToken);
  });

  it("rejects invalid password", async () => {
    await IdentityService.register(
      mockDb,
      {
        email: "wrongpass@velnox.live",
        password: "RealPassword123!",
        name: "User",
      },
      secret,
    );

    await assert.rejects(
      () =>
        IdentityService.loginWithPassword(
          mockDb,
          { email: "wrongpass@velnox.live", password: "IncorrectPassword" },
          secret,
        ),
      (err: any) => err instanceof UnauthorizedError && err.code === "INVALID_CREDENTIALS",
    );
  });

  it("rotates refresh token and revokes the old refresh token (Refresh Token Rotation)", async () => {
    const initial = await IdentityService.register(
      mockDb,
      {
        email: "rotate@velnox.live",
        password: "RotatePassword123!",
        name: "Rotate User",
      },
      secret,
    );

    const oldRefreshToken = initial.tokens.refreshToken;

    // 1. First rotation: Success
    const newTokens = await IdentityService.refreshToken(mockDb, oldRefreshToken, secret);
    assert.ok(newTokens.accessToken);
    assert.ok(newTokens.refreshToken);
    assert.notEqual(newTokens.refreshToken, oldRefreshToken);

    // 2. Second use of oldRefreshToken MUST FAIL (Token Reuse Detection)
    await assert.rejects(
      () => IdentityService.refreshToken(mockDb, oldRefreshToken, secret),
      (err: any) => err instanceof TokenRevokedError,
    );
  });

  it("logs out user by revoking tokens in TokenRepository", async () => {
    const auth = await IdentityService.register(
      mockDb,
      {
        email: "logout@velnox.live",
        password: "LogoutPassword123!",
        name: "Logout User",
      },
      secret,
    );

    await IdentityService.logout(mockDb, secret, {
      accessToken: auth.tokens.accessToken,
      refreshToken: auth.tokens.refreshToken,
    });

    // Refreshing with the revoked refresh token must now be rejected
    await assert.rejects(
      () => IdentityService.refreshToken(mockDb, auth.tokens.refreshToken, secret),
      TokenRevokedError,
    );
  });
});
