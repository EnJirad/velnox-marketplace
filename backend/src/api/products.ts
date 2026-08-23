import { Router } from "express";
import { query } from "../db/index.js";
import { optionalAuth } from "../middleware/auth.js";

const router = Router();

// GET /api/products — List products with filtering
router.get("/", optionalAuth, async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(req.query.pageSize as string) || 12));
    const search = (req.query.search as string) || "";
    const category = (req.query.category as string) || "";
    const featured = req.query.featured === "true";
    const offset = (page - 1) * pageSize;

    const conditions: string[] = ["p.status = 'active'"];
    const params: unknown[] = [];
    let paramIndex = 1;

    if (search) {
      conditions.push(`(p.name ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    if (category) {
      conditions.push(`c.slug = $${paramIndex}`);
      params.push(category);
      paramIndex++;
    }

    if (featured) {
      conditions.push("p.featured = TRUE");
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    // Get total count
    const countResult = await query(
      `SELECT COUNT(*) FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       ${whereClause}`,
      params
    );
    const total = parseInt(countResult.rows[0].count);

    // Get products with images and shop
    const productsResult = await query(
      `SELECT p.*,
        json_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'rating', s.rating, 'product_count', s.product_count) as shop,
        COALESCE(
          (SELECT json_agg(json_build_object('id', pi.id, 'url', pi.url, 'alt', pi.alt, 'sort_order', pi.sort_order) ORDER BY pi.sort_order)
           FROM product_images pi WHERE pi.product_id = p.id),
          '[]'::json
        ) as images
       FROM products p
       LEFT JOIN categories c ON p.category_id = c.id
       LEFT JOIN shops s ON p.shop_id = s.id
       ${whereClause}
       ORDER BY p.created_at DESC
       LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
      [...params, pageSize, offset]
    );

    res.json({
      success: true,
      data: {
        items: productsResult.rows,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (err) {
    console.error("List products error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to list products" },
    });
  }
});

// GET /api/products/:id — Get product by ID
router.get("/:id", optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await query(
      `SELECT p.*,
        json_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'description', s.description, 'rating', s.rating, 'product_count', s.product_count) as shop,
        COALESCE(
          (SELECT json_agg(json_build_object('id', pi.id, 'url', pi.url, 'alt', pi.alt, 'sort_order', pi.sort_order) ORDER BY pi.sort_order)
           FROM product_images pi WHERE pi.product_id = p.id),
          '[]'::json
        ) as images
       FROM products p
       LEFT JOIN shops s ON p.shop_id = s.id
       WHERE p.id = $1`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Product not found" },
      });
    }

    res.json({ success: true, data: { product: result.rows[0] } });
  } catch (err) {
    console.error("Get product error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to get product" },
    });
  }
});

// GET /api/products/slug/:slug — Get product by slug
router.get("/slug/:slug", optionalAuth, async (req, res) => {
  try {
    const { slug } = req.params;

    const result = await query(
      `SELECT p.*,
        json_build_object('id', s.id, 'name', s.name, 'slug', s.slug, 'rating', s.rating, 'product_count', s.product_count) as shop,
        COALESCE(
          (SELECT json_agg(json_build_object('id', pi.id, 'url', pi.url, 'alt', pi.alt, 'sort_order', pi.sort_order) ORDER BY pi.sort_order)
           FROM product_images pi WHERE pi.product_id = p.id),
          '[]'::json
        ) as images
       FROM products p
       LEFT JOIN shops s ON p.shop_id = s.id
       WHERE p.slug = $1`,
      [slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Product not found" },
      });
    }

    res.json({ success: true, data: { product: result.rows[0] } });
  } catch (err) {
    console.error("Get product by slug error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to get product" },
    });
  }
});

export { router as productsRouter };
