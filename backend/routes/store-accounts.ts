/**
 * Velnox — STORE ACCOUNTS (the wholesale buyer track).
 *
 * Endpoints:
 *   GET    /api/customer/store-account        — my own application + wholesale access
 *   POST   /api/customer/store-account        — apply, re-apply, or update my contact details
 *   GET    /api/admin/store-accounts          — VelCenter review queue (paginated, searchable)
 *   PATCH  /api/admin/store-accounts/:id      — approve / reject ONE application
 *
 * WHY A SEPARATE MODULE
 *   `routes/center.ts` is the company console and `routes/cart.ts` owns the cart;
 *   a store account is its own resource with its own lifecycle (apply → review →
 *   approved), its own authorization (`stores.manage`) and its own validation.
 *   It lives beside them for the same reason `routes/verification.ts` does.
 *
 * WHO MAY DO WHAT
 *   * The applicant: read and write ONLY their own row. The user id comes from the
 *     session, never from the body or the query.
 *   * The reviewer: a VelCenter member holding `stores.manage` (owner/admin hold
 *     every code; a staff account only when the owner granted it). A reviewer may
 *     NOT approve their own application — the same `isSelfApproval` rule that
 *     guards the seller-verification route.
 *   * Nobody else: every endpoint is `requireAuth` and re-checks server-side. A
 *     hidden button is UX; these checks are the authorization.
 *
 * RE-APPLICATION IS AN UPDATE, NOT A SECOND ROW
 *   One application per user (`idx_store_accounts_user` is UNIQUE). A rejected
 *   applicant who fixes their details goes back to `pending` on the SAME row, so
 *   the queue never shows the same shop twice. An ALREADY APPROVED account keeps
 *   its approval when it updates its phone number: correcting contact details is
 *   not a re-review, and revoking a shop's wholesale access by accident would be
 *   a worse failure than the one this rule protects against.
 *
 * APPROVAL GRANTS ONE THING
 *   `status = 'approved'` makes `lib/store-accounts.ts#isApprovedStore` true, and
 *   that is the ONLY gate the catalog, the cart and checkout consult. No role is
 *   written, no session is rewritten, nothing else in the account changes.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";
import { isCenterMember, userHasPermission } from "../lib/permissions.js";
import { isSelfApproval } from "../lib/verification-guard.js";
import { auditClientIp, writeAuditLog } from "../lib/audit-log.js";
import { pageMeta, pageOffset, parseLimit, parsePage } from "../lib/pagination.js";
import {
  formatStoreAccount,
  getStoreAccount,
  validateStoreApplication,
} from "../lib/store-accounts.js";

/** The permission a VelCenter reviewer needs to decide a store application. */
const REVIEW_PERMISSION = "stores.manage";

function param(req: Request, key: string): string {
  const val = req.params[key] as string | string[] | undefined;
  if (Array.isArray(val)) return val[0] ?? "";
  return val ?? "";
}

