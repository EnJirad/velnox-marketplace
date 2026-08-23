import { Router } from "express";
import { query } from "../db/index.js";
import { authenticate } from "../middleware/auth.js";

const router = Router();

// GET /api/cart — Get current user's cart
router.get("/", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;

    // Ensure cart exists
    let cartResult = await query("SELECT id FROM carts WHERE user_id = $1", [userId]);
    if (cartResult.rows.length === 0) {
      cartResult = await query(
        "INSERT INTO carts (user_id) VALUES ($1) RETURNING id",
        [userId]
      );
    }
    const cartId = cartResult.rows[0].id;

    // Get cart items with product info
    const itemsResult = await query(
      `SELECT ci.*,
        json_build_object(
          'id', p.id, 'name', p.name, 'slug', p.slug, 'price', p.price,
          'currency', p.currency, 'status', p.status,
          'images', COALESCE(
            (SELECT json_agg(json_build_object('id', pi.id, 'url', pi.url, 'alt', pi.alt))
             FROM product_images pi WHERE pi.product_id = p.id ORDER BY pi.sort_order LIMIT 1),
            '[]'::json
          )
        ) as product
       FROM cart_items ci
       JOIN products p ON ci.product_id = p.id
       WHERE ci.cart_id = $1
       ORDER BY ci.added_at DESC`,
      [cartId]
    );

    const totalAmount = itemsResult.rows.reduce(
      (sum, item) => sum + parseFloat(item.price) * item.quantity,
      0
    );
    const totalItems = itemsResult.rows.reduce(
      (sum, item) => sum + item.quantity,
      0
    );

    res.json({
      success: true,
      data: {
        cart: {
          id: cartId,
          userId,
          items: itemsResult.rows,
          totalItems,
          totalAmount,
          updatedAt: new Date().toISOString(),
        },
      },
    });
  } catch (err) {
    console.error("Get cart error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to get cart" },
    });
  }
});

// POST /api/cart/items — Add item to cart
router.post("/items", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { productId, quantity = 1 } = req.body;

    if (!productId) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "productId is required" },
      });
    }

    // Get product price
    const productResult = await query(
      "SELECT id, price, status FROM products WHERE id = $1",
      [productId]
    );
    if (productResult.rows.length === 0 || productResult.rows[0].status !== "active") {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Product not found" },
      });
    }

    // Ensure cart exists
    let cartResult = await query("SELECT id FROM carts WHERE user_id = $1", [userId]);
    if (cartResult.rows.length === 0) {
      cartResult = await query(
        "INSERT INTO carts (user_id) VALUES ($1) RETURNING id",
        [userId]
      );
    }
    const cartId = cartResult.rows[0].id;

    // Upsert cart item
    await query(
      `INSERT INTO cart_items (cart_id, product_id, quantity, price)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (cart_id, product_id)
       DO UPDATE SET quantity = cart_items.quantity + $3`,
      [cartId, productId, quantity, productResult.rows[0].price]
    );

    // Update cart timestamp
    await query("UPDATE carts SET updated_at = NOW() WHERE id = $1", [cartId]);

    // Redirect to GET /cart for consistent response
    req.url = "/";
    router.handle(req, res);
  } catch (err) {
    console.error("Add to cart error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to add to cart" },
    });
  }
});

// PATCH /api/cart/items/:itemId — Update cart item quantity
router.patch("/items/:itemId", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { itemId } = req.params;
    const { quantity } = req.body;

    if (typeof quantity !== "number" || quantity < 1) {
      return res.status(400).json({
        success: false,
        error: { code: "VALIDATION_ERROR", message: "quantity must be >= 1" },
      });
    }

    const cartResult = await query("SELECT id FROM carts WHERE user_id = $1", [userId]);
    if (cartResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Cart not found" },
      });
    }

    await query(
      "UPDATE cart_items SET quantity = $1 WHERE id = $2 AND cart_id = $3",
      [quantity, itemId, cartResult.rows[0].id]
    );

    req.url = "/";
    router.handle(req, res);
  } catch (err) {
    console.error("Update cart item error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to update cart item" },
    });
  }
});

// DELETE /api/cart/items/:itemId — Remove item from cart
router.delete("/items/:itemId", authenticate, async (req, res) => {
  try {
    const userId = req.user!.userId;
    const { itemId } = req.params;

    const cartResult = await query("SELECT id FROM carts WHERE user_id = $1", [userId]);
    if (cartResult.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: { code: "NOT_FOUND", message: "Cart not found" },
      });
    }

    await query(
      "DELETE FROM cart_items WHERE id = $1 AND cart_id = $2",
      [itemId, cartResult.rows[0].id]
    );

    req.url = "/";
    router.handle(req, res);
  } catch (err) {
    console.error("Remove cart item error:", err);
    res.status(500).json({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Failed to remove cart item" },
    });
  }
});

export { router as cartRouter };
