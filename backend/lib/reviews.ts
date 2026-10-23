import { query } from "../db/index.js";

/** Max comment length for product reviews (matches product_reviews.comment). */
export const MAX_REVIEW_COMMENT = 2000;

/**
 * Validate a review submission server-side.
 *
 * Returns a normalized `{ rating, comment }` and an error string, or
 * `error: null` when valid. The frontend must never be the source of
 * truth — a crafted request can bypass any client-side clamp.
 *
 * Rules (shared by create + update endpoints):
 *   • rating must be an integer in [1, 5]
 *   • comment must be 1..2000 characters after trimming
 */
export function validateReviewInput(body: Record<string, unknown> | undefined): {
  error: string | null;
  rating: number;
  comment: string;
} {
  const rating = Number(body?.rating);
  const comment = typeof body?.comment === "string" ? body.comment.trim() : "";

  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { error: "Rating must be 1-5", rating, comment };
  }
  if (comment.length === 0 || comment.length > MAX_REVIEW_COMMENT) {
    return { error: `Comment must be 1-${MAX_REVIEW_COMMENT} characters`, rating, comment };
  }
  return { error: null, rating, comment };
}

/**
 * Verified-purchase eligibility check.
 *
 * When a review is submitted from an order (ShopOrderDetail passes
 * `orderId`), the backend must prove the relationship from real data:
 * the order belongs to the authenticated user AND contains the product.
 * A client can never claim a verified purchase by merely knowing
 * productId + orderId — that combination is validated here against the
 * `orders` / `order_items` tables.
 *
 * Returns true only when a matching non-cancelled, non-refunded order
 * item exists for the given user + product + order.
 */
export async function verifyOrderContainsProduct(
  userId: string,
  productId: string,
  orderId: string,
): Promise<boolean> {
  const res = await query(
    `SELECT 1
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     WHERE o.id = $1
       AND o.user_id = $2
       AND oi.product_id = $3
       AND o.status NOT IN ('cancelled', 'refunded')
     LIMIT 1`,
    [orderId, userId, productId],
  );
  return res.rows.length > 0;
}