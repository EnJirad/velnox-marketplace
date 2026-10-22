/**
 * MVP favorites (the storefront's wishlist).
 *
 * One row per (user, product); the unique constraint in `db/schema.sql` is the
 * concurrency guard, so a double tap can never create two favourites and the
 * POST is idempotent by construction (`ON CONFLICT DO NOTHING`).
 *
 * Favourites are private: every route is scoped to the session's user id and no
 * route accepts a user id from the client. A favourite of a product that is no
 * longer published stays in the table (so it is restored if the listing comes
 * back) but is hidden from the list — the storefront never shows an unpurchasable
 * row, exactly like the catalogue.
 */
import type { Express, Request, Response } from "express";
import { query } from "../db/index.js";
import { notFound, ok, requireActiveUser, route } from "./http.js";

interface FavoriteRow {
  id: string;
  product_id: string;
  created_at: string;
  slug: string;
  name: string;
  price: string;
  category_slug: string | null;
  image_url: string | null;
  available: number;
  published_at: string | null;
  seller_id: string;
  store_name: string;
  seller_slug: string;
  rating: number | null;
  review_count: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireProductId(value: unknown): string {
  if (typeof value !== "string" || !UUID.test(value.trim())) {
    throw notFound("PRODUCT_NOT_FOUND", "Product not found");
  }
  return value.trim().toLowerCase();
}

export function setupMvpFavoriteRoutes(app: Express): void {
  // ── The signed-in user's favourites ──────────────────────────────────────
  app.get(
    "/api/mvp/favorites",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const user = req.sessionUser!;
      const result = await query(
        `SELECT f.id, f.product_id, f.created_at,
                p.slug, p.name, p.price, p.category_slug, p.published_at,
                sp.id AS seller_id, sp.store_name, sp.slug AS seller_slug,
                (SELECT pi.url FROM product_images pi
                  WHERE pi.product_id = p.id
                  ORDER BY pi.sort_order, pi.created_at
                  LIMIT 1) AS image_url,
                COALESCE((SELECT SUM(i.quantity - i.reserved) FROM inventory i
                           WHERE i.product_id = p.id), 0)::int AS available,
                (SELECT ROUND(AVG(r.rating)::numeric, 1) FROM product_reviews r
                  WHERE r.product_id = p.id AND r.status = 'published') AS rating,
                (SELECT COUNT(*)::int FROM product_reviews r
                  WHERE r.product_id = p.id AND r.status = 'published') AS review_count
           FROM product_favorites f
           JOIN products p ON p.id = f.product_id AND p.status = 'published'
           JOIN seller_profiles sp ON sp.id = p.seller_id AND sp.status = 'approved'
          WHERE f.user_id = $1
          ORDER BY f.created_at DESC`,
        [user.id],
      );

      const favorites = (result.rows as FavoriteRow[]).map((row) => ({
        id: row.id,
        productId: row.product_id,
        addedAt: row.created_at,
        product: {
          id: row.product_id,
          slug: row.slug,
          name: row.name,
          price: row.price,
          categorySlug: row.category_slug,
          imageUrl: row.image_url,
          available: Number(row.available),
          publishedAt: row.published_at,
          rating: row.rating === null ? null : Number(row.rating),
          reviewCount: Number(row.review_count),
          seller: { id: row.seller_id, storeName: row.store_name, slug: row.seller_slug },
        },
      }));

      ok(res, { favorites });
    }),
  );

  // ── Just the ids (the heart state on every card) ─────────────────────────
  app.get(
    "/api/mvp/favorites/ids",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const result = await query(
        `SELECT product_id FROM product_favorites WHERE user_id = $1`,
        [req.sessionUser!.id],
      );
      ok(res, { productIds: (result.rows as Array<{ product_id: string }>).map((r) => r.product_id) });
    }),
  );

  // ── Add (idempotent) ─────────────────────────────────────────────────────
  app.post(
    "/api/mvp/favorites/:productId",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const user = req.sessionUser!;
      const productId = requireProductId(req.params.productId);

      // Only a product the storefront can actually show may be favourited.
      const product = await query(
        `SELECT p.id
           FROM products p
           JOIN seller_profiles sp ON sp.id = p.seller_id AND sp.status = 'approved'
          WHERE p.id = $1 AND p.status = 'published'`,
        [productId],
      );
      if (product.rowCount === 0) throw notFound("PRODUCT_NOT_FOUND", "Product not found");

      await query(
        `INSERT INTO product_favorites (user_id, product_id)
         VALUES ($1, $2)
         ON CONFLICT (user_id, product_id) DO NOTHING`,
        [user.id, productId],
      );
      ok(res, { favorited: true, productId }, 201);
    }),
  );

  // ── Remove (idempotent) ──────────────────────────────────────────────────
  app.delete(
    "/api/mvp/favorites/:productId",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const user = req.sessionUser!;
      const productId = requireProductId(req.params.productId);
      await query(`DELETE FROM product_favorites WHERE user_id = $1 AND product_id = $2`, [
        user.id,
        productId,
      ]);
      ok(res, { favorited: false, productId });
    }),
  );
}
