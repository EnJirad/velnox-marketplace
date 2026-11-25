import { Hono } from "hono";
import { authMiddleware, requireRole } from "../middleware/auth.js";
import { neon } from "@neondatabase/serverless";
import { hashPassword } from "../core/security/password.js";
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
    const items = rows.map((r: any) => ({
      ...r,
      id: r.id,
      seller_id: r.id,
      status: r.verification_status || "pending",
      verification_status: r.verification_status || "pending",
      shop_name: r.shop_name,
      shop_slug: r.shop_slug,
      owner_name: r.user_name || r.name,
      owner_email: r.email,
      created_at: r.created_at,
      updated_at: r.updated_at,
    }));
    return c.json({
      success: true,
      data: {
        items,
        pagination: {
          total: items.length,
          page: 1,
          limit: items.length || 25,
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
 * PATCH /verifications/seller/:verificationId — Review decision on seller verification
 */
adminRoutes.patch("/verifications/seller/:verificationId", requireRole("admin"), async (c) => {
  const verificationId = c.req.param("verificationId");
  const body = (await c.req.json().catch(() => ({}))) || {};
  const { action, reason, note } = body;
  const isApproved = action === "approved" || action === "approve";
  const isRejected = action === "rejected" || action === "reject";
  const verifStatus = isApproved ? "verified" : isRejected ? "rejected" : "suspended";
  const env = c.env as Bindings | undefined;
  if (env?.DATABASE_URL) {
    try {
      const sql = neon(env.DATABASE_URL);
      await sql`
        UPDATE sellers
        SET verification_status = ${verifStatus},
            verification_rejected_reason = ${reason || null},
            verified_at = ${isApproved ? new Date().toISOString() : null},
            updated_at = NOW()
        WHERE id = ${verificationId}
      `;
      await sql`
        UPDATE shops
        SET status = ${isApproved ? "active" : "suspended"},
            updated_at = NOW()
        WHERE seller_id = ${verificationId}
      `;
    } catch (err) {
      console.error("[admin] update seller verification error:", err);
    }
  }
  return c.json({ success: true, data: { verificationId, status: verifStatus, reason, note } });
});

/**
 * GET /verifications/seller/:verificationId/evidence
 */
adminRoutes.get("/verifications/seller/:verificationId/evidence", requireRole("admin"), async (c) => {
  return c.json({ success: true, data: [] });
});

/**
 * GET /verifications/seller/:verificationId/history
 */
adminRoutes.get("/verifications/seller/:verificationId/history", requireRole("admin"), async (c) => {
  return c.json({ success: true, data: [] });
});

/**
 * GET /sellers/:sellerId/application — Application detail for verification review modal
 */
adminRoutes.get("/sellers/:sellerId/application", requireRole("admin"), async (c) => {
  const sellerId = c.req.param("sellerId");
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({
      success: true,
      data: {
        seller: { id: sellerId, status: "active", verificationStatus: "pending", verifiedAt: null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        applicant: { name: "Seller Applicant", email: "seller@velnox.live", phone: null, firstName: null, lastName: null, idNumber: null },
        store: { name: "Sample Shop", slug: "sample-shop", description: null, category: null, logo: null, cover: null },
        documents: [],
        history: [],
      },
    });
  }
  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      SELECT s.*, u.name as user_name, u.email as user_email, u.phone as user_phone,
             sh.name as shop_name, sh.slug as shop_slug, sh.description as shop_description,
             sh.logo_url as shop_logo, sh.cover_url as shop_cover, sh.status as shop_status
      FROM sellers s
      LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN shops sh ON sh.seller_id = s.id
      WHERE s.id = ${sellerId}
    `;
    if (rows.length === 0) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Seller not found" } }, 404);
    }
    const s = rows[0];
    return c.json({
      success: true,
      data: {
        seller: {
          id: s.id,
          status: s.status || "active",
          verificationStatus: s.verification_status,
          verifiedAt: s.verified_at,
          createdAt: s.created_at,
          updatedAt: s.updated_at,
        },
        applicant: {
          name: s.user_name || s.name,
          email: s.user_email || s.email,
          phone: s.user_phone || s.phone,
          firstName: null,
          lastName: null,
          idNumber: null,
        },
        store: {
          name: s.shop_name,
          slug: s.shop_slug,
          description: s.shop_description,
          category: null,
          logo: s.shop_logo,
          cover: s.shop_cover,
        },
        documents: [],
        history: [],
      },
    });
  } catch (err: any) {
    console.error("[admin] get seller application error:", err);
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err?.message || "Failed to load application" } }, 500);
  }
});

/**
 * POST /sellers/:sellerId/revoke — Revoke and suspend shop
 */
adminRoutes.post("/sellers/:sellerId/revoke", requireRole("admin"), async (c) => {
  const sellerId = c.req.param("sellerId");
  const body = (await c.req.json().catch(() => ({}))) || {};
  const reason = body.reason || "Suspended by admin";
  const env = c.env as Bindings | undefined;
  if (env?.DATABASE_URL) {
    try {
      const sql = neon(env.DATABASE_URL);
      await sql`
        UPDATE sellers
        SET verification_status = 'suspended',
            verification_rejected_reason = ${reason},
            updated_at = NOW()
        WHERE id = ${sellerId}
      `;
      await sql`
        UPDATE shops
        SET status = 'suspended',
            updated_at = NOW()
        WHERE seller_id = ${sellerId}
      `;
    } catch (err) {
      console.error("[admin] revoke seller error:", err);
    }
  }
  return c.json({ success: true, data: { revoked: true, sellerId } });
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
    return c.json({ success: true, data: { products: [], items: [], total: 0, pagination: { page: 1, limit: 25, total: 0, totalPages: 0, hasMore: false } } });
  }
  const sql = neon(env.DATABASE_URL);
  try {
    const status = c.req.query("status") || "pending_review";
    const rows = status === "all"
      ? await sql`
          SELECT p.*, s.name as shop_name, s.slug as shop_slug, s.status as shop_status,
                 c.name as category_name, u.name as seller_name, u.email as seller_email
          FROM products p
          LEFT JOIN shops s ON s.id = p.shop_id
          LEFT JOIN sellers sel ON sel.id = s.seller_id
          LEFT JOIN users u ON u.id = sel.user_id
          LEFT JOIN categories c ON c.id = p.category_id
          ORDER BY p.created_at DESC
        `
      : await sql`
          SELECT p.*, s.name as shop_name, s.slug as shop_slug, s.status as shop_status,
                 c.name as category_name, u.name as seller_name, u.email as seller_email
          FROM products p
          LEFT JOIN shops s ON s.id = p.shop_id
          LEFT JOIN sellers sel ON sel.id = s.seller_id
          LEFT JOIN users u ON u.id = sel.user_id
          LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.status = ${status}
          ORDER BY p.created_at DESC
        `;
    const formatted = rows.map((r: any) => ({
      ...r,
      price: String(r.price ?? 0),
      currency: r.currency || "THB",
      unit: r.unit || "ชิ้น",
      shop_id: r.shop_id,
      shop_name: r.shop_name || "Shop",
      shop_slug: r.shop_slug || "shop",
      seller_name: r.seller_name || "Seller",
      seller_email: r.seller_email || "",
      primaryImage: r.primary_image_url ? { id: "primary", url: r.primary_image_url, alt: r.name } : null,
      images: r.primary_image_url ? [{ id: "primary", url: r.primary_image_url, alt: r.name }] : [],
    }));
    return c.json({
      success: true,
      data: {
        products: formatted,
        items: formatted,
        total: formatted.length,
        pagination: {
          page: 1,
          limit: formatted.length || 25,
          total: formatted.length,
          totalPages: 1,
          hasMore: false,
        },
      },
    });
  } catch (err) {
    console.error("[admin] products moderation error:", err);
    return c.json({ success: true, data: { products: [], items: [], total: 0, pagination: { page: 1, limit: 25, total: 0, totalPages: 0, hasMore: false } } });
  }
});

/**
 * GET /products/:productId/moderation-detail — Moderation detail modal
 */
adminRoutes.get("/products/:productId/moderation-detail", requireRole("admin"), async (c) => {
  const productId = c.req.param("productId");
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({
      success: true,
      data: {
        product: { id: productId, name: "Sample Product", price: 100, status: "pending_review" },
        images: [],
        variants: [],
        optionGroups: [],
        attributes: [],
        inventory: { quantity: 10, reserved: 0, reorder_level: 0 },
        shop: { id: "shop-1", name: "Shop", slug: "shop", status: "active", seller_name: "Seller", seller_email: "seller@velnox.live" },
        moderationHistory: [],
      },
    });
  }
  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      SELECT p.*, s.name as shop_name, s.slug as shop_slug, s.status as shop_status,
             c.name as category_name, u.name as seller_name, u.email as seller_email
      FROM products p
      LEFT JOIN shops s ON s.id = p.shop_id
      LEFT JOIN sellers sel ON sel.id = s.seller_id
      LEFT JOIN users u ON u.id = sel.user_id
      LEFT JOIN categories c ON c.id = p.category_id
      WHERE p.id = ${productId}
    `;
    if (rows.length === 0) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } }, 404);
    }
    const p = rows[0];
    const images = await sql`SELECT id, image_url as url, alt_text as alt, sort_order FROM product_images WHERE product_id = ${productId} ORDER BY sort_order ASC`;
    return c.json({
      success: true,
      data: {
        product: {
          id: p.id,
          name: p.name,
          description: p.description || "",
          short_description: p.short_description || "",
          price: Number(p.price ?? 0),
          compare_at_price: p.compare_at_price ? Number(p.compare_at_price) : undefined,
          currency: p.currency || "THB",
          unit: p.unit || "ชิ้น",
          status: p.status,
          rejection_reason: p.rejection_reason || undefined,
          category_id: p.category_id,
          category_name: p.category_name,
          created_at: p.created_at,
          updated_at: p.updated_at,
        },
        images: images.map((img: any) => ({ id: img.id, url: img.url, alt: img.alt || "", sort_order: img.sort_order || 0, image_type: "gallery" })),
        primaryImage: p.primary_image_url ? { id: "primary", url: p.primary_image_url, alt: p.name } : null,
        variants: [],
        optionGroups: [],
        attributes: [],
        inventory: { quantity: Number(p.stock_quantity ?? 0), reserved: 0, reorder_level: 0 },
        shop: {
          id: p.shop_id,
          name: p.shop_name,
          slug: p.shop_slug,
          status: p.shop_status || "active",
          seller_name: p.seller_name || "ผู้ขาย",
          seller_email: p.seller_email || "",
        },
        moderationHistory: [],
      },
    });
  } catch (err: any) {
    console.error("[admin] product moderation detail error:", err);
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err?.message || "Failed to get detail" } }, 500);
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
  const user = c.get("user");
  const env = c.env as Bindings | undefined;
  const defaults = {
    commissionRate: 0.03,
    returnCoverageDays: 7,
    maxUploadBytes: 10485760,
    allowedUploadTypes: ["image/jpeg", "image/png", "image/webp"],
  };
  let settingsRows: Array<{ key: string; value: string }> = [];
  const settingsMap: Record<string, string> = {};
  if (env?.DATABASE_URL) {
    try {
      const sql = neon(env.DATABASE_URL);
      const rows = await sql`SELECT key, value FROM platform_settings`;
      settingsRows = rows.map((r: any) => ({ key: r.key, value: String(r.value ?? "") }));
      for (const s of settingsRows) {
        settingsMap[s.key] = s.value;
      }
    } catch (err) {
      console.error("[admin] get settings error:", err);
    }
  }
  const meta = {
    moderation: {
      approvalMode: settingsMap["product_approval_mode"] || "manual",
      productVerificationEnabled: true,
    },
    commission: {
      sellerRate: 0.03,
      returnCoverage: 7,
      currency: "THB",
      editable: false,
    },
    media: {
      maxUploadBytes: 10485760,
      allowedTypes: ["image/jpeg", "image/png", "image/webp"],
    },
    role: user?.role || "admin",
  };
  return c.json({
    success: true,
    data: {
      settings: settingsRows,
      meta,
      ...defaults,
      ...settingsMap,
    },
  });
});