export function setupStoreAccountRoutes(app: Express): void {
  /**
   * A VelCenter reviewer: membership to open the console, then the specific
   * grant. Deny by default — a missing employee row, an unknown role or a
   * database error all resolve to null.
   */
  async function assertStoreReviewer(userId: string): Promise<boolean> {
    if (!(await isCenterMember(userId))) return false;
    return userHasPermission(userId, REVIEW_PERMISSION);
  }

  // ════════════════════════════════════════════════════════════════════════
  // APPLICANT — my own store account
  // ════════════════════════════════════════════════════════════════════════

  // GET /api/customer/store-account — my application, or null when I never applied.
  // The response is per-session, so it is explicitly uncacheable.
  app.get("/api/customer/store-account", requireAuth, async (req: Request, res: Response) => {
    try {
      const account = await getStoreAccount(query, req.user!.userId);
      res.set("Cache-Control", "no-store");
      res.json({ success: true, data: account });
    } catch (err) {
      console.error("[store-accounts] read error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load your store account" } });
    }
  });

  // POST /api/customer/store-account — apply, re-apply, or update my details.
  app.post("/api/customer/store-account", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const parsed = validateStoreApplication(req.body ?? {});
      if (!parsed.ok) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.message } });
        return;
      }
      const v = parsed.values;

      // One row per user. A rejected application goes back to 'pending' so it
      // re-enters the queue; a pending one just updates; an approved one keeps
      // its approval (see the module doc).
      const result = await query(
        `INSERT INTO store_accounts (user_id, store_name, contact_name, contact_phone, address, note, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'pending')
         ON CONFLICT (user_id) DO UPDATE SET
           store_name = EXCLUDED.store_name,
           contact_name = EXCLUDED.contact_name,
           contact_phone = EXCLUDED.contact_phone,
           address = EXCLUDED.address,
           note = EXCLUDED.note,
           status = CASE WHEN store_accounts.status = 'approved' THEN 'approved' ELSE 'pending' END,
           review_note = CASE WHEN store_accounts.status = 'approved' THEN store_accounts.review_note ELSE NULL END,
           reviewed_by = CASE WHEN store_accounts.status = 'approved' THEN store_accounts.reviewed_by ELSE NULL END,
           reviewed_at = CASE WHEN store_accounts.status = 'approved' THEN store_accounts.reviewed_at ELSE NULL END,
           updated_at = NOW()
         RETURNING id, user_id, store_name, contact_name, contact_phone, address, note, status,
                   review_note, reviewed_by, reviewed_at, created_at, updated_at`,
        [userId, v.storeName, v.contactName, v.contactPhone, v.address, v.note],
      );

      res.set("Cache-Control", "no-store");
      res.json({ success: true, data: formatStoreAccount(result.rows[0]) });
    } catch (err) {
      console.error("[store-accounts] apply error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to save your store account" } });
    }
  });

  // ════════════════════════════════════════════════════════════════════════
  // VELCENTER — the review queue
  // ════════════════════════════════════════════════════════════════════════

  // GET /api/admin/store-accounts?status=pending|approved|rejected|all&q=&page=1&limit=25
  //
  // Paginated with a fully deterministic order (`created_at DESC, id DESC`), and
  // the exact filtered count comes back as `pagination.total` — so the overview
  // badge can ask for `limit=1` instead of counting a truncated page. Search runs
  // on the SERVER: filtering 25 rows locally would call the rest "no results".
  app.get("/api/admin/store-accounts", requireAuth, async (req: Request, res: Response) => {
    try {
      if (!(await assertStoreReviewer(req.user!.userId))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Store review access required" } });
        return;
      }

      const status = (req.query.status as string) || "pending";
      const search = ((req.query.q as string) || "").trim();
      const limit = parseLimit(req.query.limit);
      const page = parsePage(req.query.page);
      const offset = pageOffset(page, limit);

      const where: string[] = [];
      const params: unknown[] = [];
      if (status && status !== "all") {
        params.push(status);
        where.push(`sa.status = $${params.length}`);
      }
      if (search) {
        params.push(`%${search}%`);
        where.push(`(sa.store_name ILIKE $${params.length} OR sa.contact_name ILIKE $${params.length} OR sa.contact_phone ILIKE $${params.length} OR u.email ILIKE $${params.length})`);
      }

      const result = await query(
        `SELECT COUNT(*) OVER() AS total_count,
                sa.id, sa.user_id, sa.store_name, sa.contact_name, sa.contact_phone,
                sa.address, sa.note, sa.status, sa.review_note, sa.reviewed_by,
                sa.reviewed_at, sa.created_at, sa.updated_at,
                u.name AS applicant_name, u.email AS applicant_email,
                r.name AS reviewer_name
           FROM store_accounts sa
           JOIN users u ON u.id = sa.user_id
           LEFT JOIN users r ON r.id = sa.reviewed_by
           ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
           ORDER BY sa.created_at DESC, sa.id DESC
           LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      );

      const total = Number(result.rows[0]?.total_count ?? 0) || 0;
      res.set("Cache-Control", "no-store");
      res.json({
        success: true,
        data: {
          accounts: result.rows.map((row: any) => ({
            ...formatStoreAccount(row),
            applicantName: row.applicant_name ?? null,
            applicantEmail: row.applicant_email ?? null,
            reviewerName: row.reviewer_name ?? null,
          })),
          pagination: pageMeta(page, limit, total, result.rows.length),
        },
      });
    } catch (err) {
      console.error("[store-accounts] queue error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load the store review queue" } });
    }
  });

  // PATCH /api/admin/store-accounts/:id — approve or reject ONE application.
  app.patch("/api/admin/store-accounts/:id", requireAuth, async (req: Request, res: Response) => {
    try {
      const actorUserId = req.user!.userId;
      if (!(await assertStoreReviewer(actorUserId))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Store review access required" } });
        return;
      }

      const id = param(req, "id");
      const decision = req.body?.decision;
      if (decision !== "approve" && decision !== "reject") {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "decision must be 'approve' or 'reject'" } });
        return;
      }
      const reviewNoteRaw = req.body?.reviewNote;
      if (reviewNoteRaw !== undefined && reviewNoteRaw !== null && typeof reviewNoteRaw !== "string") {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "reviewNote must be text" } });
        return;
      }
      const reviewNote = typeof reviewNoteRaw === "string" ? reviewNoteRaw.trim() : "";
      if (reviewNote.length > 400) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "reviewNote must be 400 characters or fewer" } });
        return;
      }
      // A rejection with no reason is not actionable: the applicant cannot fix
      // what nobody named. An approval may carry an internal note or none.
      if (decision === "reject" && !reviewNote) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "A rejection needs a reason" } });
        return;
      }

      const existing = await query("SELECT id, user_id, status FROM store_accounts WHERE id = $1", [id]);
      const row = existing.rows[0];
      if (!row) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Store account not found" } });
        return;
      }

      // Approving grants wholesale access, so a reviewer may not grant it to
      // themselves. The other decision can only withhold access.
      if (isSelfApproval(decision, actorUserId, row.user_id)) {
        res.status(403).json({
          success: false,
          error: { code: "SELF_APPROVAL_FORBIDDEN", message: "You cannot approve your own store account." },
        });
        return;
      }

      const nextStatus = decision === "approve" ? "approved" : "rejected";
      if (row.status === nextStatus) {
        res.status(409).json({
          success: false,
          error: { code: "INVALID_TRANSITION", message: `This application is already ${nextStatus}.` },
        });
        return;
      }

      const updated = await query(
        `UPDATE store_accounts
            SET status = $1, review_note = $2, reviewed_by = $3, reviewed_at = NOW(), updated_at = NOW()
          WHERE id = $4
        RETURNING id, user_id, store_name, contact_name, contact_phone, address, note, status,
                  review_note, reviewed_by, reviewed_at, created_at, updated_at`,
        [nextStatus, reviewNote || null, actorUserId, id],
      );

      await writeAuditLog(
        actorUserId,
        decision === "approve" ? "STORE_ACCOUNT_APPROVED" : "STORE_ACCOUNT_REJECTED",
        "store_account",
        id,
        { from: row.status, to: nextStatus, userId: row.user_id, note: reviewNote || null },
        auditClientIp(req),
      );

      res.set("Cache-Control", "no-store");
      res.json({ success: true, data: formatStoreAccount(updated.rows[0]) });
    } catch (err) {
      console.error("[store-accounts] review error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to save the review decision" } });
    }
  });
}
