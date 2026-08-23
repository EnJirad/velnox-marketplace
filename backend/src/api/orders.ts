import { Router } from "express";
import { query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// GET /api/orders — List user's orders
router.get("/", authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT o.*,
        json_agg(json_build_object(
          'id', oi.id, 'product_id', oi.product_id, 'quantity', oi.quantity, 'price', oi.price
        )) as items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.user_id = $1
       GROUP BY o.id
       ORDER BY o.created_at DESC`,
      [req.user!.userId]
    );

    res.json({ success: true, data: { orders: result.rows } });
  } catch (err) {
    console.error("List orders error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to list orders" },
    });
  }
});

// POST /api/orders — Create order
router.post("/", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { shopId, addressId, items } = req.body;

    if (!shopId || !items?.length) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "shopId and items are required" },
      });
    }

    // Calculate total
    let totalAmount = 0;
    for (const item of items) {
      const product = await query("SELECT price FROM products WHERE id = $1", [item.productId]);
      if (product.rows.length > 0) {
        totalAmount += parseFloat(product.rows[0].price) * item.quantity;
      }
    }

    // Create order
    const orderResult = await query(
      `INSERT INTO orders (user_id, shop_id, total_amount, currency, shipping_address_id)
       VALUES ($1, $2, $3, 'THB', $4)
       RETURNING *`,
      [userId, shopId, totalAmount, addressId || null]
    );

    const order = orderResult.rows[0];

    // Create order items
    for (const item of items) {
      const product = await query("SELECT price FROM products WHERE id = $1", [item.productId]);
      if (product.rows.length > 0) {
        await query(
          `INSERT INTO order_items (order_id, product_id, quantity, price)
           VALUES ($1, $2, $3, $4)`,
          [order.id, item.productId, item.quantity, product.rows[0].price]
        );
      }
    }

    res.status(201).json({ success: true, data: { order } });
  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to create order" },
    });
  }
});

// GET /api/orders/:id — Get order by ID
router.get("/:id", authenticate, async (req, res) => {
  try {
    const result = await query(
      `SELECT o.*,
        json_agg(json_build_object(
          'id', oi.id, 'product_id', oi.product_id, 'quantity', oi.quantity, 'price', oi.price
        )) as items
       FROM orders o
       LEFT JOIN order_items oi ON o.id = oi.order_id
       WHERE o.id = $1 AND o.user_id = $2
       GROUP BY o.id`,
      [req.params.id, req.user!.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Order not found" },
      });
    }

    res.json({ success: true, data: { order: result.rows[0] } });
  } catch (err) {
    console.error("Get order error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to get order" },
    });
  }
});

export { router as ordersRouter };
