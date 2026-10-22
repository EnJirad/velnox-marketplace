/**
 * MVP product reviews.
 *
 * The original product experience let any signed-in shopper write ONE review per
 * product (create, then edit or delete the same row) and showed a
 * verified-purchase marker when the reviewer had actually bought it. That is the
 * behaviour restored here, on the canonical tables:
 *
 *   • `product_reviews` has `UNIQUE (product_id, user_id)`, so the POST is an
 *     atomic upsert — two concurrent submissions collapse into one row instead of
 *     racing a SELECT→INSERT;
 *   • the verified-purchase flag is DERIVED from `orders` + `order_items` at read
 *     time, never stored from a client claim, so it cannot be forged;
 *   • a review is visible only while its product is published and its seller
 *     approved, the same predicate as the catalogue;
 *   • only the author may edit or delete a row (`WHERE user_id = $session`).
 *
 * Ratings are aggregated in SQL and returned as a display summary; nothing in
 * the frontend recomputes them.
 */
import type { Express, Request, Response } from "express";
import { query } from "../db/index.js";
import { pageMeta, pageOffset, parseLimit, parsePage } from "../lib/pagination.js";
import {
  badRequest,
  forbidden,
  notFound,
  ok,
  optionalString,
  requireActiveUser,
  requireInt,
  route,
} from "./http.js";

/** Longest comment the schema accepts. */
export const MAX_REVIEW_COMMENT = 2000;

interface ReviewRow {
  id: string;
  rating: number;
  comment: string;
  created_at: string;
  updated_at: string;
  author_name: string;
  author_avatar_url: string | null;
  verified_purchase: boolean;
}

function reviewPayload(row: ReviewRow) {
  return {
    id: row.id,
    rating: Number(row.rating),
    comment: row.comment,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    authorName: row.author_name || "Velnox shopper",
    authorAvatarUrl: row.author_avatar_url,
    verifiedPurchase: Boolean(row.verified_purchase),
  };
}

/** One page of published reviews for a published product. */
async function listReviews(productId: string, page: number, limit: number) {
  const result = await query(
    `SELECT r.id, r.rating, r.comment, r.created_at, r.updated_at,
            u.name AS author_name, u.avatar_url AS author_avatar_url,
            EXISTS (
              SELECT 1
                FROM order_items oi
                JOIN orders o ON o.id = oi.order_id
               WHERE oi.product_id = r.product_id
                 AND o.user_id = r.user_id
                 AND o.status IN ('paid', 'processing', 'shipped', 'delivered')
            ) AS verified_purchase,
            COUNT(*) OVER ()::int AS total_count
       FROM product_reviews r
       JOIN users u ON u.id = r.user_id
      WHERE r.product_id = $1 AND r.status = 'published'
      ORDER BY r.created_at DESC
      LIMIT $2 OFFSET $3`,
    [productId, limit, pageOffset(page, limit)],
  );
  const rows = result.rows as Array<ReviewRow & { total_count: number }>;
  const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
  return { reviews: rows.map(reviewPayload), pagination: pageMeta(page, limit, total, rows.length) };
}

/** Average, count and the 5→1 histogram, all computed by the database. */
async function reviewSummary(productId: string) {
  const result = await query(
    `SELECT COUNT(*)::int AS count,
            COALESCE(ROUND(AVG(rating)::numeric, 1), 0) AS average
       FROM product_reviews
      WHERE product_id = $1 AND status = 'published'`,
    [productId],
  );
  const row = result.rows[0] as { count: number; average: string };
  const histogram = await query(
    `SELECT rating, COUNT(*)::int AS count
       FROM product_reviews
      WHERE product_id = $1 AND status = 'published'
      GROUP BY rating`,
    [productId],
  );
  const distribution: Record<string, number> = { "1": 0, "2": 0, "3": 0, "4": 0, "5": 0 };
  for (const entry of histogram.rows as Array<{ rating: number; count: number }>) {
    distribution[String(entry.rating)] = Number(entry.count);
  }
  return {
    count: Number(row.count),
    average: Number(row.average),
    distribution,
  };
}

async function publishedProductBySlug(slug: string): Promise<{ id: string } | null> {
  const result = await query(
    `SELECT p.id
       FROM products p
       JOIN seller_profiles sp ON sp.id = p.seller_id AND sp.status = 'approved'
      WHERE p.slug = $1 AND p.status = 'published'`,
    [slug],
  );
  return (result.rows[0] as { id: string } | undefined) ?? null;
}

function validateReview(body: Record<string, unknown>): { rating: number; comment: string } {
  const rating = requireInt(body.rating, "rating", { min: 1, max: 5 });
  const raw = optionalString(body.comment, "comment", { max: MAX_REVIEW_COMMENT });
  if (!raw) throw badRequest("REVIEW_COMMENT_REQUIRED", "A comment is required");
  return { rating, comment: raw };
}

