/**
 * MVP administration — owner/admin only.
 *
 * There is no staff permission catalog in the MVP: `requireAdmin` (role
 * `admin` | `owner`) is the whole rule, applied to every route in this module.
 * Approvals, suspensions and moderation decisions are written inside a
 * transaction together with their audit row, so a decision can never exist
 * without a record of who made it.
 *
 * The database owns the evidence invariants (`approved_at`, `suspended_at`,
 * `rejection_reason`, no self-approval); this module only supplies them.
 */
import type { Express, Request, Response } from "express";
import { query, withTransaction } from "../db/index.js";
import { pageMeta, parseLimit, parsePage, pageOffset } from "../lib/pagination.js";
import { writeMvpAudit } from "./audit.js";
import { expireStaleOrders } from "./checkout.js";
import {
  badRequest,
  conflict,
  notFound,
  ok,
  optionalString,
  pathUuid,
  queryOne,
  requireAdmin,
  requireActiveUser,
  requireInt,
  requireString,
  route,
} from "./http.js";
import { isAdminRole } from "./http.js";

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function requireReason(value: unknown, field: string): string {
  return requireString(value, field, { min: 3, max: 1000 });
}

async function parseNames(value: unknown): Promise<Record<string, string> | null> {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw badRequest("INVALID_INPUT", "names must be an object of language → name");
  }
  const out: Record<string, string> = {};
  for (const [lang, name] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[a-z]{2}(-[A-Za-z]{2,4})?$/.test(lang)) {
      throw badRequest("INVALID_INPUT", `names key '${lang}' is not a language code`);
    }
    if (typeof name !== "string" || !name.trim()) {
      throw badRequest("INVALID_INPUT", `names.${lang} must be a non-empty string`);
    }
    out[lang] = name.trim();
  }
  return out;
}

