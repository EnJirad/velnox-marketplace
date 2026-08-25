import type { Express, Request, Response } from "express";
import { requireAuth, optionalAuth } from "../middleware/auth.js";
import { errorHandler } from "../middleware/error.js";
import { query } from "../db/index.js";

// ─── Profile cache for /api/customer/profile (5s TTL) ──────────────────────
// Avoids repeated slow queries when multiple components mount simultaneously.
const customerProfileCache = new Map<string, { data: any; expires: number }>();
const PROFILE_CACHE_TTL = 30_000; // 30 seconds — reduces Neon cold-start impact

function getCachedCustomerProfile(userId: string): any | null {
  const entry = customerProfileCache.get(userId);
  if (entry && entry.expires > Date.now()) return entry.data;
  customerProfileCache.delete(userId);
  return null;
}

function setCachedCustomerProfile(userId: string, data: any): void {
  customerProfileCache.set(userId, { data, expires: Date.now() + PROFILE_CACHE_TTL });
}

export function invalidateCustomerProfileCache(userId: string): void {
  customerProfileCache.delete(userId);
}

// NOTE: Address columns (recipient_name, subdistrict, district, latitude,
// longitude) are managed by migration V0013 (db/migrations/013_schema_migrations_and_address_fixes.sql).
// Do NOT add startup ALTER TABLE statements here.

