/**
 * `/api/_diag` access control.
 *
 * `GET /api/_diag/schema` shipped publicly reachable with no authentication, so
 * any anonymous caller could read the schema shape, the applied migration set,
 * product counts by status, notification counts by type and audit-log row counts
 * — a free reconnaissance pass over the deployment. It is now guarded at the
 * prefix by `requireDiagAccess` (owner/admin only).
 *
 * These tests cover three layers:
 *   1. the decision rule, as a pure function;
 *   2. the composed middleware over a REAL HTTP round trip — anonymous and
 *      invalid sessions (always run, no database) plus customer/seller/staff
 *      refusals and the owner/admin admission (needs DATABASE_URL + JWT_SECRET);
 *   3. the wiring in `server.ts`, which must keep guarding the prefix rather
 *      than the single route, so a diagnostic added later is guarded by default.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import type { Server } from "http";
import type { AddressInfo } from "net";
import { join } from "path";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import { query } from "../db/index.js";
import { DIAG_ALLOWED_ROLES, isDiagRoleAllowed, requireDiagAccess } from "../middleware/diag-guard.js";

const root = join(import.meta.dir, "..", "..");
const serverSrc = readFileSync(join(root, "backend/server.ts"), "utf8");
const guardSrc = readFileSync(join(root, "backend/middleware/diag-guard.ts"), "utf8");

// ─── The rule ──────────────────────────────────────────────────────────────

describe("isDiagRoleAllowed", () => {
  test("admits exactly owner and admin", () => {
    expect(isDiagRoleAllowed("owner")).toBe(true);
    expect(isDiagRoleAllowed("admin")).toBe(true);
    expect(DIAG_ALLOWED_ROLES).toEqual(["owner", "admin"]);
  });

  test("refuses staff, seller and customer", () => {
    // `staff` is the interesting one: it is a VelCenter role, but infrastructure
    // internals are not a permission that can be granted — even a staff member
    // holding every catalog code is refused here.
    expect(isDiagRoleAllowed("staff")).toBe(false);
    expect(isDiagRoleAllowed("seller")).toBe(false);
    expect(isDiagRoleAllowed("customer")).toBe(false);
  });

  test("refuses anything that is not a clean role string", () => {
    // Near-misses a looser check would let through.
    for (const role of ["", " ", "Owner", "OWNER", "owner ", " admin", "administrator", "superadmin", "admin\n"]) {
      expect(isDiagRoleAllowed(role)).toBe(false);
    }
    expect(isDiagRoleAllowed(null)).toBe(false);
    expect(isDiagRoleAllowed(undefined)).toBe(false);
  });
});

describe("requireDiagAccess composition", () => {
  test("authentication runs before the role lookup", () => {
    // Order is the whole point: the role lookup needs req.user, and a request
    // with no valid session must be answered 401 by requireAuth, not 403.
    expect(guardSrc).toContain("export const requireDiagAccess: RequestHandler[] = [requireAuth, requireDiagRole]");
  });

  test("the role lookup fails closed on a database error", () => {
    expect(guardSrc).toContain("AUTH_LOOKUP_FAILED");
    expect(guardSrc).toContain("status(503)");
    // …and it resolves the role through the shared source of truth.
    expect(guardSrc).toContain('import { roleOf } from "../lib/permissions.js"');
  });
});

// ─── The wiring in server.ts ───────────────────────────────────────────────

describe("server wiring", () => {
  test("the /api/_diag prefix is guarded, not just the one route", () => {
    expect(serverSrc).toContain('app.use("/api/_diag", ...requireDiagAccess)');
    expect(serverSrc).toContain('import { requireDiagAccess } from "./middleware/diag-guard.js"');
  });

  test("the guard is registered before the diagnostic route it protects", () => {
    const guardAt = serverSrc.indexOf('app.use("/api/_diag", ...requireDiagAccess)');
    const routeAt = serverSrc.indexOf('app.get("/api/_diag/schema"');
    expect(guardAt).toBeGreaterThan(-1);
    expect(routeAt).toBeGreaterThan(-1);
    expect(guardAt).toBeLessThan(routeAt);
  });

  test("no diagnostic route escapes the prefix", () => {
    // Every /api/_diag registration must sit on the guarded path. A route added
    // under a different prefix (e.g. /api/diag) would bypass the guard.
    const diagRegistrations = serverSrc.match(/app\.(get|post|patch|put|delete)\("\/api\/[^"]*_diag[^"]*"/g) ?? [];
    expect(diagRegistrations.length).toBe(1);
    expect(diagRegistrations[0]).toContain('"/api/_diag/schema"');
    expect(serverSrc).not.toContain('"/api/diag');
  });
});

// ─── Real HTTP: the cases that need no database ────────────────────────────

describe("requireDiagAccess over HTTP", () => {
  let server: Server | undefined;
  let base = "";
  let handlerHits = 0;

  beforeAll(async () => {
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "1mb" }));
    // Exactly how server.ts composes it, with a stub handler so "did the request
    // get past the guard?" is observable.
    app.use("/api/_diag", ...requireDiagAccess);
    app.get("/api/_diag/schema", (_req, res) => {
      handlerHits += 1;
      res.json({ success: true, data: { reached: true } });
    });
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  test("an anonymous request is refused with 401 and never reaches the handler", async () => {
    const res = await fetch(`${base}/api/_diag/schema`);
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.success).toBe(false);
    expect(body.error.code).toBe("UNAUTHORIZED");
    // The vulnerability was that this returned the payload to anyone.
    expect(handlerHits).toBe(0);
  });

  test("a forged or garbage session cookie is refused with 401", async () => {
    const res = await fetch(`${base}/api/_diag/schema`, {
      headers: { cookie: "velnox_session=not-a-real-token" },
    });
    expect(res.status).toBe(401);
    expect(handlerHits).toBe(0);
  });
});

// ─── Real HTTP: role enforcement (needs DATABASE_URL + JWT_SECRET) ─────────

const hasDb = Boolean(process.env.DATABASE_URL && process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

describe("requireDiagAccess role enforcement (needs DATABASE_URL + JWT_SECRET)", () => {
  let server: Server | undefined;
  let base = "";
  const createdIds: string[] = [];
  const ownerId = { value: "" };
  const adminId = { value: "" };
  const staffId = { value: "" };
  const customerId = { value: "" };
  const sellerId = { value: "" };

  async function makeUser(role: string): Promise<string> {
    const res = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id",
      [`diag-guard-${role}-${crypto.randomUUID().slice(0, 8)}@test.invalid`, `Diag ${role}`, role],
    );
    const id = res.rows[0].id as string;
    createdIds.push(id);
    return id;
  }

  beforeAll(async () => {
    if (!hasDb) return;

    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "1mb" }));
    app.use("/api/_diag", ...requireDiagAccess);
    app.get("/api/_diag/schema", (_req, res) => res.json({ success: true, data: { reached: true } }));
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    ownerId.value = await makeUser("owner");
    adminId.value = await makeUser("admin");
    staffId.value = await makeUser("staff");
    customerId.value = await makeUser("customer");
    sellerId.value = await makeUser("seller");
  });

  afterAll(async () => {
    if (hasDb && createdIds.length > 0) {
      await query("DELETE FROM users WHERE id = ANY($1::uuid[])", [createdIds]);
    }
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  function call(userId: string): Promise<Response> {
    const token = jwt.sign({ userId, email: `${userId}@test.invalid` }, process.env.JWT_SECRET!, { expiresIn: "5m" });
    return fetch(`${base}/api/_diag/schema`, { headers: { cookie: `velnox_session=${token}` } });
  }

  itDb("admits owner and admin", async () => {
    for (const id of [ownerId.value, adminId.value]) {
      const res = await call(id);
      expect(res.status).toBe(200);
      expect((await res.json()).data.reached).toBe(true);
    }
  });

  itDb("refuses a staff session with 403 even though staff is a VelCenter role", async () => {
    const res = await call(staffId.value);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  itDb("refuses customer and seller sessions with 403", async () => {
    for (const id of [customerId.value, sellerId.value]) {
      const res = await call(id);
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("FORBIDDEN");
    }
  });

  itDb("refuses a session whose account no longer exists", async () => {
    // A valid signature for a deleted user must not resolve to a role.
    const token = jwt.sign({ userId: crypto.randomUUID(), email: "gone@test.invalid" }, process.env.JWT_SECRET!, { expiresIn: "5m" });
    const res = await fetch(`${base}/api/_diag/schema`, { headers: { cookie: `velnox_session=${token}` } });
    expect(res.status).toBe(403);
  });
});
