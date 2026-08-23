import { Router } from "express";
import { query } from "../db/index.js";

const router = Router();

// GET /api/shops — List shops
router.get("/", async (req, res) => {
  try {
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(50, parseInt(req.query.pageSize as string) || 20);
    const offset = (page - 1) * pageSize;

    const countResult = await query("SELECT COUNT(*) FROM shops");
    const total = parseInt(countResult.rows[0].count);

    const result = await query(
      `SELECT id, name, slug, description, logo, cover, rating, product_count, created_at
       FROM shops
       ORDER BY created_at DESC
       LIMIT $1 OFFSET $2`,
      [pageSize, offset]
    );

    res.json({
      success: true,
      data: { items: result.rows, total, page, pageSize },
    });
  } catch (err) {
    console.error("List shops error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to list shops" },
    });
  }
});

// GET /api/shops/:slug — Get shop by slug
router.get("/:slug", async (req, res) => {
  try {
    const result = await query(
      `SELECT id, name, slug, description, logo, cover, rating, product_count, created_at
       FROM shops WHERE slug = $1`,
      [req.params.slug]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Shop not found" },
      });
    }

    res.json({ success: true, data: { shop: result.rows[0] } });
  } catch (err) {
    console.error("Get shop error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to get shop" },
    });
  }
});

export { router as shopsRouter };
