/**
 * Product lifecycle rules — status state machines + V eligibility.
 *
 * These rules are the single source of truth for:
 *   • which status transitions a SELLER may perform,
 *   • which status transitions an ADMIN (VelCenter moderation) may perform,
 *   • which statuses are publicly visible in the VelShop catalog,
 *   • when a product earns the V badge.
 *
 * NOTE: V badge is now seller-only (product verification removed 2026-09-13).
 * systems. A verified seller never implies a verified product, and vice versa.
 */

/** Product statuses used by the existing (single) status system. */
export const PRODUCT_STATUSES = [
  "draft",
  "pending_review",
  "published",
  "rejected",
  "suspended",
  "archived",
] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** Statuses a product may be created with (never published directly). */
export type ProductCreationStatus = "draft" | "pending_review";

/**
 * Seller transitions. A seller may only submit for review or withdraw — never
 * publish, reject, suspend or archive their own product.
 */
export const SELLER_STATUS_TRANSITIONS: Record<string, ProductStatus[]> = {
  draft: ["pending_review"],
  rejected: ["pending_review"],
  pending_review: ["draft"],
  // Withdrawing a live product is a seller action — it never publishes anything,
  // and re-publishing still requires a fresh admin approval.
  published: ["draft"],
};

/** Statuses an admin may set through /api/admin/products/:id/moderation. */
export const ADMIN_MODERATION_TRANSITIONS: Record<string, ProductStatus[]> = {
  published: ["pending_review", "suspended"],
  rejected: ["pending_review"],
  suspended: ["published"],
};

/** Admin actions that require a written reason. */
export function moderationRequiresReason(status: ProductStatus): boolean {
  return status === "rejected" || status === "suspended";
}

/** Whether a seller may move a product from `from` to `to`. */
export function canSellerTransition(from: string, to: string): boolean {
  return (SELLER_STATUS_TRANSITIONS[from] ?? []).includes(to as ProductStatus);
}

/** Whether an admin may move a product from `from` to `to`. */
export function canAdminModerate(from: string, to: string): boolean {
  return (ADMIN_MODERATION_TRANSITIONS[to] ?? []).includes(from as ProductStatus);
}

/**
 * Public catalog visibility. Only `published` products are visible to
 * customers — drafts, reviews, rejections and suspensions are never exposed.
 */
export function isPubliclyVisible(status: string): boolean {
  return status === "published";
}

/**
 * Resolve the status a product should be created with. A seller requesting
 * "published" only ever reaches `pending_review` (approval is mandatory).
 */
export function resolveCreationStatus(requested: unknown): ProductCreationStatus {
  if (requested === "pending_review" || requested === "published") return "pending_review";
  return "draft";
}

/**
 * V eligibility — seller-verified only.
 * A verified seller's products automatically get the V badge.
 * Product verification was removed (2026-09-13).
 */
export function computeIsVerifiedProduct(
  _productVerification: unknown,
  sellerVerification: unknown,
): boolean {
  return sellerVerification === "verified";
}
