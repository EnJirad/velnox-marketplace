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
import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Reviewers that may act on seller applications. */
const REVIEWER_ROLES = ["owner", "admin", "staff"];

/** Structured reason codes — must mirror packages/shared/src/lib/verification-reasons.ts. */
const REVIEW_REASON_CODES = [
  "id_card_unclear", "id_card_incomplete", "selfie_unclear", "selfie_missing_id",
  "document_expired", "applicant_mismatch", "store_incomplete", "contact_incomplete",
  "address_incomplete", "duplicate_account", "policy_violation", "other",
];

/** Identity evidence purposes required before an application can be submitted. */
const REQUIRED_IDENTITY_PURPOSES = ["id_card", "id_card_back", "selfie_id"];

// Private evidence client — identity documents are never served from a public URL.
const reviewR2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
  },
});
const reviewBucket = process.env.R2_BUCKET || "";
const reviewPublicDomain = (process.env.R2_PUBLIC_DOMAIN || "").replace(/\/+$/, "");

/** Normalize a stored evidence reference (public URL or bare key) to an R2 key. */
function toObjectKey(ref: string): string {
  if (!ref) return "";
  if (reviewPublicDomain && ref.startsWith(reviewPublicDomain)) {
    return ref.slice(reviewPublicDomain.length).replace(/^\/+/, "");
  }
  if (/^https?:\/\//i.test(ref)) {
    try { return decodeURIComponent(new URL(ref).pathname.replace(/^\/+/, "")); } catch { return ref; }
  }
  return ref;
}

/** Purpose encoded in an evidence filename: {purpose}_{timestamp}.{ext} */
function purposeOfKey(key: string): string {
  const filename = key.split("/").pop() || "";
  return filename.split("_")[0] || "other";
}

