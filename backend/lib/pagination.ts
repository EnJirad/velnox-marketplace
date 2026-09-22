/**
 * Pagination for admin queue endpoints.
 *
 * Every admin list must be bounded: an endpoint that returns "everything" is a
 * production liability the moment the table grows, and a count derived from a
 * truncated page is worse than no count at all. These helpers are the ONE place
 * the rules live so every queue clamps the same way.
 *
 * Contract used by the routes:
 *   - `page` is 1-based; anything absent / malformed / < 1 becomes 1.
 *   - `limit` is clamped to 1..MAX_PAGE_SIZE; absent / malformed becomes
 *     DEFAULT_PAGE_SIZE. A client can never ask for an unbounded page.
 *   - the exact filtered row count is returned as `pagination.total` (from
 *     `COUNT(*) OVER ()`, or a count query when the page is out of range), so a
 *     caller that only needs the number can ask for `limit=1`.
 */

/** Default rows per page for an admin queue. */
export const DEFAULT_PAGE_SIZE = 25;

/** Hard ceiling — a single request may never return more than this many rows. */
export const MAX_PAGE_SIZE = 100;

export interface PageMeta {
  page: number;
  limit: number;
  /** Exact number of rows matching the filters, ignoring LIMIT/OFFSET. */
  total: number;
  totalPages: number;
  hasMore: boolean;
}

/** Parse a 1-based page number from a query value. Invalid input → page 1. */
export function parsePage(raw: unknown): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return n;
}

/** Parse a page size from a query value, clamped to 1..MAX_PAGE_SIZE. */
export function parseLimit(raw: unknown, fallback: number = DEFAULT_PAGE_SIZE): number {
  const n = Number.parseInt(String(raw ?? ""), 10);
  if (!Number.isFinite(n) || n < 1) return fallback;
  return Math.min(n, MAX_PAGE_SIZE);
}

/** Zero-based row offset for a 1-based page. */
export function pageOffset(page: number, limit: number): number {
  return (page - 1) * limit;
}

/**
 * Response metadata for a page.
 *
 * `rowCount` is how many rows this page actually returned — needed because a
 * page past the end returns none, while `total` stays the real count.
 */
export function pageMeta(page: number, limit: number, total: number, rowCount: number): PageMeta {
  const safeTotal = Number.isFinite(total) && total > 0 ? total : 0;
  return {
    page,
    limit,
    total: safeTotal,
    totalPages: Math.max(Math.ceil(safeTotal / limit), 1),
    hasMore: pageOffset(page, limit) + Math.max(rowCount, 0) < safeTotal,
  };
}
