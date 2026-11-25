import { Hono } from "hono";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { neon } from "@neondatabase/serverless";
import type { Bindings, Variables } from "../types.js";

export const adminRoutes = new Hono<{ Bindings: Bindings; Variables: Variables }>();

// All admin routes require authenticated session with admin/owner/staff role
adminRoutes.use("*", authMiddleware);

/**
 * GET /dashboard/counts — Overview counters for VelCenter badge queues
 */
adminRoutes.get("/dashboard/counts", requireRole("admin"), async (c) => {
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({
      success: true,
      data: {
        pendingSellers: 0,
        underReviewSellers: 0,
        pendingReviewSellers: 0,
        pendingProducts: 0,
        totalShops: 0,
        verifiedShops: 0,
        suspendedShops: 0,
        pendingVerifications: 0,
      },
    });
  }

  const sql = neon(env.DATABASE_URL);
  try {
    const [
      pendingReviewSellers,
      pendingProducts,
      totalShops,
      verifiedShops,
      suspendedShops,
    ] = await Promise.all([
      sql`SELECT COUNT(*)::int as count FROM sellers WHERE verification_status IN ('pending', 'under_review')`,
      sql`SELECT COUNT(*)::int as count FROM products WHERE status = 'pending_review'`,
      sql`SELECT COUNT(*)::int as count FROM shops`,
      sql`SELECT COUNT(*)::int as count FROM sellers WHERE verification_status = 'verified'`,
      sql`SELECT COUNT(*)::int as count FROM shops WHERE status = 'suspended'`,
    ]);

    const pendingReviewCount = pendingReviewSellers[0]?.count ?? 0;
    const pendingProductsCount = pendingProducts[0]?.count ?? 0;
    const totalShopsCount = totalShops[0]?.count ?? 0;
    const verifiedShopsCount = verifiedShops[0]?.count ?? 0;
    const suspendedShopsCount = suspendedShops[0]?.count ?? 0;

    return c.json({
      success: true,
      data: {
        pendingSellers: pendingReviewCount,
        underReviewSellers: 0,
        pendingReviewSellers: pendingReviewCount,
        pendingProducts: pendingProductsCount,
        totalShops: totalShopsCount,
        verifiedShops: verifiedShopsCount,
        suspendedShops: suspendedShopsCount,
        pendingVerifications: pendingReviewCount,
      },
    });
  } catch (err: any) {
    console.error("[admin] dashboard counts error:", err);
    return c.json({
      success: true,
      data: {
        pendingSellers: 0,
        underReviewSellers: 0,
        pendingReviewSellers: 0,
        pendingProducts: 0,
        totalShops: 0,
        verifiedShops: 0,
        suspendedShops: 0,
        pendingVerifications: 0,
      },
    });
  }
});

/**
 * GET /overview — KPIs and status for VelCenter
 */
adminRoutes.get("/overview", requireRole("admin"), async (c) => {
  return c.json({
    success: true,
    data: {
      goalsAchieved: 0,
      goalsTotal: 0,
      lowStockCount: 0,
      dueReorderCount: 0,
    },
  });
});

/**
 * GET /market-overview — Marketplace KPIs
 */