export function setupSellerRoutes(app: Express): void {
  // ── POST /api/seller/apply ─────────────────────────────────────────────
  // Submit a seller application. Creates a seller record with status "pending"
  // and optionally creates a shop record if shopName is provided.
  app.post("/api/seller/apply", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const {
        shopName,
        shopDescription,
        shopCategory,
        shopAddress,
        // Applicant info (stored in seller_settings)
        firstName,
        lastName,
        phone,
        // Identity verification — durable R2 object references, never File objects
        idNumber,
        idCardFrontUrl,
        idCardBackUrl,
        selfieUrl,
        // Optional: full ordered evidence list from the onboarding document uploader
        identityEvidence,
      } = req.body;

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

      // ── Backend validation of required identity data (spec §13) ────────
      // Frontend validation is not sufficient: an application may not be
      // submitted without the three identity documents persisted through the
      // secure media/R2 architecture.
      const evidenceRefs: string[] = [];
      for (const ref of [idCardFrontUrl, idCardBackUrl, selfieUrl]) {
        if (typeof ref === "string" && ref.trim()) evidenceRefs.push(toObjectKey(ref.trim()));
      }
      if (Array.isArray(identityEvidence)) {
        for (const ref of identityEvidence) {
          if (typeof ref === "string" && ref.trim()) {
            const key = toObjectKey(ref.trim());
            if (!evidenceRefs.includes(key)) evidenceRefs.push(key);
          }
        }
      }

      if (!firstName?.trim() || !lastName?.trim() || !phone?.trim()) {
        res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "Applicant first name, last name and phone are required" },
        });
        return;
      }

      const purposes = evidenceRefs.map(purposeOfKey);
      const missing = REQUIRED_IDENTITY_PURPOSES.filter((p) => !purposes.includes(p));
      if (missing.length > 0) {
        res.status(400).json({
          success: false,
          error: {
            code: "IDENTITY_EVIDENCE_REQUIRED",
            message: `Missing required identity documents: ${missing.join(", ")}`,
          },
        });
        return;
      }

      // Ownership — every evidence key must be a persisted media row owned by
      // this authenticated user. A seller can never attach someone else's file.
      const ownedRes = await query(
        "SELECT key FROM media WHERE uploaded_by = $1 AND key = ANY($2::text[])",
        [userId, evidenceRefs],
      );
      const ownedKeys = new Set(ownedRes.rows.map((r: { key: string }) => r.key));
      const foreign = evidenceRefs.filter((k) => !ownedKeys.has(k));
      if (foreign.length > 0) {
        console.warn(`[seller] apply rejected — unowned evidence for user ${userId}`);
        res.status(403).json({
          success: false,
          error: { code: "FORBIDDEN", message: "Identity documents do not belong to this account" },
        });
        return;
      }

      // ── Submission integrity (spec §9) ──────────────────────────────
      // Everything below runs in ONE transaction. The seller is only moved to
      // `pending` after the evidence references, the verification submission and
      // the application data are all persisted. Any failure rolls everything
      // back — there is no half-submitted state and no local-only "pending".
      const client = await getClient();
      let sellerId: string | null = null;
      let previousStatus = "";
      try {
        await client.query("BEGIN");

        const existingSeller = await client.query(
          "SELECT id, status FROM sellers WHERE user_id = $1 FOR UPDATE",
          [userId]
        );

        if (existingSeller.rows.length > 0) {
          const existing = existingSeller.rows[0];
          previousStatus = existing.status;
          if (existing.status === "pending" || existing.status === "under_review") {
            await client.query("ROLLBACK");
            res.status(409).json({
              success: false,
              error: { code: "ALREADY_APPLIED", message: "You already have a pending seller application" },
            });
            return;
          }
          if (existing.status === "approved") {
            await client.query("ROLLBACK");
            res.status(409).json({
              success: false,
              error: { code: "ALREADY_SELLER", message: "You are already an approved seller" },
            });
            return;
          }
          // rejected / needs_correction / suspended → resubmission
          await client.query(
            "UPDATE sellers SET status = 'pending', updated_at = NOW() WHERE id = $1",
            [existing.id]
          );
          sellerId = existing.id;
        } else {
          const created = await client.query(
            "INSERT INTO sellers (user_id, status) VALUES ($1, 'pending') RETURNING id",
            [userId]
          );
          sellerId = created.rows[0].id;
          previousStatus = "none";
        }

        // ── Shop (upsert — a resubmission must not create a duplicate shop) ──
        const shopAddr = shopAddress || {};
        const existingShop = await client.query("SELECT id FROM shops WHERE seller_id = $1", [sellerId]);
        if (existingShop.rows.length > 0) {
          await client.query(
            `UPDATE shops SET name = $1, description = $2, category = $3,
                    address_line1 = $4, address_line2 = $5, subdistrict = $6, district = $7,
                    city = $8, state = $9, postal_code = $10, country = $11, phone = $12, updated_at = NOW()
             WHERE id = $13`,
            [
              trimmedShopName,
              shopDescription?.trim()?.substring(0, 2000) || null,
              shopCategory?.trim()?.substring(0, 100) || null,
              shopAddr.line1?.trim()?.substring(0, 255) || null,
              shopAddr.line2?.trim()?.substring(0, 255) || null,
              shopAddr.subdistrict?.trim()?.substring(0, 100) || null,
              shopAddr.district?.trim()?.substring(0, 100) || null,
              shopAddr.city?.trim()?.substring(0, 100) || null,
              shopAddr.state?.trim()?.substring(0, 100) || null,
              shopAddr.postalCode?.trim()?.substring(0, 10) || null,
              shopAddr.country?.trim()?.substring(0, 5) || "TH",
              phone?.trim()?.substring(0, 20) || null,
              existingShop.rows[0].id,
            ]
          );
        } else {
          const baseSlug = trimmedShopName
            .toLowerCase()
            .replace(/[^a-z0-9\s-]/g, "")
            .replace(/\s+/g, "-")
            .replace(/-+/g, "-")
            .substring(0, 100) || `shop-${Date.now()}`;

          let slug = baseSlug;
          let suffix = 1;
          while (true) {
            const slugCheck = await client.query("SELECT id FROM shops WHERE slug = $1", [slug]);
            if (slugCheck.rows.length === 0) break;
            slug = `${baseSlug}-${suffix}`;
            suffix++;
          }

          await client.query(
            `INSERT INTO shops (seller_id, name, slug, description, category,
              address_line1, address_line2, subdistrict, district, city, state, postal_code, country, phone, email)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [
              sellerId, trimmedShopName, slug,
              shopDescription?.trim()?.substring(0, 2000) || null,
              shopCategory?.trim()?.substring(0, 100) || null,
              shopAddr.line1?.trim()?.substring(0, 255) || null,
              shopAddr.line2?.trim()?.substring(0, 255) || null,
              shopAddr.subdistrict?.trim()?.substring(0, 100) || null,
              shopAddr.district?.trim()?.substring(0, 100) || null,
              shopAddr.city?.trim()?.substring(0, 100) || null,
              shopAddr.state?.trim()?.substring(0, 100) || null,
              shopAddr.postalCode?.trim()?.substring(0, 10) || null,
              shopAddr.country?.trim()?.substring(0, 5) || "TH",
              phone?.trim()?.substring(0, 20) || null,
              null, // email comes from the user account, not settable here
            ]
          );
        }

        // ── Applicant + identity evidence (upsert, stale review state cleared) ──
        const settings: Record<string, unknown> = { shopName: trimmedShopName };
        if (firstName?.trim()) settings.firstName = firstName.trim().substring(0, 100);
        if (lastName?.trim()) settings.lastName = lastName.trim().substring(0, 100);
        if (phone?.trim()) settings.phone = phone.trim().substring(0, 20);
        if (idNumber?.trim()) settings.idNumber = idNumber.trim().substring(0, 20);
        // Durable R2 object references — never File objects or local object URLs
        if (idCardFrontUrl) settings.idCardFrontUrl = toObjectKey(String(idCardFrontUrl));
        if (idCardBackUrl) settings.idCardBackUrl = toObjectKey(String(idCardBackUrl));
        if (selfieUrl) settings.selfieUrl = toObjectKey(String(selfieUrl));
        settings.identityEvidence = evidenceRefs;
        settings.submittedAt = new Date().toISOString();
        // A fresh submission supersedes the previous review decision.
        delete settings.rejectionReason;
        delete settings.correctionReason;

        await client.query(
          `INSERT INTO seller_settings (seller_id, settings) VALUES ($1, $2::jsonb)
           ON CONFLICT (seller_id)
           DO UPDATE SET settings = COALESCE(seller_settings.settings, '{}'::jsonb) || $2::jsonb, updated_at = NOW()`,
          [sellerId, JSON.stringify(settings)]
        );

        // ── Verification submission (evidence persisted first) ──────────
        await client.query(
          `INSERT INTO seller_verifications (seller_id, status, verification_type, evidence_urls, submitted_at)
           VALUES ($1, 'pending', 'identity', $2::jsonb, NOW())
           ON CONFLICT (seller_id) WHERE status = 'pending'
           DO UPDATE SET evidence_urls = $2::jsonb, submitted_at = NOW(), updated_at = NOW()`,
          [sellerId, JSON.stringify(evidenceRefs)]
        );

        // ── Only now: pending verification ─────────────────────────────
        await client.query(
          "UPDATE sellers SET verification_status = 'pending', updated_at = NOW() WHERE id = $1",
          [sellerId]
        );

        // ── Review history ─────────────────────────────────────────────
        await client.query(
          `INSERT INTO seller_review_history
             (seller_id, previous_status, new_status, action, reviewer_id)
           VALUES ($1, $2, 'pending', $3, $4)`,
          [sellerId, previousStatus, previousStatus === "none" ? "submitted" : "resubmitted", userId]
        );

        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK").catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }

      // Notification — non-fatal, after commit
      try {
        await query(
          `INSERT INTO notifications (user_id, type, title, message, data)
           VALUES ($1, 'seller_application_submitted', $2, $3, $4)`,
          [
            userId,
            "ได้รับใบสมัครเปิดร้านค้าแล้ว",
            "ทีมงาน Velnox จะตรวจสอบใบสมัครและเอกสารยืนยันตัวตนของคุณ",
            JSON.stringify({ sellerId, status: "pending" }),
          ]
        );
      } catch (notifErr) {
        console.warn("[seller] submit notification failed (non-fatal):", notifErr);
      }

      invalidateCachedProfile(userId);
      console.log("[seller] application submitted:", sellerId);

      res.json({
        success: true,
        data: {
          seller: {
            id: sellerId,
            status: "pending",
            evidenceCount: evidenceRefs.length,
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
        `SELECT s.id, s.status, s.verification_status, s.created_at,
                sh.name as shop_name, sh.slug as shop_slug,
                ss.settings as seller_settings,
                (SELECT sv.submitted_at FROM seller_verifications sv
                  WHERE sv.seller_id = s.id
                  ORDER BY sv.created_at DESC LIMIT 1) AS verification_submitted_at
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

      // Review history is applicant-visible (their own application only).
      const history = await query(
        `SELECT h.action, h.previous_status, h.new_status, h.reason_code, h.reason, h.created_at
         FROM seller_review_history h
         WHERE h.seller_id = $1
         ORDER BY h.created_at DESC
         LIMIT 20`,
        [row.id],
      );

      res.json({
        success: true,
        data: {
          id: row.id,
          status: row.status,
          verificationStatus: row.verification_status ?? null,
          shopName: row.shop_name || null,
          shopSlug: row.shop_slug || null,
          createdAt: row.created_at,
          updatedAt: row.updated_at || null,
          submittedAt: row.verification_submitted_at || settings.submittedAt || null,
          rejectionReason: settings.rejectionReason || null,
          rejectionReasonCode: settings.rejectionReasonCode || null,
          correctionReason: settings.correctionReason || null,
          correctionReasonCode: settings.correctionReasonCode || null,
          applicantInfo: {
            firstName: settings.firstName || null,
            lastName: settings.lastName || null,
            phone: settings.phone || null,
          },
          // Only the count is exposed — identity documents are private.
          identityEvidenceCount: Array.isArray(settings.identityEvidence) ? settings.identityEvidence.length : 0,
          hasIdentityVerification: !!(settings.idCardFrontUrl || settings.selfieUrl),
          reviewHistory: history.rows.map((h: Record<string, unknown>) => ({
            action: h.action,
            previousStatus: h.previous_status,
            newStatus: h.new_status,
            reasonCode: h.reason_code,
            reason: h.reason,
            createdAt: h.created_at,
          })),
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
        `SELECT s.id, s.status, s.verification_status, s.verified_at, s.created_at, s.updated_at,
                sh.id as shop_id, sh.name as shop_name, sh.slug as shop_slug,
                sh.description as shop_description, sh.logo as shop_logo,
                sh.cover as shop_cover, sh.rating as shop_rating,
                sh.product_count as shop_product_count,
                sh.category as shop_category,
                sh.address_line1, sh.address_line2, sh.subdistrict, sh.district,
                sh.city, sh.state, sh.postal_code, sh.country, sh.phone as shop_phone, sh.email as shop_email,
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
      const shop = row.shop_id
        ? {
            id: row.shop_id,
            name: row.shop_name,
            slug: row.shop_slug,
            description: row.shop_description,
            logo: row.shop_logo,
            cover: row.shop_cover,
            rating: row.shop_rating ? parseFloat(row.shop_rating) : null,
            productCount: row.shop_product_count || 0,
            category: row.shop_category || null,
            address: {
              line1: row.address_line1 || null,
              line2: row.address_line2 || null,
              subdistrict: row.subdistrict || null,
              district: row.district || null,
              city: row.city || null,
              state: row.state || null,
              postalCode: row.postal_code || null,
              country: row.country || "TH",
            },
            phone: row.shop_phone || null,
            email: row.shop_email || null,
          }
        : null;

      // Return shops as array to match the SellerProfile TypeScript interface.
      res.json({
        success: true,
        data: {
          seller: {
            id: row.id,
            status: row.status,
            verificationStatus: row.verification_status ?? "unverified",
            verifiedAt: row.verified_at ?? null,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
          shops: shop ? [shop] : [],
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

  // ── PATCH /api/seller/shop ────────────────────────────────────────────
  // Update shop profile (ownership verified server-side)
  app.patch("/api/seller/shop", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const {
        name,
        description,
        category,
        address,
        phone,
        email,
        logo,
        cover,
      } = req.body;

      // Verify ownership: get seller → shop
      const ownership = await query(
        `SELECT sh.id as shop_id
         FROM shops sh
         JOIN sellers s ON s.id = sh.seller_id
         WHERE s.user_id = $1`,
        [userId]
      );

      if (ownership.rows.length === 0) {
        res.status(404).json({
          success: false,
          error: { code: "NOT_FOUND", message: "No shop found for this seller" },
        });
        return;
      }

      const shopId = ownership.rows[0].shop_id;

      // Build dynamic UPDATE
      const sets: string[] = [];
      const vals: unknown[] = [];
      let idx = 1;

      if (typeof name === "string" && name.trim()) {
        sets.push(`name = $${idx++}`);
        vals.push(name.trim().substring(0, 255));
      }
      if (typeof description === "string" || description === null) {
        sets.push(`description = $${idx++}`);
        vals.push(description?.trim()?.substring(0, 2000) || null);
      }
      if (typeof category === "string" || category === null) {
        sets.push(`category = $${idx++}`);
        vals.push(category?.trim()?.substring(0, 100) || null);
      }
      if (address && typeof address === "object") {
        sets.push(`address_line1 = $${idx++}`);
        vals.push(address.line1?.trim()?.substring(0, 255) || null);
        sets.push(`address_line2 = $${idx++}`);
        vals.push(address.line2?.trim()?.substring(0, 255) || null);
        sets.push(`subdistrict = $${idx++}`);
        vals.push(address.subdistrict?.trim()?.substring(0, 100) || null);
        sets.push(`district = $${idx++}`);
        vals.push(address.district?.trim()?.substring(0, 100) || null);
        sets.push(`city = $${idx++}`);
        vals.push(address.city?.trim()?.substring(0, 100) || null);
        sets.push(`state = $${idx++}`);
        vals.push(address.state?.trim()?.substring(0, 100) || null);
        sets.push(`postal_code = $${idx++}`);
        vals.push(address.postalCode?.trim()?.substring(0, 10) || null);
        sets.push(`country = $${idx++}`);
        vals.push(address.country?.trim()?.substring(0, 5) || "TH");
      }
      if (typeof phone === "string" || phone === null) {
        sets.push(`phone = $${idx++}`);
        vals.push(phone?.trim()?.substring(0, 20) || null);
      }
      if (typeof email === "string" || email === null) {
        sets.push(`email = $${idx++}`);
        vals.push(email?.trim()?.substring(0, 255) || null);
      }
      if (typeof logo === "string" || logo === null) {
        sets.push(`logo = $${idx++}`);
        vals.push(logo || null);
      }
      if (typeof cover === "string" || cover === null) {
        sets.push(`cover = $${idx++}`);
        vals.push(cover || null);
      }

      if (sets.length === 0) {
        res.status(400).json({
          success: false,
          error: { code: "VALIDATION_ERROR", message: "No fields to update" },
        });
        return;
      }

      sets.push(`updated_at = NOW()`);
      vals.push(shopId);

      await query(
        `UPDATE shops SET ${sets.join(", ")} WHERE id = $${idx}`,
        vals,
      );

      // Re-fetch updated shop
      const updated = await query(
        `SELECT id, name, slug, description, logo, cover, rating, product_count,
                category, address_line1, address_line2, subdistrict, district,
                city, state, postal_code, country, phone, email
         FROM shops WHERE id = $1`,
        [shopId],
      );

      const r = updated.rows[0];
      res.json({
        success: true,
        data: {
          id: r.id,
          name: r.name,
          slug: r.slug,
          description: r.description,
          logo: r.logo,
          cover: r.cover,
          rating: r.rating ? parseFloat(r.rating) : null,
          productCount: r.product_count || 0,
          category: r.category || null,
          address: {
            line1: r.address_line1 || null,
            line2: r.address_line2 || null,
            subdistrict: r.subdistrict || null,
            district: r.district || null,
            city: r.city || null,
            state: r.state || null,
            postalCode: r.postal_code || null,
            country: r.country || "TH",
          },
          phone: r.phone || null,
          email: r.email || null,
        },
      });
    } catch (err) {
      console.error("[seller] shop update error:", err);
      res.status(500).json({
        success: false,
        error: { code: "DB_ERROR", message: "Failed to update shop profile" },
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

      // Status filter + free-text search (applicant / store). The status set is
      // the canonical review lifecycle — no invented statuses.
      const { status, q } = req.query as { status?: string; q?: string };
      const params: unknown[] = [];
      const where: string[] = [];
      if (status && status !== "all") {
        params.push(status);
        where.push(`s.status = $${params.length}`);
      }
      if (q && q.trim()) {
        params.push(`%${q.trim()}%`);
        where.push(`(sh.name ILIKE $${params.length} OR u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
      }

      // Fetch all sellers with user and shop information
      // Returns data matching the frontend SellerRow interface
      const result = await query(
        `SELECT s.id, s.status, s.verification_status, s.created_at, s.updated_at,
                u.id as user_id, u.name as user_name, u.email as user_email,
                sh.id as shop_id, sh.name as shop_name, sh.product_count as shop_product_count,
                ss.settings as seller_settings,
                (SELECT sv.submitted_at FROM seller_verifications sv
                  WHERE sv.seller_id = s.id ORDER BY sv.created_at DESC LIMIT 1) AS submitted_at,
                (SELECT COUNT(*) FROM seller_verifications sv2 WHERE sv2.seller_id = s.id) AS application_revision
         FROM sellers s
         JOIN users u ON s.user_id = u.id
         LEFT JOIN shops sh ON sh.seller_id = s.id
         LEFT JOIN seller_settings ss ON ss.seller_id = s.id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY s.created_at DESC`,
        params,
      );

      // Map to frontend SellerRow interface
      const sellers = result.rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        name: row.shop_name || "ร้านค้าใหม่",
        tax_id: null,
        status: row.status,
        verification_status: row.verification_status,
        business_type: null,
        approved_at: row.status === "approved" ? row.updated_at : null,
        created_at: row.created_at,
        updated_at: row.updated_at,
        submitted_at: row.submitted_at,
        application_revision: Number(row.application_revision || 0),
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
      const { status, reason, reasonCode, note } = req.body;

      // Validate status value — canonical set (includes review lifecycle)
      const validStatuses = ["approved", "rejected", "pending", "under_review", "needs_correction", "suspended"];
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

      // Structured reasons are mandatory for correction / rejection so the
      // applicant always receives a machine-readable, translatable reason.
      const code = typeof reasonCode === "string" ? reasonCode.trim() : "";
      if (status === "rejected" || status === "needs_correction" || status === "suspended") {
        if (!code || !REVIEW_REASON_CODES.includes(code)) {
          res.status(400).json({
            success: false,
            error: { code: "REASON_REQUIRED", message: "A structured reason code is required" },
          });
          return;
        }
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

      // ── State-machine validation ────────────────────────────────────
      // Only documented transitions are permitted. Frontend cannot grant
      // privileges or skip steps; the backend is the sole authority.
      const VALID_TRANSITIONS: Record<string, string[]> = {
        pending: ["under_review", "rejected"],
        under_review: ["approved", "needs_correction", "rejected", "suspended"],
        needs_correction: ["under_review", "rejected"],
        approved: ["suspended"],
        rejected: ["pending"],   // re-application after rejection
        suspended: ["pending"],  // re-activation
      };
      const allowed = VALID_TRANSITIONS[previousStatus];
      if (!allowed || !allowed.includes(status)) {
        await client.query("ROLLBACK");
        res.status(400).json({
          success: false,
          error: {
            code: "INVALID_TRANSITION",
            message: `Cannot transition seller from "${previousStatus}" to "${status}"`,
          },
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

      // On rejection / correction / suspension: persist the applicant-visible
      // structured reason (code + human text) in seller_settings.
      if (status === "rejected" || status === "needs_correction" || status === "suspended") {
        const reasonKey = status === "rejected" ? "rejectionReason" : status === "needs_correction" ? "correctionReason" : "suspensionReason";
        const codeKey = status === "rejected" ? "rejectionReasonCode" : status === "needs_correction" ? "correctionReasonCode" : "suspensionReasonCode";
        await client.query(
          `UPDATE seller_settings
           SET settings = jsonb_set(
                 jsonb_set(COALESCE(settings, '{}'), ARRAY[$1], to_jsonb($2::text)),
                 ARRAY[$3], to_jsonb($4::text)
               ),
               updated_at = NOW()
           WHERE seller_id = $5`,
          [reasonKey, reason || "", codeKey, code, sellerId]
        );
      }
      // A correction request / rejection invalidates any standing verification.
      if (status === "needs_correction" || status === "rejected" || status === "suspended") {
        await client.query(
          `UPDATE sellers
           SET verification_status = CASE WHEN $2 = 'suspended' THEN 'suspended' ELSE 'unverified' END,
               updated_at = NOW()
           WHERE id = $1`,
          [sellerId, status]
        );
        // Keep the verification record in sync when one exists.
        await client.query(
          `UPDATE seller_verifications
           SET status = CASE WHEN $2 = 'suspended' THEN 'suspended' ELSE 'rejected' END,
               review_reason_code = $3, review_note = $4, reviewed_at = NOW(), reviewed_by = $5,
               rejection_reason = CASE WHEN $2 = 'rejected' THEN $6 ELSE rejection_reason END,
               suspension_reason = CASE WHEN $2 = 'suspended' THEN $6 ELSE suspension_reason END,
               updated_at = NOW()
           WHERE seller_id = $1 AND status IN ('pending','unverified')`,
          [sellerId, status, code, note || null, userId, reason || null]
        );
      }

      // ── Review history / audit trail ───────────────────────────────
      await client.query(
        `INSERT INTO seller_review_history
           (seller_id, previous_status, new_status, action, reason_code, reason, note, reviewer_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          sellerId,
          previousStatus,
          status,
          status === "under_review" ? "under_review" : status === "needs_correction" ? "needs_correction" : status,
          code || null,
          reason || null,
          note || null,
          userId,
        ]
      );

      // Notifications for every lifecycle change the applicant cares about
      if (["approved", "rejected", "needs_correction", "under_review", "suspended"].includes(status)) {
        const copy: Record<string, { title: string; message: string }> = {
          approved: { title: "คำขอเปิดร้านค้าได้รับอนุมัติ", message: "คุณสามารถเริ่มขายสินค้าได้แล้ว" },
          rejected: { title: "คำขอเปิดร้านค้าถูกปฏิเสธ", message: `เหตุผล: ${reason || code}` },
          needs_correction: { title: "คำขอเปิดร้านค้าต้องแก้ไขข้อมูล", message: `กรุณาแก้ไข: ${reason || code}` },
          under_review: { title: "ใบสมัครอยู่ระหว่างการตรวจสอบ", message: "ทีมงาน Velnox กำลังตรวจสอบใบสมัครของคุณ" },
          suspended: { title: "บัญชีร้านค้าถูกระงับ", message: `เหตุผล: ${reason || code}` },
        };
        const notificationType = `seller_${status}`;
        const notificationCopy = copy[status] ?? { title: "อัปเดตสถานะร้านค้า", message: reason || code };
        try {
          await client.query(
            `INSERT INTO notifications (user_id, type, title, message, data)
             VALUES ($1, $2, $3, $4, $5)`,
            [
              seller.user_id,
              notificationType,
              notificationCopy.title,
              notificationCopy.message,
              JSON.stringify({ sellerId, status, reasonCode: code || null, reason: reason || null }),
            ]
          );
        } catch (notifErr: any) {
          console.warn("[seller] notification write failed (non-fatal):", notifErr?.message);
        }
      }

      // Invalidate cached profile for the target user so /api/auth/me returns fresh role
      invalidateCachedProfile(seller.user_id);

      await client.query("COMMIT");

      // Record audit log AFTER commit — must not block or ROLLBACK the approval
      try {
        await query(
          `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details)
           VALUES ($1, $2, 'seller', $3, $4)`,
          [
            userId,
            `SELLER_${status.toUpperCase()}`,
            sellerId,
            JSON.stringify({
              previousStatus,
              newStatus: status,
              promotedRole,
              reasonCode: code || null,
              reason: reason || null,
            }),
          ]
        );
      } catch (auditErr: any) {
        console.warn("[seller] audit log write failed (non-fatal):", auditErr?.message);
      }

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

  // ── GET /api/admin/sellers/:id/application ────────────────────────────
  // Reviewer-only full application detail: applicant, store, address and
  // identity documents. Identity images are returned as SHORT-LIVED SIGNED R2
  // URLs generated after the authorization check — never public bucket URLs.
  app.get("/api/admin/sellers/:id/application", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const userResult = await query("SELECT role FROM users WHERE id = $1", [userId]);
      const userRole = userResult.rows[0]?.role as string | undefined;
      if (!userRole || !REVIEWER_ROLES.includes(userRole)) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Admin access required" } });
        return;
      }

      const sellerId = req.params.id;
      const appRes = await query(
        `SELECT s.id, s.status, s.verification_status, s.verified_at, s.created_at, s.updated_at,
                u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone,
                sh.name AS shop_name, sh.slug AS shop_slug, sh.description AS shop_description,
                sh.category AS shop_category, sh.logo AS shop_logo, sh.cover AS shop_cover,
                sh.address_line1, sh.address_line2, sh.subdistrict, sh.district, sh.city,
                sh.state, sh.postal_code, sh.country, sh.phone AS shop_phone,
                ss.settings AS seller_settings,
                sv.id AS verification_id, sv.status AS verification_status_record,
                sv.verification_type, sv.evidence_urls, sv.submitted_at, sv.reviewed_at,
                sv.rejection_reason, sv.suspension_reason, sv.review_reason_code, sv.review_note
         FROM sellers s
         JOIN users u ON u.id = s.user_id
         LEFT JOIN shops sh ON sh.seller_id = s.id
         LEFT JOIN seller_settings ss ON ss.seller_id = s.id
         LEFT JOIN LATERAL (
           SELECT * FROM seller_verifications sv2
           WHERE sv2.seller_id = s.id
           ORDER BY sv2.created_at DESC LIMIT 1
         ) sv ON TRUE
         WHERE s.id = $1`,
        [sellerId],
      );

      if (appRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Seller not found" } });
        return;
      }

      const row = appRes.rows[0];
      const settings = row.seller_settings || {};
      const refs: string[] = Array.isArray(row.evidence_urls) ? row.evidence_urls : [];

      // Reviewer-only signed access to the private identity documents.
      const documents = await Promise.all(
        refs.map(async (ref: string) => {
          const key = toObjectKey(ref);
          let url: string | null = null;
          try {
            url = await getSignedUrl(
              reviewR2,
              new GetObjectCommand({ Bucket: reviewBucket, Key: key }),
              { expiresIn: 300 },
            );
          } catch (signErr) {
            console.warn(`[seller] reviewer evidence sign failed key=${key}`, signErr);
          }
          return { key, purpose: purposeOfKey(key), filename: key.split("/").pop() || key, url, expiresIn: 300 };
        }),
      );

      const history = await query(
        `SELECT h.id, h.previous_status, h.new_status, h.action, h.reason_code, h.reason,
                h.note, h.created_at, u.name AS reviewer_name
         FROM seller_review_history h
         LEFT JOIN users u ON u.id = h.reviewer_id
         WHERE h.seller_id = $1
         ORDER BY h.created_at DESC
         LIMIT 100`,
        [sellerId],
      );

      res.json({
        success: true,
        data: {
          seller: {
            id: row.id,
            status: row.status,
            verificationStatus: row.verification_status,
            verifiedAt: row.verified_at,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          },
          applicant: {
            name: row.owner_name,
            email: row.owner_email,
            phone: settings.phone || row.owner_phone || null,
            firstName: settings.firstName || null,
            lastName: settings.lastName || null,
            // The national ID is reviewer-only data and is never returned to
            // any customer-facing surface.
            idNumber: settings.idNumber || null,
          },
          store: {
            name: row.shop_name,
            slug: row.shop_slug,
            description: row.shop_description,
            category: row.shop_category,
            logo: row.shop_logo,
            cover: row.shop_cover,
          },
          address: {
            line1: row.address_line1,
            line2: row.address_line2,
            subdistrict: row.subdistrict,
            district: row.district,
            city: row.city,
            state: row.state,
            postalCode: row.postal_code,
            country: row.country,
            phone: row.shop_phone,
          },
          verification: {
            id: row.verification_id,
            type: row.verification_type,
            status: row.verification_status_record,
            submittedAt: row.submitted_at,
            reviewedAt: row.reviewed_at,
            rejectionReason: row.rejection_reason,
            suspensionReason: row.suspension_reason,
            reviewReasonCode: row.review_reason_code,
            reviewNote: row.review_note,
          },
          documents,
          history: history.rows,
        },
      });
    } catch (err) {
      console.error("[seller] admin application detail error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch application" } });
    }
  });
}