adminRoutes.patch("/settings", requireRole("admin"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) || {};
  const env = c.env as Bindings | undefined;
  if (env?.DATABASE_URL) {
    try {
      const sql = neon(env.DATABASE_URL);
      if (body.key && body.value !== undefined) {
        await sql`
          INSERT INTO platform_settings (key, value, updated_at)
          VALUES (${body.key}, ${String(body.value)}, NOW())
          ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
        `;
      } else {
        for (const [k, v] of Object.entries(body)) {
          await sql`
            INSERT INTO platform_settings (key, value, updated_at)
            VALUES (${k}, ${typeof v === "string" ? v : JSON.stringify(v)}, NOW())
            ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
          `;
        }
      }
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
      SELECT id, email, name, avatar, role, department, status, created_at
      FROM users
      ORDER BY created_at DESC
      LIMIT 200
    `;
    const formattedUsers = users.map((u: any) => ({
      _id: u.id,
      id: u.id,
      email: u.email,
      name: u.name,
      avatarUrl: u.avatar,
      role: u.role,
      department: u.department,
      status: u.status,
      createdAt: u.created_at ? new Date(u.created_at).getTime() : Date.now(),
    }));
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
        users: formattedUsers,
      },
    });
  } catch (err) {
    console.error("[admin] users error:", err);
    return c.json({ success: true, data: { segment: "all", counts: { staff: 0, customer: 0, seller: 0 }, users: [] } });
  }
});

/**
 * PATCH /users/:userId/access — Update user access and role
 */
adminRoutes.patch("/users/:userId/access", requireRole("admin"), async (c) => {
  const userId = c.req.param("userId");
  const body = (await c.req.json().catch(() => ({}))) || {};
  const { role, department } = body;
  const allowedRoles = ["customer", "seller", "staff", "admin", "owner", "center_staff", "center_admin", "center_superadmin"];
  if (role && !allowedRoles.includes(role)) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Invalid role" } }, 400);
  }
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { id: userId, _id: userId, role: role || "customer", department: department || null } });
  }
  try {
    const sql = neon(env.DATABASE_URL);
    const updated = await sql`
      UPDATE users
      SET role = COALESCE(${role || null}, role),
          department = COALESCE(${department || null}, department),
          updated_at = NOW()
      WHERE id = ${userId}
      RETURNING id, email, name, avatar, role, department, status, updated_at
    `;
    if (updated.length === 0) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "User not found" } }, 404);
    }
    const u = updated[0];
    return c.json({ success: true, data: { ...u, _id: u.id, avatarUrl: u.avatar } });
  } catch (err: any) {
    console.error("[admin] update user access error:", err);
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err?.message || "Failed to update user access" } }, 500);
  }
});

/**
 * PATCH /staff — Update staff profile (department, permissions)
 */
adminRoutes.patch("/staff", requireRole("admin"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) || {};
  const { userId, department } = body;
  if (!userId) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "userId is required" } }, 400);
  }
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { userId, updated: true } });
  }
  try {
    const sql = neon(env.DATABASE_URL);
    await sql`
      UPDATE users
      SET department = COALESCE(${department || null}, department),
          updated_at = NOW()
      WHERE id = ${userId}
    `;
    return c.json({ success: true, data: { userId, updated: true } });
  } catch (err: any) {
    console.error("[admin] update staff profile error:", err);
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err?.message || "Failed to update staff" } }, 500);
  }
});

/**
 * GET /orders — Center orders list
 */
adminRoutes.get("/orders", requireRole("admin"), async (c) => {
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { orders: [], items: [], pagination: { limit: 100, offset: 0, total: 0, hasMore: false } } });
  }
  const sql = neon(env.DATABASE_URL);
  try {
    const limit = Math.min(Math.max(parseInt(c.req.query("limit") || "100", 10), 1), 200);
    const offset = Math.max(parseInt(c.req.query("offset") || "0", 10), 0);
    const [orders, countRow] = await Promise.all([
      sql`
        SELECT o.id, o.user_id, o.order_number, o.status, o.total_amount, o.tracking_number, o.shipping_carrier, o.created_at,
               sh.name AS shop_name, sh.slug AS shop_slug, u.email as customer_email, u.name as customer_name, u.phone as customer_phone
        FROM orders o
        LEFT JOIN shops sh ON o.shop_id = sh.id
        LEFT JOIN users u ON u.id = o.user_id
        ORDER BY o.created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      sql`SELECT COUNT(*)::int as total FROM orders`,
    ]);
    const totalCount = countRow[0]?.total ?? 0;
    const formattedOrders = orders.map((o: any) => ({
      id: o.id,
      orderNumber: o.order_number,
      status: o.status,
      createdAt: o.created_at ? new Date(o.created_at).getTime() : Date.now(),
      total: Number(o.total_amount ?? 0),
      customerName: o.customer_name || o.customer_email || "ลูกค้า",
      customerPhone: o.customer_phone || "",
      itemCount: 1,
      shopName: o.shop_name || "Velnox",
      items: [],
      trackingNumber: o.tracking_number || null,
      shippingCarrier: o.shipping_carrier || null,
    }));
    return c.json({
      success: true,
      data: {
        orders: formattedOrders,
        items: formattedOrders,
        pagination: {
          limit,
          offset,
          total: totalCount,
          hasMore: offset + formattedOrders.length < totalCount,
        },
      },
    });
  } catch (err) {
    console.error("[admin] orders error:", err);
    return c.json({ success: true, data: { orders: [], items: [], pagination: { limit: 100, offset: 0, total: 0, hasMore: false } } });
  }
});

