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
import { reserveInventoryStock, validateCheckoutQuantity } from "../lib/inventory.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function param(req: Request, key: string): string {
  return (req.params as Record<string, string>)[key] ?? "";
}

/**
 * Resolve order item display data (snapshot-first) for one or more orders.
 *
 * Image priority: purchased snapshot → current variant image → product gallery.
 * Variant name priority: purchased snapshot → current option labels → variant name.
 * Products are LEFT JOINed so deleted/unpublished products never break the order view.
 */
async function fetchOrderItemsForOrders(orderIds: string[]): Promise<Record<string, any[]>> {
  if (orderIds.length === 0) return {};

  const itemsRes = await query(
    `SELECT oi.id, oi.order_id, oi.product_id, oi.shop_id, oi.variant_id,
            oi.quantity, oi.price, oi.subtotal,
            COALESCE(NULLIF(oi.product_name_snapshot, ''), NULLIF(oi.product_name, ''), p.name, '') AS product_name,
            oi.variant_name_snapshot AS variant_name_snapshot,
            COALESCE(oi.image_url_snapshot,
                     (SELECT url FROM product_images WHERE product_id = oi.product_id ORDER BY sort_order ASC LIMIT 1)) AS image_url,
            p.unit AS unit, p.status AS product_status
     FROM order_items oi
     LEFT JOIN products p ON oi.product_id = p.id
     WHERE oi.order_id = ANY($1)
     ORDER BY oi.created_at ASC`,
    [orderIds],
  );

  // Resolve current variant names + images for items whose snapshot is missing
  // (backward compatibility for orders created before snapshots were stored).
  const variantIds = [...new Set(itemsRes.rows.map((r: any) => r.variant_id).filter(Boolean))];
  const variantMap = new Map<string, { name: string; image: string | null; labels: string | null }>();
  if (variantIds.length > 0) {
    try {
      const varRes = await query(
        `SELECT pv.id AS variant_id, pv.name,
                (SELECT url FROM product_variant_images WHERE variant_id = pv.id ORDER BY sort_order ASC LIMIT 1) AS variant_image,
                (SELECT string_agg(pov.label, ' / ' ORDER BY pog.sort_order)
                 FROM product_variant_values pvv
                 JOIN product_option_values pov ON pvv.option_value_id = pov.id
                 JOIN product_option_groups pog ON pov.option_group_id = pog.id
                 WHERE pvv.variant_id = pv.id) AS option_labels
         FROM product_variants pv
         WHERE pv.id = ANY($1)`,
        [variantIds],
      );
      for (const row of varRes.rows) {
        variantMap.set(row.variant_id, { name: row.name, image: row.variant_image, labels: row.option_labels });
      }
    } catch {
      // Variant tables may not exist on legacy databases — snapshots already cover most cases.
    }
  }

  const byOrder = new Map<string, any[]>();
  for (const r of itemsRes.rows) {
    const variant = r.variant_id ? variantMap.get(r.variant_id) : null;
    const variantName = r.variant_name_snapshot || variant?.labels || variant?.name || null;
    const imageUrl = r.image_url || variant?.image || null;
    const unitPrice = parseFloat(r.price) || 0;
    const item = {
      id: r.id,
      orderId: r.order_id,
      productId: r.product_id,
      shopId: r.shop_id,
      variantId: r.variant_id,
      productName: r.product_name || "สินค้า",
      unit: r.unit ?? "",
      unitPrice,
      price: unitPrice,
      quantity: r.quantity,
      subtotal: parseFloat(r.subtotal) || unitPrice * r.quantity,
      variantName,
      imageUrl,
      productStatus: r.product_status,
    };
    const list = byOrder.get(r.order_id) ?? [];
    list.push(item);
    byOrder.set(r.order_id, list);
  }
  return Object.fromEntries(byOrder);
}

/**
 * Load shipments for an order with their tracking events.
 * Tracking events are read defensively so legacy DBs without the table
 * still return shipments (events just empty).
 */
async function fetchShipmentsForOrder(orderId: string): Promise<any[]> {
  const sRes = await query(
    `SELECT s.id, s.carrier, s.tracking_number, s.status, s.estimated_delivery_date
     FROM shipments s
     WHERE s.order_id = $1
     ORDER BY s.created_at DESC`,
    [orderId],
  );
  const shipments = sRes.rows.map((r: any) => ({
    id: r.id,
    carrier: r.carrier,
    trackingNumber: r.tracking_number,
    status: r.status,
    estimatedDeliveryDate: r.estimated_delivery_date,
    events: [] as any[],
  }));
  if (shipments.length === 0) return shipments;
  try {
    const eventsRes = await query(
      `SELECT te.id, te.shipment_id, te.status, te.description, te.location, te.occurred_at
       FROM tracking_events te
       WHERE te.shipment_id = ANY($1)
       ORDER BY te.occurred_at ASC`,
      [shipments.map((s) => s.id)],
    );
    const byShipment = new Map<string, any[]>();
    for (const e of eventsRes.rows) {
      const list = byShipment.get(e.shipment_id) ?? [];
      list.push({
        id: e.id,
        status: e.status,
        description: e.description,
        location: e.location,
        occurredAt: e.occurred_at,
      });
      byShipment.set(e.shipment_id, list);
    }
    for (const s of shipments) s.events = byShipment.get(s.id) ?? [];
  } catch {
    // tracking_events may not exist on legacy databases.
  }
  return shipments;
}

