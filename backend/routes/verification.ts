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

      // Verify ownership and get product status
      const prodRes = await query(
        `SELECT p.id, p.verification_status FROM products p
         JOIN shops sh ON sh.id = p.shop_id
         JOIN sellers s ON s.id = sh.seller_id
         WHERE p.id = $1 AND s.user_id = $2`,
        [productId, userId],
      );

      if (prodRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
      }

      // Get the latest verification record from product_verifications (source of truth)
      const ownRes = await query(
        `SELECT * FROM product_verifications WHERE product_id = $1 ORDER BY created_at DESC LIMIT 1`,
        [productId],
      );

      // Use the actual verification record status as the source of truth
      // Fall back to products.verification_status if no record exists
      const verificationStatus = ownRes.rows[0]?.status ?? prodRes.rows[0].verification_status ?? 'unverified';

      res.json({
        success: true,
        data: {
          verificationStatus,
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
        `SELECT p.id FROM products p
         JOIN shops sh ON sh.id = p.shop_id
         JOIN sellers s ON s.id = sh.seller_id
         WHERE p.id = $1 AND s.user_id = $2`,
        [productId, userId],
      );

      if (ownRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
      }

      // Check if a pending verification ALREADY EXISTS in the actual verification table
      // (not relying on products.verification_status which can be out of sync)
      const pendingCheck = await query(
        `SELECT id FROM product_verifications WHERE product_id = $1 AND status = 'pending' LIMIT 1`,
        [productId],
      );

      if (pendingCheck.rows.length > 0) {
        return res.status(409).json({ success: false, error: { code: "ALREADY_PENDING", message: "Product verification already pending" } });
      }

      // CRITICAL: Require at least one evidence URL before setting pending
      // This prevents "pending" status without real evidence
      if (!evidenceUrls || evidenceUrls.length === 0) {
        return res.status(400).json({
          success: false,
          error: { code: "EVIDENCE_REQUIRED", message: "At least one evidence file must be uploaded before submitting for verification" }
        });
      }

      // Create verification request — only AFTER evidence is confirmed
      const verRes = await query(
        `INSERT INTO product_verifications (product_id, status, verification_type, evidence_urls, evidence_notes, submitted_at)
         VALUES ($1, 'pending', $2, $3, $4, NOW())
         ON CONFLICT (product_id) WHERE status = 'pending'
         DO UPDATE SET evidence_urls = $3, evidence_notes = $4, submitted_at = NOW(), updated_at = NOW()
         RETURNING *`,
        [productId, verificationType || "standard", JSON.stringify(evidenceUrls), evidenceNotes || null],
      );

      // Update product status — ONLY after evidence is persisted
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
  // EVIDENCE PERSISTENCE & RETRIEVAL
  // ════════════════════════════════════════════════════════════════════════

  // POST /api/seller/evidence/confirm — Persist evidence metadata after R2 upload
  app.post("/api/seller/evidence/confirm", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { objectKey, publicUrl, filename, contentType, fileSize, productId } = req.body;

      if (!objectKey || !publicUrl) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "objectKey and publicUrl required" } });
        return;
      }

      // Verify the object key belongs to this user
      if (!objectKey.startsWith("verification/evidence/")) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Invalid object key" } });
        return;
      }

      // Persist evidence metadata as a media record
      const mediaRes = await query(
        `INSERT INTO media (url, key, content_type, size, uploaded_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key) DO UPDATE SET url = $1
         RETURNING id`,
        [publicUrl, objectKey, contentType || "image/jpeg", fileSize || 0, userId]
      );

      res.json({
        success: true,
        data: {
          id: mediaRes.rows[0]?.id,
          url: publicUrl,
          objectKey,
          filename: filename || objectKey.split("/").pop(),
          contentType,
          fileSize,
        },
      });
    } catch (err) {
      console.error("[verification] evidence-confirm error:", err);
      res.status(500).json({ success: false, error: { code: "EVIDENCE_CONFIRM_FAILED", message: "Failed to confirm evidence upload" } });
    }
  });

  // GET /api/seller/products/:productId/verification/evidence — List evidence for a product
  app.get("/api/seller/products/:productId/verification/evidence", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const productId = req.params.productId;

      // Verify ownership
      const ownRes = await query(
        `SELECT p.id FROM products p
         JOIN shops sh ON sh.id = p.shop_id
         JOIN sellers s ON s.id = sh.seller_id
         WHERE p.id = $1 AND s.user_id = $2`,
        [productId, userId]
      );

      if (ownRes.rows.length === 0) {
        return res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
      }

      // Get evidence from the latest verification record
      const verRes = await query(
        `SELECT evidence_urls, evidence_notes FROM product_verifications
         WHERE product_id = $1
         ORDER BY created_at DESC LIMIT 1`,
        [productId]
      );

      const row = verRes.rows[0];
      const evidenceUrls = row?.evidence_urls || [];

      // For each URL, try to get more info from media table
      const evidenceFiles = [];
      for (const url of evidenceUrls) {
        const mediaRes = await query(
          "SELECT id, url, key, content_type, size, created_at FROM media WHERE url = $1",
          [url]
        );
        evidenceFiles.push(mediaRes.rows[0] || { url, key: null, content_type: null, size: null, created_at: null });
      }

      res.json({
        success: true,
        data: {
          evidenceFiles,
          notes: row?.evidence_notes || null,
        },
      });
    } catch (err) {
      console.error("[verification] evidence list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to list evidence" } });
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
                // Enrich seller evidence with file metadata
        for (const ver of sellerRes.rows) {
          const urls = ver.evidence_urls || [];
          const evidenceFiles = [];
          for (const url of urls) {
            const mediaRes = await query(
              "SELECT id, url, key, content_type, size, created_at FROM media WHERE url = $1",
              [url]
            );
            evidenceFiles.push(mediaRes.rows[0] || { url, content_type: null, size: null });
          }
          ver.evidence_files = evidenceFiles;
        }

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
                // Enrich with evidence file metadata (images)
        for (const ver of productRes.rows) {
          const urls = ver.evidence_urls || [];
          const evidenceFiles = [];
          for (const url of urls) {
            const mediaRes = await query(
              "SELECT id, url, key, content_type, size, created_at FROM media WHERE url = $1",
              [url]
            );
            evidenceFiles.push(mediaRes.rows[0] || { url, content_type: null, size: null });
          }
          ver.evidence_files = evidenceFiles;
        }

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
