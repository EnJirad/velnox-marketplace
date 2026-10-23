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
 *  3. The frontend must forward `verified` to the catalog, otherwise the
 *     "VelShop Verified" surface renders the whole catalog.
 *  4. `useQuery()` must actually fetch — a stub that always returned
 *     `undefined` left every VelCenter product/overview surface empty.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
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
  test("the public catalog stays published-only", () => {
    const src = read("backend/routes/products.ts");
    expect(src).toContain(`let where = "WHERE p.status = 'published'"`);
  });

  test("the product detail endpoint stays published-only", () => {
    const src = read("backend/routes/products.ts");
    expect(src).toContain("WHERE p.id = $1 AND p.status = 'published'");
  });

  test("the catalog accepts a verified-only filter", () => {
    const src = read("backend/routes/products.ts");
    expect(src).toContain('req.query.verified === "true"');
    // Velnox has ONE verification system: the seller/shop identity check.
    expect(src).toContain("s.verification_status = 'verified'");
  });
});

describe("product visibility — frontend contract", () => {
  test("catalogProductsAction forwards the verified filter", () => {
    const src = read("packages/shared/src/lib/api-routes.ts");
    const action = src.slice(src.indexOf('"api.commerce.catalogProductsAction"'));
    const body = action.slice(0, action.indexOf("apiGet("));
    expect(body).toContain('params.set("verified", "true")');
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

  test("the customer-facing V badge is a single V (no V✓)", () => {
    for (const file of [
      "packages/shared/src/components/VBadge.tsx",
      "apps/velshop/src/pages/ShopCategories.tsx",
    ]) {
      expect(read(file)).not.toContain("✓");
    }
  });
});