/**
 * Safely parse the order's shipping_address JSON snapshot.
 * Legacy orders may store malformed JSON or no address at all — never crash.
 */
/**
 * Copy a user's address row into the JSONB snapshot shape used by orders.
 * Mirrors addressSnapshot() in velrepeat-plans.ts — one canonical snapshot shape.
 */
function orderAddressSnapshot(a: any): Record<string, unknown> | null {
  if (!a) return null;
  return {
    label: a.label || "Home",
    recipientName: a.recipient_name || "",
    phone: a.phone || "",
    line1: a.line1 || "",
    line2: a.line2 || null,
    subdistrict: a.subdistrict || a.city || null,
    district: a.district || null,
    province: a.state || null,
    postalCode: a.postal_code || null,
    country: a.country || "TH",
  };
}

function parseShippingAddress(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== "string") return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
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

const CART_ITEMS_QUERY_FULL = `
  SELECT ci.*,
    p.name AS product_name,
    p.unit AS unit,
    COALESCE(pv.stock, i.quantity, 0) AS available_stock,
    sh.name AS shop_name,
    (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url,
    pv.name AS variant_name,
    pv.sku AS variant_sku,
    COALESCE(
      (SELECT string_agg(pov.label, ' / ' ORDER BY pog.sort_order)
       FROM product_variant_values pvv
       JOIN product_option_values pov ON pvv.option_value_id = pov.id
       JOIN product_option_groups pog ON pov.option_group_id = pog.id
       WHERE pvv.variant_id = ci.variant_id),
      ''
    ) AS variant_option_labels,
    (SELECT pov.image_url
     FROM product_variant_values pvv
     JOIN product_option_values pov ON pvv.option_value_id = pov.id
     JOIN product_option_groups pog ON pov.option_group_id = pog.id
     WHERE pvv.variant_id = ci.variant_id
       AND pog.display_type = 'image'
       AND pov.image_url IS NOT NULL AND pov.image_url != ''
     ORDER BY pog.sort_order LIMIT 1) AS variant_option_image_url
  FROM cart_items ci
  JOIN products p ON ci.product_id = p.id
  LEFT JOIN inventory i ON i.product_id = p.id
  LEFT JOIN shops sh ON p.shop_id = sh.id
  LEFT JOIN product_variants pv ON ci.variant_id = pv.id
  WHERE ci.cart_id = $1
  ORDER BY ci.added_at DESC
`;

const CART_ITEMS_QUERY_BASIC = `
  SELECT ci.*,
    p.name AS product_name,
    p.unit AS unit,
    COALESCE(pv.stock, i.quantity, 0) AS available_stock,
    sh.name AS shop_name,
    (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url,
    (SELECT pov.image_url
     FROM product_variant_values pvv
     JOIN product_option_values pov ON pvv.option_value_id = pov.id
     JOIN product_option_groups pog ON pov.option_group_id = pog.id
     WHERE pvv.variant_id = ci.variant_id
       AND pog.display_type = 'image'
       AND pov.image_url IS NOT NULL AND pov.image_url != ''
     ORDER BY pog.sort_order LIMIT 1) AS variant_option_image_url
  FROM cart_items ci
  JOIN products p ON ci.product_id = p.id
  LEFT JOIN inventory i ON i.product_id = p.id
  LEFT JOIN shops sh ON p.shop_id = sh.id
  WHERE ci.cart_id = $1
  ORDER BY ci.added_at DESC
`;

async function fetchCartItems(cartId: string): Promise<any[]> {
  try {
    return (await query(CART_ITEMS_QUERY_FULL, [cartId])).rows;
  } catch (err: any) {
    // 42P01 = relation does not exist — variant tables not yet migrated to production
    if (err?.code !== "42P01") throw err;
    console.warn("[cart] variant tables not found in DB, using basic cart query (run V0028 migration)");
    return (await query(CART_ITEMS_QUERY_BASIC, [cartId])).rows;
  }
}

function formatCartRow(r: any) {
  return {
    id: r.id,
    productId: r.product_id,
    variantId: r.variant_id ?? null,
    variantName: r.variant_name ?? null,
    variantSku: r.variant_sku ?? null,
    variantOptionLabels: r.variant_option_labels || null,
    productName: r.product_name ?? r.name ?? "สินค้า",
    unit: r.unit,
    quantity: r.quantity,
    priceSnapshot: parseFloat(r.price),
    availableStock: r.available_stock ?? 0,
    shopName: r.shop_name,
    productImageUrl: r.variant_option_image_url || r.product_image_url,
    addedAt: r.added_at,
  };
}

// ─── CART ─────────────────────────────────────────────────────────────────────