adminRoutes.get("/market-overview", requireRole("admin"), async (c) => {
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({
      success: true,
      data: {
        revenue: 0,
        commissionRevenue: 0,
        commissionRate: 0.03,
        orderCount: 0,
        pendingOrders: 0,
        completedOrders: 0,
        productCount: 0,
        publishedCount: 0,
        customerCount: 0,
        sellerCount: 0,
      },
    });
  }

  const sql = neon(env.DATABASE_URL);
  try {
    const [revenue, orders, products, customers, sellers] = await Promise.all([
      sql`SELECT COALESCE(SUM(total_amount), 0)::text AS total FROM orders WHERE status IN ('completed', 'delivered')`,
      sql`SELECT COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
                 COUNT(*) FILTER (WHERE status IN ('completed', 'delivered'))::int AS completed
          FROM orders`,
      sql`SELECT COUNT(*)::int AS total,
                 COUNT(*) FILTER (WHERE status = 'active')::int AS published
          FROM products WHERE status <> 'archived'`,
      sql`SELECT COUNT(*)::int AS count FROM users WHERE role = 'customer'`,
      sql`SELECT COUNT(*)::int AS count FROM sellers WHERE verification_status = 'verified'`,
    ]);

    const grossRevenue = Number(revenue[0]?.total ?? 0);
    const commissionRate = 0.03;
    const commissionRevenue = Math.round(grossRevenue * commissionRate);

    return c.json({
      success: true,
      data: {
        revenue: grossRevenue,
        commissionRevenue,
        commissionRate,
        orderCount: orders[0]?.total ?? 0,
        pendingOrders: orders[0]?.pending ?? 0,
        completedOrders: orders[0]?.completed ?? 0,
        productCount: products[0]?.total ?? 0,
        publishedCount: products[0]?.published ?? 0,
        customerCount: customers[0]?.count ?? 0,
        sellerCount: sellers[0]?.count ?? 0,
      },
    });
  } catch (err: any) {
    console.error("[admin] market-overview error:", err);
    return c.json({
      success: true,
      data: {
        revenue: 0,
        commissionRevenue: 0,
        commissionRate: 0.03,
        orderCount: 0,
        pendingOrders: 0,
        completedOrders: 0,
        productCount: 0,
        publishedCount: 0,
        customerCount: 0,
        sellerCount: 0,
      },
    });
  }
});

/**
 * GET /verifications — Seller verification list
 */
adminRoutes.get("/verifications", requireRole("admin"), async (c) => {
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { items: [], pagination: { total: 0, page: 1, limit: 25, totalPages: 0 } } });
  }
  const sql = neon(env.DATABASE_URL);
  try {
    const status = c.req.query("status") || "pending";
    const rows = status === "all"
      ? await sql`
          SELECT s.*, u.email, u.name as user_name, sh.name as shop_name, sh.slug as shop_slug
          FROM sellers s
          LEFT JOIN users u ON u.id = s.user_id
          LEFT JOIN shops sh ON sh.seller_id = s.id
          ORDER BY s.created_at DESC
        `
      : await sql`
          SELECT s.*, u.email, u.name as user_name, sh.name as shop_name, sh.slug as shop_slug
          FROM sellers s
          LEFT JOIN users u ON u.id = s.user_id
          LEFT JOIN shops sh ON sh.seller_id = s.id
          WHERE s.verification_status = ${status}
          ORDER BY s.created_at DESC
        `;
    return c.json({
      success: true,
      data: {
        items: rows,
        pagination: {
          total: rows.length,
          page: 1,
          limit: rows.length || 25,
          totalPages: 1,
        },
      },
    });
  } catch (err) {
    console.error("[admin] verifications error:", err);
    return c.json({ success: true, data: { items: [], pagination: { total: 0, page: 1, limit: 25, totalPages: 0 } } });
  }
});

/**
 * GET /sellers — Seller accounts list
 */
adminRoutes.get("/sellers", requireRole("admin"), async (c) => {
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { items: [], pagination: { total: 0, page: 1, limit: 25, totalPages: 0 } } });
  }
  const sql = neon(env.DATABASE_URL);
  try {
    const status = c.req.query("status") || "all";
    const rows = status === "all"
      ? await sql`
          SELECT s.*, u.email, u.name as user_name, sh.name as shop_name, sh.slug as shop_slug, sh.status as shop_status
          FROM sellers s
          LEFT JOIN users u ON u.id = s.user_id
          LEFT JOIN shops sh ON sh.seller_id = s.id
          ORDER BY s.created_at DESC
        `
      : await sql`
          SELECT s.*, u.email, u.name as user_name, sh.name as shop_name, sh.slug as shop_slug, sh.status as shop_status
          FROM sellers s
          LEFT JOIN users u ON u.id = s.user_id
          LEFT JOIN shops sh ON sh.seller_id = s.id
          WHERE s.verification_status = ${status}
          ORDER BY s.created_at DESC
        `;
    return c.json({
      success: true,
      data: {
        items: rows,
        pagination: {
          total: rows.length,
          page: 1,
          limit: rows.length || 25,
          totalPages: 1,
        },
      },
    });
  } catch (err) {
    console.error("[admin] sellers error:", err);
    return c.json({ success: true, data: { items: [], pagination: { total: 0, page: 1, limit: 25, totalPages: 0 } } });
  }
});

