/**
 * Verification API routes — ONE verification system.
 *
 * Velnox verifies the SELLER / SHOP identity. There is no separate product
 * verification system in the user-facing workflow (`product_verifications` and
 * `products.verification_status` are legacy tables kept only for historical
 * data; nothing here writes to them).
 *
 * V eligibility (customer-facing badge):
 *     seller.verification_status = 'verified'
 *     → every product owned by that seller shows the single green V.
 *
 * Security:
 *  - every route requires an authenticated session (httpOnly cookie)
 *  - sellers can only read/write their OWN verification
 *  - identity evidence is served to reviewers through short-lived signed R2
 *    URLs generated server-side after an authorization check — never as a
 *    public bucket URL
 *  - approve / reject / suspend are restricted to owner | admin | staff
 *
 * "No successful evidence persistence = no pending verification": the seller
 * status only moves to `pending` after the evidence media rows exist in Neon.
 */

import type { Express, Request, Response } from "express";
import { query, getClient } from "../db/index.js";
import { auditClientIp, writeAuditLog } from "../lib/audit-log.js";
import { userHasPermission } from "../lib/permissions.js";
import { isSelfApproval } from "../lib/verification-guard.js";
import { broadcast, CHANNELS, sendToUser } from "../realtime/index.js";
import { requireAuth } from "../middleware/auth.js";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

/** Reviewers that may act on identity evidence. */
const REVIEWER_ROLES = ["owner", "admin", "staff"];

/**
 * Structured correction / rejection reasons.
 * Codes are persisted (never free-text only) and are safe to show the applicant.
 */
const REVIEW_REASON_CODES = [
  // identity evidence
  "id_card_unclear",
  "id_card_incomplete",
  "selfie_unclear",
  "selfie_missing_id",
  "document_expired",
  // application data
  "applicant_mismatch",
  "store_incomplete",
  "contact_incomplete",
  "address_incomplete",
  // eligibility
  "duplicate_account",
  "policy_violation",
  "other",
] as const;

