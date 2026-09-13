/**
 * Verification API routes — dual verification system.
 *
 * Seller Verification: identity/business verification of the seller/shop.
 * Product Verification: independent verification of each product.
 *
 * V eligibility = seller verified AND product verified.
 * All verification decisions are server-side enforced.
 */

import type { Express, Request, Response } from "express";
import { query } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

export function registerVerificationRoutes(app: Express) {

  // ════════════════════════════════════════════════════════════════════════
  // SELLER VERIFICATION
  // ════════════════════════════════════════════════════════════════════════

  // GET /api/seller/verification — Get seller's own verification status
  app.get("/api/seller/verification", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const result = await query(
        `SELECT sv.*,
                s.verification_status AS seller_verification_status,
                s.verified_at
         FROM sellers s
         LEFT JOIN seller_verifications sv ON sv.seller_id = s.id AND sv.status IN ('pending','verified','rejected','suspended')
         WHERE s.user_id = $1
         ORDER BY sv.created_at DESC
         LIMIT 1`,
        [userId],
      );
      const row = result.rows[0] ?? null;
      res.json({ success: true, data: row });
    } catch (err) {
      console.error("[verification] seller status error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch verification status" } });
    }
  });

  // POST /api/seller/verification — Submit seller verification request
  app.post("/api/seller/verification", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { evidenceUrls, verificationType } = req.body;

      // Get seller
      const sellerRes = await query("SELECT id, verification_status FROM sellers WHERE user_id = $1", [userId]);
      if (sellerRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Seller not found" } });
      }
      const seller = sellerRes.rows[0];

      // Check if already pending
      if (seller.verification_status === "pending") {
        return res.status(409).json({ success: false, error: { code: "ALREADY_PENDING", message: "Verification already pending" } });
      }

      // Create verification request
      const verRes = await query(
        `INSERT INTO seller_verifications (seller_id, status, verification_type, evidence_urls, submitted_at)
         VALUES ($1, 'pending', $2, $3, NOW())
         ON CONFLICT (seller_id) WHERE status = 'pending'
         DO UPDATE SET evidence_urls = $3, submitted_at = NOW(), updated_at = NOW()
         RETURNING *`,
        [seller.id, verificationType || "identity", JSON.stringify(evidenceUrls || [])],
      );

      // Update seller status
      await query(
        "UPDATE sellers SET verification_status = 'pending', updated_at = NOW() WHERE id = $1",
        [seller.id],
      );

      res.json({ success: true, data: verRes.rows[0] });
    } catch (err) {
      console.error("[verification] seller submit error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to submit verification" } });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // PRODUCT VERIFICATION
  // ════════════════════════════════════════════════════════════════════════

  // GET /api/seller/products/:productId/verification — Get product verification status
  app.get("/api/seller/products/:productId/verification", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const productId = req.params.productId;

      // Verify ownership
      const ownRes = await query(
        `SELECT pv.* FROM product_verifications pv
         JOIN products p ON p.id = pv.product_id
         JOIN shops sh ON sh.id = p.shop_id
         JOIN sellers s ON s.id = sh.seller_id
         WHERE pv.product_id = $1 AND s.user_id = $2
         ORDER BY pv.created_at DESC LIMIT 1`,
        [productId, userId],
      );

      // Also get current status from products table
      const prodRes = await query(
        `SELECT p.verification_status FROM products p
         JOIN shops sh ON sh.id = p.shop_id
         JOIN sellers s ON s.id = sh.seller_id
         WHERE p.id = $1 AND s.user_id = $2`,
        [productId, userId],
      );

      if (prodRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
      }

      res.json({
        success: true,
        data: {
          verificationStatus: prodRes.rows[0].verification_status,
          latestRequest: ownRes.rows[0] ?? null,
        },
      });
    } catch (err) {
      console.error("[verification] product status error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch verification status" } });
    }
  });

  // POST /api/seller/products/:productId/verification — Submit product for verification
  app.post("/api/seller/products/:productId/verification", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const productId = req.params.productId;
      const { evidenceUrls, evidenceNotes, verificationType } = req.body;

      // Verify ownership
      const ownRes = await query(
        `SELECT p.id, p.verification_status FROM products p
         JOIN shops sh ON sh.id = p.shop_id
         JOIN sellers s ON s.id = sh.seller_id
         WHERE p.id = $1 AND s.user_id = $2`,
        [productId, userId],
      );

      if (ownRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
      }

      const product = ownRes.rows[0];

      // Check if already pending
      if (product.verification_status === "pending") {
        return res.status(409).json({ success: false, error: { code: "ALREADY_PENDING", message: "Product verification already pending" } });
      }

      // Create verification request
      const verRes = await query(
        `INSERT INTO product_verifications (product_id, status, verification_type, evidence_urls, evidence_notes, submitted_at)
         VALUES ($1, 'pending', $2, $3, $4, NOW())
         ON CONFLICT (product_id) WHERE status = 'pending'
         DO UPDATE SET evidence_urls = $3, evidence_notes = $4, submitted_at = NOW(), updated_at = NOW()
         RETURNING *`,
        [productId, verificationType || "standard", JSON.stringify(evidenceUrls || []), evidenceNotes || null],
      );

      // Update product status
      await query(
        "UPDATE products SET verification_status = 'pending', updated_at = NOW() WHERE id = $1",
        [productId],
      );

      res.json({ success: true, data: verRes.rows[0] });
    } catch (err) {
      console.error("[verification] product submit error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to submit verification" } });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // ADMIN VERIFICATION MANAGEMENT (VelCenter)
  // ════════════════════════════════════════════════════════════════════════

  // GET /api/admin/verifications — List pending verifications
  app.get("/api/admin/verifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const type = req.query.type as string; // "seller" or "product"
      const status = (req.query.status as string) || "pending";

      // Check admin/owner role (employees table has no 'status' column)
      const userRes = await query(
        "SELECT role FROM users WHERE id = $1",
        [userId],
      );
      if (userRes.rows.length === 0 || !['owner', 'admin', 'staff'].includes(userRes.rows[0].role)) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Admin access required" } });
      }

      const results: any = { sellers: [], products: [] };

      if (!type || type === "seller") {
        const sellerRes = await query(
          `SELECT sv.*, s.user_id AS owner_user_id, sh.name AS shop_name, sh.slug AS shop_slug
           FROM seller_verifications sv
           JOIN sellers s ON s.id = sv.seller_id
           LEFT JOIN shops sh ON sh.seller_id = s.id
           WHERE sv.status = $1
           ORDER BY sv.submitted_at ASC
           LIMIT 50`,
          [status],
        );
        results.sellers = sellerRes.rows;
      }

      if (!type || type === "product") {
        const productRes = await query(
          `SELECT pv.*, p.name AS product_name, p.slug AS product_slug,
                  sh.name AS shop_name, s.user_id AS seller_user_id
           FROM product_verifications pv
           JOIN products p ON p.id = pv.product_id
           JOIN shops sh ON sh.id = p.shop_id
           JOIN sellers s ON s.id = sh.seller_id
           WHERE pv.status = $1
           ORDER BY pv.submitted_at ASC
           LIMIT 50`,
          [status],
        );
        results.products = productRes.rows;
      }

      res.json({ success: true, data: results });
    } catch (err) {
      console.error("[verification] admin list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch verifications" } });
    }
  });

  // PATCH /api/admin/verifications/seller/:verificationId — Approve/reject seller verification
  app.patch("/api/admin/verifications/seller/:verificationId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { verificationId } = req.params;
      const { action, reason } = req.body; // action: "approve" | "reject" | "suspend"

      // Check admin/owner role (employees table has no 'status' column)
      const userRes = await query(
        "SELECT role FROM users WHERE id = $1",
        [userId],
      );
      if (userRes.rows.length === 0 || !['owner', 'admin', 'staff'].includes(userRes.rows[0].role)) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Admin access required" } });
      }

      const newStatus = action === "approve" ? "verified" : action === "suspend" ? "suspended" : "rejected";

      const verRes = await query(
        `UPDATE seller_verifications
         SET status = $1, reviewed_at = NOW(), reviewed_by = $2,
             rejection_reason = $3, suspension_reason = $4, updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [newStatus, userId, action === "reject" ? reason : null, action === "suspend" ? reason : null, verificationId],
      );

      if (verRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Verification not found" } });
      }

      // Update seller verification_status
      await query(
        `UPDATE sellers SET verification_status = $1, verified_at = CASE WHEN $1 = 'verified' THEN NOW() ELSE verified_at END, updated_at = NOW()
         WHERE id = (SELECT seller_id FROM seller_verifications WHERE id = $2)`,
        [newStatus, verificationId],
      );

      res.json({ success: true, data: verRes.rows[0] });
    } catch (err) {
      console.error("[verification] seller action error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to process verification" } });
    }
  });

  // PATCH /api/admin/verifications/product/:verificationId — Approve/reject product verification
  app.patch("/api/admin/verifications/product/:verificationId", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { verificationId } = req.params;
      const { action, reason } = req.body;

      // Check admin/owner role (employees table has no 'status' column)
      const userRes = await query(
        "SELECT role FROM users WHERE id = $1",
        [userId],
      );
      if (userRes.rows.length === 0 || !['owner', 'admin', 'staff'].includes(userRes.rows[0].role)) {
        return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Admin access required" } });
      }

      const newStatus = action === "approve" ? "verified" : action === "suspend" ? "suspended" : "rejected";

      const verRes = await query(
        `UPDATE product_verifications
         SET status = $1, reviewed_at = NOW(), reviewed_by = $2,
             rejection_reason = $3, suspension_reason = $4, updated_at = NOW()
         WHERE id = $5
         RETURNING *`,
        [newStatus, userId, action === "reject" ? reason : null, action === "suspend" ? reason : null, verificationId],
      );

      if (verRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Verification not found" } });
      }

      // Update product verification_status
      await query(
        `UPDATE products SET verification_status = $1, verified_at = CASE WHEN $1 = 'verified' THEN NOW() ELSE verified_at END, updated_at = NOW()
         WHERE id = (SELECT product_id FROM product_verifications WHERE id = $2)`,
        [newStatus, verificationId],
      );

      res.json({ success: true, data: verRes.rows[0] });
    } catch (err) {
      console.error("[verification] product action error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to process verification" } });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // PUBLIC: seller/shop verification status (for shop page display)
  // ════════════════════════════════════════════════════════════════════════

  // GET /api/shops/:shopId/verification — Get shop verification status (public, safe data only)
  app.get("/api/shops/:shopId/verification", async (req: Request, res: Response) => {
    try {
      const shopId = req.params.shopId;
      const result = await query(
        `SELECT s.verification_status, s.verified_at
         FROM sellers s
         JOIN shops sh ON sh.seller_id = s.id
         WHERE sh.id = $1`,
        [shopId],
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Shop not found" } });
      }
      // Only return safe public data
      res.json({
        success: true,
        data: {
          verificationStatus: result.rows[0].verification_status,
          verifiedAt: result.rows[0].verified_at,
        },
      });
    } catch (err) {
      console.error("[verification] shop status error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch shop verification" } });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // EVIDENCE UPLOAD (for verification submissions)
  // ════════════════════════════════════════════════════════════════════════

  // R2 client for evidence upload
  const evidenceR2 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    },
  });
  const evidenceBucket = process.env.R2_BUCKET || "";
  const evidencePublicDomain = process.env.R2_PUBLIC_DOMAIN || "";

  // Allowed evidence file types
  const EVIDENCE_ALLOWED_TYPES = [
    "image/jpeg", "image/png", "image/webp", "image/avif",
    "application/pdf",
    "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  const EVIDENCE_MAX_SIZE = 10 * 1024 * 1024; // 10MB

  // POST /api/seller/evidence/upload-intent — Get presigned URL for evidence upload
  app.post("/api/seller/evidence/upload-intent", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { filename, mimeType, purpose } = req.body;
      // purpose: 'product_photo' | 'packaging' | 'label' | 'serial' | 'receipt' | 'supplier_doc' | 'other'

      if (!filename || !mimeType) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "filename and mimeType required" } });
        return;
      }

      if (!EVIDENCE_ALLOWED_TYPES.includes(mimeType)) {
        res.status(400).json({ success: false, error: { code: "INVALID_FILE_TYPE", message: "File type not allowed" } });
        return;
      }

      // Verify user is a seller
      const sellerRes = await query("SELECT id FROM sellers WHERE user_id = $1", [userId]);
      if (sellerRes.rows.length === 0) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Seller account required" } });
        return;
      }

      const sellerId = sellerRes.rows[0].id;
      const ext = filename.split(".").pop() || "jpg";
      const safePurpose = (purpose || "other").replace(/[^a-z0-9_-]/g, "_");
      const timestamp = Date.now();
      const objectKey = `verification/evidence/${sellerId}/${safePurpose}_${timestamp}.${ext}`;

      const command = new PutObjectCommand({
        Bucket: evidenceBucket,
        Key: objectKey,
        ContentType: mimeType,
      });

      const uploadUrl = await getSignedUrl(evidenceR2, command, { expiresIn: 300 });
      const cdnUrl = evidencePublicDomain ? `${evidencePublicDomain}/${objectKey}` : "";

      console.log(`[verification] evidence presign: seller=${sellerId} purpose=${safePurpose} key=${objectKey}`);

      res.json({
        success: true,
        data: { uploadUrl, objectKey, cdnUrl },
      });
    } catch (err) {
      console.error("[verification] evidence presign error:", err);
      res.status(500).json({ success: false, error: { code: "R2_PRESIGN_FAILED", message: "Failed to generate upload URL" } });
    }
  });
}
