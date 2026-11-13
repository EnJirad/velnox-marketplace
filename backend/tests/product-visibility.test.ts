/**
 * Product visibility regression guards.
 *
 * Context: "previously created products are no longer appearing" was caused by
 * defects spread across the product-visibility pipeline rather than by one
 * broken query. These are static/source-level guards (same style as
 * `category-validation.test.ts`) so the exact bugs cannot silently return:
 *
 *  1. `products.category_id` stores the canonical category SLUG (migrations
 *     V0015 / V0029; `validateCategory` returns `categorySlug`). Joining it to
 *     `categories.id` (uuid) can never match, which silently produced
 *     `categorySlug: null` and zero category product counts.
 *  2. The public catalog and product detail must only expose `published` rows.
 *  3. The storefront must NOT render or forward a `verified` / V filter any
 *     more (owner decision 2026-11-11). Seller identity verification still
 *     runs in VelCenter; it is not a shopping filter.
 *  4. `useQuery()` must actually fetch — a stub that always returned
 *     `undefined` left every VelCenter product/overview surface empty.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(repoRoot, rel), "utf-8");

describe("product visibility — category key compatibility", () => {
  test("no product query joins categories by uuid instead of slug", () => {
    const src = read("backend/routes/products.ts");
    expect(src).not.toContain("c.id::text = p.category_id");
    expect(src).toContain("LEFT JOIN categories c ON c.slug = p.category_id");
  });

  test("category product counts compare the slug column", () => {
    const src = read("backend/routes/products.ts");
    expect(src).toContain("p.category_id = c.slug AND p.status = 'published'");
    expect(src).not.toContain("p.category_id = c.id");
  });

  test("products.category_id is TEXT (slug), never a uuid foreign key", () => {
    const schema = read("db/schema.sql");
    const productsTable = schema.slice(schema.indexOf("CREATE TABLE IF NOT EXISTS products ("));
    const column = productsTable.slice(productsTable.indexOf("category_id"));
    expect(column.startsWith("category_id TEXT")).toBe(true);
  });
});

describe("product visibility — catalog contract", () => {
  test("the public catalog stays published-only and hides suspended shops", () => {
    const src = read("backend/routes/products.ts");
    // Publishing is only half the rule: a suspended shop must not keep selling.
    expect(src).toContain(`const BASE_WHERE = "WHERE p.status = 'published' AND sh.status = 'active'"`);
  });

  test("the product detail endpoint stays published-only", () => {
    const src = read("backend/routes/products.ts");
    expect(src).toContain("WHERE p.id = $1 AND p.status = 'published'");
  });

  test("the storefront no longer filters by verification (V removed 2026-11-11)", () => {
    // The V is not a shopping filter any more. Seller identity verification
    // still exists in VelCenter's review queue; it simply must not narrow the
    // customer's catalog. Re-adding `req.query.verified` here would silently
    // resurrect the removed filter.
    const src = read("backend/routes/products.ts");
    expect(src).not.toContain('req.query.verified === "true"');
    expect(src).not.toContain("s.verification_status = 'verified'");
  });
});

describe("product visibility — frontend contract", () => {
  test("catalogProductsAction no longer forwards a verified filter", () => {
    const src = read("packages/shared/src/lib/api-routes.ts");
    const action = src.slice(src.indexOf('"api.commerce.catalogProductsAction"'));
    const body = action.slice(0, action.indexOf("apiGet("));
    expect(body).not.toContain('params.set("verified", "true")');
  });

  test("useQuery performs a request instead of returning undefined", () => {
    const src = read("packages/shared/src/lib/api-routes.ts");
    const hook = src.slice(src.indexOf("export function useQuery"));
    const body = hook.slice(0, hook.indexOf("export function useMutation"));
    expect(body).toContain("useState");
    expect(body).toContain("useEffect");
    // The old stub: `if (!handler) return undefined; return undefined;`
    expect(body).not.toMatch(/if \(!handler\) return undefined;\s*\n\s*return undefined;/);
  });

  test("the customer-facing storefront carries no V at all (owner decision 2026-11-11)", () => {
    // The V badge component is gone and no VelShop page renders a V filter or
    // card. Seller identity verification still runs in VelCenter — it is just
    // not part of what a customer browses or filters by.
    expect(existsSync(join(repoRoot, "packages/shared/src/components/VBadge.tsx"))).toBe(false);
    for (const file of [
      "apps/velshop/src/pages/ShopProducts.tsx",
      "apps/velshop/src/pages/ShopCategories.tsx",
      "apps/velshop/src/pages/ShopHome.tsx",
    ]) {
      const src = read(file);
      expect(src).not.toContain("verified=true");
      expect(src).not.toContain("velshopVerifiedFilter");
      expect(src).not.toContain("verifiedOnly");
    }
  });
});