export function setupMvpAdminRoutes(app: Express): void {
  const guard = [requireActiveUser, requireAdmin];

  // ── Seller queue + decisions ─────────────────────────────────────────────
  app.get(
    "/api/mvp/admin/sellers",
    ...guard,
    route(async (req: Request, res: Response) => {
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit, 25);
      const status = optionalString(req.query.status, "status", { max: 30 });
      if (status && !["pending", "approved", "rejected", "suspended"].includes(status)) {
        throw badRequest("INVALID_INPUT", "Unknown seller status");
      }
      const result = await query(
        `SELECT sp.id, sp.store_name, sp.slug, sp.status, sp.rejection_reason,
                sp.suspension_reason, sp.created_at, sp.approved_at, sp.suspended_at,
                u.id AS user_id, u.email, u.name,
                COUNT(*) OVER ()::int AS total_count
           FROM seller_profiles sp
           JOIN users u ON u.id = sp.user_id
          WHERE ($1::text IS NULL OR sp.status = $1)
          ORDER BY sp.created_at DESC
          LIMIT $2 OFFSET $3`,
        [status, limit, pageOffset(page, limit)],
      );
      const rows = result.rows as Array<Record<string, unknown> & { total_count: number }>;
      const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
      ok(res, { sellers: rows, pagination: pageMeta(page, limit, total, rows.length) });
    }),
  );

  app.post(
    "/api/mvp/admin/sellers/:id/approve",
    ...guard,
    route(async (req: Request, res: Response) => {
      const admin = req.sessionUser!;
      const sellerId = pathUuid(req.params.id);

      const seller = await withTransaction(async (client) => {
        const result = await client.query(
          `UPDATE seller_profiles
              SET status = 'approved',
                  approved_at = COALESCE(approved_at, NOW()),
                  approved_by = $2,
                  rejection_reason = NULL,
                  suspended_at = NULL,
                  suspension_reason = NULL,
                  updated_at = NOW()
            WHERE id = $1 AND status IN ('pending', 'rejected', 'suspended')
            RETURNING id, user_id, store_name, slug, status, approved_at, approved_by`,
          [sellerId, admin.id],
        );
        const row = result.rows[0] as
          | { id: string; user_id: string; store_name: string; status: string }
          | undefined;
        if (!row) {
          const existing = await client.query(`SELECT status FROM seller_profiles WHERE id = $1`, [
            sellerId,
          ]);
          if (existing.rowCount === 0) throw notFound("SELLER_NOT_FOUND", "Seller not found");
          throw conflict(
            "INVALID_STATUS",
            `A seller in '${(existing.rows[0] as { status: string }).status}' cannot be approved`,
          );
        }
        // `users.role` is a cached convenience, never the authorization source.
        await client.query(
          `UPDATE users SET role = 'seller', updated_at = NOW() WHERE id = $1 AND role = 'customer'`,
          [row.user_id],
        );
        await writeMvpAudit(client, admin.id, "SELLER_APPROVED", "seller_profile", sellerId, {
          storeName: row.store_name,
        });
        return row;
      });

      ok(res, { seller });
    }),
  );

  app.post(
    "/api/mvp/admin/sellers/:id/reject",
    ...guard,
    route(async (req: Request, res: Response) => {
      const admin = req.sessionUser!;
      const sellerId = pathUuid(req.params.id);
      const reason = requireReason((req.body ?? {}).reason, "reason");

      const seller = await withTransaction(async (client) => {
        const result = await client.query(
          `UPDATE seller_profiles
              SET status = 'rejected', rejection_reason = $2, updated_at = NOW()
            WHERE id = $1 AND status = 'pending'
            RETURNING id, user_id, store_name, status, rejection_reason`,
          [sellerId, reason],
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (!row) {
          const existing = await client.query(`SELECT status FROM seller_profiles WHERE id = $1`, [
            sellerId,
          ]);
          if (existing.rowCount === 0) throw notFound("SELLER_NOT_FOUND", "Seller not found");
          throw conflict("INVALID_STATUS", "Only a pending application can be rejected");
        }
        await writeMvpAudit(client, admin.id, "SELLER_REJECTED", "seller_profile", sellerId, {
          reason,
        });
        return row;
      });

      ok(res, { seller });
    }),
  );

  app.post(
    "/api/mvp/admin/sellers/:id/suspend",
    ...guard,
    route(async (req: Request, res: Response) => {
      const admin = req.sessionUser!;
      const sellerId = pathUuid(req.params.id);
      const reason = requireReason((req.body ?? {}).reason, "reason");

      const seller = await withTransaction(async (client) => {
        const result = await client.query(
          `UPDATE seller_profiles
              SET status = 'suspended', suspended_at = NOW(), suspension_reason = $2, updated_at = NOW()
            WHERE id = $1 AND status = 'approved'
            RETURNING id, user_id, store_name, status, suspended_at, suspension_reason`,
          [sellerId, reason],
        );
        const row = result.rows[0] as
          | { id: string; user_id: string; store_name: string; status: string }
          | undefined;
        if (!row) {
          const existing = await client.query(`SELECT status FROM seller_profiles WHERE id = $1`, [
            sellerId,
          ]);
          if (existing.rowCount === 0) throw notFound("SELLER_NOT_FOUND", "Seller not found");
          throw conflict("INVALID_STATUS", "Only an approved seller can be suspended");
        }
        await client.query(
          `UPDATE users SET role = 'customer', updated_at = NOW() WHERE id = $1 AND role = 'seller'`,
          [row.user_id],
        );
        await writeMvpAudit(client, admin.id, "SELLER_SUSPENDED", "seller_profile", sellerId, {
          reason,
        });
        return row;
      });

      ok(res, { seller });
    }),
  );

  // ── Product moderation ───────────────────────────────────────────────────
  app.get(
    "/api/mvp/admin/products",
    ...guard,
    route(async (req: Request, res: Response) => {
      const page = parsePage(req.query.page);
      const limit = parseLimit(req.query.limit, 25);
      const status = optionalString(req.query.status, "status", { max: 30 });
      if (status && !["draft", "submitted", "approved", "published", "rejected"].includes(status)) {
        throw badRequest("INVALID_INPUT", "Unknown product status");
      }
      const result = await query(
        `SELECT p.id, p.name, p.slug, p.price, p.status, p.rejection_reason, p.created_at,
                p.submitted_at, p.approved_at, p.published_at,
                sp.id AS seller_id, sp.store_name,
                (SELECT pi.url FROM product_images pi WHERE pi.product_id = p.id
                  ORDER BY pi.sort_order, pi.created_at LIMIT 1) AS image_url,
                COUNT(*) OVER ()::int AS total_count
           FROM products p
           JOIN seller_profiles sp ON sp.id = p.seller_id
          WHERE ($1::text IS NULL OR p.status = $1)
          ORDER BY p.submitted_at DESC NULLS LAST, p.created_at DESC
          LIMIT $2 OFFSET $3`,
        [status, limit, pageOffset(page, limit)],
      );
      const rows = result.rows as Array<Record<string, unknown> & { total_count: number }>;
      const total = rows.length > 0 ? Number(rows[0]!.total_count) : 0;
      ok(res, { products: rows, pagination: pageMeta(page, limit, total, rows.length) });
    }),
  );

  app.post(
    "/api/mvp/admin/products/:id/approve",
    ...guard,
    route(async (req: Request, res: Response) => {
      const admin = req.sessionUser!;
      const productId = pathUuid(req.params.id);

      const product = await withTransaction(async (client) => {
        const result = await client.query(
          `UPDATE products
              SET status = 'approved', approved_at = NOW(), approved_by = $2,
                  rejection_reason = NULL, updated_at = NOW()
            WHERE id = $1 AND status = 'submitted'
            RETURNING id, name, status, approved_at, approved_by`,
          [productId, admin.id],
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (!row) {
          const existing = await client.query(`SELECT status FROM products WHERE id = $1`, [productId]);
          if (existing.rowCount === 0) throw notFound("PRODUCT_NOT_FOUND", "Product not found");
          throw conflict("INVALID_STATUS", "Only a submitted product can be approved");
        }
        await writeMvpAudit(client, admin.id, "PRODUCT_APPROVED", "product", productId, {});
        return row;
      });

      ok(res, { product });
    }),
  );

  app.post(
    "/api/mvp/admin/products/:id/reject",
    ...guard,
    route(async (req: Request, res: Response) => {
      const admin = req.sessionUser!;
      const productId = pathUuid(req.params.id);
      const reason = requireReason((req.body ?? {}).reason, "reason");

      const product = await withTransaction(async (client) => {
        const result = await client.query(
          `UPDATE products
              SET status = 'rejected', rejection_reason = $2, updated_at = NOW()
            WHERE id = $1 AND status IN ('submitted', 'approved', 'published')
            RETURNING id, name, status, rejection_reason`,
          [productId, reason],
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (!row) {
          const existing = await client.query(`SELECT status FROM products WHERE id = $1`, [productId]);
          if (existing.rowCount === 0) throw notFound("PRODUCT_NOT_FOUND", "Product not found");
          throw conflict("INVALID_STATUS", "This product cannot be rejected in its current state");
        }
        await writeMvpAudit(client, admin.id, "PRODUCT_REJECTED", "product", productId, { reason });
        return row;
      });

      ok(res, { product });
    }),
  );

  // ── Categories ───────────────────────────────────────────────────────────
  app.get(
    "/api/mvp/admin/categories",
    ...guard,
    route(async (_req: Request, res: Response) => {
      const result = await query(
        `SELECT id, slug, name, names, parent_id, sort_order, is_active, icon, image_url,
                (SELECT COUNT(*)::int FROM products p WHERE p.category_slug = categories.slug) AS product_count
           FROM categories
          ORDER BY sort_order, name`,
      );
      ok(res, { categories: result.rows });
    }),
  );

  app.post(
    "/api/mvp/admin/categories",
    ...guard,
    route(async (req: Request, res: Response) => {
      const admin = req.sessionUser!;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const slug = requireString(body.slug, "slug", { max: 120 }).toLowerCase();
      if (!SLUG.test(slug)) {
        throw badRequest("INVALID_SLUG", "slug must be lowercase letters, digits and single dashes");
      }
      const name = requireString(body.name, "name", { max: 120 });
      const names = await parseNames(body.names);
      const parentId =
        body.parentId === undefined || body.parentId === null
          ? null
          : pathUuid(body.parentId, "parentId");
      const sortOrder =
        body.sortOrder === undefined || body.sortOrder === null
          ? 0
          : requireInt(body.sortOrder, "sortOrder", { min: 0, max: 10_000 });
      const isActive = body.isActive === undefined ? true : Boolean(body.isActive);
      const icon = optionalString(body.icon, "icon", { max: 120 });
      const imageUrl = optionalString(body.imageUrl, "imageUrl", { max: 500 });

      const category = await withTransaction(async (client) => {
        const result = await client.query(
          `INSERT INTO categories (slug, name, names, parent_id, sort_order, is_active, icon, image_url)
           VALUES ($1, $2, $3::jsonb, $4::uuid, $5, $6, $7, $8)
           RETURNING id, slug, name, names, parent_id, sort_order, is_active, icon, image_url`,
          [slug, name, JSON.stringify(names ?? {}), parentId, sortOrder, isActive, icon, imageUrl],
        );
        const row = result.rows[0] as { id: string };
        await writeMvpAudit(client, admin.id, "CATEGORY_CREATED", "category", row.id, { slug });
        return row;
      });

      ok(res, { category }, 201);
    }),
  );

  app.patch(
    "/api/mvp/admin/categories/:id",
    ...guard,
    route(async (req: Request, res: Response) => {
      const admin = req.sessionUser!;
      const categoryId = pathUuid(req.params.id);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const names = await parseNames(body.names);

      const category = await withTransaction(async (client) => {
        const sets: string[] = [];
        const params: unknown[] = [];

        if (body.name !== undefined) {
          params.push(requireString(body.name, "name", { max: 120 }));
          sets.push(`name = $${params.length}`);
        }
        if (names !== null) {
          params.push(JSON.stringify(names));
          sets.push(`names = $${params.length}::jsonb`);
        }
        if (body.parentId !== undefined) {
          params.push(
            body.parentId === null ? null : pathUuid(body.parentId, "parentId"),
          );
          sets.push(`parent_id = $${params.length}::uuid`);
        }
        if (body.sortOrder !== undefined) {
          params.push(requireInt(body.sortOrder, "sortOrder", { min: 0, max: 10_000 }));
          sets.push(`sort_order = $${params.length}`);
        }
        if (body.isActive !== undefined) {
          params.push(Boolean(body.isActive));
          sets.push(`is_active = $${params.length}`);
        }
        if (body.icon !== undefined) {
          params.push(optionalString(body.icon, "icon", { max: 120 }));
          sets.push(`icon = $${params.length}`);
        }
        if (body.imageUrl !== undefined) {
          params.push(optionalString(body.imageUrl, "imageUrl", { max: 500 }));
          sets.push(`image_url = $${params.length}`);
        }
        if (sets.length === 0) throw badRequest("INVALID_INPUT", "No fields to update");

        params.push(categoryId);
        const result = await client.query(
          `UPDATE categories SET ${sets.join(", ")}, updated_at = NOW()
            WHERE id = $${params.length}
            RETURNING id, slug, name, names, parent_id, sort_order, is_active, icon, image_url`,
          params,
        );
        const row = result.rows[0] as Record<string, unknown> | undefined;
        if (!row) throw notFound("CATEGORY_NOT_FOUND", "Category not found");
        await writeMvpAudit(client, admin.id, "CATEGORY_UPDATED", "category", categoryId, {
          fields: sets.length,
        });
        return row;
      });

      ok(res, { category });
    }),
  );

  app.delete(
    "/api/mvp/admin/categories/:id",
    ...guard,
    route(async (req: Request, res: Response) => {
      const admin = req.sessionUser!;
      const categoryId = pathUuid(req.params.id);
      await withTransaction(async (client) => {
        const result = await client.query(`DELETE FROM categories WHERE id = $1 RETURNING slug`, [
          categoryId,
        ]);
        const row = result.rows[0] as { slug: string } | undefined;
        if (!row) throw notFound("CATEGORY_NOT_FOUND", "Category not found");
        await writeMvpAudit(client, admin.id, "CATEGORY_DELETED", "category", categoryId, {
          slug: row.slug,
        });
      });
      ok(res, { deleted: true });
    }),
  );

  // ── Metrics ──────────────────────────────────────────────────────────────
  app.get(
    "/api/mvp/admin/metrics",
    ...guard,
    route(async (_req: Request, res: Response) => {
      const row = await queryOne<Record<string, unknown>>(
        `SELECT
           (SELECT COUNT(*)::int FROM users WHERE status = 'active') AS active_users,
           (SELECT COUNT(*)::int FROM seller_profiles WHERE status = 'pending') AS pending_sellers,
           (SELECT COUNT(*)::int FROM seller_profiles WHERE status = 'approved') AS approved_sellers,
           (SELECT COUNT(*)::int FROM seller_profiles WHERE status = 'suspended') AS suspended_sellers,
           (SELECT COUNT(*)::int FROM products WHERE status = 'submitted') AS products_awaiting_review,
           (SELECT COUNT(*)::int FROM products WHERE status = 'published') AS published_products,
           (SELECT COUNT(*)::int FROM orders) AS orders_total,
           (SELECT COUNT(*)::int FROM orders WHERE status = 'pending_payment') AS orders_pending_payment,
           (SELECT COUNT(*)::int FROM orders
             WHERE status IN ('paid','processing','shipped','delivered')) AS orders_paid,
           (SELECT COUNT(*)::int FROM orders WHERE status = 'delivered') AS orders_delivered,
           (SELECT COUNT(*)::int FROM orders WHERE status = 'cancelled') AS orders_cancelled,
           (SELECT COUNT(*)::int FROM payments WHERE status = 'paid') AS paid_payments,
           (SELECT COALESCE(SUM(amount), 0)::numeric(12,2)::text FROM payments WHERE status = 'paid') AS gross_settled_amount`,
        [],
      );
      ok(res, { metrics: row ?? {} });
    }),
  );

  // ── Operational sweep (manual in Phase 3 — no scheduler rewrite in scope) ─
  app.post(
    "/api/mvp/admin/maintenance/expire-pending-orders",
    ...guard,
    route(async (req: Request, res: Response) => {
      const admin = req.sessionUser!;
      const limit =
        req.body && typeof req.body.limit !== "undefined"
          ? requireInt(req.body.limit, "limit", { min: 1, max: 500 })
          : 100;
      const expired = await expireStaleOrders(limit);
      if (expired > 0) {
        await writeMvpAudit(null, admin.id, "ORDERS_EXPIRED", "order", null, { expired });
      }
      ok(res, { expired });
    }),
  );
}

export { isAdminRole };
