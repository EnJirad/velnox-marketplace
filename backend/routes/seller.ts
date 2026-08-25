/**
 * Velnox Seller Routes — Complete Seller Onboarding & Approval System
 *
 * Endpoints:
 *   POST /api/seller/apply           — Submit seller application (authenticated)
 *   GET  /api/seller/status          — Get current user's seller status (authenticated)
 *   GET  /api/seller/profile         — Get seller profile (authenticated)
 *   GET  /api/admin/sellers          — List all sellers (admin only)
 *   PATCH /api/admin/sellers/:id/status — Approve/reject/suspend seller (admin only)
 *
 * Security:
 *   - All seller endpoints require authentication
 *   - Admin endpoints require owner/admin/staff role
 *   - Sellers cannot approve themselves
 *   - Backend determines user identity from session, never trusts frontend userId
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query, getClient } from "../db/index.js";
import { invalidateCachedProfile } from "./auth.js";

export function setupSellerRoutes(app: Express): void {
  // ── POST /api/seller/apply ─────────────────────────────────────────────
  // Submit a seller application. Creates a seller record with status "pending"
  // and optionally creates a shop record if shopName is provided.
  app.post("/api/seller/apply", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { shopName } = req.body;

      console.log("[seller] application received from user:", userId);

      // Validate input
      if (!shopName || typeof shopName !== "string" || !shopName.trim()) {
        res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "shopName is required" },
        });
        return;
      }

      const trimmedShopName = shopName.trim().substring(0, 255);

      // Check if user already has a seller application
      const existingSeller = await query(
        "SELECT id, status FROM sellers WHERE user_id = $1",
        [userId]
      );

      if (existingSeller.rows.length > 0) {
        const existing = existingSeller.rows[0];
        if (existing.status === "pending" || existing.status === "under_review") {
          res.status(409).json({
            success: false,
            error: {
              code: "ALREADY_APPLIED",
              message: "You already have a pending seller application",
            },
          });
          return;
        }
        if (existing.status === "approved") {
          res.status(409).json({
            success: false,
            error: {
              code: "ALREADY_SELLER",
              message: "You are already an approved seller",
            },
          });
          return;
        }
        // If rejected or suspended, allow re-application by updating status
        await query(
          "UPDATE sellers SET status = 'pending', updated_at = NOW() WHERE user_id = $1",
          [userId]
        );
      } else {
        // Create new seller record
        await query(
          "INSERT INTO sellers (user_id, status) VALUES ($1, 'pending')",
          [userId]
        );
      }

      // Get the seller record
      const sellerResult = await query(
        "SELECT id, status FROM sellers WHERE user_id = $1",
        [userId]
      );
      const seller = sellerResult.rows[0];

      // Create shop record if shopName provided
      if (trimmedShopName) {
        // Generate a URL-friendly slug from shop name
        const baseSlug = trimmedShopName
          .toLowerCase()
          .replace(/[^a-z0-9\s-]/g, "")
          .replace(/\s+/g, "-")
          .replace(/-+/g, "-")
          .substring(0, 100);

        // Check for slug uniqueness and append suffix if needed
        let slug = baseSlug;
        let suffix = 1;
        while (true) {
          const slugCheck = await query(
            "SELECT id FROM shops WHERE slug = $1",
            [slug]
          );
          if (slugCheck.rows.length === 0) break;
          slug = `${baseSlug}-${suffix}`;
          suffix++;
        }

        // Create shop record
        await query(
          "INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3)",
          [seller.id, trimmedShopName, slug]
        );

        // Create default seller settings
        await query(
          "INSERT INTO seller_settings (seller_id, settings) VALUES ($1, $2)",
          [seller.id, JSON.stringify({ shopName: trimmedShopName })]
        );
      }

      console.log("[seller] application created:", seller.id);

      res.json({
        success: true,
        data: {
          seller: {
            id: seller.id,
            status: seller.status,
          },
        },
      });
    } catch (err) {
      console.error("[seller] apply error:", err);
      res.status(500).json({
        success: false,
        error: { code: "SELLER_APPLY_FAILED", message: "Failed to submit seller application" },
      });
    }
  });

  // ── GET /api/seller/status ────────────────────────────────────────────
  // Get the current user's seller status
  app.get("/api/seller/status", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;

      const result = await query(
        `SELECT s.id, s.status, s.created_at,
                sh.name as shop_name, sh.slug as shop_slug,
                ss.settings as seller_settings
         FROM sellers s
         LEFT JOIN shops sh ON sh.seller_id = s.id
         LEFT JOIN seller_settings ss ON ss.seller_id = s.id
         WHERE s.user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        res.json({
          success: true,
          data: null,
        });
        return;
      }

      const row = result.rows[0];
      const settings = row.seller_settings || {};

      console.log(`[seller] status for user ${userId}: ${row.status}`);

      res.json({
        success: true,
        data: {
          id: row.id,
          status: row.status,
          shopName: row.shop_name || null,
          shopSlug: row.shop_slug || null,
          createdAt: row.created_at,
          rejectionReason: settings.rejectionReason || null,
        },
      });
    } catch (err: any) {
      // Graceful fallback: if the join fails (e.g. shops/seller_settings tables
      // don't exist yet), try a simpler query that only reads sellers.
      if (err?.code === "42P01" || err?.code === "42703") {
        try {
          const userId = req.user!.userId;
          const fallback = await query(
            `SELECT id, status, created_at FROM sellers WHERE user_id = $1`,
            [userId]
          );
          if (fallback.rows.length === 0) {
            res.json({ success: true, data: null });
            return;
          }
          const row = fallback.rows[0];
          console.log(`[seller] status (fallback) for user ${userId}: ${row.status}`);
          res.json({
            success: true,
            data: {
              id: row.id,
              status: row.status,
              shopName: null,
              shopSlug: null,
              createdAt: row.created_at,
              rejectionReason: null,
            },
          });
          return;
        } catch { /* ignore fallback error */ }
      }
      console.error("[seller] status error:", err);
      res.status(500).json({
        success: false,
        error: { code: "DB_ERROR", message: "Failed to fetch seller status" },
      });
    }
  });

  // ── GET /api/seller/profile ───────────────────────────────────────────
  // Get seller profile details
  app.get("/api/seller/profile", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;

      const result = await query(
        `SELECT s.id, s.status, s.created_at, s.updated_at,
                sh.id as shop_id, sh.name as shop_name, sh.slug as shop_slug,
                sh.description as shop_description, sh.logo as shop_logo,
                sh.cover as shop_cover, sh.rating as shop_rating,
                sh.product_count as shop_product_count,
                ss.settings as seller_settings
         FROM sellers s
         LEFT JOIN shops sh ON sh.seller_id = s.id
         LEFT JOIN seller_settings ss ON ss.seller_id = s.id
         WHERE s.user_id = $1`,
        [userId]
      );

      if (result.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Seller profile not found" },
        });
        return;
      }

      const row = result.rows[0];
      res.json({
        success: true,
        data: {
          id: row.id,
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          shop: row.shop_id
            ? {
                id: row.shop_id,
                name: row.shop_name,
                slug: row.shop_slug,
                description: row.shop_description,
                logo: row.shop_logo,
                cover: row.shop_cover,
                rating: row.shop_rating ? parseFloat(row.shop_rating) : null,
                productCount: row.shop_product_count || 0,
              }
            : null,
          settings: row.seller_settings || {},
        },
      });
    } catch (err) {
      console.error("[seller] profile error:", err);
      res.status(500).json({
        success: false,
        error: { code: "DB_ERROR", message: "Failed to fetch seller profile" },
      });
    }
  });

  // ── GET /api/admin/sellers ────────────────────────────────────────────
  // List all sellers with user information (admin only)
  app.get("/api/admin/sellers", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;

      // Verify user has admin permissions
      const userResult = await query(
        "SELECT role FROM users WHERE id = $1",
        [userId]
      );

      if (userResult.rows.length === 0) {
        res.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "User not found" },
        });
        return;
      }

      const userRole = userResult.rows[0].role;
      if (!["owner", "admin", "staff"].includes(userRole)) {
        res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "Insufficient permissions" },
        });
        return;
      }

      // Fetch all sellers with user and shop information
      // Returns data matching the frontend SellerRow interface
      const result = await query(
        `SELECT s.id, s.status, s.created_at, s.updated_at,
                u.id as user_id, u.name as user_name, u.email as user_email,
                sh.id as shop_id, sh.name as shop_name, sh.product_count as shop_product_count,
                ss.settings as seller_settings
         FROM sellers s
         JOIN users u ON s.user_id = u.id
         LEFT JOIN shops sh ON sh.seller_id = s.id
         LEFT JOIN seller_settings ss ON ss.seller_id = s.id
         ORDER BY s.created_at DESC`
      );

      // Map to frontend SellerRow interface
      const sellers = result.rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        name: row.shop_name || "ร้านค้าใหม่",
        tax_id: null,
        status: row.status,
        business_type: null,
        approved_at: row.status === "approved" ? row.updated_at : null,
        created_at: row.created_at,
        owner_id: row.user_id,
        owner_name: row.user_name,
        owner_email: row.user_email,
        shop_count: row.shop_id ? 1 : 0,
        product_count: row.shop_product_count || 0,
      }));

      res.json({
        success: true,
        data: sellers,
      });
    } catch (err) {
      console.error("[seller] admin list error:", err);
      res.status(500).json({
        success: false,
        error: { code: "DB_ERROR", message: "Failed to fetch sellers" },
      });
    }
  });

  // ── PATCH /api/admin/sellers/:id/status ───────────────────────────────
  // Update seller status (approve, reject, suspend)
  // Uses a PostgreSQL transaction for atomicity.
  // On approval: promotes user.role to 'seller' (unless owner/admin/staff).
  // Records audit log entry for every status change.
  app.patch("/api/admin/sellers/:id/status", requireAuth, async (req: Request, res: Response) => {
    const client = await getClient();
    try {
      const userId = req.user!.userId;
      const sellerId = req.params.id;
      const { status, reason } = req.body;

      // Validate status value — canonical set
      const validStatuses = ["approved", "rejected", "pending", "suspended"];
      if (!status || !validStatuses.includes(status)) {
        res.status(400).json({
          success: false,
          error: {
            code: "VALIDATION_ERROR",
            message: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
          },
        });
        return;
      }

      await client.query("BEGIN");

      // Verify user has admin permissions (within transaction)
      const userResult = await client.query(
        "SELECT role FROM users WHERE id = $1",
        [userId]
      );

      if (userResult.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(401).json({
          success: false,
          error: { code: "UNAUTHORIZED", message: "User not found" },
        });
        return;
      }

      const userRole = userResult.rows[0].role;
      if (!["owner", "admin"].includes(userRole)) {
        await client.query("ROLLBACK");
        res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "Only owner or admin can approve/reject sellers" },
        });
        return;
      }

      // Check if seller exists (within transaction, with row lock)
      const sellerResult = await client.query(
        "SELECT id, user_id, status FROM sellers WHERE id = $1 FOR UPDATE",
        [sellerId]
      );

      if (sellerResult.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "Seller not found" },
        });
        return;
      }

      const seller = sellerResult.rows[0];
      const previousStatus = seller.status;

      // Prevent self-approval/rejection
      if (seller.user_id === userId && (status === "approved" || status === "rejected")) {
        await client.query("ROLLBACK");
        res.status(403).json({
          success: false,
          error: { code: "SELF_ACTION_FORBIDDEN", message: "Cannot approve/reject yourself" },
        });
        return;
      }

      // Idempotency: if seller already has the requested status, return success
      if (previousStatus === status) {
        await client.query("COMMIT");
        res.json({
          success: true,
          data: {
            seller: { id: sellerId, status },
            message: `Seller already ${status}`,
          },
        });
        return;
      }

      // Update seller status
      await client.query(
        "UPDATE sellers SET status = $1, updated_at = NOW() WHERE id = $2",
        [status, sellerId]
      );

      // On approval: promote user.role to 'seller' (unless already owner/admin/staff)
      let promotedRole: string | null = null;
      if (status === "approved") {
        const targetUser = await client.query(
          "SELECT role FROM users WHERE id = $1",
          [seller.user_id]
        );
        const targetRole = targetUser.rows[0]?.role;
        if (targetRole && !["owner", "admin", "staff", "seller"].includes(targetRole)) {
          await client.query(
            "UPDATE users SET role = 'seller', updated_at = NOW() WHERE id = $1",
            [seller.user_id]
          );
          promotedRole = "seller";
        } else if (targetRole === "seller") {
          promotedRole = "seller"; // already seller
        } else {
          promotedRole = targetRole; // owner/admin/staff — keep their role
        }
      }

      // On rejection: store rejection reason in seller_settings
      if (status === "rejected" && reason) {
        await client.query(
          `UPDATE seller_settings
           SET settings = jsonb_set(COALESCE(settings, '{}'), '{rejectionReason}', $1::jsonb),
               updated_at = NOW()
           WHERE seller_id = $2`,
          [JSON.stringify(reason), sellerId]
        );
      }

      // Record audit log entry
      try {
        await client.query(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, old_value, new_value, details)
           VALUES ($1, $2, 'seller', $3, $4, $5, $6)`,
          [
            userId,
            `SELLER_${status.toUpperCase()}`,
            sellerId,
            JSON.stringify({ status: previousStatus }),
            JSON.stringify({ status }),
            JSON.stringify({
              previousStatus,
              newStatus: status,
              promotedRole,
              reason: reason || null,
            }),
          ]
        );
      } catch (auditErr: any) {
        // Audit log failure should not block the operation
        console.warn("[seller] audit log write failed:", auditErr?.message);
      }

      // Invalidate cached profile for the target user so /api/auth/me returns fresh role
      invalidateCachedProfile(seller.user_id);

      await client.query("COMMIT");

      console.log(`[seller] ${status}: seller ${sellerId} (user ${seller.user_id}) by admin ${userId} [${previousStatus} → ${status}]${promotedRole ? ` role→${promotedRole}` : ""}`);

      res.json({
        success: true,
        data: {
          seller: {
            id: sellerId,
            status,
            previousStatus,
          },
          user: {
            id: seller.user_id,
            role: promotedRole,
          },
        },
      });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[seller] admin status update error:", err);
      res.status(500).json({
        success: false,
        error: { code: "DB_ERROR", message: "Failed to update seller status" },
      });
    } finally {
      client.release();
    }
  });
}