export function setupRoutes(app: Express): void {
  // NOTE: /api/auth/me and /api/auth/logout are defined in auth.ts (setupGoogleAuth)
  // to avoid route conflicts. Do NOT re-define them here.

  // ─── Products ────────────────────────────────────────
  app.get("/api/products", optionalAuth, async (req, res) => {
    try {
      const page = parseInt(req.query.page as string) || 1;
      const pageSize = parseInt(req.query.pageSize as string) || 12;
      const search = req.query.search as string;
      const category = req.query.category as string;
      const featured = req.query.featured === "true";
      const offset = (page - 1) * pageSize;

      let where = "WHERE p.status = 'published'";
      const params: unknown[] = [];
      let paramIndex = 1;

      if (search) { where += ` AND (p.name ILIKE $${paramIndex} OR p.description ILIKE $${paramIndex})`; params.push(`%${search}%`); paramIndex++; }
      if (category) { where += ` AND c.slug = $${paramIndex}`; params.push(category); paramIndex++; }
      if (featured) { where += ` AND p.featured = true`; }

      const countResult = await query(`SELECT COUNT(*) FROM products p LEFT JOIN categories c ON c.slug = p.category_id ${where}`, params);
      const total = parseInt(countResult.rows[0]!.count);

      params.push(pageSize, offset);
      const productsResult = await query(`
        SELECT p.*, c.name as category_name, c.slug as category_slug, c.icon as category_icon,
               s.id as shop_id, s.name as shop_name, s.slug as shop_slug, s.rating as shop_rating, s.product_count as shop_product_count
        FROM products p
        LEFT JOIN categories c ON c.slug = p.category_id
        LEFT JOIN shops s ON p.shop_id = s.id
        ${where}
        ORDER BY p.created_at DESC
        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
      `, params);

      const items = productsResult.rows.map((r: Record<string, unknown>) => ({
        id: r.id, shopId: r.shop_id, name: r.name, slug: r.slug, description: r.description,
        shortDescription: r.short_description, price: r.price, compareAtPrice: r.compare_at_price,
        currency: r.currency, status: r.status, featured: r.featured, rating: r.rating,
        reviewCount: r.review_count, soldCount: r.sold_count, categoryId: r.category_id,
        category: r.category_name ? { id: r.category_id, name: r.category_name, slug: r.category_slug, icon: r.category_icon, parentId: null } : undefined,
        shop: r.shop_id ? { id: r.shop_id, sellerId: "", name: r.shop_name, slug: r.shop_slug, description: null, logo: null, cover: null, rating: r.shop_rating, productCount: r.shop_product_count, createdAt: "" } : undefined,
        images: [], createdAt: r.created_at, updatedAt: r.updated_at,
      }));

      res.json({ success: true, data: { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) } });
    } catch (err) {
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch products" } });
    }
  });

  app.get("/api/products/:id", async (req, res) => {
    try {
      // Public access only shows published products
      const result = await query("SELECT * FROM products WHERE id = $1 AND status = 'published'", [req.params.id]);
      if (result.rows.length === 0) { res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } }); return; }
      res.json({ success: true, data: { product: result.rows[0] } });
    } catch {
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch product" } });
    }
  });

  // ─── Categories ──────────────────────────────────────
  app.get("/api/categories", async (_req, res) => {
    try {
      const result = await query("SELECT * FROM categories ORDER BY name");
      res.json({ success: true, data: { categories: result.rows.map((r: Record<string, unknown>) => ({ id: r.id, name: r.name, slug: r.slug, icon: r.icon, parentId: r.parent_id })) } });
    } catch {
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch categories" } });
    }
  });

  // ─── Customer Profile ──────────────────────────────────
  app.get("/api/customer/profile", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;

      // Check cache first
      const cached = getCachedCustomerProfile(userId);
      if (cached) {
        res.json({ success: true, data: cached });
        return;
      }

      let result;
      let coverUrl: string | null = null;
      try {
        result = await query(
          "SELECT id, email, name, avatar, cover_url, phone, created_at FROM users WHERE id = $1",
          [userId]
        );
        coverUrl = result.rows[0]?.cover_url || null;
      } catch (queryErr: any) {
        if (queryErr?.code === "42703") {
          result = await query(
            "SELECT id, email, name, avatar, phone, created_at FROM users WHERE id = $1",
            [userId]
          );
        } else {
          throw queryErr;
        }
      }
      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "User not found" } });
        return;
      }
      const u = result.rows[0];

      // If cover_url column doesn't exist, retrieve latest cover from media table
      if (!coverUrl) {
        try {
          const coverResult = await query(
            `SELECT url FROM media
             WHERE uploaded_by = $1 AND key LIKE $2
             ORDER BY created_at DESC LIMIT 1`,
            [userId, `profile/cover/${userId}/%`]
          );
          coverUrl = coverResult.rows[0]?.url || null;
        } catch { /* media table query failed — ignore */ }
      }

      // Also try fixed-key format (no slash between userId and filename)
      if (!coverUrl) {
        try {
          const fixedResult = await query(
            `SELECT url FROM media
             WHERE uploaded_by = $1 AND key LIKE $2
             ORDER BY created_at DESC LIMIT 1`,
            [userId, `profile/cover/${userId}%`]
          );
          coverUrl = fixedResult.rows[0]?.url || null;
        } catch { /* ignore */ }
      }

      const profileData = {
        name: u.name,
        email: u.email,
        phone: u.phone || null,
        avatarUrl: u.avatar || null,
        coverUrl,
        memberSince: new Date(u.created_at).getTime(),
      };

      setCachedCustomerProfile(userId, profileData);
      res.json({ success: true, data: profileData });
    } catch (err) {
      console.error("[profile] fetch error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch profile" } });
    }
  });

  app.put("/api/customer/profile", requireAuth, async (req: Request, res: Response) => {
    try {
      const { name, phone } = req.body;
      const userId = req.user!.userId;
      const updates: string[] = [];
      const params: unknown[] = [];
      let paramIndex = 1;

      if (name !== undefined && name !== null) {
        updates.push(`name = $${paramIndex}`);
        params.push(name);
        paramIndex++;
      }
      if (phone !== undefined) {
        updates.push(`phone = $${paramIndex}`);
        params.push(phone || null);
        paramIndex++;
      }

      if (updates.length > 0) {
        updates.push("updated_at = NOW()");
        params.push(userId);
        await query(`UPDATE users SET ${updates.join(", ")} WHERE id = $${paramIndex}`, params);
      }

      // Invalidate caches after profile update
      try {
        const { invalidateCachedProfile } = await import("./auth.js");
        invalidateCachedProfile(userId);
      } catch { /* ignore */ }
      invalidateCustomerProfileCache(userId);

      const result = await query(
        "SELECT id, name, phone, created_at FROM users WHERE id = $1",
        [userId]
      );
      const u = result.rows[0];
      res.json({
        success: true,
        data: {
          name: u.name,
          phone: u.phone || null,
          memberSince: new Date(u.created_at).getTime(),
        },
      });
    } catch (err) {
      console.error("[profile] update error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to update profile" } });
    }
  });

  // ─── Addresses ────────────────────────────────────────
  // GET /api/customer/addresses — list all addresses for the authenticated user
  app.get("/api/customer/addresses", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      // Try to SELECT all columns including optional ones
      let result;
      try {
        result = await query(
          `SELECT id, label, recipient_name, phone, line1, line2, city, state, postal_code,
                  country, is_default, subdistrict, district, latitude, longitude,
                  created_at, updated_at
           FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
          [userId]
        );
      } catch (colErr: any) {
        // If a column doesn't exist (42703), fall back to base columns
        if (colErr?.code === "42703") {
          result = await query(
            `SELECT id, label, recipient_name, phone, line1, line2, city, state, postal_code,
                    country, is_default, created_at, updated_at
             FROM addresses WHERE user_id = $1 ORDER BY is_default DESC, created_at DESC`,
            [userId]
          );
        } else {
          throw colErr;
        }
      }

      const addresses = result.rows.map((r: Record<string, unknown>) => ({
        id: r.id,
        label: r.label || "Home",
        recipientName: r.recipient_name || "",
        phone: r.phone || "",
        line1: r.line1 || "",
        line2: r.line2 || null,
        // Map DB columns to frontend field names
        subdistrict: r.subdistrict || r.city || null,
        district: r.district || null,
        province: r.state || null,
        postalCode: r.postal_code || null,
        country: r.country || "TH",
        latitude: r.latitude != null ? Number(r.latitude) : null,
        longitude: r.longitude != null ? Number(r.longitude) : null,
        isDefault: r.is_default || false,
      }));

      res.json({ success: true, data: addresses });
    } catch (err) {
      console.error("[addresses] list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch addresses" } });
    }
  });

  // POST /api/customer/addresses — create or update an address
  app.post("/api/customer/addresses", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const {
        addressId,
        label,
        recipientName,
        phone,
        line1,
        line2,
        subdistrict,
        district,
        province,
        postalCode,
        country,
        latitude,
        longitude,
        isDefault,
      } = req.body;

      // Server-side validation
      if (!recipientName || typeof recipientName !== "string" || !recipientName.trim()) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "recipientName is required" } });
        return;
      }
      if (!phone || typeof phone !== "string" || !phone.trim()) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "phone is required" } });
        return;
      }
      if (!line1 || typeof line1 !== "string" || !line1.trim()) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "line1 (address) is required" } });
        return;
      }
      if (!province || typeof province !== "string" || !province.trim()) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "province is required" } });
        return;
      }
      if (!postalCode || typeof postalCode !== "string" || !/^\d{5}$/.test(postalCode.trim())) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "postalCode must be a 5-digit string" } });
        return;
      }
      if (latitude != null && (typeof latitude !== "number" || latitude < -90 || latitude > 90)) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "latitude is invalid" } });
        return;
      }
      if (longitude != null && (typeof longitude !== "number" || longitude < -180 || longitude > 180)) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "longitude is invalid" } });
        return;
      }

      const trimmedLabel = (label || "Home").trim().substring(0, 100);
      const trimmedRecipient = recipientName.trim().substring(0, 255);
      const trimmedPhone = phone.trim().substring(0, 50);
      const trimmedLine1 = line1.trim().substring(0, 255);
      const trimmedLine2 = line2 ? String(line2).trim().substring(0, 255) : null;
      const trimmedSubdistrict = subdistrict ? String(subdistrict).trim().substring(0, 100) : null;
      const trimmedDistrict = district ? String(district).trim().substring(0, 100) : null;
      const trimmedProvince = province.trim().substring(0, 100);
      const trimmedPostal = postalCode.trim();
      const trimmedCountry = (country || "TH").trim().substring(0, 100);

      // Determine if this is an update or create
      const isUpdate = addressId && typeof addressId === "string" && addressId.length > 0;

      if (isUpdate) {
        // Verify the address belongs to this user
        const existing = await query(
          "SELECT id FROM addresses WHERE id = $1 AND user_id = $2",
          [addressId, userId]
        );
        if (existing.rows.length === 0) {
          res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Address not found" } });
          return;
        }

        // If setting as default, clear other defaults first
        if (isDefault) {
          await query(
            "UPDATE addresses SET is_default = false, updated_at = NOW() WHERE user_id = $1 AND is_default = true",
            [userId]
          );
        }

        // Try updating with all columns; fall back if optional columns don't exist
        try {
          await query(
            `UPDATE addresses SET
               label = $1, recipient_name = $2, phone = $3, line1 = $4, line2 = $5,
               subdistrict = $6, district = $7, city = $6, state = $8,
               postal_code = $9, country = $10, is_default = $11,
               latitude = $12, longitude = $13, updated_at = NOW()
             WHERE id = $14 AND user_id = $15`,
            [
              trimmedLabel, trimmedRecipient, trimmedPhone, trimmedLine1, trimmedLine2,
              trimmedSubdistrict, trimmedDistrict, trimmedProvince,
              trimmedPostal, trimmedCountry, !!isDefault,
              latitude ?? null, longitude ?? null,
              addressId, userId,
            ]
          );
        } catch (updateErr: any) {
          if (updateErr?.code === "42703") {
            // One of the new columns doesn't exist — update only base columns
            await query(
              `UPDATE addresses SET
                 label = $1, recipient_name = $2, phone = $3, line1 = $4, line2 = $5,
                 city = $6, state = $7,
                 postal_code = $8, country = $9, is_default = $10,
                 updated_at = NOW()
               WHERE id = $11 AND user_id = $12`,
              [
                trimmedLabel, trimmedRecipient, trimmedPhone, trimmedLine1, trimmedLine2,
                trimmedSubdistrict || trimmedProvince, trimmedProvince,
                trimmedPostal, trimmedCountry, !!isDefault,
                addressId, userId,
              ]
            );
          } else {
            throw updateErr;
          }
        }

        res.json({ success: true, data: { id: addressId } });
      } else {
        // Create new address
        // If setting as default, clear other defaults first
        if (isDefault) {
          await query(
            "UPDATE addresses SET is_default = false, updated_at = NOW() WHERE user_id = $1 AND is_default = true",
            [userId]
          );
        }

        let result;
        try {
          result = await query(
            `INSERT INTO addresses
               (user_id, label, recipient_name, phone, line1, line2,
                subdistrict, district, city, state,
                postal_code, country, is_default, latitude, longitude)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
             RETURNING id`,
            [
              userId, trimmedLabel, trimmedRecipient, trimmedPhone, trimmedLine1, trimmedLine2,
              trimmedSubdistrict, trimmedDistrict, trimmedSubdistrict || trimmedProvince, trimmedProvince,
              trimmedPostal, trimmedCountry, !!isDefault,
              latitude ?? null, longitude ?? null,
            ]
          );
        } catch (insertErr: any) {
          if (insertErr?.code === "42703") {
            // Optional columns don't exist — insert with base columns only
            result = await query(
              `INSERT INTO addresses
                 (user_id, label, recipient_name, phone, line1, line2,
                  city, state, postal_code, country, is_default)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
               RETURNING id`,
              [
                userId, trimmedLabel, trimmedRecipient, trimmedPhone, trimmedLine1, trimmedLine2,
                trimmedSubdistrict || trimmedProvince, trimmedProvince,
                trimmedPostal, trimmedCountry, !!isDefault,
              ]
            );
          } else {
            throw insertErr;
          }
        }

        res.json({ success: true, data: { id: result.rows[0].id } });
      }
    } catch (err) {
      console.error("[addresses] save error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to save address" } });
    }
  });

  // DELETE /api/customer/addresses/:id
  app.delete("/api/customer/addresses/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { id } = req.params;

      const result = await query(
        "DELETE FROM addresses WHERE id = $1 AND user_id = $2 RETURNING id",
        [id, userId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Address not found" } });
        return;
      }

      res.json({ success: true, data: { success: true } });
    } catch (err) {
      console.error("[addresses] delete error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to delete address" } });
    }
  });

  // ─── Placeholder routes ──────────────────────────────
  const placeholder = (name: string) => async (_req: Request, res: Response) => {
    res.json({ success: true, data: { [name]: [] } });
  };

  app.get("/api/cart", requireAuth, placeholder("cart"));
  app.post("/api/cart/items", requireAuth, placeholder("cart"));
  app.patch("/api/cart/items/:id", requireAuth, placeholder("cart"));
  app.delete("/api/cart/items/:id", requireAuth, placeholder("cart"));

  app.get("/api/orders", requireAuth, placeholder("orders"));
  app.post("/api/orders", requireAuth, placeholder("order"));
  app.get("/api/orders/:id", requireAuth, placeholder("order"));

  // Legacy address placeholders (kept for backward compatibility)
  app.get("/api/addresses", requireAuth, placeholder("addresses"));
  app.post("/api/addresses", requireAuth, placeholder("address"));
  app.put("/api/addresses/:id", requireAuth, placeholder("address"));
  app.delete("/api/addresses/:id", requireAuth, placeholder("address"));

  // /api/shops and /api/shops/:slug are handled by products.ts — do NOT add placeholders here

  // ─── Error Handler ──────────────────────────────────
  app.use(errorHandler);
}
