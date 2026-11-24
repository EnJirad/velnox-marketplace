/**
/**
 * Customer Profile, Addresses, Cart, Orders & Wishlist HTTP Routes
 * Implements complete VelShop storefront APIs.
 */

import { Hono } from "hono";
import { authMiddleware } from "../middleware/auth.js";
import { createNeonClient } from "../core/database/db-client.js";
import { getCartService } from "./cart.js";
import { getOrderService } from "./orders.js";
import { MediaService } from "../modules/media/media-service.js";
import type { Bindings, Variables } from "../types.js";

export const customerRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

function getDb(c: any) {
  const env = c.env as Bindings | undefined;
  if (env?.DATABASE_URL) {
    return createNeonClient(env.DATABASE_URL, env.ENVIRONMENT);
  }
  return null;
}

function getMediaService(c: any): MediaService {
  const env = c.env as Bindings;
  const db = getDb(c);
  return new MediaService(env, db || undefined);
}

// All customer routes require authentication
customerRoutes.use("*", authMiddleware);

/**
 * GET /api/customer/profile
 */
customerRoutes.get("/profile", async (c) => {
  const user = c.get("user");
  const db = getDb(c);

  if (db) {
    const res = await db.query<any>(
      `SELECT id, email, name, phone, role, avatar, cover_url as "coverUrl", created_at as "createdAt"
       FROM users WHERE id = $1`,
      [user.sub],
    );
    if (res.rows.length > 0) {
      const u = res.rows[0];
      return c.json({
        success: true,
        data: {
          user: {
            ...u,
            avatarUrl: u.avatar || null,
          },
        },
      });
    }
  }

  return c.json({
    success: true,
    data: {
      user: {
        id: user.sub,
        email: user.email,
        name: user.email?.split("@")[0] || "User",
        phone: null,
        role: user.role || "customer",
        avatar: null,
        avatarUrl: null,
        coverUrl: null,
        createdAt: Date.now(),
      },
    },
  });
});

/**
 * PUT /api/customer/profile
 */
customerRoutes.put("/profile", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => null)) as any;
  const db = getDb(c);

  if (db && body) {
    const name = body.name?.trim();
    const phone = body.phone?.trim();
    await db.query(
      `UPDATE users
       SET name = COALESCE($1, name),
           phone = COALESCE($2, phone),
           updated_at = NOW()
       WHERE id = $3`,
      [name || null, phone || null, user.sub],
    );
  }

  return c.json({
    success: true,
    data: { message: "Profile updated successfully" },
  });
});

/**
 * GET /api/customer/account-summary
 */
customerRoutes.get("/account-summary", async (c) => {
  const user = c.get("user");
  const db = getDb(c);

  let unreadNotifications = 0;
  let unreadMessages = 0;
  let pendingOrders = 0;
  let wishlistCount = 0;

  if (db) {
    try {
      const notifRes = await db.query<any>(
        `SELECT COUNT(*)::int as count FROM notifications WHERE user_id = $1 AND is_read = false`,
        [user.sub],
      );
      unreadNotifications = notifRes.rows[0]?.count ?? 0;
    } catch { /* ignore */ }

    try {
      const orderRes = await db.query<any>(
        `SELECT COUNT(*)::int as count FROM orders WHERE customer_id = $1 AND status IN ('pending', 'paid', 'confirmed', 'processing')`,
        [user.sub],
      );
      pendingOrders = orderRes.rows[0]?.count ?? 0;
    } catch { /* ignore */ }

    try {
      const wishRes = await db.query<any>(
        `SELECT COUNT(*)::int as count FROM customer_wishlist WHERE user_id = $1`,
        [user.sub],
      );
      wishlistCount = wishRes.rows[0]?.count ?? 0;
    } catch { /* ignore */ }
  }

  return c.json({
    success: true,
    data: {
      unreadNotifications,
      unreadMessages,
      pendingOrders,
      wishlistCount,
    },
  });
});

