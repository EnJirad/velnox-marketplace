/**
 * Velnox Customer Cart, Wishlist & Order Endpoints
 *
 * Cart:
 *   GET    /api/customer/cart            — Get current user's cart
 *   POST   /api/customer/cart/add        — Add item to cart
 *   PUT    /api/customer/cart/item/:id   — Update cart item quantity
 *   DELETE /api/customer/cart/item/:id   — Remove cart item
 *
 * Wishlist:
 *   GET    /api/customer/wishlist        — Get user's wishlist
 *   POST   /api/customer/wishlist/toggle — Toggle product in wishlist
 *
 * Orders:
 *   POST   /api/customer/checkout        — Create order from cart
 *   GET    /api/customer/orders          — List user's orders
 *   GET    /api/customer/orders/:id      — Get order detail
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query, withTransaction } from "../db/index.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function param(req: Request, key: string): string {
  return (req.params as Record<string, string>)[key] ?? "";
}

/**
 * Ensure the user has a cart row. Returns the cart_id.
 */
async function ensureCart(userId: string): Promise<string> {
  const existing = await query("SELECT id FROM carts WHERE user_id = $1", [userId]);
  if (existing.rows.length > 0) return existing.rows[0].id;

  const created = await query(
    "INSERT INTO carts (user_id) VALUES ($1) RETURNING id",
    [userId],
  );
  return created.rows[0].id;
}

/**
 * Recalculate cart totals from cart_items.
 */
async function recalcCart(cartId: string): Promise<void> {
  await query(
    `UPDATE carts
       SET total_items  = COALESCE((SELECT SUM(quantity)   FROM cart_items WHERE cart_id = $1), 0),
           total_amount = COALESCE((SELECT SUM(price * quantity) FROM cart_items WHERE cart_id = $1), 0),
           updated_at   = NOW()
     WHERE id = $1`,
    [cartId],
  );
}

// ─── CART ─────────────────────────────────────────────────────────────────────

