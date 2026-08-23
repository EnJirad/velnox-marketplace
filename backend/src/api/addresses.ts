import { Router } from "express";
import { query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// GET /api/addresses — List user's addresses
router.get("/", authenticate, async (req, res) => {
  try {
    const result = await query(
      "SELECT * FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC",
      [req.user!.userId]
    );
    res.json({ success: true, data: { addresses: result.rows } });
  } catch (err) {
    console.error("List addresses error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to list addresses" },
    });
  }
});

// POST /api/addresses — Create address
router.post("/", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { label, fullName, phone, line1, line2, city, state, postalCode, country, isDefault } = req.body;

    const result = await query(
      `INSERT INTO addresses (user_id, label, full_name, phone, line1, line2, city, state, postal_code, country, is_default)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [userId, label || "Home", fullName, phone, line1, line2 || null, city, state, postalCode, country || "TH", isDefault || false]
    );

    res.status(201).json({ success: true, data: { address: result.rows[0] } });
  } catch (err) {
    console.error("Create address error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to create address" },
    });
  }
});

// PUT /api/addresses/:id — Update address
router.put("/:id", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { id } = req.params;
    const { label, fullName, phone, line1, line2, city, state, postalCode, country, isDefault } = req.body;

    const result = await query(
      `UPDATE addresses SET
        label = COALESCE($1, label),
        full_name = COALESCE($2, full_name),
        phone = COALESCE($3, phone),
        line1 = COALESCE($4, line1),
        line2 = $5,
        city = COALESCE($6, city),
        state = COALESCE($7, state),
        postal_code = COALESCE($8, postal_code),
        country = COALESCE($9, country),
        is_default = COALESCE($10, is_default),
        updated_at = NOW()
       WHERE id = $11 AND user_id = $12
       RETURNING *`,
      [label, fullName, phone, line1, line2, city, state, postalCode, country, isDefault, id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Address not found" },
      });
    }

    res.json({ success: true, data: { address: result.rows[0] } });
  } catch (err) {
    console.error("Update address error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to update address" },
    });
  }
});

// DELETE /api/addresses/:id — Delete address
router.delete("/:id", authenticate, async (req, res) => {
  try {
    const result = await query(
      "DELETE FROM addresses WHERE id = $1 AND user_id = $2",
      [req.params.id, req.user!.userId]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Address not found" },
      });
    }

    res.json({ success: true, data: { success: true } });
  } catch (err) {
    console.error("Delete address error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to delete address" },
    });
  }
});

export { router as addressesRouter };
