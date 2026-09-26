/**
 * GET /api/admin/products/moderation — server-side pagination, EXECUTED.
 *
 * The endpoint used to end at `ORDER BY p.created_at DESC`: every matching
 * product with its full image list came back to VelCenter on every load and
 * every realtime refetch — the moderation queue downloaded the whole table to
 * render one page of it. It is now bounded (default 25 / max 100), ordered
 * deterministically (`p.created_at DESC, p.id DESC` — `created_at` alone is not
 * unique) and returns the exact filtered count as `pagination.total`.
 *
 * A static assertion cannot prove that a page past the end still reports the
 * real total, or that two pages never repeat a row. These tests boot the real
 * route on a throwaway HTTP listener against a real (disposable) PostgreSQL,
 * seed more rows than one page holds, and count real rows.
 *
 * DB-gated — skipped unless `TEST_DATABASE_URL` points at a validated test
 * database AND `JWT_SECRET` is set (see `helpers/test-db.ts`). The pool itself
 * refuses a production target, so this can never reach live data. Fixtures use a
 * random suffix and are removed in `afterAll`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { Server } from "http";
import type { AddressInfo } from "net";
import cookieParser from "cookie-parser";
import express from "express";
import jwt from "jsonwebtoken";
import { query } from "../db/index.js";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "../lib/pagination.js";
import { setupProductRoutes } from "../routes/products.js";
import { purgeUsers } from "./helpers/purge.js";
import { hasTestDatabase } from "./helpers/test-db.js";

/** More rows than one default page holds, so a short page is provably not a total. */
const SEEDED = 30;

/** Two of the rows share a `created_at`, so the `id` tie-break is load-bearing. */
const TIE_AT = 10;

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