export function setupMvpReviewRoutes(app: Express): void {
  // ── Public list + summary ────────────────────────────────────────────────
  app.get(
    "/api/mvp/products/:slug/reviews",
    route(async (req: Request, res: Response) => {
      const slug = optionalString(req.params.slug, "slug", { max: 120 });
      if (!slug) throw badRequest("INVALID_INPUT", "slug is required");
      const product = await publishedProductBySlug(slug);
      if (!product) throw notFound("PRODUCT_NOT_FOUND", "Product not found");

      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit, 5);
      const [list, summary] = await Promise.all([
        listReviews(product.id, page, limit),
        reviewSummary(product.id),
      ]);
      ok(res, { ...list, summary });
    }),
  );

  // ── The viewer's own review + eligibility ────────────────────────────────
  app.get(
    "/api/mvp/products/:slug/reviews/me",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const slug = optionalString(req.params.slug, "slug", { max: 120 });
      if (!slug) throw badRequest("INVALID_INPUT", "slug is required");
      const product = await publishedProductBySlug(slug);
      if (!product) throw notFound("PRODUCT_NOT_FOUND", "Product not found");

      const own = await query(
        `SELECT r.id, r.rating, r.comment, r.created_at, r.updated_at,
                u.name AS author_name, u.avatar_url AS author_avatar_url,
                EXISTS (
                  SELECT 1 FROM order_items oi
                    JOIN orders o ON o.id = oi.order_id
                   WHERE oi.product_id = r.product_id AND o.user_id = r.user_id
                     AND o.status IN ('paid', 'processing', 'shipped', 'delivered')
                ) AS verified_purchase
           FROM product_reviews r
           JOIN users u ON u.id = r.user_id
          WHERE r.product_id = $1 AND r.user_id = $2`,
        [product.id, req.sessionUser!.id],
      );
      const row = own.rows[0] as ReviewRow | undefined;

      const purchase = await query(
        `SELECT 1
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
          WHERE oi.product_id = $1 AND o.user_id = $2
            AND o.status IN ('paid', 'processing', 'shipped', 'delivered')
          LIMIT 1`,
        [product.id, req.sessionUser!.id],
      );

      ok(res, {
        review: row ? reviewPayload(row) : null,
        verifiedPurchase: (purchase.rowCount ?? 0) > 0,
      });
    }),
  );

  // ── Create or update the caller's review (one per product) ───────────────
  app.post(
    "/api/mvp/products/:slug/reviews",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const slug = optionalString(req.params.slug, "slug", { max: 120 });
      if (!slug) throw badRequest("INVALID_INPUT", "slug is required");
      const product = await publishedProductBySlug(slug);
      if (!product) throw notFound("PRODUCT_NOT_FOUND", "Product not found");

      const { rating, comment } = validateReview((req.body ?? {}) as Record<string, unknown>);
      const userId = req.sessionUser!.id;

      const saved = await query(
        `INSERT INTO product_reviews (product_id, user_id, rating, comment, status)
         VALUES ($1, $2, $3, $4, 'published')
         ON CONFLICT (product_id, user_id) DO UPDATE
           SET rating = EXCLUDED.rating,
               comment = EXCLUDED.comment,
               status = 'published',
               updated_at = NOW()
         RETURNING id, created_at, updated_at`,
        [product.id, userId, rating, comment],
      );
      const row = saved.rows[0] as { id: string; created_at: string; updated_at: string };
      ok(res, { review: { id: row.id, rating, comment, updatedAt: row.updated_at } }, 201);
    }),
  );

  // ── Edit own review ──────────────────────────────────────────────────────
  app.patch(
    "/api/mvp/reviews/:reviewId",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const reviewId = optionalString(req.params.reviewId, "reviewId", { max: 64 });
      if (!reviewId) throw badRequest("INVALID_INPUT", "reviewId is required");
      const { rating, comment } = validateReview((req.body ?? {}) as Record<string, unknown>);

      const updated = await query(
        `UPDATE product_reviews
            SET rating = $1, comment = $2, updated_at = NOW()
          WHERE id = $3 AND user_id = $4
          RETURNING id`,
        [rating, comment, reviewId, req.sessionUser!.id],
      );
      if (updated.rowCount === 0) throw notFound("REVIEW_NOT_FOUND", "Review not found");
      ok(res, { id: reviewId, rating, comment });
    }),
  );

  // ── Delete own review ────────────────────────────────────────────────────
  app.delete(
    "/api/mvp/reviews/:reviewId",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const reviewId = optionalString(req.params.reviewId, "reviewId", { max: 64 });
      if (!reviewId) throw badRequest("INVALID_INPUT", "reviewId is required");
      const deleted = await query(
        `DELETE FROM product_reviews WHERE id = $1 AND user_id = $2 RETURNING id`,
        [reviewId, req.sessionUser!.id],
      );
      if (deleted.rowCount === 0) {
        throw forbidden("REVIEW_NOT_OWNED", "Only the author can delete this review");
      }
      ok(res, { deleted: true });
    }),
  );
}
