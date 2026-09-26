/**
 * Admin queue pagination.
 *
 * Admin lists that return "everything" are a production liability the moment a
 * table grows, and a count derived from a truncated page is worse than no count:
 * the VelCenter overview badge used to be the length of a `LIMIT 200` result, so
 * at 201 pending verifications it silently read 200.
 *
 * These tests cover:
 *   1. the clamping rules themselves, exhaustively, as pure functions;
 *   2. the wiring that makes them real — the verification AND seller queues must
 *      page with a deterministic order, expose the exact filtered count as
 *      `pagination.total`, and the VelCenter counters must read an exact count
 *      instead of measuring a fetched list;
 *   3. that a non-integer/absent/negative page or limit cannot be handed to SQL.
 *
 * Unit + static assertions only — no database required.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  pageMeta,
  pageOffset,
  parseLimit,
  parsePage,
} from "../lib/pagination.js";

const root = join(import.meta.dir, "..", "..");
const verificationSrc = readFileSync(join(root, "backend", "routes", "verification.ts"), "utf8");
const sellerSrc = readFileSync(join(root, "backend", "routes", "seller.ts"), "utf8");
const apiRoutesSrc = readFileSync(join(root, "packages", "shared", "src", "lib", "api-routes.ts"), "utf8");
const queueSrc = readFileSync(
  join(root, "apps", "velcenter", "src", "components", "SellerVerificationQueue.tsx"),
  "utf8",
);
const centerSrc = readFileSync(join(root, "apps", "velcenter", "src", "pages", "Center.tsx"), "utf8");

describe("page / limit parsing", () => {
  test("an absent page is page 1", () => {
    expect(parsePage(undefined)).toBe(1);
    expect(parsePage(null)).toBe(1);
    expect(parsePage("")).toBe(1);
  });

  test("a malformed or out-of-range page falls back to 1, never to SQL", () => {
    for (const raw of ["abc", "0", "-1", "-99", "NaN", " ", "{}", "1e5x"]) {
      const page = parsePage(raw);
      expect(Number.isInteger(page)).toBe(true);
      expect(page).toBeGreaterThanOrEqual(1);
    }
    // "1e5x" parses as 1 with parseInt — the point is that it is an integer, not NaN.
    expect(parsePage("7")).toBe(7);
  });

  test("an absent limit is the default page size", () => {
    expect(parseLimit(undefined)).toBe(DEFAULT_PAGE_SIZE);
    expect(parseLimit("")).toBe(DEFAULT_PAGE_SIZE);
    expect(parseLimit("abc")).toBe(DEFAULT_PAGE_SIZE);
    expect(parseLimit("0")).toBe(DEFAULT_PAGE_SIZE);
    expect(parseLimit("-25")).toBe(DEFAULT_PAGE_SIZE);
  });

  test("a limit can never exceed the ceiling", () => {
    expect(parseLimit(String(MAX_PAGE_SIZE))).toBe(MAX_PAGE_SIZE);
    expect(parseLimit(String(MAX_PAGE_SIZE + 1))).toBe(MAX_PAGE_SIZE);
    expect(parseLimit("100000")).toBe(MAX_PAGE_SIZE);
    expect(parseLimit(1)).toBe(1);
  });

  test("offset is zero-based", () => {
    expect(pageOffset(1, DEFAULT_PAGE_SIZE)).toBe(0);
    expect(pageOffset(2, 25)).toBe(25);
    expect(pageOffset(4, 10)).toBe(30);
  });
});

describe("page metadata", () => {
  test("the last full page reports no more rows", () => {
    const meta = pageMeta(2, 25, 50, 25);
    expect(meta).toEqual({ page: 2, limit: 25, total: 50, totalPages: 2, hasMore: false });
  });

  test("a partial page still knows there are more", () => {
    const meta = pageMeta(1, 25, 60, 25);
    expect(meta.hasMore).toBe(true);
    expect(meta.totalPages).toBe(3);
  });

  test("an empty result set is one page of zero rows, not zero pages", () => {
    const meta = pageMeta(1, 25, 0, 0);
    expect(meta.total).toBe(0);
    expect(meta.totalPages).toBe(1);
    expect(meta.hasMore).toBe(false);
  });

  test("a page past the end reports the real total and no more rows", () => {
    // The rows are empty but the count is not — hasMore must not claim more.
    const meta = pageMeta(9, 25, 30, 0);
    expect(meta.total).toBe(30);
    expect(meta.hasMore).toBe(false);
  });

  test("a negative or NaN total is reported as zero, never NaN", () => {
    expect(pageMeta(1, 25, Number.NaN, 0).total).toBe(0);
    expect(pageMeta(1, 25, -5, 0).total).toBe(0);
  });
});

describe("GET /api/admin/verifications is paginated", () => {
  test("it applies LIMIT/OFFSET from the shared helpers", () => {
    expect(verificationSrc).toContain('import { pageMeta, pageOffset, parseLimit, parsePage } from "../lib/pagination.js"');
    expect(verificationSrc).toContain("const limit = parseLimit(req.query.limit)");
    expect(verificationSrc).toContain("const page = parsePage(req.query.page)");
    expect(verificationSrc).toContain("const offset = pageOffset(page, limit)");
    expect(verificationSrc).toContain("LIMIT $${params.length + 1} OFFSET $${params.length + 2}`");
    expect(verificationSrc).toContain("[...params, limit, offset]");
  });

  test("the old hard cap is gone, so the queue is no longer silently truncated at 200", () => {
    expect(verificationSrc).not.toContain("LIMIT 200");
  });

  test("the order is deterministic, so paging cannot skip or repeat a row", () => {
    expect(verificationSrc).toContain("ORDER BY sv.submitted_at DESC NULLS LAST, sv.created_at DESC, sv.id DESC");
  });

  test("the exact filtered count is returned as pagination.total", () => {
    expect(verificationSrc).toContain("COUNT(*) OVER() AS total_count");
    expect(verificationSrc).toContain("pagination: pageMeta(page, limit, total, sellers.length)");
    // A page past the end returns no rows, so the count must come from a query.
    expect(verificationSrc).toContain("if (!sellerRes.rows.length && page > 1)");
  });

  test("the window-function column never leaks into the payload", () => {
    expect(verificationSrc).toContain("delete clean.total_count");
  });

  test("the limit/offset parameters cannot be swallowed by the filter params", () => {
    // Filters push into `params`; the page values are appended in the call, so the
    // two index families can never collide.
    expect(verificationSrc).toContain("const params: unknown[] = [];");
    const call = verificationSrc.indexOf("[...params, limit, offset]");
    const filters = verificationSrc.indexOf("params.push(`%${search}%`)");
    expect(filters).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(filters);
  });
});

describe("the pagination contract is consumed, not just produced", () => {
  test("the shared action forwards page and limit", () => {
    const line = apiRoutesSrc.split("\n").find((l) => l.includes('"api.admin.verifications"')) ?? "";
    expect(line).toContain("page=${a.page}");
    expect(line).toContain("limit=${a.limit}");
  });

  test("the queue asks for a bounded page and never merges per-status lists", () => {
    expect(queueSrc).toContain("const PAGE_SIZE = 25");
    expect(queueSrc).toContain("page,");
    expect(queueSrc).toContain("limit: PAGE_SIZE");
    expect(queueSrc).toContain("setPagination(res?.pagination ?? null)");
    expect(queueSrc).not.toContain("Promise.all(");
  });

  test("the queue renders previous/next controls and an exact total", () => {
    expect(queueSrc).toContain("pagination?.hasMore");
    expect(queueSrc).toContain("pagination?.total ?? rows.length");
    expect(queueSrc).toContain("setPage((p) => p + 1)");
    expect(queueSrc).toContain("setPage((p) => Math.max(p - 1, 1))");
  });

  test("search is a server query, so it is not limited to the current page", () => {
    expect(queueSrc).toContain("q: query || undefined");
    expect(queueSrc).toContain("setQuery(search.trim())");
    // The client-side filter over the current page is gone.
    expect(queueSrc).not.toContain("const filtered = useMemo");
  });

  test("the VelCenter overview counter reads the exact count, not a page length", () => {
    expect(centerSrc).toContain('verificationsAction({ status: "pending", limit: 1 })');
    expect(centerSrc).toContain("setPendingVerifications(Number(pending?.pagination?.total ?? 0))");
    // Counting fetched rows is what made the badge wrong past one page.
    expect(centerSrc).not.toContain('.filter((v) => v.status === "pending").length');
  });
});

describe("GET /api/admin/sellers is paginated", () => {
  test("it applies LIMIT/OFFSET from the shared helpers", () => {
    expect(sellerSrc).toContain('import { pageMeta, pageOffset, parseLimit, parsePage } from "../lib/pagination.js"');
    expect(sellerSrc).toContain("const limit = parseLimit(req.query.limit)");
    expect(sellerSrc).toContain("const page = parsePage(req.query.page)");
    expect(sellerSrc).toContain("const offset = pageOffset(page, limit)");
    expect(sellerSrc).toContain("LIMIT $${params.length + 1} OFFSET $${params.length + 2}`");
    expect(sellerSrc).toContain("[...params, limit, offset]");
  });

  test("the unbounded seller list is gone", () => {
    // The handler used to end at `ORDER BY s.created_at DESC`, returning every
    // seller with joins on every dashboard load and every realtime refetch.
    expect(sellerSrc).not.toContain("ORDER BY s.created_at DESC`,");
  });

  test("the order is deterministic, so paging cannot skip or repeat a row", () => {
    expect(sellerSrc).toContain("ORDER BY s.created_at DESC, s.id DESC");
  });

  test("the exact filtered count is returned as pagination.total", () => {
    expect(sellerSrc).toContain("COUNT(*) OVER() AS total_count");
    expect(sellerSrc).toContain("pagination: pageMeta(page, limit, total, sellers.length)");
    // A page past the end returns no rows, so the count must come from a query.
    expect(sellerSrc).toContain("if (!result.rows.length && page > 1)");
  });

  test("the window-function column never leaks into the payload", () => {
    const from = sellerSrc.indexOf("const sellers = result.rows.map");
    const to = sellerSrc.indexOf("res.json({", from);
    expect(from).toBeGreaterThan(-1);
    expect(to).toBeGreaterThan(from);
    const mapper = sellerSrc.slice(from, to);
    // The row mapper builds an explicit object, so `total_count` has no path out.
    expect(mapper).not.toContain("total_count");
    expect(mapper).not.toContain("...row");
  });

  test("the limit/offset parameters cannot be swallowed by the filter params", () => {
    expect(sellerSrc).toContain("const params: unknown[] = [];");
    const call = sellerSrc.indexOf("[...params, limit, offset]");
    const filters = sellerSrc.indexOf("where.push(`(sh.name ILIKE $${params.length}");
    expect(filters).toBeGreaterThan(-1);
    expect(call).toBeGreaterThan(filters);
  });
});

describe("the seller + product counters read exact counts, not page lengths", () => {
  test("the seller action forwards page and limit", () => {
    const line = apiRoutesSrc.split("\n").find((l) => l.includes('"api.centerAdmin.sellerList"')) ?? "";
    expect(line).toContain("page=${a.page}");
    expect(line).toContain("limit=${a.limit}");
  });

  test("the sellers counter asks for limit 1 and reads pagination.total", () => {
    // Same shape as the verification counter: a bounded page + the exact count.
    expect(centerSrc).toContain('sellerListAction({ status: "pending", limit: 1 })');
    expect(centerSrc).toContain("setPendingSellers(Number(pending?.pagination?.total ?? 0))");
    // Counting fetched rows is what made the badge wrong past one page.
    expect(centerSrc).not.toContain("(sellerRows ?? []).filter");
    expect(centerSrc).not.toContain("setSellerRows(");
  });

  test("the product counter reads the dashboard COUNT, not the unbounded list", () => {
    // GET /api/admin/products/moderation has no LIMIT yet (its handler lives past
    // the edit window in products.ts), so the dashboard must not download every
    // product row into the browser to measure a badge.
    expect(centerSrc).toContain("setPendingProducts(Number(counts?.pendingProducts ?? 0))");
    expect(centerSrc).toContain("useAction(api.centerAdmin.dashboardCounts)");
    expect(centerSrc).not.toContain("(modProducts ?? []).filter");
    expect(centerSrc).not.toContain("setModProducts(");
  });
});
