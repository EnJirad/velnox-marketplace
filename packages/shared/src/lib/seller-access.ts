/**
 * Seller access — the ONE client-side reading of the backend's decision.
 *
 * `users.role` is a cached convenience (promoted on approval, not re-read per
 * request) and is NOT an access check. What decides whether the seller
 * experience may be shown is the applicant's own application status, computed
 * by the backend (`sellers.status === 'approved'`) and returned by
 * `GET /api/seller/status` as a top-level `sellerAccess` boolean.
 *
 * Fail closed everywhere: anything that is not an explicit approval — no
 * application, `pending`, `under_review`, `needs_correction`, `rejected`,
 * `suspended`, a loading response, a network error, or a malformed payload —
 * denies access.
 */

/** Statuses allowed by the `sellers.status` CHECK constraint. */
export const SELLER_APPLICATION_STATUSES = [
  "pending",
  "under_review",
  "needs_correction",
  "approved",
  "rejected",
  "suspended",
] as const;

export type SellerApplicationStatus = (typeof SELLER_APPLICATION_STATUSES)[number];

/** True ONLY for an approved application. */
export function isSellerApproved(status: string | null | undefined): boolean {
  return status === "approved";
}

/**
 * May the seller tab bar render? Loading and API errors deny — the tab is never
 * shown speculatively ("assume approved until proven otherwise" is exactly the
 * bug this replaces).
 */
export function shouldShowSellerTab(state: {
  sellerAccess?: boolean;
  loading?: boolean;
  error?: string | null;
}): boolean {
  if (state.loading) return false;
  if (state.error) return false;
  return state.sellerAccess === true;
}

/** Minimal shape of a `GET /api/seller/status` response. */
export interface SellerStatusResponse {
  sellerAccess?: unknown;
  data?: { status?: unknown } | null;
}

/**
 * Read the backend's verdict. The server's explicit `sellerAccess` wins; when
 * an older payload omits it, derive from the application status it did send.
 * Never returns true without a server-provided approval.
 */
export function sellerAccessFromStatusResponse(
  payload: SellerStatusResponse | null | undefined,
): boolean {
  if (!payload || typeof payload !== "object") return false;
  if (payload.sellerAccess === true) return true;
  if (payload.sellerAccess === false) return false;
  const status = payload.data && typeof payload.data.status === "string" ? payload.data.status : null;
  return isSellerApproved(status);
}
