/**
 * GET /api/admin/sellers — server-side pagination, EXECUTED.
 *
 * Admin lists that return "everything" are a production liability the moment a
 * table grows. `/api/admin/sellers` used to end at `ORDER BY s.created_at DESC`:
 * every seller, with the `users` / shops / seller_settings joins and two
 * correlated `seller_verifications` subqueries, on every VelCenter load and
 * every realtime refetch — because the overview badge was the length of that
 * array.
 *
 * The badge now asks for `limit=1` and reads `pagination.total`, so the count
 * must be EXACT no matter which page is requested. A static assertion cannot
 * prove that; these tests boot the real route on a throwaway HTTP listener
 * against a real (disposable) PostgreSQL, seed more rows than one page holds,
 * and count real rows.
 *
 * DB-gated — skipped unless `TEST_DATABASE_URL` points at a validated test
 * database AND `JWT_SECRET` is set (see `helpers/test-db.ts`). The pool itself
 * refuses a production target, so this can never reach live data. Fixtures use
 * a random suffix and are removed in `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "http";
import type { AddressInfo } from "net";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import { query } from "../db/index.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../lib/pagination.js";
import { setupSellerRoutes } from "../routes/seller.js";
import { purgeUsers } from "./helpers/purge.js";
import { hasTestDatabase } from "./helpers/test-db.js";

/** More rows than one default page holds, so a short page is provably not a total. */
const SEEDED = 30;

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

describe("GET /api/admin/sellers over HTTP (needs a test database + JWT_SECRET)", () => {
  let server: Server | undefined;
  let base = "";
  let ownerId = "";
  let customerId = "";
  let marker = "";
  const seededUserIds: string[] = [];

  beforeAll(async () => {
    // The listener needs no database, so it always starts: that keeps the
    // harness itself under test here rather than only where a DB exists.
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "1mb" }));
    setupSellerRoutes(app);
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    if (!hasDb) return;

    const suffix = crypto.randomUUID().slice(0, 8);
    marker = `page-sellers-${suffix}`;

    // `owner` holds every code in the catalog, so `sellers.manage` is satisfied
    // without an `employees` row (see lib/permissions.ts).
    const owner = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'owner') RETURNING id",
      [`page-owner-${suffix}@test.invalid`, "Paging Owner"],
    );
    ownerId = owner.rows[0].id;
    seededUserIds.push(ownerId);

    // The negative control: a real account that must NOT be able to read the queue.
    const customer = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'customer') RETURNING id",
      [`page-customer-${suffix}@test.invalid`, "Not A Reviewer"],
    );
    customerId = customer.rows[0].id;
    seededUserIds.push(customerId);

    for (let i = 0; i < SEEDED; i++) {
      // Distinct `created_at` values so the deterministic order
      // (`created_at DESC, id DESC`) has something real to order by.
      const u = await query(
        "INSERT INTO users (email, name, role) VALUES ($1, $2, 'customer') RETURNING id",
        [`${marker}-${i}@test.invalid`, `Pending Seller ${i}`],
      );
      const uid = u.rows[0].id as string;
      seededUserIds.push(uid);
      await query(
        "INSERT INTO sellers (user_id, status, created_at) VALUES ($1, 'pending', NOW() - ($2 || ' minutes')::interval)",
        [uid, String(i)],
      );
    }
  });

  afterAll(async () => {
    // sellers / shops / seller_settings cascade from `users`; the shared purge
    // only exists for the two NO ACTION children (orders, reviewed_by).
    if (hasDb && seededUserIds.length) await purgeUsers(seededUserIds);
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  });

  // No `jti` → `requireAuth` skips the revocation lookup.
  function sessionCookie(userId: string): string {
    const token = jwt.sign({ userId, email: `${userId}@test.invalid` }, process.env.JWT_SECRET!, {
      expiresIn: "5m",
    });
    return `velnox_session=${token}`;
  }

  /** Only this fixture's sellers can match `marker`, so other suites cannot move the count. */
  function listSellers(qs: string, userId: string): Promise<Response> {
    return fetch(`${base}/api/admin/sellers?status=pending&q=${encodeURIComponent(marker)}${qs}`, {
      headers: { cookie: sessionCookie(userId) },
    });
  }

  test("reaches the real route: no session cookie is rejected before any query", async () => {
    // Runs without a test database. It proves the harness is driving the actual
    // registered handler — a 401 from `requireAuth` can only come from inside the
    // route — so the cases below fail for pagination reasons, not plumbing ones.
    const res = await fetch(`${base}/api/admin/sellers`);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  itDb("a center member without sellers.manage gets 403 FORBIDDEN, not the queue", async () => {
    const res = await listSellers("", customerId);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  itDb("pagination.total is the EXACT count, independent of the page size", async () => {
    // This is the whole point: the badge asks for one row and must still learn
    // that 30 sellers are pending.
    const res = await listSellers("&limit=1", ownerId);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.data.sellers)).toBe(true);
    expect(body.data.sellers).toHaveLength(1);
    expect(body.data.pagination.total).toBe(SEEDED);
    expect(body.data.pagination.totalPages).toBe(SEEDED);
    expect(body.data.pagination.hasMore).toBe(true);
    expect(body.data.pagination.page).toBe(1);
    expect(body.data.pagination.limit).toBe(1);
  });

  itDb("an absent limit is one bounded default page, never the whole table", async () => {
    const res = await listSellers("", ownerId);
    const body = await res.json();

    expect(body.data.pagination.limit).toBe(DEFAULT_PAGE_SIZE);
    expect(body.data.sellers).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(body.data.sellers.length).toBeLessThan(SEEDED);
    // The old handler returned all 30 rows here.
    expect(body.data.pagination.total).toBe(SEEDED);
    expect(body.data.pagination.totalPages).toBe(2);
    expect(body.data.pagination.hasMore).toBe(true);
  });

  itDb("a client cannot ask for an unbounded page", async () => {
    const res = await listSellers("&limit=100000", ownerId);
    const body = await res.json();

    expect(body.data.pagination.limit).toBe(MAX_PAGE_SIZE);
    expect(body.data.sellers.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });

  itDb("consecutive pages are disjoint and cover the rows exactly once", async () => {
    // The property `ORDER BY created_at DESC, id DESC` exists to guarantee: a
    // non-deterministic order would repeat or skip a row under LIMIT/OFFSET.
    const first = await (await listSellers("&page=1&limit=10", ownerId)).json();
    const second = await (await listSellers("&page=2&limit=10", ownerId)).json();

    const ids1 = first.data.sellers.map((s: { id: string }) => s.id);
    const ids2 = second.data.sellers.map((s: { id: string }) => s.id);

    expect(ids1).toHaveLength(10);
    expect(ids2).toHaveLength(10);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
    expect(first.data.pagination.total).toBe(SEEDED);
    expect(second.data.pagination.total).toBe(SEEDED);
  });

  itDb("a page past the end reports the real total and no rows", async () => {
    // The window-function count is unavailable with no rows, so the handler's
    // fallback count query is what keeps this from reporting a total of 0.
    const res = await listSellers("&page=99&limit=1", ownerId);
    const body = await res.json();

    expect(body.data.sellers).toHaveLength(0);
    expect(body.data.pagination.total).toBe(SEEDED);
    expect(body.data.pagination.hasMore).toBe(false);
  });

  itDb("the window-function column never reaches the payload", async () => {
    const res = await listSellers("&limit=1", ownerId);
    expect(await res.text()).not.toContain("total_count");
  });
});
