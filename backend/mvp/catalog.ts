/**
 * MVP public catalog — what an anonymous visitor may see.
 *
 * VISIBILITY IS A QUERY PREDICATE, NOT A UI FILTER.
 * `p.status = 'published'` is in the SQL of every public read, and a product
 * detail lookup for any other status is a 404 — drafts, submissions, rejected
 * and approved-but-not-published listings are indistinguishable from
 * non-existent ones. The same predicate is what `order_items`' trigger enforces
 * at purchase time, so "visible" and "purchasable" cannot drift apart.
 *
 * A seller must also be `approved`: a suspended seller's listings disappear
 * immediately, without rewriting any product row.
 */
import type { Express, Request, Response } from "express";
import { query } from "../db/index.js";
import { pageMeta, parseLimit, parsePage, pageOffset } from "../lib/pagination.js";
import { badRequest, notFound, ok, optionalString, route } from "./http.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Escape `%`, `_` and `\` so a search phrase is a phrase, not a wildcard. */
export function ilikePattern(phrase: string): string {
  return `%${phrase.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}

interface CategoryRow {
  id: string;
  slug: string;
  name: string;
  names: Record<string, string>;
  parent_id: string | null;
  sort_order: number;
  icon: string | null;
  image_url: string | null;
}

export interface CategoryNode extends CategoryRow {
  children: CategoryNode[];
}

/** Build the parent/child tree from a flat, ordered list. */
export function buildCategoryTree(rows: CategoryRow[]): CategoryNode[] {
  const byId = new Map<string, CategoryNode>();
  for (const row of rows) byId.set(row.id, { ...row, children: [] });

  const roots: CategoryNode[] = [];
  for (const row of rows) {
    const node = byId.get(row.id)!;
    const parent = row.parent_id ? byId.get(row.parent_id) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  return roots;
}

interface SellingUnitRow {
  id: string;
  variant_id: string | null;
  label: string;
  base_quantity: number;
  price: string;
}

export interface SellingUnitOption {
  /** `null` = the implicit base unit (one base unit at the scope's price). */
  id: string | null;
  /** `null` for the implicit base unit; the UI labels it. */
  label: string | null;
  baseQuantity: number;
  price: string;
  /** How many of THIS option the current stock supports (packs left, not bags). */
  available: number;
  isBase: boolean;
}

/**
 * The buyable options of ONE inventory scope (base product or one variant).
 *
 * The implicit base unit is offered only when the seller has not defined an
 * explicit one (`base_quantity = 1`): otherwise the buyer would see two entries
 * for the same single unit at two possibly different prices.
 */
export function sellingUnitOptions(
  units: SellingUnitRow[],
  scopeVariantId: string | null,
  scopePrice: string,
  scopeAvailable: number,
): SellingUnitOption[] {
  const scoped = units.filter((unit) => unit.variant_id === scopeVariantId);
  const options: SellingUnitOption[] = [];

  if (!scoped.some((unit) => Number(unit.base_quantity) === 1)) {
    options.push({
      id: null,
      label: null,
      baseQuantity: 1,
      price: scopePrice,
      available: scopeAvailable,
      isBase: true,
    });
  }

  for (const unit of scoped) {
    const baseQuantity = Number(unit.base_quantity);
    options.push({
      id: unit.id,
      label: unit.label,
      baseQuantity,
      price: unit.price,
      available: Math.floor(scopeAvailable / baseQuantity),
      isBase: baseQuantity === 1,
    });
  }
  return options;
}

export function setupMvpCatalogRoutes(app: Express): void {
  // ── Category tree (public) ───────────────────────────────────────────────
  app.get(
    "/api/mvp/categories",
    route(async (_req: Request, res: Response) => {
      const result = await query(
        `SELECT id, slug, name, names, parent_id, sort_order, icon, image_url
           FROM categories
          WHERE is_active
          ORDER BY sort_order, name`,
      );
      ok(res, { categories: buildCategoryTree(result.rows as CategoryRow[]) });
    }),
  );

  // ── Product list (public) ───────────────────────────────────────────────
  app.get(
    "/api/mvp/products",
    route(async (req: Request, res: Response) => {
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit, 20);
      const category = optionalString(req.query.category, "category", { max: 120 });
      const q = optionalString(req.query.q, "q", { max: 120 });
      const seller = optionalString(req.query.seller, "seller", { max: 120 });
      const sellerId = seller && UUID.test(seller) ? seller : null;
      const sellerSlug = seller && !UUID.test(seller) ? seller : null;

      const params: unknown[] = [
        category,
        q ? ilikePattern(q) : null,
        sellerId,
        sellerSlug,
        limit,
        pageOffset(page, limit),
      ];

      const result = await query(
        `SELECT p.id, p.slug, p.name, p.price, p.category_slug, p.published_at,
                sp.id AS seller_id, sp.store_name, sp.slug AS seller_slug,
                (SELECT pi.url FROM product_images pi
                  WHERE pi.product_id = p.id
                  ORDER BY pi.sort_order, pi.created_at
                  LIMIT 1) AS image_url,
                COALESCE((SELECT SUM(i.quantity - i.reserved) FROM inventory i
                           WHERE i.product_id = p.id), 0)::int AS available,
                COUNT(*) OVER ()::int AS total_count
           FROM products p
           JOIN seller_profiles sp ON sp.id = p.seller_id AND sp.status = 'approved'
          WHERE p.status = 'published'
            AND ($1::text IS NULL OR p.category_slug = $1)
            AND ($2::text IS NULL OR p.name ILIKE $2)
            AND ($3::uuid IS NULL OR p.seller_id = $3::uuid)
            AND ($4::text IS NULL OR sp.slug = $4)
          ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC
          LIMIT $5 OFFSET $6`,
        params,
      );

      const rows = result.rows as Array<Record<string, unknown> & { total_count: number }>;
      const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
      const products = rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        price: row.price,
        categorySlug: row.category_slug,
        imageUrl: row.image_url,
        available: Number(row.available),
        publishedAt: row.published_at,
        seller: { id: row.seller_id, storeName: row.store_name, slug: row.seller_slug },
      }));

      ok(res, { products, pagination: pageMeta(page, limit, total, rows.length) });
    }),
  );

  // ── Product detail (public) ──────────────────────────────────────────────
  app.get(
    "/api/mvp/products/:slug",
    route(async (req: Request, res: Response) => {
      const slug = optionalString(req.params.slug, "slug", { max: 120 });
      if (!slug) throw badRequest("INVALID_INPUT", "slug is required");

      const productResult = await query(
        `SELECT p.id, p.slug, p.name, p.description, p.price, p.category_slug,
                p.published_at, p.created_at,
                sp.id AS seller_id, sp.store_name, sp.slug AS seller_slug, sp.description AS seller_description
           FROM products p
           JOIN seller_profiles sp ON sp.id = p.seller_id AND sp.status = 'approved'
          WHERE p.slug = $1 AND p.status = 'published'`,
        [slug],
      );
      const product = productResult.rows[0] as Record<string, unknown> | undefined;
      if (!product) throw notFound("PRODUCT_NOT_FOUND", "Product not found");

      const productId = String(product.id);
      const images = await query(
        `SELECT url, alt, sort_order FROM product_images
          WHERE product_id = $1 ORDER BY sort_order, created_at`,
        [productId],
      );
      const variants = await query(
        `SELECT v.id, v.name, v.sku, v.price, v.status,
                COALESCE(i.quantity - i.reserved, 0)::int AS available
           FROM product_variants v
           LEFT JOIN inventory i ON i.product_id = v.product_id AND i.variant_id = v.id
          WHERE v.product_id = $1
          ORDER BY v.sort_order, v.created_at`,
        [productId],
      );
      const baseStock = await query(
        `SELECT quantity - reserved AS available FROM inventory
          WHERE product_id = $1 AND variant_id IS NULL`,
        [productId],
      );
      // Only ACTIVE units are buyable, so only active units are published.
      const sellingUnits = await query(
        `SELECT id, variant_id, label, base_quantity, price
           FROM product_selling_units
          WHERE product_id = $1 AND is_active
          ORDER BY sort_order, base_quantity, created_at`,
        [productId],
      );
      const unitRows = sellingUnits.rows as SellingUnitRow[];
      const baseAvailable = Number(
        (baseStock.rows[0] as { available: number } | undefined)?.available ?? 0,
      );

      ok(res, {
        product: {
          id: product.id,
          slug: product.slug,
          name: product.name,
          description: product.description,
          price: product.price,
          currency: "THB",
          categorySlug: product.category_slug,
          publishedAt: product.published_at,
          seller: {
            id: product.seller_id,
            storeName: product.store_name,
            slug: product.seller_slug,
            description: product.seller_description,
          },
          images: (images.rows as Array<{ url: string; alt: string; sort_order: number }>).map(
            (row) => ({ url: row.url, alt: row.alt, sortOrder: row.sort_order }),
          ),
          sellingUnits: sellingUnitOptions(
            unitRows,
            null,
            String(product.price),
            baseAvailable,
          ),
          variants: (
            variants.rows as Array<{
              id: string;
              name: string;
              sku: string | null;
              price: string;
              status: string;
              available: number;
            }>
          ).map((row) => ({
            id: row.id,
            name: row.name,
            sku: row.sku,
            price: row.price,
            status: row.status,
            available: Number(row.available),
            sellingUnits: sellingUnitOptions(
              unitRows,
              row.id,
              row.price,
              Number(row.available),
            ),
          })),
          available: baseAvailable,
        },
      });
    }),
  );
}