// Mirrored in packages/shared/src/lib/verification-reasons.ts so VelCenter and
// the backend share one vocabulary. backend/tests asserts the two lists match.
export function registerVerificationRoutes(app: Express) {
  // ════════════════════════════════════════════════════════════════════════
  // R2 — private evidence storage
  // ════════════════════════════════════════════════════════════════════════

  const evidenceR2 = new S3Client({
    region: "auto",
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY || "",
    },
  });
  const evidenceBucket = process.env.R2_BUCKET || "";
  const evidencePublicDomain = (process.env.R2_PUBLIC_DOMAIN || "").replace(/\/+$/, "");

  const EVIDENCE_ALLOWED_TYPES = [
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/avif",
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  const EVIDENCE_MAX_SIZE = 10 * 1024 * 1024; // 10MB

  /** Evidence purposes accepted by the presign endpoint. */
  const EVIDENCE_PURPOSES = [
    // seller identity (onboarding + standalone verification)
    "id_card",
    "id_card_back",
    "selfie_id",
    "business_doc",
    // generic verification evidence
    "identity",
    "product_photo",
    "packaging",
    "label",
    "serial",
    "receipt",
    "supplier_doc",
    "other",
  ];

  /** Normalize any stored evidence reference (public URL or bare key) to an R2 key. */
  function toObjectKey(ref: string): string {
    if (!ref) return "";
    if (evidencePublicDomain && ref.startsWith(evidencePublicDomain)) {
      return ref.slice(evidencePublicDomain.length).replace(/^\/+/, "");
    }
    if (/^https?:\/\//i.test(ref)) {
      try {
        return decodeURIComponent(new URL(ref).pathname.replace(/^\/+/, ""));
      } catch {
        return ref;
      }
    }
    return ref;
  }

  /**
   * Who may act on a seller verification?
   *
   * The reviewer role alone is NOT enough: approving a real-world identity is
   * `sellers.manage`. owner/admin hold it implicitly, a staff account only when
   * VelCenter granted it — deny by default. Before this, every staff account
   * could approve any applicant, granted permission or not.
   */
  async function assertReviewer(userId: string): Promise<string | null> {
    const userRes = await query("SELECT role FROM users WHERE id = $1", [userId]);
    const role = userRes.rows[0]?.role as string | undefined;
    if (!role || !REVIEWER_ROLES.includes(role)) return null;
    if (!(await userHasPermission(userId, "sellers.manage"))) return null;
    return role;
  }

  // ════════════════════════════════════════════════════════════════════════
  // SELLER VERIFICATION — applicant side
  // ════════════════════════════════════════════════════════════════════════

  // GET /api/seller/verification — the seller's own verification state
  app.get("/api/seller/verification", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const result = await query(
        `SELECT sv.id, sv.status, sv.verification_type, sv.evidence_urls,
                sv.submitted_at, sv.reviewed_at, sv.rejection_reason, sv.review_reason_code,
                sv.suspension_reason,
                s.verification_status AS seller_verification_status, s.verified_at
         FROM sellers s
         LEFT JOIN seller_verifications sv ON sv.seller_id = s.id
         WHERE s.user_id = $1
         ORDER BY sv.created_at DESC NULLS LAST
         LIMIT 1`,
        [userId],
      );
      const row = result.rows[0] ?? null;
      // Evidence references are never returned to the applicant as public URLs;
      // only the count is exposed.
      res.json({
        success: true,
        data: row
          ? {
              id: row.id ?? null,
              status: row.seller_verification_status ?? row.status ?? "unverified",
              verificationType: row.verification_type ?? "identity",
              evidenceCount: Array.isArray(row.evidence_urls) ? row.evidence_urls.length : 0,
              submittedAt: row.submitted_at ?? null,
              reviewedAt: row.reviewed_at ?? null,
              rejectionReason: row.rejection_reason ?? null,
              reviewReasonCode: row.review_reason_code ?? null,
              suspensionReason: row.suspension_reason ?? null,
              verifiedAt: row.verified_at ?? null,
            }
          : null,
      });
    } catch (err) {
      console.error("[verification] seller status error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch verification status" } });
    }
  });

  // POST /api/seller/verification — submit (or re-submit) seller verification
  app.post("/api/seller/verification", requireAuth, async (req: Request, res: Response) => {
    const client = await getClient();
    try {
      const userId = req.user!.userId;
      const { evidenceUrls, verificationType } = req.body as {
        evidenceUrls?: unknown;
        verificationType?: string;
      };

      const evidence = Array.isArray(evidenceUrls) ? evidenceUrls.filter((u) => typeof u === "string" && u) : [];

      // HARD RULE: no evidence persisted → no pending verification.
      if (evidence.length === 0) {
        res.status(400).json({
          success: false,
          error: { code: "EVIDENCE_REQUIRED", message: "At least one identity document must be uploaded before submitting for verification" },
        });
        return;
      }

      await client.query("BEGIN");

      const sellerRes = await client.query("SELECT id, status, verification_status FROM sellers WHERE user_id = $1 FOR UPDATE", [userId]);
      if (sellerRes.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Seller not found" } });
        return;
      }
      const seller = sellerRes.rows[0];

      // Ownership: every evidence key must belong to this authenticated user.
      // Keys are `verification/evidence/{ownerSegment}/...` where ownerSegment is
      // the seller id when one exists, otherwise the user id.
      const ownershipRes = await client.query(
        `SELECT key FROM media WHERE uploaded_by = $1 AND key = ANY($2::text[])`,
        [userId, evidence.map(toObjectKey)],
      );
      const ownedKeys = new Set(ownershipRes.rows.map((r: { key: string }) => r.key));
      const foreign = evidence.map(toObjectKey).filter((k) => !ownedKeys.has(k));
      if (foreign.length > 0) {
        await client.query("ROLLBACK");
        console.warn(`[verification] submit rejected — evidence not owned by user ${userId}`);
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Evidence does not belong to this account" } });
        return;
      }

      // Upsert the pending verification record
      const verRes = await client.query(
        `INSERT INTO seller_verifications (seller_id, status, verification_type, evidence_urls, submitted_at)
         VALUES ($1, 'pending', $2, $3::jsonb, NOW())
         ON CONFLICT (seller_id) WHERE status = 'pending'
         DO UPDATE SET evidence_urls = $3::jsonb, verification_type = $2, submitted_at = NOW(), updated_at = NOW()
         RETURNING *`,
        [seller.id, verificationType || "identity", JSON.stringify(evidence.map(toObjectKey))],
      );

      // Only now — after the verification row and evidence exist — set pending
      await client.query(
        `UPDATE sellers
         SET verification_status = 'pending', updated_at = NOW()
         WHERE id = $1`,
        [seller.id],
      );

      // Review history: submitted
      await client.query(
        `INSERT INTO seller_review_history
           (seller_id, previous_status, new_status, action, reviewer_id)
         VALUES ($1, $2, 'pending', 'submitted', $3)`,
        [seller.id, seller.verification_status ?? "unverified", userId],
      );

      await client.query("COMMIT");

      res.json({ success: true, data: verRes.rows[0] });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[verification] seller submit error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to submit verification" } });
    } finally {
      client.release();
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // EVIDENCE PERSISTENCE
  // ════════════════════════════════════════════════════════════════════════

  // GET /api/seller/evidence — evidence owned by the caller (refresh hydration).
  // Returns object keys + short-lived signed URLs, never public bucket URLs.
  app.get("/api/seller/evidence", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const result = await query(
        `SELECT id, key, content_type, size, created_at
         FROM media
         WHERE uploaded_by = $1 AND key LIKE 'verification/evidence/%'
         ORDER BY created_at DESC`,
        [userId],
      );

      const rows = await Promise.all(
        result.rows.map(async (r: { id: string; key: string; content_type: string | null; size: number | null; created_at: string }) => {
          const filename = String(r.key).split("/").pop() || "";
          const purpose = filename.split("_")[0] || "other";
          let signedUrl: string | null = null;
          try {
            signedUrl = await getSignedUrl(
              evidenceR2,
              new GetObjectCommand({ Bucket: evidenceBucket, Key: r.key }),
              { expiresIn: 300 },
            );
          } catch (signErr) {
            console.warn("[verification] seller evidence sign failed:", signErr);
          }
          return {
            id: r.id,
            key: r.key,
            content_type: r.content_type,
            size: r.size,
            created_at: r.created_at,
            purpose,
            url: signedUrl,
          };
        }),
      );

      res.json({ success: true, data: rows });
    } catch (err) {
      console.error("[verification] list evidence error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch evidence" } });
    }
  });

  // POST /api/seller/evidence/confirm — persist evidence metadata after the R2 PUT
  app.post("/api/seller/evidence/confirm", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { objectKey, publicUrl, filename, contentType, fileSize } = req.body as {
        objectKey?: string;
        publicUrl?: string;
        filename?: string;
        contentType?: string;
        fileSize?: number;
      };

      if (!objectKey) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "objectKey required" } });
        return;
      }
      if (!objectKey.startsWith("verification/evidence/")) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Invalid object key" } });
        return;
      }

      // Ownership: the owner segment is the seller id (when the caller has a
      // seller record) or the caller's own user id (onboarding, before the
      // seller row exists). Both are derived from the session.
      const sellerRes = await query("SELECT id FROM sellers WHERE user_id = $1", [userId]);
      const sellerId: string | null = sellerRes.rows[0]?.id ?? null;
      const keyOwner = objectKey.split("/")[2] || "";
      const allowedOwners = [String(userId), sellerId ? String(sellerId) : ""].filter(Boolean);
      if (!allowedOwners.includes(keyOwner)) {
        console.warn(`[verification] evidence confirm ownership mismatch: keyOwner=${keyOwner} user=${userId} seller=${sellerId}`);
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Object key does not belong to this account" } });
        return;
      }

      const storedUrl = publicUrl || (evidencePublicDomain ? `${evidencePublicDomain}/${objectKey}` : objectKey);

      const mediaRes = await query(
        `INSERT INTO media (url, key, content_type, size, uploaded_by)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (key) DO UPDATE SET url = $1, content_type = $3, size = $4
         RETURNING id`,
        [storedUrl, objectKey, contentType || "image/jpeg", fileSize || 0, userId],
      );

      res.json({
        success: true,
        data: {
          id: mediaRes.rows[0]?.id,
          url: storedUrl,
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

  // POST /api/seller/evidence/upload-intent — presigned PUT for evidence
  app.post("/api/seller/evidence/upload-intent", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const { filename, mimeType, purpose } = req.body as {
        filename?: string;
        mimeType?: string;
        purpose?: string;
      };

      if (!filename || !mimeType) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "filename and mimeType required" } });
        return;
      }
      if (!EVIDENCE_ALLOWED_TYPES.includes(mimeType)) {
        res.status(400).json({ success: false, error: { code: "INVALID_FILE_TYPE", message: "File type not allowed" } });
        return;
      }

      const safePurpose = (purpose || "other").replace(/[^a-z0-9_-]/gi, "_").toLowerCase();
      if (!EVIDENCE_PURPOSES.includes(safePurpose)) {
        res.status(400).json({ success: false, error: { code: "INVALID_PURPOSE", message: "Unknown evidence purpose" } });
        return;
      }

      // Applicants upload identity evidence BEFORE a seller row exists, so the
      // owner segment falls back to the authenticated user id.
      const sellerRes = await query("SELECT id FROM sellers WHERE user_id = $1", [userId]);
      const ownerSegment: string = sellerRes.rows[0]?.id ?? userId;

      const ext = (filename.split(".").pop() || "jpg").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 5) || "jpg";
      const objectKey = `verification/evidence/${ownerSegment}/${safePurpose}_${Date.now()}.${ext}`;

      const uploadUrl = await getSignedUrl(
        evidenceR2,
        new PutObjectCommand({ Bucket: evidenceBucket, Key: objectKey, ContentType: mimeType }),
        { expiresIn: 300 },
      );
      const cdnUrl = evidencePublicDomain ? `${evidencePublicDomain}/${objectKey}` : "";

      console.log(`[verification] evidence presign: owner=${ownerSegment} purpose=${safePurpose} key=${objectKey}`);

      res.json({ success: true, data: { uploadUrl, objectKey, cdnUrl } });
    } catch (err) {
      console.error("[verification] evidence presign error:", err);
      res.status(500).json({ success: false, error: { code: "R2_PRESIGN_FAILED", message: "Failed to generate upload URL" } });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // VELCENTER — seller verification review
  // ════════════════════════════════════════════════════════════════════════

  // GET /api/admin/verifications?status=pending|verified|rejected|suspended|all
  // Seller verification queue ONLY. Product verification no longer exists.
  app.get("/api/admin/verifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const role = await assertReviewer(req.user!.userId);
      if (!role) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Admin access required" } });
        return;
      }

      const status = (req.query.status as string) || "pending";
      const search = ((req.query.q as string) || "").trim();
      const where: string[] = [];
      const params: unknown[] = [];

      if (status && status !== "all") {
        params.push(status);
        where.push(`sv.status = $${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        where.push(`(sh.name ILIKE $${params.length} OR u.name ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
      }

      const sellerRes = await query(
        `SELECT sv.id, sv.seller_id, sv.status, sv.verification_type, sv.evidence_urls,
                sv.submitted_at, sv.reviewed_at, sv.rejection_reason,
                sv.suspension_reason, sv.review_reason_code, sv.review_note, sv.created_at, sv.updated_at,
                s.status AS seller_status, s.verification_status,
                u.id AS owner_user_id, u.name AS owner_name, u.email AS owner_email, u.phone AS owner_phone,
                sh.name AS shop_name, sh.slug AS shop_slug, sh.category AS shop_category,
                sh.address_line1, sh.address_line2, sh.subdistrict, sh.district, sh.city,
                sh.state, sh.postal_code, sh.country, sh.phone AS shop_phone,
                ss.settings AS seller_settings
         FROM seller_verifications sv
         JOIN sellers s ON s.id = sv.seller_id
         JOIN users u ON u.id = s.user_id
         LEFT JOIN shops sh ON sh.seller_id = s.id
         LEFT JOIN seller_settings ss ON ss.seller_id = s.id
         ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
         ORDER BY sv.submitted_at DESC NULLS LAST, sv.created_at DESC
         LIMIT 200`,
        params,
      );

      // Never return raw evidence locations to the list — only counts.
      const sellers = sellerRes.rows.map((row: Record<string, unknown>) => ({
        ...row,
        evidence_count: Array.isArray(row.evidence_urls) ? (row.evidence_urls as unknown[]).length : 0,
        evidence_urls: undefined,
      }));

      res.json({ success: true, data: { sellers, products: [] } });
    } catch (err) {
      console.error("[verification] admin list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to fetch verifications" } });
    }
  });

  // GET /api/admin/verifications/seller/:verificationId/evidence
  // Reviewer-only, short-lived signed R2 URLs. The bucket is private and the
  // browser can never request an arbitrary key.
  app.get("/api/admin/verifications/seller/:verificationId/evidence", requireAuth, async (req: Request, res: Response) => {
    try {
      const role = await assertReviewer(req.user!.userId);
      if (!role) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Admin access required" } });
        return;
      }

      const { verificationId } = req.params;
      const verRes = await query(
        "SELECT id, evidence_urls FROM seller_verifications WHERE id = $1",
        [verificationId],
      );
      if (verRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Verification not found" } });
        return;
      }

      const refs: string[] = Array.isArray(verRes.rows[0].evidence_urls) ? verRes.rows[0].evidence_urls : [];
      const files = await Promise.all(
        refs.map(async (ref: string) => {
          const key = toObjectKey(ref);
          let url: string | null = null;
          try {
            url = await getSignedUrl(
              evidenceR2,
              new GetObjectCommand({ Bucket: evidenceBucket, Key: key }),
              { expiresIn: 300 },
            );
          } catch (signErr) {
            console.warn(`[verification] evidence sign failed key=${key}`, signErr);
          }
          const filename = key.split("/").pop() || key;
          const purpose = filename.split("_")[0] || "other";
          return {
            key,
            filename,
            purpose,
            url,
            // 5 minute lifetime — the UI must re-request if it expires
            expiresIn: 300,
          };
        }),
      );

      res.json({ success: true, data: { verificationId, files } });
    } catch (err) {
      console.error("[verification] admin evidence error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load evidence" } });
    }
  });

  // GET /api/admin/verifications/seller/:verificationId/history
  app.get("/api/admin/verifications/seller/:verificationId/history", requireAuth, async (req: Request, res: Response) => {
    try {
      const role = await assertReviewer(req.user!.userId);
      if (!role) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Admin access required" } });
        return;
      }
      const { verificationId } = req.params;
      const verRes = await query("SELECT seller_id FROM seller_verifications WHERE id = $1", [verificationId]);
      if (verRes.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Verification not found" } });
        return;
      }
      const history = await query(
        `SELECT h.id, h.previous_status, h.new_status, h.action, h.reason_code, h.reason,
                h.note, h.created_at, u.name AS reviewer_name, u.email AS reviewer_email
         FROM seller_review_history h
         LEFT JOIN users u ON u.id = h.reviewer_id
         WHERE h.seller_id = $1
         ORDER BY h.created_at DESC
         LIMIT 100`,
        [verRes.rows[0].seller_id],
      );
      res.json({ success: true, data: history.rows });
    } catch (err) {
      console.error("[verification] admin history error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load review history" } });
    }
  });

  // PATCH /api/admin/verifications/seller/:verificationId
  // action: approve | reject | suspend | needs_correction
  app.patch("/api/admin/verifications/seller/:verificationId", requireAuth, async (req: Request, res: Response) => {
    const client = await getClient();
    try {
      const userId = req.user!.userId;
      const { verificationId } = req.params;
      const { action, reason, reasonCode, note } = req.body as {
        action?: "approve" | "reject" | "suspend" | "needs_correction";
        reason?: string;
        reasonCode?: string;
        note?: string;
      };

      const role = await assertReviewer(userId);
      if (!role) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Admin access required" } });
        return;
      }

      if (!action || !["approve", "reject", "suspend", "needs_correction"].includes(action)) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "action must be approve, reject, suspend or needs_correction" } });
        return;
      }

      // Structured reason required for anything that is not an approval.
      const code = (reasonCode || "").trim();
      if (action !== "approve") {
        if (!code || !(REVIEW_REASON_CODES as readonly string[]).includes(code)) {
          res.status(400).json({ success: false, error: { code: "REASON_REQUIRED", message: "A structured reason code is required" } });
          return;
        }
      }
      // Reviewer identity always comes from the session — never the request body.
      const reviewerId = userId;

      const newStatus = action === "approve" ? "verified" : action === "suspend" ? "suspended" : action === "needs_correction" ? "pending" : "rejected";

      await client.query("BEGIN");

      const currentRes = await client.query(
        "SELECT id, seller_id, status, evidence_urls FROM seller_verifications WHERE id = $1 FOR UPDATE",
        [verificationId],
      );
      if (currentRes.rows.length === 0) {
        await client.query("ROLLBACK");
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Verification not found" } });
        return;
      }
      const current = currentRes.rows[0];
      const previousStatus = current.status;
      const evidenceCount = Array.isArray(current.evidence_urls) ? current.evidence_urls.length : 0;

      // Self-approval guard: a reviewer who also owns the shop must NOT be able
      // to approve their own identity verification. Ownership is resolved from
      // the database — never from the request body — and the check runs before
      // any write below, so a refused decision leaves nothing behind.
      const ownerRes = await client.query(
        "SELECT s.user_id FROM sellers s WHERE s.id = $1",
        [current.seller_id],
      );
      if (isSelfApproval(action, userId, ownerRes.rows[0]?.user_id)) {
        await client.query("ROLLBACK");
        res.status(403).json({ success: false, error: { code: "SELF_ACTION_FORBIDDEN", message: "You cannot approve your own seller verification" } });
        return;
      }

      // State machine — a reviewer cannot approve an empty submission.
      if (action === "approve") {
        if (evidenceCount === 0) {
          await client.query("ROLLBACK");
          res.status(400).json({ success: false, error: { code: "EVIDENCE_REQUIRED", message: "Cannot approve a verification with no evidence" } });
          return;
        }
        if (["rejected", "suspended"].includes(previousStatus)) {
          await client.query("ROLLBACK");
          res.status(400).json({ success: false, error: { code: "INVALID_TRANSITION", message: `Cannot approve a ${previousStatus} verification` } });
          return;
        }
      }

      const verRes = await client.query(
        `UPDATE seller_verifications
         SET status = $1, reviewed_at = NOW(), reviewed_by = $2,
             rejection_reason = $3, suspension_reason = $4,
             review_reason_code = $5, review_note = $6, updated_at = NOW()
         WHERE id = $7
         RETURNING *`,
        [
          newStatus,
          reviewerId,
          action === "reject" ? reason || null : null,
          action === "suspend" ? reason || null : null,
          code || null,
          note || null,
          verificationId,
        ],
      );

      // Seller verification_status follows the verification record.
      const sellerVerificationStatus = action === "needs_correction" ? "unverified" : newStatus;
      await client.query(
        `UPDATE sellers
         SET verification_status = $1,
             verified_at = CASE WHEN $1 = 'verified' THEN NOW() ELSE verified_at END,
             updated_at = NOW()
         WHERE id = $2`,
        [sellerVerificationStatus, current.seller_id],
      );

      // Rejection / correction reasons are applicant-visible.
      if (action === "reject" || action === "needs_correction") {
        const key = action === "reject" ? "rejectionReason" : "correctionReason";
        const codeKey = action === "reject" ? "rejectionReasonCode" : "correctionReasonCode";
        await client.query(
          `UPDATE seller_settings
           SET settings = jsonb_set(
                 jsonb_set(COALESCE(settings, '{}'), ARRAY[$1], to_jsonb($2::text)),
                 ARRAY[$3], to_jsonb($4::text)
               ),
               updated_at = NOW()
           WHERE seller_id = $5`,
          [key, reason || "", codeKey, code, current.seller_id],
        );
      }
      if (action === "needs_correction") {
        // A correction request re-opens the application so the seller can edit.
        await client.query(
          "UPDATE sellers SET status = 'needs_correction', updated_at = NOW() WHERE id = $1 AND status IN ('pending','under_review')",
          [current.seller_id],
        );
      }

      // Review history / audit trail. `action` uses the canonical lifecycle
      // vocabulary shared with the VelCenter UI (submitted | resubmitted |
      // under_review | needs_correction | approved | rejected | suspended).
      const historyAction =
        action === "approve" ? "approved"
          : action === "reject" ? "rejected"
            : action === "suspend" ? "suspended"
              : "needs_correction";
      await client.query(
        `INSERT INTO seller_review_history
           (seller_id, previous_status, new_status, action, reason_code, reason, note, reviewer_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [current.seller_id, previousStatus, newStatus, historyAction, code || null, reason || null, note || null, reviewerId],
      );

      await client.query("COMMIT");

      // Staff audit trail — non-fatal, after commit. The seller review history
      // above is applicant-facing; this row is the VelCenter Audit Logs entry.
      await writeAuditLog(
        reviewerId,
        `SELLER_VERIFICATION_${historyAction.toUpperCase()}`,
        "seller",
        current.seller_id,
        { verificationId, from: previousStatus, to: newStatus, reasonCode: code || null, reason: reason || null, note: note || null },
        auditClientIp(req),
      );

      // Notifications — non-fatal, after commit
      if (["approve", "reject", "suspend", "needs_correction"].includes(action)) {
        try {
          const userRes = await query("SELECT user_id FROM sellers WHERE id = $1", [current.seller_id]);
          const targetUserId = userRes.rows[0]?.user_id;
          if (targetUserId) {
            const map: Record<string, { type: string; title: string; message: string }> = {
              approve: { type: "seller_verification_approved", title: "ร้านค้าได้รับการยืนยันแล้ว", message: "เครื่องหมาย V ถูกเปิดใช้งานกับสินค้าทั้งหมดของร้านคุณ" },
              reject: { type: "seller_verification_rejected", title: "การยืนยันร้านค้าไม่ผ่าน", message: `เหตุผล: ${reason || code}` },
              suspend: { type: "seller_verification_suspended", title: "การยืนยันร้านค้าถูกระงับ", message: `เหตุผล: ${reason || code}` },
              needs_correction: { type: "seller_verification_needs_correction", title: "ต้องแก้ไขข้อมูลการยืนยัน", message: `กรุณาแก้ไข: ${reason || code}` },
            };
            const n = map[action] ?? { type: "seller_verification_update", title: "อัปเดตการยืนยันร้านค้า", message: reason || code };
            const notifRes = await query(
              `INSERT INTO notifications (user_id, type, title, message, data)
               VALUES ($1, $2, $3, $4, $5)
               RETURNING id`,
              [targetUserId, n.type, n.title, n.message, JSON.stringify({ verificationId, action, reasonCode: code || null, reason: reason || null })],
            );
            // Push over the EXISTING realtime channel (`sendToUser` + the same
            // event the customer bell already listens to) so the seller's
            // notification bell updates without a refresh. Non-fatal: the row is
            // already committed and polling in the UI is the fallback.
            try {
              sendToUser(targetUserId, "", CHANNELS.NOTIFICATION_CREATED, {
                id: notifRes.rows[0]?.id ?? null,
                type: n.type,
                title: n.title,
                message: n.message,
              });
            } catch { /* non-fatal */ }
          }
        } catch (notifErr) {
          console.warn("[verification] notification write failed (non-fatal):", notifErr);
        }
      }

      // Approval is a material identity decision: never let a stale cached
      // profile keep a revoked/approved state.
      try {
        const { invalidateCachedProfile } = await import("./auth.js");
        const userRes = await query("SELECT user_id FROM sellers WHERE id = $1", [current.seller_id]);
        if (userRes.rows[0]?.user_id) invalidateCachedProfile(userRes.rows[0].user_id);
      } catch { /* non-fatal */ }

      // Broadcast seller update so VelCenter queues refresh in real-time
      try {
        broadcast(CHANNELS.SELLER_UPDATED, "seller:status-changed", { sellerId: current.seller_id, action, newStatus });
      } catch { /* broadcast is best-effort */ }

      res.json({ success: true, data: verRes.rows[0] });
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      console.error("[verification] seller action error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to process verification" } });
    } finally {
      client.release();
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // PUBLIC: shop verification status (safe fields only)
  // ════════════════════════════════════════════════════════════════════════

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
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Shop not found" } });
        return;
      }
      // Public-safe fields only — never evidence, identity numbers or notes.
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
}
