import type { Express, Request, Response } from "express";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error.js";
import { query } from "../db/index.js";

export function setupRoutes(app: Express): void {
  // ─── Auth ────────────────────────────────────────────
  app.get("/api/auth/me", requireAuth, async (req, res) => {
    try {
      const result = await query("SELECT id, email, name, avatar, created_at, updated_at FROM users WHERE id = $1", [req.user!.userId]);
      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found" } });
        return;
      }
      const u = result.rows[0]!;
      res.json({ success: true, data: { user: { id: u.id, email: u.email, name: u.name, avatar: u.avatar, createdAt: u.created_at, updatedAt: u.updated_at } } });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch user" } });
    }
  });

  app.post("/api/auth/logout", (_req, res) => {
    res.clearCookie("session_token");
    res.json({ success: true, data: { success: true } });
  });

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