/**
 * PATCH /sellers/:sellerId/status — Approve/reject/suspend seller
 */
adminRoutes.patch("/sellers/:sellerId/status", requireRole("admin"), async (c) => {
  const sellerId = c.req.param("sellerId");
  const body = (await c.req.json().catch(() => ({}))) || {};
  const status = body.status;
  const reason = body.reason || "";
  const env = c.env as Bindings | undefined;
  if (env?.DATABASE_URL) {
    const sql = neon(env.DATABASE_URL);
    const verifStatus = status === "approved" ? "verified" : status === "rejected" ? "rejected" : "pending";
    await sql`
      UPDATE sellers
      SET verification_status = ${verifStatus},
          verification_rejected_reason = ${reason},
          verified_at = ${status === "approved" ? new Date().toISOString() : null},
          updated_at = NOW()
      WHERE id = ${sellerId}
    `;
  }
  return c.json({ success: true, data: { sellerId, status } });
});

/**
 * GET /products/moderation — Products pending moderation
 */
adminRoutes.get("/products/moderation", requireRole("admin"), async (c) => {
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { items: [], total: 0 } });
  }
  const sql = neon(env.DATABASE_URL);
  try {
    const status = c.req.query("status") || "pending_review";
    const rows = status === "all"
      ? await sql`
          SELECT p.*, s.name as shop_name, c.name as category_name
          FROM products p
          LEFT JOIN shops s ON s.id = p.shop_id
          LEFT JOIN categories c ON c.id = p.category_id
          ORDER BY p.created_at DESC
        `
      : await sql`
          SELECT p.*, s.name as shop_name, c.name as category_name
          FROM products p
          LEFT JOIN shops s ON s.id = p.shop_id
          LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.status = ${status}
          ORDER BY p.created_at DESC
        `;
    return c.json({ success: true, data: { items: rows, total: rows.length } });
  } catch (err) {
    console.error("[admin] products moderation error:", err);
    return c.json({ success: true, data: { items: [], total: 0 } });
  }
});

/**
 * PATCH /products/:productId/moderation — Approve or reject product
 */
adminRoutes.patch("/products/:productId/moderation", requireRole("admin"), async (c) => {
  const productId = c.req.param("productId");
  const body = (await c.req.json().catch(() => ({}))) || {};
  const status = body.status === "approved" ? "published" : body.status === "rejected" ? "delisted" : body.status || "published";
  const env = c.env as Bindings | undefined;
  if (env?.DATABASE_URL) {
    const sql = neon(env.DATABASE_URL);
    await sql`UPDATE products SET status = ${status}, updated_at = NOW() WHERE id = ${productId}`;
  }
  return c.json({ success: true, data: { productId, status } });
});

/**
 * GET & PATCH /settings — Platform settings
 */
adminRoutes.get("/settings", requireRole("admin"), async (c) => {
  const env = c.env as Bindings | undefined;
  const defaults = {
    commissionRate: 0.03,
    returnCoverageDays: 7,
    maxUploadBytes: 10485760,
    allowedUploadTypes: ["image/jpeg", "image/png", "image/webp"],
  };
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: defaults });
  }
  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`SELECT key, value FROM platform_settings WHERE key = 'platform_config'`;
    if (rows.length > 0 && rows[0].value) {
      const parsed = JSON.parse(rows[0].value);
      return c.json({ success: true, data: { ...defaults, ...parsed } });
    }
  } catch (err) {
    console.error("[admin] get settings error:", err);
  }
  return c.json({ success: true, data: defaults });
});