/**
 * PATCH /orders/:orderId/status — Admin update order status / shipping tracking
 */
adminRoutes.patch("/orders/:orderId/status", requireRole("admin"), async (c) => {
  const orderId = c.req.param("orderId");
  const body = (await c.req.json().catch(() => ({}))) || {};
  const { status, trackingNumber, trackingCarrier } = body;
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { id: orderId, status: status || "processing", trackingNumber } });
  }
  try {
    const sql = neon(env.DATABASE_URL);
    const updated = await sql`
      UPDATE orders
      SET status = COALESCE(${status || null}, status),
          tracking_number = COALESCE(${trackingNumber || null}, tracking_number),
          shipping_carrier = COALESCE(${trackingCarrier || null}, shipping_carrier),
          updated_at = NOW()
      WHERE id = ${orderId}
      RETURNING id, order_number, status, tracking_number, shipping_carrier, total_amount, updated_at
    `;
    if (updated.length === 0) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Order not found" } }, 404);
    }
    return c.json({ success: true, data: updated[0] });
  } catch (err: any) {
    console.error("[admin] update order status error:", err);
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err?.message || "Failed to update order status" } }, 500);
  }
});

/**
 * Tracking routes (carrier search, health, shipment detail)
 */
adminRoutes.get("/tracking/search", requireRole("admin"), async (c) => {
  return c.json({ success: true, data: { items: [], total: 0 } });
});