describe("GET /api/admin/products/moderation over HTTP (needs a test database + JWT_SECRET)", () => {
  let server: Server | undefined;
  let base = "";
  let ownerId = "";
  let customerId = "";
  let shopId = "";
  let marker = "";
  const seededUserIds: string[] = [];
  const seededProductIds: string[] = [];

  beforeAll(async () => {
    // The listener needs no database, so it always starts: that keeps the
    // harness itself under test here rather than only where a DB exists.
    const app = express();
    app.use(cookieParser());
    app.use(express.json({ limit: "1mb" }));
    setupProductRoutes(app);
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    if (!hasDb) return;

    const suffix = crypto.randomUUID().slice(0, 8);
    marker = `mod-page-${suffix}`;

    // `owner` holds every code, so `products.moderate` is satisfied without an
    // `employees` row (see lib/permissions.ts).
    const owner = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'owner') RETURNING id",
      [`${marker}-owner@test.invalid`, "Moderation Owner"],
    );
    ownerId = owner.rows[0].id;
    seededUserIds.push(ownerId);

    // The negative control: a real account that must NOT be able to read the queue.
    const customer = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'customer') RETURNING id",
      [`${marker}-customer@test.invalid`, "Not A Moderator"],
    );
    customerId = customer.rows[0].id;
    seededUserIds.push(customerId);

    const sellerUser = await query(
      "INSERT INTO users (email, name, role) VALUES ($1, $2, 'customer') RETURNING id",
      [`${marker}-seller@test.invalid`, "Queued Seller"],
    );
    const sellerUserId = sellerUser.rows[0].id;
    seededUserIds.push(sellerUserId);

    const seller = await query(
      "INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id",
      [sellerUserId],
    );
    const shop = await query(
      "INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
      [seller.rows[0].id, `${marker} shop`, `${marker}-shop`],
    );
    shopId = shop.rows[0].id;

    for (let i = 0; i < SEEDED; i++) {
      // Distinct `created_at` values so the deterministic order has something to
      // order by — except for one deliberate tie (TIE_AT / TIE_AT + 1), where the
      // `id` half of `created_at DESC, id DESC` is the only thing keeping paging
      // from repeating or skipping a row.
      const minutes = i === TIE_AT + 1 ? TIE_AT : i;
      const p = await query(
        `INSERT INTO products (shop_id, name, slug, price, status, created_at)
         VALUES ($1, $2, $3, 199.00, 'pending_review', NOW() - ($4 || ' minutes')::interval)
         RETURNING id`,
        [shopId, `${marker}-${i}`, `${marker}-${i}`, String(minutes)],
      );
      seededProductIds.push(p.rows[0].id as string);
    }
  });

  afterAll(async () => {
    // products / shops / sellers cascade from `users`; the shared purge only
    // exists for the two NO ACTION children (orders, reviewed_by).
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

  /** Only this fixture's products can match `marker`, so other suites cannot move the count. */
  function listProducts(qs: string, userId: string): Promise<Response> {
    return fetch(
      `${base}/api/admin/products/moderation?status=pending_review&q=${encodeURIComponent(marker)}${qs}`,
      { headers: { cookie: sessionCookie(userId) } },
    );
  }

  test("reaches the real route: no session cookie is rejected before any query", async () => {
    // Runs without a test database. It proves the harness is driving the actual
    // registered handler — a 401 from `requireAuth` can only come from inside the
    // route — so the cases below fail for pagination reasons, not plumbing ones.
    const res = await fetch(`${base}/api/admin/products/moderation`);
    expect(res.status).toBe(401);
    expect((await res.json()).error.code).toBe("UNAUTHORIZED");
  });

  itDb("an authenticated account without products.moderate gets 403 FORBIDDEN, not the queue", async () => {
    const res = await listProducts("", customerId);
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  itDb("pagination.total is the EXACT count, independent of the page size", async () => {
    // A caller that only needs the number asks for one row and still learns the
    // whole filtered size.
    const res = await listProducts("&limit=1", ownerId);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.data.products)).toBe(true);
    expect(body.data.products).toHaveLength(1);
    expect(body.data.pagination.total).toBe(SEEDED);
    expect(body.data.pagination.totalPages).toBe(SEEDED);
    expect(body.data.pagination.hasMore).toBe(true);
    expect(body.data.pagination.page).toBe(1);
    expect(body.data.pagination.limit).toBe(1);
  });

  itDb("an absent limit is one bounded default page, never the whole table", async () => {
    const res = await listProducts("", ownerId);
    const body = await res.json();

    expect(body.data.pagination.limit).toBe(DEFAULT_PAGE_SIZE);
    expect(body.data.products).toHaveLength(DEFAULT_PAGE_SIZE);
    expect(body.data.products.length).toBeLessThan(SEEDED);
    // The old handler returned all 30 rows here.
    expect(body.data.pagination.total).toBe(SEEDED);
    expect(body.data.pagination.totalPages).toBe(2);
    expect(body.data.pagination.hasMore).toBe(true);
  });

  itDb("a client cannot ask for an unbounded page", async () => {
    const res = await listProducts("&limit=100000", ownerId);
    const body = await res.json();

    expect(body.data.pagination.limit).toBe(MAX_PAGE_SIZE);
    expect(body.data.products.length).toBeLessThanOrEqual(MAX_PAGE_SIZE);
  });

  itDb("consecutive pages are disjoint and cover the rows exactly once", async () => {
    const first = await (await listProducts("&page=1&limit=10", ownerId)).json();
    const second = await (await listProducts("&page=2&limit=10", ownerId)).json();

    const ids1 = first.data.products.map((p: { id: string }) => p.id);
    const ids2 = second.data.products.map((p: { id: string }) => p.id);

    expect(ids1).toHaveLength(10);
    expect(ids2).toHaveLength(10);
    expect(ids1.filter((id: string) => ids2.includes(id))).toHaveLength(0);
    expect(first.data.pagination.total).toBe(SEEDED);
    expect(second.data.pagination.total).toBe(SEEDED);
  });

  itDb("paging the seeded set returns every row exactly once, in (created_at DESC, id DESC) order", async () => {
    // This is the property the tie-break exists for: two rows share `created_at`,
    // so an incomplete order would let one page repeat or skip it.
    const pages = await Promise.all(
      [1, 2, 3].map(async (page) => (await listProducts(`&page=${page}&limit=10`, ownerId)).json()),
    );
    const flat = pages.flatMap((body) =>
      body.data.products.map((p: { id: string }) => p.id as string),
    );

    expect(flat).toHaveLength(SEEDED);
    expect(new Set(flat).size).toBe(SEEDED);

    const expected = await query(
      "SELECT id FROM products WHERE shop_id = $1 ORDER BY created_at DESC, id DESC",
      [shopId],
    );
    expect(flat).toEqual(expected.rows.map((r: { id: string }) => r.id));
  });

  itDb("a page past the end reports the real total and no rows", async () => {
    // The window-function count is unavailable with no rows, so the handler's
    // fallback count query is what keeps this from reporting a total of 0.
    const res = await listProducts("&page=99&limit=1", ownerId);
    const body = await res.json();

    expect(body.data.products).toHaveLength(0);
    expect(body.data.pagination.total).toBe(SEEDED);
    expect(body.data.pagination.hasMore).toBe(false);
  });

  itDb("the window-function column never reaches the payload", async () => {
    const res = await listProducts("&limit=1", ownerId);
    expect(await res.text()).not.toContain("total_count");
  });
});
