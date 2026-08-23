import { Router } from "express";
import { query } from "../db/index.js";

const router = Router();

// GET /api/categories — List all categories
router.get("/", async (_req, res) => {
  try {
    const result = await query(
      "SELECT id, name, slug, icon, parent_id FROM categories ORDER BY sort_order, name"
    );
    res.json({ success: true, data: { categories: result.rows } });
  } catch (err) {
    console.error("List categories error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to list categories" },
    });
  }
});

export { router as categoriesRouter };
