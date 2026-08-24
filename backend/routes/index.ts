import type { Express, Request, Response } from "express";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error.js";
import { query } from "../db/index.js";

// ─── Profile cache for /api/customer/profile (5s TTL) ──────────────────────
// Avoids repeated slow queries when multiple components mount simultaneously.
const customerProfileCache = new Map<string, { data: any; expires: number }>();
const PROFILE_CACHE_TTL = 5_000;

function getCachedCustomerProfile(userId: string): any | null {
  const entry = customerProfileCache.get(userId);
  if (entry && entry.expires > Date.now()) return entry.data;
  customerProfileCache.delete(userId);
  return null;
}

function setCachedCustomerProfile(userId: string, data: any): void {
  customerProfileCache.set(userId, { data, expires: Date.now() + PROFILE_CACHE_TTL });
}

export function invalidateCustomerProfileCache(userId: string): void {
  customerProfileCache.delete(userId);
}

export function setupRoutes(app: Express): void {
  // NOTE: /api/auth/me and /api/auth/logout are defined in auth.ts (setupGoogleAuth)
  // to avoid route conflicts. Do NOT re-define them here.

  // ─── Products ────────────────────────────────────────
  app.get("/api/products", optionalAuth, async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 12;
      const search = req.query.search as string;
      const category = req.query.category as string;
      const featured = req.query.featured === "true";
      const offset = (page - 1) * pageSize;

      let where = "WHERE p.status = 'active'";
      const params: unknown[] = [];
      let paramIndex = 1;

      if (search) { where += ` AND (p.name ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`; params.push(`%${search}%`); paramIndex++; }
      if (category) { where += ` AND c.slug = $${paramIndex}`; params.push(category); paramIndex++; }
      if (featured) { where += ` AND p.featured = true`; }

      const countResult = await query(`SELECT COUNT(*) FROM products p LEFT JOIN categories c ON p.category_id = c.id ${where}`, params);
      const total = parseInt(countResult.rows[0]!.count);

      params.push(pageSize, offset);
      const productsResult = await query(`
        SELECT p.*, c.name as category_name, c.slug as category_slug, c.icon as category_icon,
               s.id as shop_id, s.name as shop_name, s.slug as shop_slug, s.rating as shop_rating, s.product_count as shop_product_count
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN shops s ON p.shop_id = s.id
        ${where}
        ORDER BY p.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `, params);

      const items = productsResult.rows.map((r: Record<string, unknown>) => ({
        id: r.id, shopId: r.shop_id, name: r.name, slug: r.slug, description: r.description,
        shortDescription: r.short_description, price: r.price, compareAtPrice: r.compare_at_price,
        currency: r.currency, status: r.status, featured: r.featured, rating: r.rating,
        reviewCount: r.review_count, soldCount: r.sold_count, categoryId: r.category_id,
        category: r.category_name ? { id: r.category_id, name: r.category_name, slug: r.category_slug, icon: r.category_icon, parentId: null } : undefined,
        shop: r.shop_id ? { id: r.shop_id, sellerId: "", name: r.shop_name, slug: r.shop_slug, description: null, logo: null, cover: null, rating: r.shop_rating, productCount: r.shop_product_count, createdAt: "" } : undefined,
        images: [], createdAt: r.created_at, updatedAt: r.updated_at,
      }));

      res.json({ success: true, data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch products" } });
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      const result = await query("SELECT * FROM products WHERE id = $1", [req.params.id]);
      if (result.rows.length === 0) { res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } }); return; }
      res.json({ success: true, data: { product: result.rows[0] } });
    } catch {
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch product" } });
    }
  });

  // ─── Categories ──────────────────────────────────────
  app.get("/api/categories", async (_req, res) => {
    try {
      const result = await query("SELECT * FROM categories ORDER BY name");
      res.json({ success: true, data: { categories: result.rows.map((r: Record<string, unknown>) => ({ id: r.id, name: r.name, slug: r.slug, icon: r.icon, parentId: r.parent_id })) } });
    } catch {
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch categories" } });
    }
  });

  // ─── Customer Profile ──────────────────────────────────
  app.get("/api/customer/profile", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;

      // Check cache first
      const cached = getCachedCustomerProfile(userId);
      if (cached) {
        res.json({ success: true, data: cached });
        return;
      }

      let result;
      try {
        result = await query(
          "SELECT id, email, name, avatar, cover_url, phone, created_at FROM users WHERE id = $1",
          [userId]
        );
      } catch (queryErr: any) {
        if (queryErr?.code === "42703") {
          result = await query(
            "SELECT id, email, name, avatar, phone, created_at FROM users WHERE id = $1",
            [userId]
          );
        } else {
          throw queryErr;
        }
      }
      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found" } });
        return;
      }
      const u = result.rows[0];
      const profileData = {
        name: u.name,
        email: u.email,
        phone: u.phone || null,
        avatarUrl: u.avatar || null,
        coverUrl: u.cover_url || null,
        memberSince: new Date(u.created_at).getTime(),
      };

      setCachedCustomerProfile(userId, profileData);
      res.json({ success: true, data: profileData });
    } catch (err) {
      console.error("[profile] fetch error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch profile" } });
    }
  });

  app.put("/api/customer/profile", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name, phone } = req.body;
      const userId = req.user!.userId;
      const updates: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (name !== undefined && name !== null) {
        updates.push(`name = $${paramIndex}`);
        params.push(name);
        paramIndex++;
      }
      if (phone !== undefined) {
        updates.push(`phone = $${paramIndex}`);
        params.push(phone || null);
        paramIndex++;
      }

      if (updates.length > 0) {
        updates.push("updated_at = NOW()");
        params.push(userId);
        await query(`UPDATE users SET ${updates.join(", ")} WHERE id = $${paramIndex}`, params);
      }

      // Invalidate caches after profile update
      try {
        const { invalidateCachedProfile } = await import("./auth.js");
        invalidateCachedProfile(userId);
      } catch { /* ignore */ }
      invalidateCustomerProfileCache(userId);

      const result = await query(
        "SELECT id, name, phone, created_at FROM users WHERE id = $1",
        [userId]
      );
      const u = result.rows[0];
      res.json({
        success: true,
        data: {
          name: u.name,
          phone: u.phone || null,
          memberSince: new Date(u.created_at).getTime(),
        },
      });
    } catch (err) {
      console.error("[profile] update error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update profile" } });
    }
  });

  // ─── Placeholder routes ──────────────────────────────
  const placeholder = (name: string) => async (_req: Request, res: Response) => {
    res.json({ success: true, data: { [name]: [] } });
  };

  app.get("/api/cart", requireAuth, placeholder("cart"));
  app.post("/api/cart/items", requireAuth, placeholder("cart"));
  app.patch("/api/cart/items/:id", requireAuth, placeholder("cart"));
  app.delete("/api/cart/items/:id", requireAuth, placeholder("cart"));

  app.get("/api/orders", requireAuth, placeholder("orders"));
  app.post("/api/orders", requireAuth, placeholder("order"));
  app.get("/api/orders/:id", requireAuth, placeholder("order"));

  app.get("/api/addresses", requireAuth, placeholder("addresses"));
  app.post("/api/addresses", requireAuth, placeholder("address"));
  app.put("/api/addresses/:id", requireAuth, placeholder("address"));
  app.delete("/api/addresses/:id", requireAuth, placeholder("address"));

  app.get("/api/shops", placeholder("shops"));
  app.get("/api/shops/:slug", placeholder("shop"));

  // ─── Error Handler ──────────────────────────────────
  app.use(errorHandler);
}