adminRoutes.patch("/settings", requireRole("admin"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) || {};
  const env = c.env as Bindings | undefined;
  if (env?.DATABASE_URL) {
    try {
      const sql = neon(env.DATABASE_URL);
      const jsonStr = JSON.stringify(body);
      await sql`
        INSERT INTO platform_settings (key, value, updated_at)
        VALUES ('platform_config', ${jsonStr}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `;
    } catch (err) {
      console.error("[admin] patch settings error:", err);
    }
  }
  return c.json({ success: true, data: body });
});

/**
 * GET & PUT /announcements — Storefront announcements
 */
adminRoutes.get("/announcements", requireRole("admin"), async (c) => {
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: [] });
  }
  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`SELECT value FROM platform_settings WHERE key = 'shop_announcements'`;
    if (rows.length > 0 && rows[0].value) {
      const items = JSON.parse(rows[0].value);
      return c.json({ success: true, data: Array.isArray(items) ? items : [] });
    }
  } catch (err) {
    console.error("[admin] get announcements error:", err);
  }
  return c.json({ success: true, data: [] });
});

adminRoutes.put("/announcements", requireRole("admin"), async (c) => {
  const body = (await c.req.json().catch(() => [])) || [];
  const env = c.env as Bindings | undefined;
  if (env?.DATABASE_URL) {
    try {
      const sql = neon(env.DATABASE_URL);
      const jsonStr = JSON.stringify(body);
      await sql`
        INSERT INTO platform_settings (key, value, updated_at)
        VALUES ('shop_announcements', ${jsonStr}, NOW())
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
      `;
    } catch (err) {
      console.error("[admin] put announcements error:", err);
    }
  }
  return c.json({ success: true, data: body });
});

/**
 * GET /permissions — Admin permissions catalog
 */
adminRoutes.get("/permissions", requireRole("admin"), async (c) => {
  return c.json({
    success: true,
    data: [
      { code: "orders.view", label: "ดูออเดอร์", description: "ดูรายการออเดอร์ทั้งหมด" },
      { code: "orders.manage", label: "จัดการออเดอร์", description: "เปลี่ยนสถานะออเดอร์" },
      { code: "products.moderate", label: "ตรวจสอบสินค้า", description: "อนุมัติ/ปฏิเสธสินค้าที่รอตรวจสอบ" },
      { code: "sellers.manage", label: "จัดการผู้ขาย", description: "อนุมัติ/ระงับผู้ขาย" },
      { code: "users.manage", label: "ดูบัญชีผู้ใช้", description: "ดูบัญชีผู้ใช้และลูกค้า" },
      { code: "staff.manage", label: "จัดการพนักงาน", description: "ดูบัญชีพนักงาน" },
      { code: "audit.view", label: "ดู Audit Logs", description: "ดูบันทึกการดำเนินการสำคัญ" },
      { code: "settings.manage", label: "จัดการตั้งค่าระบบ", description: "แก้ไขการตั้งค่าแพลตฟอร์ม" },
    ],
  });
});

/**
 * GET /users — User directory with segment counts
 */
adminRoutes.get("/users", requireRole("admin"), async (c) => {
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { segment: "all", counts: { staff: 0, customer: 0, seller: 0 }, users: [] } });
  }
  const sql = neon(env.DATABASE_URL);
  try {
    const rawSegment = c.req.query("segment") || "all";
    const users = await sql`
      SELECT id, email, name, role, status, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 200
    `;
    const counts = await sql`
      SELECT
        COUNT(*) FILTER (WHERE role IN ('owner', 'admin', 'staff', 'center_staff', 'center_admin', 'center_superadmin'))::int AS staff,
        COUNT(*) FILTER (WHERE role = 'customer')::int AS customer,
        COUNT(*) FILTER (WHERE role = 'seller')::int AS seller
      FROM users
    `;
    const cRow = counts[0] || {};
    return c.json({
      success: true,
      data: {
        segment: rawSegment,
        counts: {
          staff: Number(cRow.staff ?? 0),
          customer: Number(cRow.customer ?? 0),
          seller: Number(cRow.seller ?? 0),
        },
        users,
      },
    });
  } catch (err) {
    console.error("[admin] users error:", err);
    return c.json({ success: true, data: { segment: "all", counts: { staff: 0, customer: 0, seller: 0 }, users: [] } });
  }
});

