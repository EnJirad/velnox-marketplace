/**
 * DB client lease/release guard — static (always runs) + DB-gated (executed).
 *
 * Root cause this protects (2026-09-27): `POST /api/admin/sellers/:id/revoke`
 * leased a pool client with `getClient()` and never called `client.release()`.
 * Every call — success, 403, 400, 404 and error paths — permanently consumed
 * one of the pool's 20 connections, so enough revoked shops would exhaust the
 * pool and take every route (Google OAuth included) down with a pool timeout.
 *
 * The static half fails on exactly that shape (a lease with no later release);
 * the runtime half measures the leak's real signature — a client that never
 * returns leaves `pool.idleCount` one lower forever — and carries a negative
 * control proving the probe detects that signature.
 *
 * The runtime cases are skipped unless `TEST_DATABASE_URL` points at a
 * validated test database and `JWT_SECRET` is set (see helpers/test-db.ts).
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import pool, { query } from "../db/index.js";
import { setupSellerRoutes } from "../routes/seller.js";
import { purgeUsers } from "./helpers/purge.js";
import { hasTestDatabase } from "./helpers/test-db.js";

// ─── Static guard: every leased client is released afterwards ───────────────

const LEASE_LINE = /= await getClient\(\);/;
const RELEASE_LINE = /\.release\(\);/;

function leaseAndReleaseLines(file: string): { leases: number[]; releases: number[] } {
  const lines = readFileSync(file, "utf8").split("\n");
  const leases: number[] = [];
  const releases: number[] = [];
  lines.forEach((line, i) => {
    if (LEASE_LINE.test(line)) leases.push(i + 1);
    if (RELEASE_LINE.test(line)) releases.push(i + 1);
  });
  return { leases, releases };
}

describe("client lease/release guard (no database needed)", () => {
  test("the shared withTransaction helper releases its client in a finally block", () => {
    const src = readFileSync(fileURLToPath(new URL("../db/index.ts", import.meta.url)), "utf8");
    expect(src).toMatch(/finally\s*{\s*client\.release\(\);\s*}/);
    // Every lease goes through getClient(), so a refused connection is logged
    // with the same safe fields everywhere.
    expect(src.match(/pool\.connect\(\)/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });

  test("every route module releases each client it leases (guards the shop-revoke leak)", () => {
    const dir = fileURLToPath(new URL("../routes/", import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(5);

    const checked: string[] = [];
    for (const file of files) {
      const { leases, releases } = leaseAndReleaseLines(`${dir}${file}`);
      if (leases.length === 0) continue;
      checked.push(file);
      // The i-th lease must be followed by the i-th release in file order. A
      // handler that leases without releasing (the seller.ts :1263 bug) makes
      // this false: the committed file had 3 leases and only 2 releases.
      expect(releases.length).toBeGreaterThanOrEqual(leases.length);
      leases.forEach((leaseLine, i) => expect(leaseLine).toBeLessThan(releases[i]!));
    }
    // The sweep must actually see the modules that lease clients.
    for (const expected of ["seller.ts", "products.ts", "verification.ts", "auth.ts"]) {
      expect(checked).toContain(expected);
    }
  });

  test("db failure logging never includes the connection string or query parameters", () => {
    const src = readFileSync(fileURLToPath(new URL("../db/index.ts", import.meta.url)), "utf8");
    expect(src).toContain('logDbFailure("query"');
    expect(src).toContain('logDbFailure("connect"');
    for (const consoleLine of src.split("\n").filter((l) => l.includes("console."))) {
      expect(consoleLine).not.toContain("connectionString");
      expect(consoleLine).not.toContain("params");
    }
  });
});

// ─── Runtime proof (needs a test database + JWT_SECRET) ─────────────────────

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

describe("POST /api/admin/sellers/:id/revoke returns its connection to the pool", () => {
  let server: Server | undefined;
  let base = "";
  let ownerId = "";
  let customerId = "";
  let sellerId = "";
  const seededUserIds: string[] = [];

  beforeAll(async () => {
    // The listener needs no database, so it always starts.
    const app = express();
    app.use(express.json({ limit: "1mb" }));
    app.use(cookieParser());
    setupSellerRoutes(app);
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    if (!hasDb) return;

    const marker = `revoke-lease-${crypto.randomUUID().slice(0, 8)}`;
    const owner = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'owner') RETURNING id",
      [`${marker}-owner@test.invalid`, "Revoke Owner"],
    );
    ownerId = owner.rows[0].id;
    seededUserIds.push(ownerId);

    const customer = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'customer') RETURNING id",
      [`${marker}-customer@test.invalid`, "Revoke Customer"],
    );
    customerId = customer.rows[0].id;
    seededUserIds.push(customerId);

    const sellerUser = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'seller') RETURNING id",
      [`${marker}-seller@test.invalid`, "Revoke Seller"],
    );
    seededUserIds.push(sellerUser.rows[0].id);

    const seller = await query(
      "INSERT INTO sellers (user_id, status, verification_status) VALUES ($1, 'approved', 'verified') RETURNING id",
      [sellerUser.rows[0].id],
    );
    sellerId = seller.rows[0].id;

    await query("INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id", [
      sellerId,
      "Revoke Lease Probe Shop",
      `${marker}-shop`,
    ]);
  });

  afterAll(async () => {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    if (hasDb) await purgeUsers(seededUserIds);
  });

  function sessionCookie(userId: string): string {
    const token = jwt.sign({ userId, email: `${userId}@test.invalid` }, process.env.JWT_SECRET!, {
      expiresIn: "5m",
    });
    return `velnox_session=${token}`;
  }

  async function revoke(userId: string, reason: string): Promise<Response> {
    return fetch(`${base}/api/admin/sellers/${sellerId}/revoke`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: sessionCookie(userId) },
      body: JSON.stringify({ reason }),
    });
  }

  /** The leaked client never comes back, so this only settles after a fix. */
  async function idleCountOnceReturned(expected: number): Promise<number> {
    for (let i = 0; i < 80; i++) {
      if (pool.idleCount >= expected) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    return pool.idleCount;
  }

  itDb("success path: the revocation commits and the connection returns to the pool", async () => {
    const before = pool.idleCount;
    const res = await revoke(ownerId, "policy violation");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; data: { sellerId: string; status: string } };
    expect(body.success).toBe(true);
    expect(body.data.sellerId).toBe(sellerId);
    expect(body.data.status).toBe("revoked");

    // Business behaviour preserved: the seller really is suspended.
    const row = await query("SELECT status FROM sellers WHERE id = $1", [sellerId]);
    expect(row.rows[0].status).toBe("suspended");

    // The regression: without `finally { client.release(); }` this is `before - 1`.
    expect(await idleCountOnceReturned(before)).toBeGreaterThanOrEqual(before);
  });

  itDb("a refused caller (403, non-owner) also returns its connection", async () => {
    const before = pool.idleCount;
    const res = await revoke(customerId, "nope");
    expect(res.status).toBe(403);
    expect(await idleCountOnceReturned(before)).toBeGreaterThanOrEqual(before);
  });

  itDb("a failed query logs safe fields only — code, severity, statement keyword, no parameters", async () => {
    const calls: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => {
      calls.push(args.map((a) => (typeof a === "string" ? a : JSON.stringify(a))).join(" "));
    };
    try {
      await expect(
        query("SELECT * FROM no_such_table_lease_probe WHERE secret = $1", ["pii-value"]),
      ).rejects.toThrow();
    } finally {
      console.error = original;
    }
    const logged = calls.join("\n");
    expect(logged).toContain('"code":"42P01"'); // undefined_table — the same log path a 53000 takes
    expect(logged).toContain('"statement":"SELECT"');
    expect(logged).not.toContain("pii-value"); // parameters are never logged
  });

  itDb("negative control: the same probe detects a client that is never released", async () => {
    // Make sure the probe starts from a non-zero idle pool.
    await query("SELECT 1");
    const before = pool.idleCount;
    expect(before).toBeGreaterThan(0);

    const leaked = await pool.connect();
    expect(pool.idleCount).toBe(before - 1); // the leak's exact signature
    leaked.release();
    expect(pool.idleCount).toBe(before); // non-vacuous: the probe can recover
  });
});
