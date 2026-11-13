/**
 * Catalog search + filters — the rules a marketplace is judged on.
 *
 * Two things were wrong before this change:
 *
 *  1. Search was ONE `%q%` substring over name+description. "iphone case black"
 *     matched nothing even when three separate listings would satisfy each
 *     word, and nothing was ranked: a name-exact hit sat wherever `created_at`
 *     put it.
 *  2. The only filters were category / shop / price / in-stock, and the page
 *     never told the customer WHY a list was short.
 *
 * Pure SQL cannot be executed without a database here, so these are source
 * assertions on the query builder plus on the page's filter surface.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");

const ROUTES = "backend/routes/products.ts";
const API = "packages/shared/src/lib/api-routes.ts";
const PAGE = "apps/velshop/src/pages/ShopProducts.tsx";
const GRID = "packages/shared/src/components/shop/ProductGrid.tsx";

function catalogHandler(): string {
  const src = read(ROUTES);
  const start = src.indexOf('app.get("/api/products/catalog"');
  const end = src.indexOf('app.get("/api/products/:productId"', start);
  expect(start).toBeGreaterThan(-1);
  return src.slice(start, end);
}

describe("search — words, not one long substring", () => {
  test("the query is split into tokens and capped", () => {
    const src = catalogHandler();
    expect(src).toContain("q.trim().toLowerCase().split(/\\s+/)");
    expect(src).toContain(".slice(0, 6)");
  });

  test("every token must match, across every field a customer means", () => {
    const src = catalogHandler();
    // Name, short description, description, brand (supplier), shop, category.
    for (const field of [
      "p.name ILIKE",
      "p.short_description",
      "p.description",
      "p.supplier",
      "sh.name ILIKE",
      "c.name",
    ]) {
      expect(src).toContain(field);
    }
    // The strict pass joins the token predicates with AND, never OR.
    expect(src).toContain('parts.join(` ${searchJoin} `)');
    expect(src).toContain('(searchJoin: "AND" | "OR")');
  });

  test("a precise search that finds nothing falls back to the loose pass", () => {
    const src = catalogHandler();
    expect(src).toContain('let result = await runCatalog("AND");');
    expect(src).toContain("if (result.rows.length === 0 && tokens.length > 1)");
    expect(src).toContain('result = await runCatalog("OR");');
  });

  test("results are ranked by how well they answer the query", () => {
    const src = catalogHandler();
    // exact name > name prefix > name contains > shop name > brand > the rest
    expect(src).toContain("WHEN lower(p.name) = ${exactPh} THEN 100");
    expect(src).toContain("WHEN lower(p.name) LIKE ${prefixPh} THEN 60");
    expect(src).toContain("WHEN lower(p.name) LIKE ${containsPh} THEN 40");
    expect(src).toContain("WHEN lower(sh.name) LIKE ${containsPh} THEN 25");
    // …and that score actually drives the order.
    expect(src).toContain("ORDER BY ${relevance} DESC, p.sold_count DESC, p.created_at DESC");
  });

  test("an explicit sort still wins over relevance", () => {
    const src = catalogHandler();
    expect(src).toContain('sortBy === "newest" || sortBy === "relevance"');
    expect(src).toContain('case "price_asc"');
    expect(src).toContain('case "rating"');
    expect(src).toContain('case "discount"');
  });
});

describe("filters — the standard marketplace set", () => {
  test("rating and on-sale filters exist and are NULL-safe", () => {
    const src = catalogHandler();
    expect(src).toContain("COALESCE(p.rating, 0) >= $${idx}");
    expect(src).toContain("p.compare_at_price IS NOT NULL AND p.compare_at_price > p.price");
  });

  test("the API layer forwards them, and accepts both sort spellings", () => {
    const src = read(API);
    const action = src.slice(src.indexOf('"api.commerce.catalogProductsAction"'));
    const body = action.slice(0, action.indexOf("apiGet("));
    expect(body).toContain('params.set("minRating"');
    expect(body).toContain('params.set("onSale", "true")');
    // ProductGrid used to send `sort` while the mapper read `sortBy`, so the
    // sort was silently dropped and every grid came back "newest".
    expect(body).toContain("a?.sortBy ?? a?.sort");
  });

  test("ProductGrid passes the new filters through", () => {
    const src = read(GRID);
    expect(src).toContain("minRating?: string;");
    expect(src).toContain("onSale?: boolean;");
    expect(src).toContain("if (minRating) params.minRating = minRating;");
    expect(src).toContain('if (onSale) params.onSale = "true";');
  });

  test("the market page ships price bands and rating bands, not just two inputs", () => {
    const src = read(PAGE);
    expect(src).toContain("const PRICE_BANDS");
    expect(src).toContain("const RATING_BANDS");
    expect(src).toContain('params.get("rating")');
    expect(src).toContain('params.get("sale") === "1"');
  });

  test("active filters are visible and removable, not hidden in a sheet", () => {
    const src = read(PAGE);
    expect(src).toContain("const activeChips = useMemo(");
    expect(src).toContain('t("products.activeFilters")');
    expect(src).toContain("activeChips.map((chip)");
    expect(src).toContain('t("products.clearAll")');
  });
});

describe("the V is gone from the market (owner decision 2026-11-11)", () => {
  test("no V filter, no verified param, no verified-only prop", () => {
    const page = read(PAGE);
    expect(page).not.toContain("verifiedOnly");
    expect(page).not.toContain('"verified"');
    expect(page).not.toContain("velshopVerifiedFilter");
    expect(read(GRID)).not.toContain("verifiedOnly");
  });
});