export function setupCartRoutes(app: Express): void {
  // ── GET /api/customer/cart ────────────────────────────────────────────────
  app.get("/api/customer/cart", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const cartId = await ensureCart(userId);

      const rows = await fetchCartItems(cartId);
      const items = rows.map(formatCartRow);
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

      // Validate variant if provided
      let cartPrice = parseFloat(product.price);
      let availableStock = 0;
      let validatedVariantId: string | null = null;

      if (variantId && typeof variantId === "string") {
        let varResult;
        try {
          varResult = await query(
            "SELECT id, price, stock, status, product_id FROM product_variants WHERE id = $1",
            [variantId],
          );
        } catch (varErr: any) {
          if (varErr?.code === "42P01") {
            res.status(503).json({ success: false, error: { code: "STOCK_UNAVAILABLE", message: "Variant system is unavailable. Please try again later." } });
            return;
          }
          throw varErr;
        }
        if (varResult.rows.length === 0) {
          res.status(400).json({ success: false, error: { code: "VARIANT_NOT_FOUND", message: "Selected variant was not found." } });
          return;
        }
        const variant = varResult.rows[0];
        if (variant.product_id !== productId) {
          res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Variant does not belong to this product" } });
          return;
        }
        if (variant.status !== "active") {
          res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Variant is not available" } });
          return;
        }
        // Validate stock is a valid number
        const variantStock = Number(variant.stock);
        if (variant.stock == null || !Number.isFinite(variantStock)) {
          res.status(503).json({ success: false, error: { code: "STOCK_UNAVAILABLE", message: "Variant stock is unavailable. Please try again later." } });
          return;
        }
        if (variantStock <= 0) {
          res.status(400).json({ success: false, error: { code: "OUT_OF_STOCK", message: "This variant is out of stock." } });
          return;
        }
        // Server determines authoritative price and stock from variant
        cartPrice = parseFloat(variant.price);
        availableStock = variantStock;
        validatedVariantId = variant.id;
      } else {
        // No variant — check product-level stock from inventory
        const invResult = await query("SELECT quantity, reserved FROM inventory WHERE product_id = $1", [productId]);
        if (invResult.rows.length === 0) {
          res.status(503).json({ success: false, error: { code: "STOCK_UNAVAILABLE", message: "Stock information is unavailable. Please try again later." } });
          return;
        }
        const inv = invResult.rows[0];
        const quantity = Number(inv.quantity);
        const reserved = Number(inv.reserved);
        if (!Number.isFinite(quantity) || !Number.isFinite(reserved)) {
          res.status(503).json({ success: false, error: { code: "STOCK_UNAVAILABLE", message: "Stock data is corrupted. Please try again later." } });
          return;
        }
        availableStock = quantity - reserved;
        if (availableStock <= 0) {
          res.status(400).json({ success: false, error: { code: "OUT_OF_STOCK", message: "This product is out of stock." } });
          return;
        }
      }

      const cartId = await ensureCart(userId);

      // Check if item already in cart — match by productId + variantId
      const variantClause = validatedVariantId ? " AND variant_id = $3" : " AND variant_id IS NULL";
      const existingParams: any[] = [cartId, productId];
      if (validatedVariantId) existingParams.push(validatedVariantId);
      const existing = await query(
        `SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2${variantClause}`,
        existingParams,
      );

      if (existing.rows.length > 0) {
        const newQty = Math.min(availableStock, existing.rows[0].quantity + qty);
        await query(
          "UPDATE cart_items SET quantity = $1, price = $2 WHERE id = $3",
          [newQty, cartPrice, existing.rows[0].id],
        );
      } else {
        const addQty = Math.min(availableStock, qty);
        try {
          await query(
            "INSERT INTO cart_items (cart_id, product_id, quantity, price, variant_id) VALUES ($1, $2, $3, $4, $5)",
            [cartId, productId, addQty, cartPrice, validatedVariantId],
          );
        } catch (insertErr: any) {
          // 42703 = column does not exist — cart_items.variant_id not yet added by V0028
          if (insertErr?.code === "42703") {
            console.warn("[cart] variant_id column missing, inserting without it (run V0028 migration)");
            await query(
              "INSERT INTO cart_items (cart_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)",
              [cartId, productId, addQty, cartPrice],
            );
          } else {
            throw insertErr;
          }
        }
      }

      await recalcCart(cartId);

      const rows = await fetchCartItems(cartId);
      const items = rows.map(formatCartRow);
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

      // Check stock — variant stock is source of truth for variant products
      let availableStock: number;
      if (item.variant_id) {
        let varResult;
        try {
          varResult = await query(
            "SELECT stock FROM product_variants WHERE id = $1",
            [item.variant_id],
          );
        } catch (varErr: any) {
          if (varErr?.code === "42P01") {
            res.status(503).json({ success: false, error: { code: "STOCK_UNAVAILABLE", message: "Variant system is unavailable. Please try again later." } });
            return;
          }
          throw varErr;
        }
        if (varResult.rows.length === 0) {
          res.status(400).json({ success: false, error: { code: "VARIANT_NOT_FOUND", message: "Selected variant was not found." } });
          return;
        }
        const variantStock = Number(varResult.rows[0].stock);
        if (varResult.rows[0].stock == null || !Number.isFinite(variantStock)) {
          res.status(503).json({ success: false, error: { code: "STOCK_UNAVAILABLE", message: "Variant stock is unavailable. Please try again later." } });
          return;
        }
        if (variantStock <= 0) {
          res.status(400).json({ success: false, error: { code: "OUT_OF_STOCK", message: "This variant is out of stock." } });
          return;
        }
        availableStock = variantStock;
      } else {
        const quantity = Number(item.stock_qty ?? 0);
        const reserved = Number(item.reserved ?? 0);
        if (!Number.isFinite(quantity) || !Number.isFinite(reserved)) {
          res.status(503).json({ success: false, error: { code: "STOCK_UNAVAILABLE", message: "Stock data is unavailable. Please try again later." } });
          return;
        }
        availableStock = quantity - reserved;
      }
      const finalQty = Math.min(qty, availableStock);

      await query("UPDATE cart_items SET quantity = $1 WHERE id = $2", [finalQty, cartItemId]);

      const cartId = await ensureCart(userId);
      await recalcCart(cartId);

      const rows = await fetchCartItems(cartId);
      const items = rows.map(formatCartRow);
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

      const rows = await fetchCartItems(cartId);
      const items = rows.map(formatCartRow);
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
        console.warn("[wishlist] customer_wishlist table not found — run V0028 migration");
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
        console.warn("[wishlist] customer_wishlist table not found — run V0028 migration");
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
      // NOTE: clients send `addressId` (VelShop checkout) or `shippingAddressId`
      // (legacy) — accept both. The snapshot is ALWAYS built server-side from the
      // owned address row; a client-supplied `shippingAddress` object is never trusted.
      const body = req.body ?? {};
      const shippingAddressId = (body.shippingAddressId ?? body.addressId) as string | undefined;
      const notes = body.notes as string | undefined;
      const cartItemIds = body.cartItemIds as string[] | undefined;
      const requestId = body.requestId as string | undefined;
      // Payment method is only a routing hint (cod vs online); it never affects price.
      const paymentMethodBody = typeof body.paymentMethod === "string" ? body.paymentMethod : "cod";

      // Resolve + ownership-check the address BEFORE the transaction so the
      // snapshot is written from the database row, not from client input.
      let serverAddressSnapshot: Record<string, unknown> | null = null;
      if (shippingAddressId && typeof shippingAddressId === "string") {
        const addrResult = await query(
          `SELECT id, label, recipient_name, phone, line1, line2, subdistrict, district, city, state, postal_code, country
           FROM addresses WHERE id = $1 AND user_id = $2`,
          [shippingAddressId, userId],
        );
        if (addrResult.rows.length === 0) {
          res.status(403).json({
            success: false,
            error: { code: "ADDRESS_NOT_FOUND", message: "Shipping address was not found for this account." },
          });
          return;
        }
        serverAddressSnapshot = orderAddressSnapshot(addrResult.rows[0]);
      }

      // Get cart
      const cartResult = await query("SELECT id FROM carts WHERE user_id = $1", [userId]);
      if (cartResult.rows.length === 0) {
        res.status(400).json({ success: false, error: { code: "EMPTY_CART", message: "Cart is empty" } });
        return;
      }
      const cartId = cartResult.rows[0].id;

      // Get cart items with product details (include image for snapshot)
      // When cartItemIds is provided (Buy Now / selected items), only fetch those items
      let itemsResult;
      if (Array.isArray(cartItemIds) && cartItemIds.length > 0) {
        itemsResult = await query(
          `SELECT ci.*, p.name AS product_name, p.shop_id, p.status AS product_status,
                  p.price AS product_price, p.vrepeat_enabled, p.unit,
                  i.quantity AS stock_qty, i.reserved,
                  sh.name AS shop_name,
                  (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url
           FROM cart_items ci
           JOIN products p ON ci.product_id = p.id
           LEFT JOIN inventory i ON i.product_id = p.id
           LEFT JOIN shops sh ON p.shop_id = sh.id
           WHERE ci.cart_id = $1 AND ci.id = ANY($2)`,
          [cartId, cartItemIds],
        );
      } else {
        itemsResult = await query(
          `SELECT ci.*, p.name AS product_name, p.shop_id, p.status AS product_status,
                  p.price AS product_price, p.vrepeat_enabled, p.unit,
                  i.quantity AS stock_qty, i.reserved,
                  sh.name AS shop_name,
                  (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url
           FROM cart_items ci
           JOIN products p ON ci.product_id = p.id
           LEFT JOIN inventory i ON i.product_id = p.id
           LEFT JOIN shops sh ON p.shop_id = sh.id
           WHERE ci.cart_id = $1`,
          [cartId],
        );
      }

      if (itemsResult.rows.length === 0) {
        res.status(400).json({ success: false, error: { code: "EMPTY_CART", message: "Cart is empty" } });
        return;
      }

      // Validate all items — variant-aware stock check. Also re-read the CURRENT
      // server price for every item: the final price must never come from a stale
      // cart snapshot. If a price changed, we charge the current price and flag it
      // so the client can tell the customer (never silently charge either side).
      const items = itemsResult.rows;
      let priceChanged = false;
      for (const item of items) {
        // Server-side quantity validation — never trust the frontend.
        const qtyError = validateCheckoutQuantity(item.quantity);
        if (qtyError) {
          res.status(400).json({
            success: false,
            error: { code: "VALIDATION_ERROR", message: `Invalid quantity for "${item.product_name}": ${qtyError}` },
          });
          return;
        }
        if (item.product_status !== "published") {
          res.status(400).json({
            success: false,
            error: { code: "PRODUCT_UNAVAILABLE", message: `Product "${item.product_name}" is no longer available` },
          });
          return;
        }
        if (item.variant_id) {
          // Variant stock is source of truth — must succeed or stop checkout
          let varStock;
          try {
            varStock = await query(
              `SELECT stock, status, price FROM product_variants WHERE id = $1`,
              [item.variant_id],
            );
          } catch (varErr: any) {
            res.status(503).json({
              success: false,
              error: { code: "STOCK_UNAVAILABLE", message: `Stock information is unavailable for "${item.product_name}". Please try again later.` },
            });
            return;
          }
          if (varStock.rows.length === 0) {
            res.status(400).json({
              success: false,
              error: { code: "VARIANT_NOT_FOUND", message: `Variant for "${item.product_name}" was not found.` },
            });
            return;
          }
          const v = varStock.rows[0];
          const variantStock = Number(v.stock);
          if (v.stock == null || !Number.isFinite(variantStock)) {
            res.status(503).json({
              success: false,
              error: { code: "STOCK_UNAVAILABLE", message: `Stock data is unavailable for "${item.product_name}". Please try again later.` },
            });
            return;
          }
          if (v.status !== "active" || item.quantity > variantStock) {
            res.status(400).json({
              success: false,
              error: { code: "INSUFFICIENT_STOCK", message: `Insufficient stock for "${item.product_name}" (variant: ${variantStock} available)` },
            });
            return;
          }
          // Price revalidation — charge the CURRENT variant price, never a stale snapshot.
          const variantPrice = Number(v.price);
          if (Number.isFinite(variantPrice) && variantPrice >= 0 && Math.abs(variantPrice - parseFloat(item.price)) > 0.005) {
            item.price = variantPrice;
            priceChanged = true;
          }
        } else {
          const available = (item.stock_qty ?? 0) - (item.reserved ?? 0);
          if (item.quantity > available) {
            res.status(400).json({
              success: false,
              error: { code: "INSUFFICIENT_STOCK", message: `Insufficient stock for "${item.product_name}"` },
            });
            return;
          }
          // Price revalidation for non-variant products.
          const productPrice = Number(item.product_price);
          if (Number.isFinite(productPrice) && productPrice >= 0 && Math.abs(productPrice - parseFloat(item.price)) > 0.005) {
            item.price = productPrice;
            priceChanged = true;
          }
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
      let responseData: any = null;

      /** Internal marker: this request key was already claimed — respond with the stored result. */
      class DuplicateCheckoutError extends Error {}

      try {
      await withTransaction(async (client) => {
        // Idempotency guard — claim this request key BEFORE doing any work.
        // ON CONFLICT DO NOTHING: a second submit with the same key inserts
        // nothing, so we abort the transaction (rolling back any work) and
        // return the response snapshot of the first successful request.
        if (requestId && typeof requestId === "string") {
          const claim = await client.query(
            `INSERT INTO checkout_requests (user_id, request_key) VALUES ($1, $2)
             ON CONFLICT (user_id, request_key) DO NOTHING RETURNING id`,
            [userId, requestId],
          );
          if (claim.rows.length === 0) {
            const prev = await client.query(
              `SELECT response FROM checkout_requests WHERE user_id = $1 AND request_key = $2`,
              [userId, requestId],
            );
            responseData = prev.rows[0]?.response ?? null;
            throw new DuplicateCheckoutError("duplicate checkout request");
          }
        }

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
            [userId, shopId, totalAmount, shippingAddressId || null, serverAddressSnapshot ? JSON.stringify(serverAddressSnapshot) : null, notes || null],
          );
          const orderId = orderResult.rows[0].id;

          // Create order items + decrease stock
          for (const item of shopItems) {
            const subtotal = parseFloat(item.price) * item.quantity;

            // Load variant info for snapshot
            let variantNameSnapshot: string | null = null;
            let skuSnapshot: string | null = null;
            let optionLabelsSnapshot: string | null = null;
            if (item.variant_id) {
              try {
                const varRes = await client.query(
                  `SELECT pv.name AS vname, pv.sku,
                          COALESCE(
                            (SELECT string_agg(pov.label, ' / ' ORDER BY pog.sort_order)
                             FROM product_variant_values pvv
                             JOIN product_option_values pov ON pvv.option_value_id = pov.id
                             JOIN product_option_groups pog ON pov.option_group_id = pog.id
                             WHERE pvv.variant_id = pv.id),
                            ''
                          ) AS option_labels
                   FROM product_variants pv WHERE pv.id = $1`,
                  [item.variant_id],
                );
                if (varRes.rows[0]) {
                  variantNameSnapshot = varRes.rows[0].vname;
                  skuSnapshot = varRes.rows[0].sku;
                  optionLabelsSnapshot = varRes.rows[0].option_labels;
                }
              } catch { /* variant table may not exist */ }
            }

            await client.query(
              `INSERT INTO order_items (order_id, product_id, shop_id, product_name, product_name_snapshot, image_url_snapshot, variant_id, variant_name_snapshot, quantity, price, subtotal)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
              [orderId, item.product_id, item.shop_id || null, item.product_name, item.product_name, item.product_image_url || null, item.variant_id || null, variantNameSnapshot, item.quantity, item.price, subtotal],
            );

            // Decrease stock: if variant, use atomic variant stock decrement; otherwise use inventory
            if (item.variant_id) {
              let updResult;
              try {
                updResult = await client.query(
                  `UPDATE product_variants SET stock = stock - $1, updated_at = NOW()
                   WHERE id = $2 AND stock >= $1
                   RETURNING id`,
                  [item.quantity, item.variant_id],
                );
              } catch (varErr: any) {
                // Variant table query failed — do NOT fallback to inventory
                throw new Error(`STOCK_UNAVAILABLE: failed to update variant stock for ${item.variant_id}`);
              }
              if (updResult.rows.length === 0) {
                throw new Error(`INSUFFICIENT_STOCK: variant ${item.variant_id}`);
              }
            } else {
              // Atomic guarded reservation — validation and mutation in one
              // statement so concurrent checkouts can never oversell.
              await reserveInventoryStock(client, item.product_id, item.quantity);
            }
          }

          createdOrders.push({ orderId, orderNumber: orderId, shopId, shopName: shopItems[0]?.shop_name ?? '', subtotal: totalAmount, shippingFee: 0, total: totalAmount });

          // COD orders get a real payments row (method 'cod', provider 'cod', status 'pending')
          // so order list/detail can report paymentStatus. Online payments are created
          // by the Stripe checkout flow instead.
          if (paymentMethodBody === "cod") {
            await client.query(
              `INSERT INTO payments (order_id, provider, method, amount, currency, status)
               VALUES ($1, 'cod', 'cod', $2, 'THB', 'pending')`,
              [orderId, totalAmount],
            );
          }
        }

        // Clear only the purchased items from cart (preserves unselected items)
        const processedItemIds = items.map((i: any) => i.id);
        if (processedItemIds.length > 0) {
          await client.query(
            "DELETE FROM cart_items WHERE id = ANY($1)",
            [processedItemIds],
          );
        }
        // Recalculate remaining cart totals
        await recalcCart(cartId);

        // Build the idempotent response once, inside the transaction.
        const parentOrderId = createdOrders[0]?.orderId ?? '';
        const parentOrderNumber = createdOrders[0]?.orderNumber ?? '';
        const totalAll = createdOrders.reduce((s, o) => s + o.total, 0);
        const itemCount = items.reduce((s: number, i: any) => s + i.quantity, 0);
        const summaryItems = items.map((i: any) => ({
          productId: i.product_id,
          variantId: i.variant_id ?? null,
          name: i.product_name,
          qty: i.quantity,
          unit: i.unit ?? "",
          price: parseFloat(i.price),
          imageUrl: i.product_image_url ?? null,
          vrepeatEnabled: Boolean(i.vrepeat_enabled),
        }));
        responseData = {
          parentOrderId,
          parentOrderNumber,
          orders: createdOrders,
          total: totalAll,
          itemCount,
          priceChanged,
          items: summaryItems,
        };

        // Snapshot the response + link the parent order to this request key,
        // so a duplicate submit returns exactly the same result.
        if (requestId && typeof requestId === "string") {
          await client.query(
            `UPDATE checkout_requests SET order_id = $1, response = $2::jsonb
             WHERE user_id = $3 AND request_key = $4`,
            [responseData.parentOrderId, JSON.stringify(responseData), userId, requestId],
          );
        }
      });
      } catch (err) {
        if (err instanceof DuplicateCheckoutError) {
          if (responseData) {
            res.json({ success: true, data: responseData });
            return;
          }
          // Key claimed but no response recorded yet — the first request is
          // still in flight. Never create a second order; ask the client to wait.
          res.status(409).json({
            success: false,
            error: { code: "DUPLICATE_CHECKOUT_IN_PROGRESS", message: "Your order is being processed. Please wait a moment." },
          });
          return;
        }
        throw err;
      }

      res.json({ success: true, data: responseData });
    } catch (err) {
      // Atomic stock guard fired (race with another purchase) — tell the
      // customer it is a stock conflict, not a generic server failure.
      const errMsg = err instanceof Error ? err.message : "";
      if (errMsg.startsWith("INSUFFICIENT_STOCK:")) {
        console.error("[checkout] insufficient stock (concurrent purchase):", errMsg);
        res.status(409).json({
          success: false,
          error: { code: "INSUFFICIENT_STOCK", message: "Insufficient stock — please refresh and try again." },
        });
        return;
      }
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
        `SELECT o.*, sh.name AS shop_name, sh.slug AS shop_slug,
                COALESCE((SELECT status FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1), 'unpaid') AS payment_status,
                COALESCE((SELECT status FROM shipments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1), 'none') AS shipping_status
         FROM orders o
         LEFT JOIN shops sh ON o.shop_id = sh.id
         WHERE o.user_id = $1
         ORDER BY o.created_at DESC
         LIMIT $2`,
        [userId, limit],
      );

      const orderIds = result.rows.map((r: any) => r.id);
      const itemsByOrder = await fetchOrderItemsForOrders(orderIds);

      const orders = result.rows.map((r: any) => {
        const items = itemsByOrder[r.id] ?? [];
        return {
          id: r.id,
          orderNumber: r.order_number || r.id,
          customerUserId: r.user_id,
          status: r.status,
          paymentStatus: r.payment_status,
          shippingStatus: r.shipping_status,
          shippingMethod: null,
          trackingNumber: null,
          subtotal: parseFloat(r.subtotal) || 0,
          discount: parseFloat(r.discount) || 0,
          shippingFee: parseFloat(r.shipping_fee) || 0,
          total: parseFloat(r.total_amount) || 0,
          currency: r.currency ?? "THB",
          addressSnapshot: parseShippingAddress(r.shipping_address),
          note: r.notes,
          shopId: r.shop_id,
          shopName: r.shop_name,
          shopSlug: r.shop_slug,
          createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
          updatedAt: r.updated_at ? new Date(r.updated_at).getTime() : Date.now(),
          items,
          itemCount: items.reduce((s: number, i: any) => s + i.quantity, 0),
        };
      });

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
        `SELECT o.*, sh.name AS shop_name, sh.slug AS shop_slug,
                COALESCE((SELECT status FROM payments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1), 'unpaid') AS payment_status,
                COALESCE((SELECT status FROM shipments WHERE order_id = o.id ORDER BY created_at DESC LIMIT 1), 'none') AS shipping_status
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

      const [itemsByOrder, shipments, paymentsRes] = await Promise.all([
        fetchOrderItemsForOrders([orderId]),
        fetchShipmentsForOrder(orderId),
        query(
          `SELECT id, method, status, amount, provider
           FROM payments
           WHERE order_id = $1
           ORDER BY created_at DESC`,
          [orderId],
        ),
      ]);
      const items = itemsByOrder[orderId] ?? [];

      res.json({
        success: true,
        data: {
          id: order.id,
          orderNumber: order.order_number || order.id,
          parentOrderId: order.id,
          customerUserId: order.user_id,
          status: order.status,
          paymentStatus: order.payment_status,
          shippingStatus: order.shipping_status,
          shippingMethod: null,
          trackingNumber: shipments[0]?.trackingNumber ?? null,
          subtotal: parseFloat(order.subtotal) || 0,
          discount: parseFloat(order.discount) || 0,
          shippingFee: parseFloat(order.shipping_fee) || 0,
          total: parseFloat(order.total_amount) || 0,
          currency: order.currency ?? "THB",
          addressSnapshot: parseShippingAddress(order.shipping_address),
          note: order.notes,
          shopId: order.shop_id,
          shopName: order.shop_name,
          shopSlug: order.shop_slug,
          createdAt: order.created_at ? new Date(order.created_at).getTime() : Date.now(),
          updatedAt: order.updated_at ? new Date(order.updated_at).getTime() : Date.now(),
          items,
          itemCount: items.reduce((s: number, i: any) => s + i.quantity, 0),
          shipments,
          payments: paymentsRes.rows.map((p: any) => ({
            id: p.id,
            method: p.method,
            status: p.status,
            amount: parseFloat(p.amount) || 0,
          })),
        },
      });
    } catch (err) {
      console.error("[orders] detail error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch order" } });
    }
  });

  // ── PATCH /api/customer/orders/:orderId/cancel ────────────────────────────
  // Customer cancels their own order before it ships; stock is restored.
  app.patch("/api/customer/orders/:orderId/cancel", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const orderId = param(req, "orderId");

      const orderRes = await query(
        `SELECT id, status FROM orders WHERE id = $1 AND user_id = $2`,
        [orderId, userId],
      );
      if (orderRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Order not found" } });
        return;
      }
      if (!["pending", "confirmed"].includes(orderRes.rows[0].status)) {
        res.status(400).json({
          success: false,
          error: { code: "INVALID_STATUS", message: "Order can only be cancelled before it ships" },
        });
        return;
      }

      await withTransaction(async (client) => {
        await client.query(
          `UPDATE orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
          [orderId],
        );
        // Restore stock for each purchased item
        const items = await client.query(
          `SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1`,
          [orderId],
        );
        for (const item of items.rows) {
          if (item.variant_id) {
            await client.query(
              `UPDATE product_variants SET stock = stock + $1, updated_at = NOW() WHERE id = $2`,
              [item.quantity, item.variant_id],
            );
          } else {
            await client.query(
              `UPDATE inventory SET reserved = GREATEST(0, reserved - $1) WHERE product_id = $2`,
              [item.quantity, item.product_id],
            );
          }
        }
      });

      res.json({ success: true, data: { id: orderId, status: "cancelled" } });
    } catch (err) {
      console.error("[orders] cancel error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to cancel order" } });
    }
  });

  // ── POST /api/customer/reorder ────────────────────────────────────────────
  // Re-adds every item from a past order into the user's cart, merging with
  // existing cart lines (same product + variant) up to available stock.
  app.post("/api/customer/reorder", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { orderId } = req.body as { orderId?: string };
      if (!orderId || typeof orderId !== "string") {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "orderId is required" } });
        return;
      }

      const orderRes = await query(
        `SELECT id FROM orders WHERE id = $1 AND user_id = $2`,
        [orderId, userId],
      );
      if (orderRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Order not found" } });
        return;
      }

      const itemsRes = await query(
        `SELECT product_id, variant_id, quantity, product_name FROM order_items WHERE order_id = $1`,
        [orderId],
      );
      if (itemsRes.rows.length === 0) {
        res.status(400).json({ success: false, error: { code: "EMPTY_ORDER", message: "Order has no items" } });
        return;
      }

      const cartId = await ensureCart(userId);
      const added: any[] = [];
      const skipped: { productName: string; reason: string }[] = [];

      for (const item of itemsRes.rows) {
        // Product must still exist and be published (no crash on deleted products)
        const prodRes = await query(`SELECT name, status FROM products WHERE id = $1`, [item.product_id]);
        if (prodRes.rows.length === 0 || prodRes.rows[0].status !== "published") {
          skipped.push({ productName: item.product_name || "สินค้า", reason: "unavailable" });
          continue;
        }

        // Stock check — variant stock is the source of truth for variant items;
        // no arbitrary fallback: if we cannot read stock we do not add the item.
        let available = 0;
        if (item.variant_id) {
          let varRes;
          try {
            varRes = await query(`SELECT stock, status FROM product_variants WHERE id = $1`, [item.variant_id]);
          } catch {
            skipped.push({ productName: item.product_name || "สินค้า", reason: "stock_unavailable" });
            continue;
          }
          if (varRes.rows.length === 0 || varRes.rows[0].status !== "active") {
            skipped.push({ productName: item.product_name || "สินค้า", reason: "unavailable" });
            continue;
          }
          const stockNum = Number(varRes.rows[0].stock);
          if (varRes.rows[0].stock == null || !Number.isFinite(stockNum) || stockNum <= 0) {
            skipped.push({ productName: item.product_name || "สินค้า", reason: "out_of_stock" });
            continue;
          }
          available = stockNum;
        } else {
          const invRes = await query(`SELECT quantity, reserved FROM inventory WHERE product_id = $1`, [item.product_id]);
          if (invRes.rows.length === 0) {
            skipped.push({ productName: item.product_name || "สินค้า", reason: "stock_unavailable" });
            continue;
          }
          const qtyNum = Number(invRes.rows[0].quantity);
          const resNum = Number(invRes.rows[0].reserved);
          if (!Number.isFinite(qtyNum) || !Number.isFinite(resNum) || qtyNum - resNum <= 0) {
            skipped.push({ productName: item.product_name || "สินค้า", reason: "out_of_stock" });
            continue;
          }
          available = qtyNum - resNum;
        }

        // Merge with an existing cart line for the same product + variant
        const existing = await query(
          `SELECT id, quantity FROM cart_items WHERE cart_id = $1 AND product_id = $2 AND (variant_id IS NOT DISTINCT FROM $3)`,
          [cartId, item.product_id, item.variant_id],
        );
        if (existing.rows.length > 0) {
          const curQty = Number(existing.rows[0].quantity) || 0;
          if (curQty >= available) {
            skipped.push({ productName: item.product_name || "สินค้า", reason: "at_stock_limit" });
            continue;
          }
          const finalQty = Math.min(curQty + item.quantity, available);
          await query(
            `UPDATE cart_items SET quantity = $1, updated_at = NOW() WHERE id = $2`,
            [finalQty, existing.rows[0].id],
          );
        } else {
          const finalQty = Math.min(item.quantity, available);
          const insRes = await query(
            `INSERT INTO cart_items (cart_id, product_id, variant_id, quantity)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [cartId, item.product_id, item.variant_id, finalQty],
          );
          added.push({ id: insRes.rows[0].id, productId: item.product_id });
        }
      }

      await recalcCart(cartId);
      res.json({ success: true, data: { added, skipped } });
    } catch (err) {
      console.error("[orders] reorder error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to reorder" } });
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
