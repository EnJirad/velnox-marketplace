/**
 * BUSINESS VERIFICATION — the wholesale buyer gate.
 * ═══════════════════════════════════════════════════════════════════════════
 * A logged-in customer asks to be treated as a business so they can see and pay
 * wholesale prices. The evidentiary bar is the SELLER's bar (owner decision
 * 2026-02-05, Spec A), because wholesale pricing is a financial benefit granted
 * to a verified trading entity, not a self-declared label:
 *
 *   • commercial registration number (เลขทะเบียนพาณิชย์, 13 digits)
 *   • shop-front photo
 *   • authorised person's ID photo
 *   • bank book / account proof
 *
 * Evidence reuses the existing purpose-guarded upload path
 * (`POST /api/seller/evidence/upload-intent` / `/confirm`, `media` rows owned by
 * the uploader); this module only records WHICH keys the request rests on and
 * verifies that the caller really owns them.
 *
 *   POST   /api/business/verification                 — submit / resubmit
 *   GET    /api/business/verification                 — own status
 *   GET    /api/admin/business-verifications          — review queue
 *   POST   /api/admin/business-verifications/:id/review — approve / reject / suspend
 *
 * The STATUS is resolved server-side at pricing time (`lib/checkout-lines.ts`)
 * and is never read from the client, a cookie, or a token claim.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query, getClient } from "../db/index.js";
import { evidencePurposeFromKey } from "../lib/evidence-purpose.js";
import { userHasPermission } from "../lib/permissions.js";
import { sendToUser, CHANNELS } from "../realtime/index.js";

/** The four evidence purposes this gate requires. */
export const BUSINESS_EVIDENCE_PURPOSES = [
  "business_registration",
  "storefront_photo",
  "business_id",
  "bank_book",
] as const;

const REGISTRATION_RE = /^\d{13}$/;
const MAX_NAME = 200;

const BUSINESS_STATUSES = ["unverified", "pending", "verified", "rejected", "suspended"] as const;
type BusinessStatus = (typeof BUSINESS_STATUSES)[number];

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ success: false, error: { code, message } });
}