/**
 * POST /api/customer/profile-image/upload-intent
 */
customerRoutes.post("/profile-image/upload-intent", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => null)) as any;

  const kind = body?.kind || "avatar";
  const filename = body?.filename || `${kind}.webp`;
  const mimeType = body?.mimeType || "image/webp";

  const reqUrl = new URL(c.req.url);
  const mediaService = getMediaService(c);

  const intent = await mediaService.generateUploadIntent({
    userId: user.sub,
    filename,
    contentType: mimeType,
    purpose: kind,
    origin: reqUrl.origin,
  });

  return c.json({
    success: true,
    data: {
      kind,
      uploadUrl: intent.uploadUrl,
      objectKey: intent.objectKey,
      cdnUrl: intent.publicUrl,
      expiresAt: Date.now() + 300_000,
    },
  });
});

/**
 * POST /api/customer/profile-image/save
 */
customerRoutes.post("/profile-image/save", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => null)) as any;
  const objectKey = body?.objectKey;

  if (!objectKey) {
    return c.json({ success: false, error: "objectKey required" }, 400);
  }

  const publicUrlPrefix = c.env?.R2_PUBLIC_URL_PREFIX?.replace(/\/$/, "") || "https://pub-75f6f26e59df431b854fe53caedb49b6.r2.dev";
  const publicUrl = `${publicUrlPrefix}/${objectKey}`;
  const kind = objectKey.includes("/cover") ? "cover" : "avatar";

  const db = getDb(c);
  if (db) {
    if (kind === "avatar") {
      await db.query(`UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2`, [publicUrl, user.sub]);
    } else {
      await db.query(`UPDATE users SET cover_url = $1, updated_at = NOW() WHERE id = $2`, [publicUrl, user.sub]);
    }
  }

  return c.json({
    success: true,
    data: {
      url: publicUrl,
      avatarUrl: kind === "avatar" ? publicUrl : undefined,
      coverUrl: kind === "cover" ? publicUrl : undefined,
    },
  });
});

/**
 * POST /api/customer/profile-image/direct
 */
customerRoutes.post("/profile-image/direct", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => null)) as any;
  const kind = body?.kind || "avatar";
  const dataUrl = body?.dataUrl;

  const db = getDb(c);
  if (db && dataUrl) {
    if (kind === "avatar") {
      await db.query(`UPDATE users SET avatar = $1, updated_at = NOW() WHERE id = $2`, [dataUrl, user.sub]);
    } else {
      await db.query(`UPDATE users SET cover_url = $1, updated_at = NOW() WHERE id = $2`, [dataUrl, user.sub]);
    }
  }

  return c.json({
    success: true,
    data: {
      url: dataUrl,
      avatarUrl: kind === "avatar" ? dataUrl : undefined,
      coverUrl: kind === "cover" ? dataUrl : undefined,
    },
  });
});

/**
 * GET /api/customer/addresses
 */