export function setupCartRoutes(app: Express): void {
  // ── GET /api/customer/cart ────────────────────────────────────────────────
  app.get("/api/customer/cart", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const cartId = await ensureCart(userId);

      const result = await query(
        `SELECT ci.*,
                p.name AS product_name,
                p.unit AS unit,
                i.quantity AS available_stock,
                sh.name AS shop_name,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url
         FROM cart_items ci
         JOIN products p ON ci.product_id = p.id
         LEFT JOIN inventory i ON i.product_id = p.id
         LEFT JOIN shops sh ON p.shop_id = sh.id
         WHERE ci.cart_id = $1
         ORDER BY ci.added_at DESC`,
        [cartId],
      );

      const items = result.rows.map((r: any) => ({
        id: r.id,
        productId: r.product_id,
        productName: r.product_name,
        unit: r.unit,
        quantity: r.quantity,
        priceSnapshot: parseFloat(r.price),
        availableStock: r.available_stock ?? 0,
        shopName: r.shop_name,
        productImageUrl: r.product_image_url,
        addedAt: r.added_at,
      }));

      res.json({ success: true, data: { items } });
    } catch (err) {
      console.error("[cart] get error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch cart" } });
    }
  });

  // ── POST /api/customer/cart/add ───────────────────────────────────────────
  app.post("/api/customer/cart/add", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { productId, quantity = 1, variantId = null } = req.body;

      if (!productId || typeof productId !== "string") {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "productId is required" } });
        return;
      }

      const qty = Math.max(1, Math.floor(Number(quantity) || 1));

      // Validate product exists and is published
      const productResult = await query(
        "SELECT id, price, status FROM products WHERE id = $1",
        [productId],
      );
      if (productResult.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
        return;
      }
      const product = productResult.rows[0];
      if (product.status !== "published") {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Product is not available" } });
        return;
      }

      // Check stock
      const invResult = await query("SELECT quantity, reserved FROM inventory WHERE product_id = $1", [productId]);
      const inv = invResult.rows[0];
      const availableStock = inv ? inv.quantity - inv.reserved : 999;

      const cartId = await ensureCart(userId);

      // Check if item already in cart
      const existing = await query(
        "SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2",
        [cartId, productId],
      );

      if (existing.rows.length > 0) {
        const newQty = Math.min(availableStock, existing.rows[0].quantity + qty);
        await query(
          "UPDATE cart_items SET quantity = $1 WHERE id = $2",
          [newQty, existing.rows[0].id],
        );
      } else {
        const addQty = Math.min(availableStock, qty);
        // Note: variant_id column may not exist yet in production.
        // After V0021 migration applies, re-add variant_id support.
        // For now, use a try-catch to handle both cases.
        try {
          await query(
            "INSERT INTO cart_items (cart_id, product_id, quantity, price, variant_id) VALUES ($1, $2, $3, $4, $5)",
            [cartId, productId, addQty, product.price, variantId],
          );
        } catch (insertErr: any) {
          // If column 'variant_id' does not exist (42703), retry without it
          if (insertErr?.code === "42703") {
            await query(
              "INSERT INTO cart_items (cart_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)",
              [cartId, productId, addQty, product.price],
            );
          } else {
            throw insertErr;
          }
        }
      }

      await recalcCart(cartId);

      // Return updated cart
      const cartResult = await query(
        `SELECT ci.*,
                p.name AS product_name,
                p.unit AS unit,
                i.quantity AS available_stock,
                sh.name AS shop_name,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url
         FROM cart_items ci
         JOIN products p ON ci.product_id = p.id
         LEFT JOIN inventory i ON i.product_id = p.id
         LEFT JOIN shops sh ON p.shop_id = sh.id
         WHERE ci.cart_id = $1
         ORDER BY ci.added_at DESC`,
        [cartId],
      );

      const items = cartResult.rows.map((r: any) => ({
        id: r.id,
        productId: r.product_id,
        productName: r.product_name,
        unit: r.unit,
        quantity: r.quantity,
        priceSnapshot: parseFloat(r.price),
        availableStock: r.available_stock ?? 0,
        shopName: r.shop_name,
        productImageUrl: r.product_image_url,
        addedAt: r.added_at,
      }));

      res.json({ success: true, data: { items } });
    } catch (err) {
      console.error("[cart] add error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to add to cart" } });
    }
  });

  // ── PUT /api/customer/cart/item/:cartItemId ───────────────────────────────
  app.put("/api/customer/cart/item/:cartItemId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const cartItemId = param(req, "cartItemId");
      const { quantity } = req.body;
      const qty = Number(quantity);

      if (qty <= 0) {
        // Remove item
        await query(
          `DELETE FROM cart_items WHERE id = $1 AND cart_id = (SELECT id FROM carts WHERE user_id = $2)`,
          [cartItemId, userId],
        );
        const cartId = await ensureCart(userId);
        await recalcCart(cartId);
        res.json({ success: true, data: { removed: true } });
        return;
      }

      // Validate stock
      const itemResult = await query(
        `SELECT ci.*, i.quantity AS stock_qty, i.reserved
         FROM cart_items ci
         JOIN carts c ON ci.cart_id = c.id
         LEFT JOIN inventory i ON i.product_id = ci.product_id
         WHERE ci.id = $1 AND c.user_id = $2`,
        [cartItemId, userId],
      );

      if (itemResult.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Cart item not found" } });
        return;
      }

      const item = itemResult.rows[0];
      const availableStock = (item.stock_qty ?? 0) - (item.reserved ?? 0);
      const finalQty = Math.min(qty, availableStock || 999);

      await query("UPDATE cart_items SET quantity = $1 WHERE id = $2", [finalQty, cartItemId]);

      const cartId = await ensureCart(userId);
      await recalcCart(cartId);

      // Return updated cart
      const cartResult = await query(
        `SELECT ci.*,
                p.name AS product_name,
                p.unit AS unit,
                i.quantity AS available_stock,
                sh.name AS shop_name,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url
         FROM cart_items ci
         JOIN products p ON ci.product_id = p.id
         LEFT JOIN inventory i ON i.product_id = p.id
         LEFT JOIN shops sh ON p.shop_id = sh.id
         WHERE ci.cart_id = $1
         ORDER BY ci.added_at DESC`,
        [cartId],
      );

      const items = cartResult.rows.map((r: any) => ({
        id: r.id,
        productId: r.product_id,
        productName: r.product_name,
        unit: r.unit,
        quantity: r.quantity,
        priceSnapshot: parseFloat(r.price),
        availableStock: r.available_stock ?? 0,
        shopName: r.shop_name,
        productImageUrl: r.product_image_url,
        addedAt: r.added_at,
      }));

      res.json({ success: true, data: { items } });
    } catch (err) {
      console.error("[cart] update error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update cart item" } });
    }
  });

  // ── DELETE /api/customer/cart/item/:cartItemId ─────────────────────────────
  app.delete("/api/customer/cart/item/:cartItemId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const cartItemId = param(req, "cartItemId");

      await query(
        `DELETE FROM cart_items WHERE id = $1 AND cart_id = (SELECT id FROM carts WHERE user_id = $2)`,
        [cartItemId, userId],
      );

      const cartId = await ensureCart(userId);
      await recalcCart(cartId);

      // Return updated cart
      const cartResult = await query(
        `SELECT ci.*,
                p.name AS product_name,
                p.unit AS unit,
                i.quantity AS available_stock,
                sh.name AS shop_name,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url
         FROM cart_items ci
         JOIN products p ON ci.product_id = p.id
         LEFT JOIN inventory i ON i.product_id = p.id
         LEFT JOIN shops sh ON p.shop_id = sh.id
         WHERE ci.cart_id = $1
         ORDER BY ci.added_at DESC`,
        [cartId],
      );

      const items = cartResult.rows.map((r: any) => ({
        id: r.id,
        productId: r.product_id,
        productName: r.product_name,
        unit: r.unit,
        quantity: r.quantity,
        priceSnapshot: parseFloat(r.price),
        availableStock: r.available_stock ?? 0,
        shopName: r.shop_name,
        productImageUrl: r.product_image_url,
        addedAt: r.added_at,
      }));

      res.json({ success: true, data: { items } });
    } catch (err) {
      console.error("[cart] remove error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to remove cart item" } });
    }
  });

  // ─── WISHLIST ──────────────────────────────────────────────────────────────

  // ── GET /api/customer/wishlist ────────────────────────────────────────────
  app.get("/api/customer/wishlist", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const result = await query(
        `SELECT w.id, w.product_id, w.created_at,
                p.name, p.price, p.unit, p.currency, p.status,
                sh.name AS shop_name,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url
         FROM customer_wishlist w
         JOIN products p ON w.product_id = p.id
         LEFT JOIN shops sh ON p.shop_id = sh.id
         WHERE w.user_id = $1 AND p.status = 'published'
         ORDER BY w.created_at DESC`,
        [userId],
      );

      const items = result.rows.map((r: any) => ({
        id: r.id,
        productId: r.product_id,
        productName: r.name,
        price: parseFloat(r.price),
        unit: r.unit,
        currency: r.currency,
        shopName: r.shop_name,
        productImageUrl: r.product_image_url,
        createdAt: r.created_at,
      }));

      res.json({ success: true, data: items });
    } catch (err: any) {
      // Gracefully handle missing table — return empty wishlist instead of 500
      if (err?.code === "42P01" || String(err?.message ?? "").includes("does not exist")) {
        console.warn("[wishlist] table not found — returning empty wishlist");
        res.json({ success: true, data: [] });
        return;
      }
      console.error("[wishlist] get error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch wishlist" } });
    }
  });

  // ── POST /api/customer/wishlist/toggle ────────────────────────────────────
  app.post("/api/customer/wishlist/toggle", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { productId } = req.body;

      if (!productId || typeof productId !== "string") {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "productId is required" } });
        return;
      }

      // Check if already wishlisted
      const existing = await query(
        "SELECT id FROM customer_wishlist WHERE user_id = $1 AND product_id = $2",
        [userId, productId],
      );

      if (existing.rows.length > 0) {
        // Remove from wishlist
        await query(
          "DELETE FROM customer_wishlist WHERE user_id = $1 AND product_id = $2",
          [userId, productId],
        );
        res.json({ success: true, data: { wishlisted: false, added: false } });
      } else {
        // Add to wishlist
        await query(
          "INSERT INTO customer_wishlist (user_id, product_id) VALUES ($1, $2)",
          [userId, productId],
        );
        res.json({ success: true, data: { wishlisted: true, added: true } });
      }
    } catch (err: any) {
      if (err?.code === "42P01" || String(err?.message ?? "").includes("does not exist")) {
        console.warn("[wishlist] table not found — cannot toggle");
        res.status(503).json({ success: false, error: { code: "TABLE_MISSING", message: "Wishlist is not available yet. Please try again later." } });
        return;
      }
      console.error("[wishlist] toggle error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to toggle wishlist" } });
    }
  });

  // ─── ORDERS / CHECKOUT ────────────────────────────────────────────────────

  // ── POST /api/customer/checkout ───────────────────────────────────────────
  app.post("/api/customer/checkout", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { shippingAddressId, shippingAddress, notes } = req.body;

      // Get cart
      const cartResult = await query("SELECT id FROM carts WHERE user_id = $1", [userId]);
      if (cartResult.rows.length === 0) {
        res.status(400).json({ success: false, error: { code: "EMPTY_CART", message: "Cart is empty" } });
        return;
      }
      const cartId = cartResult.rows[0].id;

      // Get cart items with product details (include image for snapshot)
      const itemsResult = await query(
        `SELECT ci.*, p.name AS product_name, p.shop_id, p.status AS product_status,
                i.quantity AS stock_qty, i.reserved,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url
         FROM cart_items ci
         JOIN products p ON ci.product_id = p.id
         LEFT JOIN inventory i ON i.product_id = p.id
         WHERE ci.cart_id = $1`,
        [cartId],
      );

      if (itemsResult.rows.length === 0) {
        res.status(400).json({ success: false, error: { code: "EMPTY_CART", message: "Cart is empty" } });
        return;
      }

      // Validate all items
      const items = itemsResult.rows;
      for (const item of items) {
        if (item.product_status !== "published") {
          res.status(400).json({
            success: false,
            error: { code: "PRODUCT_UNAVAILABLE", message: `Product "${item.product_name}" is no longer available` },
          });
          return;
        }
        const available = (item.stock_qty ?? 0) - (item.reserved ?? 0);
        if (item.quantity > available) {
          res.status(400).json({
            success: false,
            error: { code: "INSUFFICIENT_STOCK", message: `Insufficient stock for "${item.product_name}"` },
          });
          return;
        }
      }

      // Group items by shop
      const shopMap = new Map<string, typeof items>();
      for (const item of items) {
        const shopId = item.shop_id || "unknown";
        const list = shopMap.get(shopId) ?? [];
        list.push(item);
        shopMap.set(shopId, list);
      }

      // Create orders (one per shop)
      const createdOrders: any[] = [];

      await withTransaction(async (client) => {
        for (const [shopId, shopItems] of shopMap) {
          // Calculate total from DB prices (not client-provided)
          let totalAmount = 0;
          for (const item of shopItems) {
            totalAmount += parseFloat(item.price) * item.quantity;
          }

          // Create order
          const orderResult = await client.query(
            `INSERT INTO orders (user_id, shop_id, status, total_amount, currency, shipping_address_id, shipping_address, notes)
             VALUES ($1, $2, 'pending', $3, 'THB', $4, $5, $6)
             RETURNING id, created_at`,
            [userId, shopId, totalAmount, shippingAddressId || null, shippingAddress ? JSON.stringify(shippingAddress) : null, notes || null],
          );
          const orderId = orderResult.rows[0].id;

          // Create order items + decrease stock
          for (const item of shopItems) {
            const subtotal = parseFloat(item.price) * item.quantity;
            await client.query(
              `INSERT INTO order_items (order_id, product_id, shop_id, product_name, product_name_snapshot, image_url_snapshot, quantity, price, subtotal)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [orderId, item.product_id, item.shop_id || null, item.product_name, item.product_name, item.product_image_url || null, item.quantity, item.price, subtotal],
            );

            // Reserve stock
            await client.query(
              `UPDATE inventory SET reserved = reserved + $1 WHERE product_id = $2`,
              [item.quantity, item.product_id],
            );
          }

          createdOrders.push({ orderId, orderNumber: orderId, shopId, shopName: shopItems[0]?.shop_name ?? '', subtotal: totalAmount, shippingFee: 0, total: totalAmount });
        }

        // Clear purchased items from cart
        await client.query("DELETE FROM cart_items WHERE cart_id = $1", [cartId]);
        await client.query(
          "UPDATE carts SET total_items = 0, total_amount = 0, updated_at = NOW() WHERE id = $1",
          [cartId],
        );
      });

      const parentOrderId = createdOrders[0]?.orderId ?? '';
      const parentOrderNumber = createdOrders[0]?.orderNumber ?? '';
      const totalAll = createdOrders.reduce((s, o) => s + o.total, 0);
      const itemCount = items.reduce((s, i) => s + i.quantity, 0);
      res.json({ success: true, data: { parentOrderId, parentOrderNumber, orders: createdOrders, total: totalAll, itemCount } });
    } catch (err) {
      console.error("[checkout] error:", err);
      res.status(500).json({ success: false, error: { code: "CHECKOUT_FAILED", message: "Failed to create order" } });
    }
  });

  // ── GET /api/customer/orders ──────────────────────────────────────────────
  app.get("/api/customer/orders", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const limit = Math.min(Number(req.query.limit) || 50, 100);

      const result = await query(
        `SELECT o.*, sh.name AS shop_name, sh.slug AS shop_slug
         FROM orders o
         LEFT JOIN shops sh ON o.shop_id = sh.id
         WHERE o.user_id = $1
         ORDER BY o.created_at DESC
         LIMIT $2`,
        [userId, limit],
      );

      // Fetch items for each order
      const ordersWithItems = await Promise.all(
        result.rows.map(async (r: any) => {
          const itemsRes = await query(
            `SELECT oi.*, p.unit,
                    (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url
             FROM order_items oi
             JOIN products p ON oi.product_id = p.id
             WHERE oi.order_id = $1`,
            [r.id],
          );
          const items = itemsRes.rows.map((i: any) => ({
            id: i.id,
            orderId: i.order_id,
            productId: i.product_id,
            productName: i.product_name,
            unit: i.unit,
            unitPrice: parseFloat(i.price),
            quantity: i.quantity,
            subtotal: parseFloat(i.price) * i.quantity,
            productImageUrl: i.product_image_url,
          }));
          return {
            id: r.id,
            orderNumber: r.id,
            customerUserId: r.user_id,
            status: r.status,
            paymentStatus: 'unpaid',
            shippingStatus: 'pending',
            shippingMethod: null,
            trackingNumber: null,
            subtotal: parseFloat(r.total_amount),
            discount: 0,
            shippingFee: 0,
            total: parseFloat(r.total_amount),
            currency: r.currency ?? 'THB',
            addressSnapshot: r.shipping_address ? JSON.parse(r.shipping_address) : null,
            note: r.notes,
            createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
            updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
            items,
            itemCount: items.reduce((s: number, i: any) => s + i.quantity, 0),
          };
        }),
      );
      const orders = ordersWithItems;

      res.json({ success: true, data: orders });
    } catch (err) {
      console.error("[orders] list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch orders" } });
    }
  });

  // ── GET /api/customer/orders/:orderId ─────────────────────────────────────
  app.get("/api/customer/orders/:orderId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const orderId = param(req, "orderId");

      const orderResult = await query(
        `SELECT o.*, sh.name AS shop_name, sh.slug AS shop_slug
         FROM orders o
         LEFT JOIN shops sh ON o.shop_id = sh.id
         WHERE o.id = $1 AND o.user_id = $2`,
        [orderId, userId],
      );

      if (orderResult.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Order not found" } });
        return;
      }

      const order = orderResult.rows[0];

      // Get order items
      const itemsResult = await query(
        `SELECT oi.*, p.unit,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url
         FROM order_items oi
         JOIN products p ON oi.product_id = p.id
         WHERE oi.order_id = $1`,
        [orderId],
      );

      const items = itemsResult.rows.map((r: any) => ({
        id: r.id,
        productId: r.product_id,
        productName: r.product_name,
        unit: r.unit,
        quantity: r.quantity,
        price: parseFloat(r.price),
        subtotal: parseFloat(r.price) * r.quantity,
        productImageUrl: r.product_image_url,
      }));

      res.json({
        success: true,
        data: {
          id: order.id,
          orderNumber: order.id,
          customerUserId: order.user_id,
          status: order.status,
          paymentStatus: 'unpaid',
          shippingStatus: 'pending',
          shippingMethod: null,
          trackingNumber: null,
          subtotal: parseFloat(order.total_amount),
          discount: 0,
          shippingFee: 0,
          total: parseFloat(order.total_amount),
          currency: order.currency ?? 'THB',
          addressSnapshot: order.shipping_address ? JSON.parse(order.shipping_address) : null,
          note: order.notes,
          createdAt: order.created_at ? new Date(order.created_at).getTime() : Date.now(),
          updatedAt: order.updated_at ? new Date(order.updated_at).getTime() : Date.now(),
          items,
          itemCount: items.reduce((s: number, i: any) => s + i.quantity, 0),
        },
      });
    } catch (err) {
      console.error("[orders] detail error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch order" } });
    }
  });

  // ─── SUBSCRIPTIONS (VelRepeat stubs) ──────────────────────────────────────

  // ── GET /api/customer/subscriptions ────────────────────────────────────
  app.get("/api/customer/subscriptions", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      // Check if subscriptions table exists
      const tableCheck = await query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'subscriptions') AS exists`
      );
      if (!tableCheck.rows[0]?.exists) {
        res.json({ success: true, data: [] });
        return;
      }
      const result = await query(
        `SELECT s.*, p.name AS product_name, p.unit,
                (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url
         FROM subscriptions s
         LEFT JOIN products p ON s.product_id = p.id
         WHERE s.user_id = $1
         ORDER BY s.created_at DESC`,
        [userId],
      );
      const subs = result.rows.map((r: any) => ({
        id: r.id,
        productId: r.product_id,
        productName: r.product_name,
        unit: r.unit,
        quantity: r.quantity ?? 1,
        intervalDays: r.interval_days ?? 30,
        nextOrderDate: r.next_order_date,
        status: r.status,
        productImageUrl: r.product_image_url,
        createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
      }));
      res.json({ success: true, data: subs });
    } catch (err) {
      console.error("[subscriptions] list error:", err);
      res.json({ success: true, data: [] });
    }
  });

  // ── POST /api/subscriptions/create ──────────────────────────────────────
  app.post("/api/subscriptions/create", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { productId, quantity = 1, intervalDays = 30 } = req.body;
      if (!productId) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "productId is required" } });
        return;
      }
      // Verify product exists and is published
      const prod = await query("SELECT id, status FROM products WHERE id = $1", [productId]);
      if (prod.rows.length === 0 || prod.rows[0].status !== 'published') {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
        return;
      }
      const tableCheck = await query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'subscriptions') AS exists`
      );
      if (!tableCheck.rows[0]?.exists) {
        res.status(501).json({ success: false, error: { code: "NOT_IMPLEMENTED", message: "Subscriptions not available yet" } });
        return;
      }
      const nextDate = new Date();
      nextDate.setDate(nextDate.getDate() + intervalDays);
      const result = await query(
        `INSERT INTO subscriptions (user_id, product_id, quantity, interval_days, next_order_date, status)
         VALUES ($1, $2, $3, $4, $5, 'active')
         RETURNING *`,
        [userId, productId, quantity, intervalDays, nextDate.toISOString().split('T')[0]],
      );
      res.json({ success: true, data: { id: result.rows[0].id, status: 'active' } });
    } catch (err) {
      console.error("[subscriptions] create error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to create subscription" } });
    }
  });

  // ── PATCH /api/subscriptions/:subscriptionId/pause ──────────────────────
  app.patch("/api/subscriptions/:subscriptionId/pause", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const subId = param(req, "subscriptionId");
      const { status } = req.body;
      const tableCheck = await query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'subscriptions') AS exists`
      );
      if (!tableCheck.rows[0]?.exists) {
        res.status(501).json({ success: false, error: { code: "NOT_IMPLEMENTED", message: "Subscriptions not available yet" } });
        return;
      }
      await query(
        `UPDATE subscriptions SET status = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`,
        [status ?? 'cancelled', subId, userId],
      );
      res.json({ success: true, data: { id: subId, status: status ?? 'cancelled' } });
    } catch (err) {
      console.error("[subscriptions] pause error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update subscription" } });
    }
  });

  // ── PATCH /api/subscriptions/:subscriptionId ──────────────────────────────
  app.patch("/api/subscriptions/:subscriptionId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const subId = param(req, "subscriptionId");
      const { intervalDays, quantity } = req.body;
      const tableCheck = await query(
        `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'subscriptions') AS exists`
      );
      if (!tableCheck.rows[0]?.exists) {
        res.status(501).json({ success: false, error: { code: "NOT_IMPLEMENTED", message: "Subscriptions not available yet" } });
        return;
      }
      if (intervalDays != null) {
        await query(`UPDATE subscriptions SET interval_days = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`, [intervalDays, subId, userId]);
      }
      if (quantity != null) {
        await query(`UPDATE subscriptions SET quantity = $1, updated_at = NOW() WHERE id = $2 AND user_id = $3`, [quantity, subId, userId]);
      }
      res.json({ success: true, data: { id: subId } });
    } catch (err) {
      console.error("[subscriptions] update error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update subscription" } });
    }
  });
}