/**
 * GET /orders — Center orders list
 */
adminRoutes.get("/orders", requireRole("admin"), async (c) => {
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { items: [], total: 0 } });
  }
  const sql = neon(env.DATABASE_URL);
  try {
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "100", 10), 1), 200);
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10), 0);
    const orders = await sql`
      SELECT o.id, o.user_id, o.order_number, o.status, o.total_amount, o.created_at,
             sh.name AS shop_name, sh.slug AS shop_slug, u.email as customer_email, u.name as customer_name
      FROM orders o
      LEFT JOIN shops sh ON o.shop_id = sh.id
      LEFT JOIN users u ON u.id = o.user_id
      ORDER BY o.created_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;
    return c.json({ success: true, data: { items: orders, total: orders.length } });
  } catch (err) {
    console.error("[admin] orders error:", err);
    return c.json({ success: true, data: { items: [], total: 0 } });
  }
});

/**
 * GET, POST, PATCH, DELETE /categories — Categories catalog for admin
 */
adminRoutes.get("/categories", requireRole("admin"), async (c) => {
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: [] });
  }
  const sql = neon(env.DATABASE_URL);
  try {
    const rows = await sql`
      SELECT c.id, c.name, c.slug,
             COALESCE(c.icon, c.icon_url) as icon,
             COALESCE(c.image_url, c.icon_url) as image_url,
             c.parent_id, c.sort_order, c.description, c.is_active,
             c.names, c.description_names,
             c.created_at, c.updated_at,
             COUNT(p.id)::int as product_count
      FROM categories c
      LEFT JOIN products p ON p.category_id = c.id
      GROUP BY c.id
      ORDER BY c.sort_order ASC, c.name ASC
    `;
    return c.json({ success: true, data: rows });
  } catch (err) {
    console.error("[admin] categories error:", err);
    return c.json({ success: true, data: [] });
  }
});

adminRoutes.post("/categories", requireRole("admin"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) || {};
  const name = (body.name || "").trim();
  if (!name) {
    return c.json({ success: false, error: { code: "BAD_REQUEST", message: "Category name is required" } }, 400);
  }
  const id = body.id || crypto.randomUUID();
  const slug = (body.slug || "").trim() || name.toLowerCase().replace(/[^a-z0-9\s-]/g, "").replace(/\s+/g, "-") || `cat-${Date.now()}`;
  const icon = body.icon || null;
  const imageUrl = body.image_url || icon || null;
  const parentId = body.parent_id || null;
  const sortOrder = Number(body.sort_order ?? 0);
  const description = body.description ? String(body.description).trim() : null;
  const isActive = body.is_active !== undefined ? Boolean(body.is_active) : true;
  const names = body.names ? JSON.stringify(body.names) : "{}";
  const descriptionNames = body.description_names ? JSON.stringify(body.description_names) : "{}";

  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({
      success: true,
      data: { id, name, slug, icon, image_url: imageUrl, parent_id: parentId, sort_order: sortOrder, description, is_active: isActive },
    }, 201);
  }
  try {
    const sql = neon(env.DATABASE_URL);
    const [created] = await sql`
      INSERT INTO categories (id, name, slug, icon, icon_url, image_url, parent_id, sort_order, description, is_active, names, description_names, updated_at)
      VALUES (${id}, ${name}, ${slug}, ${icon}, ${icon || imageUrl}, ${imageUrl}, ${parentId}, ${sortOrder}, ${description}, ${isActive}, ${names}::jsonb, ${descriptionNames}::jsonb, NOW())
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        slug = EXCLUDED.slug,
        icon = EXCLUDED.icon,
        icon_url = EXCLUDED.icon_url,
        image_url = EXCLUDED.image_url,
        parent_id = EXCLUDED.parent_id,
        sort_order = EXCLUDED.sort_order,
        description = EXCLUDED.description,
        is_active = EXCLUDED.is_active,
        updated_at = NOW()
      RETURNING id, name, slug, icon, image_url, parent_id, sort_order, description, is_active, created_at, updated_at
    `;
    return c.json({ success: true, data: created || { id, name, slug } }, 201);
  } catch (err: any) {
    console.error("[admin] create category error:", err);
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err?.message || "Failed to create category" } }, 500);
  }
});

adminRoutes.patch("/categories/:categoryId", requireRole("admin"), async (c) => {
  const categoryId = c.req.param("categoryId");
  const body = (await c.req.json().catch(() => ({}))) || {};
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { id: categoryId, ...body } });
  }
  try {
    const sql = neon(env.DATABASE_URL);
    const existing = await sql`SELECT * FROM categories WHERE id = ${categoryId}`;
    if (existing.length === 0) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Category not found" } }, 404);
    }
    const current = existing[0];
    const name = body.name !== undefined ? String(body.name).trim() : current.name;
    const slug = body.slug !== undefined ? String(body.slug).trim() : current.slug;
    const icon = body.icon !== undefined ? body.icon : current.icon;
    const imageUrl = body.image_url !== undefined ? body.image_url : (icon || current.image_url);
    const parentId = body.parent_id !== undefined ? (body.parent_id || null) : current.parent_id;
    const sortOrder = body.sort_order !== undefined ? Number(body.sort_order) : current.sort_order;
    const description = body.description !== undefined ? (body.description ? String(body.description).trim() : null) : current.description;
    const isActive = body.is_active !== undefined ? Boolean(body.is_active) : current.is_active;

    const [updated] = await sql`
      UPDATE categories
      SET name = ${name},
          slug = ${slug},
          icon = ${icon},
          icon_url = ${icon || imageUrl},
          image_url = ${imageUrl},
          parent_id = ${parentId},
          sort_order = ${sortOrder},
          description = ${description},
          is_active = ${isActive},
          updated_at = NOW()
      WHERE id = ${categoryId}
      RETURNING id, name, slug, icon, image_url, parent_id, sort_order, description, is_active, created_at, updated_at
    `;
    return c.json({ success: true, data: updated || { id: categoryId, name, slug } });
  } catch (err: any) {
    console.error("[admin] update category error:", err);
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err?.message || "Failed to update category" } }, 500);
  }
});

adminRoutes.delete("/categories/:categoryId", requireRole("admin"), async (c) => {
  const categoryId = c.req.param("categoryId");
  const env = c.env as Bindings | undefined;
  if (env?.DATABASE_URL) {
    try {
      const sql = neon(env.DATABASE_URL);
      await sql`UPDATE categories SET parent_id = NULL WHERE parent_id = ${categoryId}`;
      await sql`DELETE FROM categories WHERE id = ${categoryId}`;
    } catch (err: any) {
      console.error("[admin] delete category error:", err);
      return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err?.message || "Failed to delete category" } }, 500);
    }
  }
  return c.json({ success: true, data: { id: categoryId, deleted: true } });
});

/**
 * GET /employees — Employee roster
 */
adminRoutes.get("/employees", requireRole("admin"), async (c) => {
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: [] });
  }
  const sql = neon(env.DATABASE_URL);
  try {
    const employees = await sql`
      SELECT id, email, name, role, department, status, created_at
      FROM users
      WHERE role IN ('owner', 'admin', 'staff', 'center_staff', 'center_admin', 'center_superadmin')
      ORDER BY created_at DESC
    `;
    return c.json({ success: true, data: employees });
  } catch (err) {
    console.error("[admin] employees error:", err);
    return c.json({ success: true, data: [] });
  }
});

/**
 * Payment incidents & audit log stubs
 */
adminRoutes.get("/payment-incidents", requireRole("admin"), async (c) => {
  return c.json({ success: true, data: { items: [], total: 0 } });
});

adminRoutes.patch("/payment-incidents/:incidentId", requireRole("admin"), async (c) => {
  return c.json({ success: true, data: { resolved: true } });
});

adminRoutes.get("/audit-logs", requireRole("admin"), async (c) => {
  return c.json({ success: true, data: { items: [], total: 0 } });
});