/** Resolve the caller's verification row (ownership is part of the query). */
async function loadOwn(userId: string) {
  const result = await query(
    `SELECT id, status, business_name, business_type, registration_number,
            evidence_urls, submitted_at, reviewed_at, rejection_reason, review_note
       FROM business_verifications WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

function toWire(row: any) {
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    businessName: row.business_name,
    businessType: row.business_type,
    registrationNumber: row.registration_number,
    evidenceKeys: Array.isArray(row.evidence_urls) ? row.evidence_urls : [],
    submittedAt: row.submitted_at,
    reviewedAt: row.reviewed_at,
    rejectionReason: row.rejection_reason,
    reviewNote: row.review_note,
  };
}

export function registerBusinessVerificationRoutes(app: Express): void {
  // ── GET /api/business/verification ─────────────────────────────────────────
  app.get("/api/business/verification", requireAuth, async (req: Request, res: Response) => {
    try {
      const row = await loadOwn(req.user!.userId);
      // No row is a legitimate state, not a 404: the storefront asks this on
      // every product page to decide whether to show wholesale prices.
      res.json({ success: true, data: row ? toWire(row) : { status: "unverified" } });
    } catch (err) {
      console.error("[business-verification] read error:", err);
      fail(res, 500, "DB_ERROR", "Failed to read business verification");
    }
  });

  // ── POST /api/business/verification ────────────────────────────────────────
  app.post("/api/business/verification", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const body = req.body ?? {};

      const businessName = String(body.businessName ?? "").trim();
      const businessType = String(body.businessType ?? "").trim();
      const registrationNumber = String(body.registrationNumber ?? "").trim();
      const evidenceKeys = Array.isArray(body.evidenceKeys) ? body.evidenceKeys.map(String) : [];

      if (!businessName || businessName.length > MAX_NAME) {
        fail(res, 400, "VALIDATION_ERROR", `businessName is required (max ${MAX_NAME} characters)`);
        return;
      }
      if (!businessType || businessType.length > MAX_NAME) {
        fail(res, 400, "VALIDATION_ERROR", "businessType is required");
        return;
      }
      if (!REGISTRATION_RE.test(registrationNumber)) {
        fail(res, 400, "VALIDATION_ERROR", "registrationNumber must be 13 digits");
        return;
      }

      // Every required purpose must be present, and the caller must OWN each key
      // (a key alone is guessable; `media.uploaded_by` is the proof).
      const purposes = new Set<string>();
      for (const key of evidenceKeys) {
        const media = await query(`SELECT key FROM media WHERE key = $1 AND uploaded_by = $2`, [key, userId]);
        if (media.rows.length === 0) {
          fail(res, 400, "EVIDENCE_NOT_FOUND", `Evidence "${key}" is not yours or does not exist`);
          return;
        }
        // Only business evidence may back a business request: an applicant must
        // not be able to satisfy this with a product photo.
        const keyPurpose = evidencePurposeFromKey(key);
        if (!BUSINESS_EVIDENCE_PURPOSES.includes(keyPurpose as (typeof BUSINESS_EVIDENCE_PURPOSES)[number])) {
          fail(res, 400, "INVALID_EVIDENCE", `Evidence "${key}" was uploaded for "${keyPurpose}", not for a business`);
          return;
        }
        purposes.add(keyPurpose);
      }
      const missing = BUSINESS_EVIDENCE_PURPOSES.filter((p) => !purposes.has(p));
      if (missing.length > 0) {
        fail(res, 400, "MISSING_EVIDENCE", `Missing required evidence: ${missing.join(", ")}`);
        return;
      }

      const existing = await loadOwn(userId);
      if (existing?.status === "verified") {
        fail(res, 409, "ALREADY_VERIFIED", "This account is already verified as a business");
        return;
      }

      const client = await getClient();
      try {
        await client.query("BEGIN");
        let id: string;
        if (existing) {
          const updated = await client.query(
            `UPDATE business_verifications
                SET status = 'pending', business_name = $1, business_type = $2,
                    registration_number = $3, evidence_urls = $4::jsonb,
                    submitted_at = NOW(), reviewed_at = NULL, reviewed_by = NULL,
                    rejection_reason = NULL, review_note = NULL, updated_at = NOW()
              WHERE user_id = $5
              RETURNING id`,
            [businessName, businessType, registrationNumber, JSON.stringify(evidenceKeys), userId],
          );
          id = String(updated.rows[0].id);
        } else {
          const inserted = await client.query(
            `INSERT INTO business_verifications
               (user_id, status, business_name, business_type, registration_number, evidence_urls, submitted_at)
             VALUES ($1, 'pending', $2, $3, $4, $5::jsonb, NOW())
             RETURNING id`,
            [userId, businessName, businessType, registrationNumber, JSON.stringify(evidenceKeys)],
          );
          id = String(inserted.rows[0].id);
        }
        await client.query(
          `INSERT INTO business_verification_history (verification_id, action, note)
           VALUES ($1, $2, $3)`,
          [id, existing ? "resubmitted" : "submitted", `${evidenceKeys.length} evidence file(s)`],
        );
        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK").catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }

      res.json({ success: true, data: { status: "pending" } });
    } catch (err) {
      console.error("[business-verification] submit error:", err);
      fail(res, 500, "DB_ERROR", "Failed to submit business verification");
    }
  });

  // ── GET /api/admin/business-verifications ──────────────────────────────────
  // `sellers.manage` is the permission that already guards the seller review
  // queue; the same staff decide business accounts.
  app.get("/api/admin/business-verifications", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      if (!(await userHasPermission(userId, "sellers.manage"))) {
        fail(res, 403, "FORBIDDEN", "Business verification review requires sellers.manage");
        return;
      }

      const statusFilter = typeof req.query.status === "string" ? req.query.status : "";
      const params: unknown[] = [];
      let where = "";
      if (statusFilter && (BUSINESS_STATUSES as readonly string[]).includes(statusFilter)) {
        params.push(statusFilter);
        where = `WHERE bv.status = $${params.length}`;
      }

      const result = await query(
        `SELECT bv.id, bv.user_id, bv.status, bv.business_name, bv.business_type,
                bv.registration_number, bv.evidence_urls, bv.submitted_at,
                bv.reviewed_at, bv.rejection_reason, bv.review_note,
                u.email AS applicant_email, u.name AS applicant_name
           FROM business_verifications bv
           JOIN users u ON u.id = bv.user_id
           ${where}
          ORDER BY bv.submitted_at DESC NULLS LAST, bv.created_at DESC
          LIMIT 200`,
        params,
      );

      res.json({
        success: true,
        data: result.rows.map((r) => ({
          id: r.id,
          userId: r.user_id,
          status: r.status,
          businessName: r.business_name,
          businessType: r.business_type,
          registrationNumber: r.registration_number,
          evidenceCount: Array.isArray(r.evidence_urls) ? r.evidence_urls.length : 0,
          submittedAt: r.submitted_at,
          reviewedAt: r.reviewed_at,
          rejectionReason: r.rejection_reason,
          reviewNote: r.review_note,
          applicantEmail: r.applicant_email,
          applicantName: r.applicant_name,
        })),
      });
    } catch (err) {
      console.error("[business-verification] queue error:", err);
      fail(res, 500, "DB_ERROR", "Failed to read the business verification queue");
    }
  });

  // ── POST /api/admin/business-verifications/:id/review ──────────────────────
  app.post("/api/admin/business-verifications/:id/review", requireAuth, async (req: Request, res: Response) => {
    try {
      const reviewerId = req.user!.userId;
      if (!(await userHasPermission(reviewerId, "sellers.manage"))) {
        fail(res, 403, "FORBIDDEN", "Business verification review requires sellers.manage");
        return;
      }

      const id = String(req.params.id);
      const body = req.body ?? {};
      const decision = String(body.decision ?? "").trim();
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) : "";

      if (!["approve", "reject", "suspend"].includes(decision)) {
        fail(res, 400, "VALIDATION_ERROR", "decision must be approve, reject or suspend");
        return;
      }
      if (decision === "reject" && !note) {
        // A rejection the applicant cannot act on is not a decision.
        fail(res, 400, "VALIDATION_ERROR", "A rejection needs a reason");
        return;
      }

      const current = await query(
        `SELECT id, user_id, status FROM business_verifications WHERE id = $1`,
        [id],
      );
      if (current.rows.length === 0) {
        fail(res, 404, "NOT_FOUND", "Business verification not found");
        return;
      }
      const row = current.rows[0];
      const applicantId = String(row.user_id);
      if (applicantId === reviewerId) {
        fail(res, 403, "SELF_REVIEW", "You cannot review your own business verification");
        return;
      }

      const nextStatus: BusinessStatus =
        decision === "approve" ? "verified" : decision === "reject" ? "rejected" : "suspended";

      const client = await getClient();
      try {
        await client.query("BEGIN");
        await client.query(
          `UPDATE business_verifications
              SET status = $1, reviewed_at = NOW(), reviewed_by = $2,
                  rejection_reason = $3, review_note = $4, updated_at = NOW()
            WHERE id = $5`,
          [nextStatus, reviewerId, decision === "reject" ? note : null, note || null, id],
        );
        await client.query(
          `INSERT INTO business_verification_history (verification_id, action, note)
           VALUES ($1, $2, $3)`,
          [id, decision, note],
        );
        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK").catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }

      // Tell the applicant's open session; the next pricing pass reads the same
      // status from the database, so this is a courtesy, never the gate.
      try {
        sendToUser(applicantId, `user:${applicantId}`, CHANNELS.BUSINESS_VERIFICATION_UPDATED, {
          status: nextStatus,
        });
      } catch { /* realtime is never fatal */ }

      res.json({ success: true, data: { id, status: nextStatus } });
    } catch (err) {
      console.error("[business-verification] review error:", err);
      fail(res, 500, "DB_ERROR", "Failed to record the review");
    }
  });
}