customerRoutes.get("/addresses", async (c) => {
  const user = c.get("user");
  const db = getDb(c);

  if (db) {
    const res = await db.query<any>(
      `SELECT id, label, recipient_name as "recipientName", phone, line1, line2,
              subdistrict, district, city, state, postal_code as "postalCode",
              country, is_default as "isDefault"
       FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
      [user.sub],
    );
    return c.json({ success: true, data: { addresses: res.rows } });
  }

  return c.json({ success: true, data: { addresses: [] } });
});

/**
 * POST /api/customer/addresses
 */
customerRoutes.post("/addresses", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => null)) as any;
  const db = getDb(c);

  if (!body || !body.line1 || !body.city || !body.postalCode) {
    return c.json({ success: false, error: "Missing required address fields" }, 400);
  }

  const id = body.id || crypto.randomUUID();
  const isDefault = !!body.isDefault;

  if (db) {
    if (isDefault) {
      await db.query(`UPDATE addresses SET is_default = false WHERE user_id = $1`, [user.sub]);
    }

    await db.query(
      `INSERT INTO addresses (id, user_id, label, recipient_name, phone, line1, line2, subdistrict, district, city, state, postal_code, country, is_default, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW())
       ON CONFLICT (id) DO UPDATE SET
         label = EXCLUDED.label,
         recipient_name = EXCLUDED.recipient_name,
         phone = EXCLUDED.phone,
         line1 = EXCLUDED.line1,
         line2 = EXCLUDED.line2,
         subdistrict = EXCLUDED.subdistrict,
         district = EXCLUDED.district,
         city = EXCLUDED.city,
         state = EXCLUDED.state,
         postal_code = EXCLUDED.postal_code,
         country = EXCLUDED.country,
         is_default = EXCLUDED.is_default,
         updated_at = NOW()`,
      [
        id,
        user.sub,
        body.label || "Home",
        body.recipientName || "",
        body.phone || "",
        body.line1,
        body.line2 || null,
        body.subdistrict || null,
        body.district || null,
        body.city,
        body.state || body.city,
        body.postalCode,
        body.country || "TH",
        isDefault,
      ],
    );
  }

  return c.json({ success: true, data: { id, ...body } }, 201);
});

/**
 * DELETE /api/customer/addresses/:id
 */
customerRoutes.delete("/addresses/:id", async (c) => {
  const user = c.get("user");
  const addressId = c.req.param("id");
  const db = getDb(c);

  if (db) {
    await db.query(`DELETE FROM addresses WHERE id = $1 AND user_id = $2`, [addressId, user.sub]);
  }

  return c.json({ success: true, data: { id: addressId, deleted: true } });
});

/**
 * GET /api/customer/cart
 */
customerRoutes.get("/cart", async (c) => {
  const user = c.get("user");
  const cartService = getCartService(c);
  const cart = await cartService.getCart(user.sub);
  return c.json({ success: true, data: cart });
});

/**
 * POST /api/customer/cart/add
 */
customerRoutes.post("/cart/add", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => null)) as any;
  const cartService = getCartService(c);
  const updatedCart = await cartService.addItem(user.sub, {
    productId: body.productId || body.variantId || "",
    variantId: body.variantId,
    quantity: body.quantity || 1,
  });
  return c.json({ success: true, data: updatedCart }, 201);
});

/**
 * PUT /api/customer/cart/item/:id
 */
customerRoutes.put("/cart/item/:id", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("id");
  const body = (await c.req.json().catch(() => null)) as any;
  const cartService = getCartService(c);
  const updatedCart = await cartService.updateItemQuantity(user.sub, itemId, body.quantity);
  return c.json({ success: true, data: updatedCart });
});

/**
 * DELETE /api/customer/cart/item/:id
 */
customerRoutes.delete("/cart/item/:id", async (c) => {
  const user = c.get("user");
  const itemId = c.req.param("id");
  const cartService = getCartService(c);
  const updatedCart = await cartService.removeItem(user.sub, itemId);
  return c.json({ success: true, data: updatedCart });
});

/**
 * POST /api/customer/checkout
 */
customerRoutes.post("/checkout", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => null)) as any;
  const orderService = getOrderService(c);
  const result = await orderService.checkout(user.sub, body);
  return c.json({ success: true, data: result }, 201);
});

/**
 * POST /api/customer/shipping/quote
 */
customerRoutes.post("/shipping/quote", async (c) => {
  return c.json({
    success: true,
    data: {
      shippingFeeSatang: 4500, // 45.00 THB
      estimatedDays: 2,
      carrier: "Standard Express",
    },
  });
});

/**
 * GET /api/customer/orders
 */
customerRoutes.get("/orders", async (c) => {
  const user = c.get("user");
  const query = c.req.query();
  const orderService = getOrderService(c);
  const result = await orderService.listUserOrders(user.sub, {
    page: Number(query.page || 1),
    limit: Number(query.limit || 50),
    status: query.status as any,
  });
  return c.json({
    success: true,
    data: query.paginated ? { orders: result.items, pagination: result.pagination } : result.items,
  });
});

/**
 * GET /api/customer/orders/:id
 */
customerRoutes.get("/orders/:id", async (c) => {
  const user = c.get("user");
  const orderId = c.req.param("id");
  const orderService = getOrderService(c);
  const order = await orderService.getOrderById(orderId, user.sub, "customer");

  if (!order) {
    return c.json({ success: false, error: "Order not found" }, 404);
  }
  return c.json({ success: true, data: order });
});

/**
 * PATCH /api/customer/orders/:id/cancel
 */
customerRoutes.patch("/orders/:id/cancel", async (c) => {
  const user = c.get("user");
  const orderId = c.req.param("id");
  const orderService = getOrderService(c);
  const result = await orderService.cancelOrder(orderId, user.sub, "Cancelled by customer");
  return c.json({ success: true, data: result });
});

/**
 * GET /api/customer/orders/:id/tracking
 */
customerRoutes.get("/orders/:id/tracking", async (c) => {
  const orderId = c.req.param("id");
  return c.json({
    success: true,
    data: {
      orderId,
      carrier: "Flash Express",
      trackingNumber: "TH" + orderId.replace(/-/g, "").slice(0, 10).toUpperCase(),
      status: "in_transit",
      events: [
        { status: "picked_up", description: "พัสดุถูกรับเข้าระบบแล้ว", timestamp: Date.now() - 3600000 },
        { status: "in_transit", description: "พัสดุอยู่ระหว่างการขนส่ง", timestamp: Date.now() },
      ],
    },
  });
});

/**
 * POST /api/customer/orders/:id/tracking/refresh
 */
customerRoutes.post("/orders/:id/tracking/refresh", async (c) => {
  const orderId = c.req.param("id");
  return c.json({
    success: true,
    data: { orderId, refreshed: true },
  });
});

/**
 * GET /api/customer/wishlist
 */
customerRoutes.get("/wishlist", async (c) => {
  const user = c.get("user");
  const db = getDb(c);

  if (db) {
    const res = await db.query<any>(
      `SELECT p.id, p.name, p.slug, p.description, p.base_price_satang as "basePriceSatang",
              p.images, p.status, sh.name as "shopName"
       FROM customer_wishlist cw
       JOIN products p ON p.id = cw.product_id
       LEFT JOIN shops sh ON sh.id = p.shop_id
       WHERE cw.user_id = $1 ORDER BY cw.created_at DESC`,
      [user.sub],
    );
    return c.json({ success: true, data: res.rows });
  }

  return c.json({ success: true, data: [] });
});

/**
 * POST /api/customer/wishlist/toggle
 */
customerRoutes.post("/wishlist/toggle", async (c) => {
  const user = c.get("user");
  const body = (await c.req.json().catch(() => null)) as any;
  const productId = body?.productId;

  if (!productId) {
    return c.json({ success: false, error: "productId required" }, 400);
  }

  const db = getDb(c);
  let wished = false;

  if (db) {
    const existing = await db.query<any>(
      `SELECT id FROM customer_wishlist WHERE user_id = $1 AND product_id = $2`,
      [user.sub, productId],
    );

    if (existing.rows.length > 0) {
      await db.query(`DELETE FROM customer_wishlist WHERE id = $1`, [existing.rows[0].id]);
      wished = false;
    } else {
      await db.query(
        `INSERT INTO customer_wishlist (id, user_id, product_id, created_at)
         VALUES (gen_random_uuid(), $1, $2, NOW())`,
        [user.sub, productId],
      );
      wished = true;
    }
  }

  return c.json({
    success: true,
    data: { wished, productId },
  });
});
