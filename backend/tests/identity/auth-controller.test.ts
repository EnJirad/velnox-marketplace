import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AuthController } from "../../src/modules/identity/routes/auth-routes.ts";
import { TokenRepository } from "../../src/modules/identity/repository/token-repository.ts";
import type { DbQueryable } from "../../../database/src/types.ts";

describe("Identity Module — AuthController (Web & Mobile Dual Response)", () => {
  const secret = "test-jwt-secret-very-secure-key-1234567890";
  let users: any[] = [];
  let revokedList: any[] = [];

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
        const u = {
          id: `usr_${Date.now()}`,
          email: params?.[0],
          name: params?.[1],
          password_hash: params?.[2],
          role: params?.[3],
          status: params?.[4],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        };
        users.push(u);
        return { rows: [u] };
      }
      if (q.includes("INSERT INTO customer_profiles")) {
        return { rows: [] };
      }
      if (q.includes("INSERT INTO revoked_tokens")) {
        revokedList.push(params?.[0]);
        return { rows: [] };
      }
      if (q.includes("SELECT 1 FROM revoked_tokens WHERE token_id = $1")) {
        return { rows: revokedList.includes(params?.[0]) ? [{ exists: 1 }] : [] };
      }
      return { rows: [] };
    },
  };

  beforeEach(() => {
    users = [];
    revokedList = [];
    TokenRepository.clearCache();
  });

  it("handles register: sets Set-Cookie for web AND returns AuthTokens in body for mobile", async () => {
    const res = await AuthController.register(
      mockDb,
      secret,
      {
        email: "controller@velnox.live",
        password: "ControllerPassword123!",
        name: "Controller User",
      },
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.success, true);
    assert.ok(res.headers?.["Set-Cookie"]?.includes("velnox_session="));
    assert.ok(res.body.data.tokens.accessToken);
    assert.ok(res.body.data.tokens.refreshToken);
    assert.equal(res.body.data.user.email, "controller@velnox.live");
  });

  it("handles login: returns standard ApiResponse format", async () => {
    await AuthController.register(
      mockDb,
      secret,
      {
        email: "signin@velnox.live",
        password: "SigninPassword123!",
        name: "Signin User",
      },
    );

    const loginRes = await AuthController.login(
      mockDb,
      secret,
      {
        email: "signin@velnox.live",
        password: "SigninPassword123!",
      },
    );

    assert.equal(loginRes.status, 200);
    assert.equal(loginRes.body.success, true);
    assert.ok(loginRes.headers?.["Set-Cookie"]?.includes("velnox_session="));
    assert.ok(loginRes.body.data.tokens.accessToken);
  });

  it("handles refresh: rotates token and issues new cookie", async () => {
    const regRes = await AuthController.register(
      mockDb,
      secret,
      {
        email: "refresh-ctrl@velnox.live",
        password: "RefreshPassword123!",
        name: "Refresh User",
      },
    );

    const refreshToken = regRes.body.data.tokens.refreshToken;

    const refreshRes = await AuthController.refresh(mockDb, secret, {
      refreshToken,
    });

    assert.equal(refreshRes.status, 200);
    assert.equal(refreshRes.body.success, true);
    assert.ok(refreshRes.body.data.accessToken);
    assert.ok(refreshRes.body.data.refreshToken);
    assert.notEqual(refreshRes.body.data.refreshToken, refreshToken);
    assert.ok(refreshRes.headers?.["Set-Cookie"]?.includes("velnox_session="));
  });

  it("handles logout: clears cookie and revokes tokens", async () => {
    const regRes = await AuthController.register(
      mockDb,
      secret,
      {
        email: "logout-ctrl@velnox.live",
        password: "LogoutPassword123!",
        name: "Logout User",
      },
    );

    const logoutRes = await AuthController.logout(
      mockDb,
      secret,
      {
        authorization: `Bearer ${regRes.body.data.tokens.accessToken}`,
      },
      {
        refreshToken: regRes.body.data.tokens.refreshToken,
      },
    );

    assert.equal(logoutRes.status, 200);
    assert.equal(logoutRes.body.success, true);
    assert.ok(logoutRes.headers?.["Set-Cookie"]?.includes("Max-Age=0"));
  });
});