adminRoutes.get("/tracking/health", requireRole("admin"), async (c) => {
  return c.json({ success: true, data: { status: "healthy", carriers: ["thaipost", "kerry", "flash", "jnt"] } });
});

adminRoutes.get("/tracking/shipments/:shipmentId", requireRole("admin"), async (c) => {
  return c.json({ success: true, data: null });
});

adminRoutes.post("/orders/:orderId/tracking/refresh", requireRole("admin"), async (c) => {
  return c.json({ success: true, data: { refreshed: true } });
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
      SELECT id, email, name, role, department, status, password_hash, must_change_password, created_at
      FROM users
      WHERE role IN ('owner', 'admin', 'staff', 'center_staff', 'center_admin', 'center_superadmin')
      ORDER BY created_at DESC
    `;
    const data = employees.map((r: any) => ({
      userId: r.id,
      neonId: r.id,
      id: r.id,
      email: r.email,
      name: r.name,
      role: r.role,
      department: r.department,
      employeeId: null,
      permissions: [],
      active: r.status === "active",
      mustChangePassword: r.must_change_password ?? false,
      passwordAuth: Boolean(r.password_hash),
      createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
    }));
    return c.json({ success: true, data });
  } catch (err) {
    console.error("[admin] employees error:", err);
    return c.json({ success: true, data: [] });
  }
});

/**
 * POST /employees — Create staff employee account
 */
adminRoutes.post("/employees", requireRole("admin"), async (c) => {
  const body = (await c.req.json().catch(() => ({}))) || {};
  const { name, email, department, role, password } = body;
  if (!email || !name) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Email and name are required" } }, 400);
  }
  const employeeRole = role && ["staff", "admin", "center_staff", "center_admin"].includes(role) ? role : "staff";
  const tempPassword = password && password.length >= 8
    ? password
    : "vel" + Array.from({ length: 8 }, () => Math.floor(Math.random() * 10)).join("");
  const passwordHash = await hashPassword(tempPassword);
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { id: crypto.randomUUID(), email, name, role: employeeRole, tempPassword } }, 201);
  }
  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      INSERT INTO users (email, name, role, department, password_hash, must_change_password, status)
      VALUES (${email.trim().toLowerCase()}, ${name.trim()}, ${employeeRole}, ${department || "general"}, ${passwordHash}, TRUE, 'active')
      ON CONFLICT (email) DO UPDATE
        SET name = EXCLUDED.name,
            role = EXCLUDED.role,
            department = EXCLUDED.department,
            password_hash = EXCLUDED.password_hash,
            must_change_password = TRUE,
            status = 'active',
            updated_at = NOW()
      RETURNING id, email, name, role, department
    `;
    const user = rows[0];
    return c.json({ success: true, data: { id: user.id, email: user.email, name: user.name, role: user.role, tempPassword } }, 201);
  } catch (err: any) {
    console.error("[admin] create employee error:", err);
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err?.message || "Failed to create employee" } }, 500);
  }
});

