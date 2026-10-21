/**
 * MVP auth — real routes, real PostgreSQL.
 *
 * Covers the security promises the brief makes: scrypt hashing, a session
 * cookie that works, server-side revocation on logout, no password hash in any
 * response, no role escalation from the request, and a parked OAuth path that
 * says so instead of pretending.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { query } from "../../db/index.js";
import { hasTestDatabase } from "../../tests/helpers/test-db.js";
import { api, createUser, startApp, type TestApp } from "./helpers/mvp-app.js";

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

function sessionCookie(setCookie: string[]): string | undefined {
  const raw = setCookie.find((value) => value.startsWith("velnox_session="));
  return raw?.split(";")[0];
}

describe("MVP auth (needs a test database + JWT_SECRET)", () => {
  let app: TestApp;

  beforeAll(async () => {
    if (!hasDb) return;
    app = await startApp();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  itDb("signs up a customer, sets an httpOnly cookie and returns no hash", async () => {
    const email = `signup-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
    const res = await api(app.base, "/api/mvp/auth/signup", {
      method: "POST",
      body: { email, password: "correct horse battery", name: "New Buyer" },
    });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.user.email).toBe(email);
    expect(res.body.data.user.role).toBe("customer");
    expect(JSON.stringify(res.body)).not.toContain("password");

    const cookie = sessionCookie(res.setCookie);
    expect(cookie).toBeDefined();
    const rawCookie = res.setCookie.find((v) => v.startsWith("velnox_session="))!;
    expect(rawCookie).toContain("HttpOnly");

    const me = await api(app.base, "/api/mvp/auth/me", { cookie: cookie! });
    expect(me.status).toBe(200);
    expect(me.body.data.user.email).toBe(email);
    expect(me.body.data.seller).toBeNull();
    expect(JSON.stringify(me.body)).not.toContain("scrypt");
  });

  itDb("refuses a duplicate email (case-insensitive)", async () => {
    const email = `dup-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
    const first = await api(app.base, "/api/mvp/auth/signup", {
      method: "POST",
      body: { email, password: "correct horse battery" },
    });
    expect(first.status).toBe(201);

    const second = await api(app.base, "/api/mvp/auth/signup", {
      method: "POST",
      body: { email: email.toUpperCase(), password: "correct horse battery" },
    });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("EMAIL_IN_USE");
  });

  itDb("rejects a weak password", async () => {
    const res = await api(app.base, "/api/mvp/auth/signup", {
      method: "POST",
      body: { email: `weak-${crypto.randomUUID().slice(0, 8)}@test.invalid`, password: "short" },
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("WEAK_PASSWORD");
  });

  itDb("logs in, and answers identically for a wrong password and an unknown email", async () => {
    const user = await createUser();
    const okLogin = await api(app.base, "/api/mvp/auth/login", {
      method: "POST",
      body: { email: user.email, password: user.password },
    });
    expect(okLogin.status).toBe(200);
    expect(sessionCookie(okLogin.setCookie)).toBeDefined();

    const wrongPassword = await api(app.base, "/api/mvp/auth/login", {
      method: "POST",
      body: { email: user.email, password: "definitely-not-it" },
    });
    const unknownEmail = await api(app.base, "/api/mvp/auth/login", {
      method: "POST",
      body: { email: `nobody-${crypto.randomUUID().slice(0, 8)}@test.invalid`, password: "definitely-not-it" },
    });

    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });

  itDb("refuses a suspended account at login", async () => {
    const user = await createUser({ status: "suspended" });
    const res = await api(app.base, "/api/mvp/auth/login", {
      method: "POST",
      body: { email: user.email, password: user.password },
    });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("ACCOUNT_NOT_ACTIVE");
  });

  itDb("revokes the session on logout — the same cookie stops working", async () => {
    const user = await createUser();
    const cookie = sessionCookie(
      (
        await api(app.base, "/api/mvp/auth/login", {
          method: "POST",
          body: { email: user.email, password: user.password },
        })
      ).setCookie,
    )!;

    const before = await api(app.base, "/api/mvp/auth/me", { cookie });
    expect(before.status).toBe(200);

    const logout = await api(app.base, "/api/mvp/auth/logout", { method: "POST", cookie });
    expect(logout.status).toBe(200);
    expect(logout.body.data.revoked).toBe(true);

    const after = await api(app.base, "/api/mvp/auth/me", { cookie });
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe("UNAUTHORIZED");
  });

  itDb("treats a token for a user that does not exist as unauthenticated", async () => {
    const ghost = `velnox_session=${(await import("jsonwebtoken")).default.sign(
      { userId: crypto.randomUUID(), email: "ghost@test.invalid" },
      process.env.JWT_SECRET as string,
      { expiresIn: "5m" },
    )}`;
    const res = await api(app.base, "/api/mvp/auth/me", { cookie: ghost });
    expect(res.status).toBe(401);
  });

  itDb("parks OAuth explicitly instead of pretending it works", async () => {
    const res = await api(app.base, "/api/mvp/auth/oauth");
    expect(res.status).toBe(501);
    expect(res.body.error.code).toBe("OAUTH_PARKED");
  });

  itDb("bootstrap-owner: fails closed without a secret, then creates exactly one owner", async () => {
    const previous = process.env.BOOTSTRAP_OWNER_SECRET;
    // The endpoint only works while NO admin/owner exists. Other fixture files
    // create admins, so temporarily demote them and restore the exact roles
    // afterwards — the guard itself is what is under test here.
    const demoted = await query(
      `UPDATE users SET role = 'customer' WHERE role IN ('admin', 'owner') RETURNING id, role`,
    );
    const originalRoles = demoted.rows as Array<{ id: string; role: string }>;
    try {
      delete process.env.BOOTSTRAP_OWNER_SECRET;
      const disabled = await api(app.base, "/api/mvp/auth/bootstrap-owner", {
        method: "POST",
        body: { email: `owner-${crypto.randomUUID().slice(0, 8)}@test.invalid`, password: "owner-password", secret: "x" },
      });
      expect(disabled.status).toBe(503);
      expect(disabled.body.error.code).toBe("BOOTSTRAP_DISABLED");

      process.env.BOOTSTRAP_OWNER_SECRET = "test-bootstrap-secret";
      const email = `owner-${crypto.randomUUID().slice(0, 8)}@test.invalid`;
      const wrong = await api(app.base, "/api/mvp/auth/bootstrap-owner", {
        method: "POST",
        body: { email, password: "owner-password", secret: "wrong" },
      });
      expect(wrong.status).toBe(403);

      const created = await api(app.base, "/api/mvp/auth/bootstrap-owner", {
        method: "POST",
        body: { email, password: "owner-password", secret: "test-bootstrap-secret" },
      });
      expect(created.status).toBe(201);
      expect(created.body.data.user.role).toBe("owner");

      const again = await api(app.base, "/api/mvp/auth/bootstrap-owner", {
        method: "POST",
        body: { email: `owner2-${crypto.randomUUID().slice(0, 8)}@test.invalid`, password: "owner-password", secret: "test-bootstrap-secret" },
      });
      expect(again.status).toBe(409);
      expect(again.body.error.code).toBe("OWNER_EXISTS");
    } finally {
      if (previous === undefined) delete process.env.BOOTSTRAP_OWNER_SECRET;
      else process.env.BOOTSTRAP_OWNER_SECRET = previous;
      for (const row of originalRoles) {
        await query(`UPDATE users SET role = $2 WHERE id = $1 AND role = 'customer'`, [
          row.id,
          row.role,
        ]);
      }
    }
  });
});
