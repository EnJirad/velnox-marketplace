/**
 * Seller access — the ONE server-side decision.
 *
 * `users.role` is a cached convenience: it is promoted to `seller` when an
 * application is approved and is NOT re-read on every request. The authoritative
 * source for "may this account act as a seller?" is the applicant's own
 * `sellers.status` row, so every seller-only surface resolves it here instead of
 * trusting the session, the client, or the fact that some page happened to be
 * reachable.
 *
 * Rule (unchanged, now enforced in one place):
 *
 *     sellerAccess = true  ⇔  sellers.status === 'approved'
 *
 * Everything else — no application, `pending`, `under_review`,
 * `needs_correction`, `rejected`, `suspended` — is a refusal. The applicant-side
 * application flow (`POST /api/seller/apply`, `GET /api/seller/status`,
 * `/api/seller/evidence*`, `/api/seller/verification`) deliberately does NOT use
 * this guard: it must stay reachable while the application is under review or
 * waiting for corrections.
 */
import type { Request, Response, NextFunction } from "express";
import { query } from "../db/index.js";

declare global {
  namespace Express {
    interface Request {
      /** Set by `requireApprovedSeller` for handlers that need the seller row. */
      sellerId?: string;
    }
  }
}

export interface SellerAccess {
  sellerId: string | null;
  status: string | null;
  /** True ONLY for an approved application — computed from `sellers.status`. */
  sellerAccess: boolean;
}

/** Resolve the caller's OWN seller application. Never takes an id from the client. */
export async function resolveSellerAccess(userId: string): Promise<SellerAccess> {
  const result = await query("SELECT id, status FROM sellers WHERE user_id = $1", [userId]);
  const row = result.rows[0] as { id: string; status: string } | undefined;
  return {
    sellerId: row?.id ?? null,
    status: row?.status ?? null,
    sellerAccess: row?.status === "approved",
  };
}

/**
 * Gate for seller-dashboard APIs. 401 without a session (defence in depth —
 * `requireAuth` already ran), 403 unless the caller's own application is
 * approved. Ownership is by session identity only; a client-supplied userId,
 * role, or `approved` flag is never read.
 */
export async function requireApprovedSeller(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = req.user?.userId;
  if (!userId) {
    res.status(401).json({ success: false, error: { code: "UNAUTHORIZED", message: "Not authenticated" } });
    return;
  }

  let access: SellerAccess;
  try {
    access = await resolveSellerAccess(userId);
  } catch (err) {
    console.error("[seller-access] resolve failed:", err);
    res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to verify seller access" } });
    return;
  }

  if (!access.sellerAccess) {
    console.warn(`[seller-access] denied user=${userId} status=${access.status ?? "none"}`);
    res.status(403).json({
      success: false,
      error: {
        code: "SELLER_NOT_APPROVED",
        message: "This action requires an approved seller application",
      },
    });
    return;
  }

  req.sellerId = access.sellerId ?? undefined;
  next();
}
