/**
 * MVP product rules — the vocabulary, the slug, and what counts as a MATERIAL
 * change to a live listing.
 *
 * The lifecycle ITSELF is not restated here. `db/mvp/schema.sql` owns it:
 * `enforce_product_status_transition()` rejects an illegal transition and
 * `require_approved_seller_for_product()` rejects a write by a seller who is not
 * approved. Duplicating that machine in TypeScript would create a second
 * authority that can drift from the database. This module only holds the two
 * decisions the database cannot express:
 *
 *   1. which statuses exist (for typed reads and the moderation queue filter),
 *   2. which edits to a PUBLISHED listing must send it back through review.
 *
 * THE RE-APPROVAL RULE (explicit, per the Phase 3 brief)
 * ------------------------------------------------------
 * A published listing is a reviewed artifact. If a seller materially changes it
 * after approval, the approval no longer describes what customers can buy, so
 * the edit takes the product down to `draft` and it must be re-submitted and
 * re-approved before it is purchasable again.
 *
 * Material fields: name, description, price, category, images, and the variant
 * set (adding/removing/re-pricing/re-naming/deactivating a variant).
 *
 * NOT material: stock level. Stock is operational, changes constantly, and
 * taking a listing down because a seller restocked would be absurd — it is also
 * the only mutable field a suspended seller could otherwise abuse, which the
 * seller gate already blocks.
 */
import { randomBytes } from "node:crypto";

/** Statuses declared by `products.status` in db/mvp/schema.sql. */
export const PRODUCT_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "published",
  "rejected",
] as const;

export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

/** The only status a customer may ever see. */
export const PUBLIC_PRODUCT_STATUS: ProductStatus = "published";

export function isProductStatus(value: unknown): value is ProductStatus {
  return typeof value === "string" && (PRODUCT_STATUSES as readonly string[]).includes(value);
}

/**
 * Fields whose change takes a published listing back to review.
 *
 * Exported as data so the Phase 3 report and the tests cite the same list the
 * handler uses, instead of prose that can drift.
 */
export const MATERIAL_CHANGE_FIELDS = [
  "name",
  "description",
  "price",
  "categorySlug",
  "images",
  "variants",
] as const;

export type MaterialChangeField = (typeof MATERIAL_CHANGE_FIELDS)[number];

/**
 * Build a URL slug from free text.
 *
 * Thai/Myanmar names slugify to their ASCII letters and digits; if nothing
 * survives, a random suffix is used so an empty slug can never be produced
 * (`products.slug` has a NOT EMPTY CHECK). The caller appends a uniqueness
 * suffix; this function never assumes the result is unique.
 */
export function slugify(input: string): string {
  const base = input
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return base.length > 0 ? base : "item";
}

/** A short random suffix that makes a generated slug unique in practice. */
export function slugSuffix(): string {
  return randomBytes(4).toString("hex");
}

/** Product slug: readable base + random suffix, e.g. `cotton-shirt-9f2a1c3d`. */
export function generateProductSlug(name: string): string {
  return `${slugify(name)}-${slugSuffix()}`;
}

/** Store slug for a seller application. */
export function generateSellerSlug(storeName: string): string {
  return `${slugify(storeName)}-${slugSuffix()}`;
}