/**
 * POST /employees/:id/reset-password — Reset employee password
 */
adminRoutes.post("/employees/:id/reset-password", requireRole("admin"), async (c) => {
  const employeeId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) || {};
  const password = body.password || ("vel" + Array.from({ length: 6 }, () => Math.floor(Math.random() * 10)).join(""));
  if (password.length < 8) {
    return c.json({ success: false, error: { code: "VALIDATION_ERROR", message: "Password must be at least 8 characters" } }, 400);
  }
  const passwordHash = await hashPassword(password);
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { success: true, tempPassword: password, email: "employee@velnox.com" } });
  }
  try {
    const sql = neon(env.DATABASE_URL);
    const rows = await sql`
      UPDATE users
      SET password_hash = ${passwordHash},
          must_change_password = TRUE,
          updated_at = NOW()
      WHERE id = ${employeeId}
      RETURNING id, email
    `;
    if (rows.length === 0) {
      return c.json({ success: false, error: { code: "NOT_FOUND", message: "Employee not found" } }, 404);
    }
    return c.json({ success: true, data: { success: true, tempPassword: password, email: rows[0].email } });
  } catch (err: any) {
    console.error("[admin] reset employee password error:", err);
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err?.message || "Failed to reset password" } }, 500);
  }
});

/**
 * PATCH /employees/:id/active — Toggle active status
 */
adminRoutes.patch("/employees/:id/active", requireRole("admin"), async (c) => {
  const employeeId = c.req.param("id");
  const body = (await c.req.json().catch(() => ({}))) || {};
  const active = body.active !== false;
  const status = active ? "active" : "suspended";
  const env = c.env as Bindings | undefined;
  if (!env?.DATABASE_URL) {
    return c.json({ success: true, data: { id: employeeId, active } });
  }
  try {
    const sql = neon(env.DATABASE_URL);
    await sql`
      UPDATE users
      SET status = ${status},
          updated_at = NOW()
      WHERE id = ${employeeId}
    `;
    return c.json({ success: true, data: { id: employeeId, active } });
  } catch (err: any) {
    console.error("[admin] toggle employee active error:", err);
    return c.json({ success: false, error: { code: "INTERNAL_ERROR", message: err?.message || "Failed to toggle status" } }, 500);
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
