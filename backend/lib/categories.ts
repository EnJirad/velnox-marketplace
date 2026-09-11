/**
 * Category validation — the canonical `products.category_id` contract.
 *
 * Source of truth: the `categories` table (`id` UUID, `slug` TEXT UNIQUE,
 * `is_active` BOOLEAN). The multilingual columns and `is_active` are added by
 * migration 040 (db/migrations/040_verification_and_categories.sql) — if that
 * migration is not applied, category queries fail with
 * `column "is_active" does not exist`.
 *
 * `products.category_id` is TEXT and stores the canonical category SLUG
 * (migrations 015/029 converted it from UUID for exactly this reason). The slug
 * is also what the frontend StoreProductCategory union, category URLs and the
 * public catalog all use, so the API normalises every accepted identifier
 * (slug or UUID) to a slug.
 *
 * No category name or slug is hard-coded here: every check is a DB lookup that
 * the caller injects, which keeps this module pure and unit-testable.
 */

export interface CategoryLookupRow {
  slug: string;
  is_active: boolean;
}

/** Injected lookup: resolves a raw slug/UUID to a category row, or null. */
export type CategoryLookup = (raw: string) => Promise<CategoryLookupRow | null>;

export const CATEGORY_UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Clean, client-safe message for every INVALID_CATEGORY response. */
export const INVALID_CATEGORY_MESSAGE = "Selected category is invalid or unavailable.";

/**
 * Validate a category selection and return the canonical slug.
 *
 * - empty/undefined input is allowed (category is optional) and yields null
 * - a non-string, unknown slug, unknown UUID, inactive category, or a row with
 *   no slug is rejected with INVALID_CATEGORY_MESSAGE
 */
export async function validateCategory(
  input: unknown,
  lookup: CategoryLookup,
): Promise<{ ok: boolean; categorySlug: string | null; error?: string }> {
  if (input === undefined || input === null || input === "") {
    return { ok: true, categorySlug: null };
  }
  if (typeof input !== "string") {
    return { ok: false, categorySlug: null, error: INVALID_CATEGORY_MESSAGE };
  }
  const raw = input.trim();
  if (!raw) return { ok: true, categorySlug: null };

  const row = await lookup(raw);
  if (!row) return { ok: false, categorySlug: null, error: INVALID_CATEGORY_MESSAGE };
  if (!row.is_active) return { ok: false, categorySlug: null, error: INVALID_CATEGORY_MESSAGE };

  const slug = typeof row.slug === "string" ? row.slug.trim() : "";
  if (!slug) return { ok: false, categorySlug: null, error: INVALID_CATEGORY_MESSAGE };

  return { ok: true, categorySlug: slug };
}
