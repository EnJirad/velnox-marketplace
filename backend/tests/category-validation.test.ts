/**
 * Category validation — canonical identifier + schema consistency.
 *
 * The Product API validates a seller's category selection against the real
 * `categories` table (never a hard-coded list) and stores the canonical SLUG in
 * `products.category_id`.
 *
 * Unit tests (always run) cover the pure validator with an injected lookup.
 * Static tests verify the category schema/source-of-truth wiring, so a query
 * referencing a column the schema does not define (the
 * `column "is_active" does not exist` regression) fails the suite.
 * The integration test (skipped without DATABASE_URL) checks the live schema.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import {
  CATEGORY_UUID_RE,
  INVALID_CATEGORY_MESSAGE,
  validateCategory,
  type CategoryLookupRow,
} from "../lib/categories.js";

const REPO_ROOT = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(REPO_ROOT, rel), "utf-8");

// ─── validateCategory (pure, always runs) ──────────────────────────────────

describe("validateCategory", () => {
  const UUID = "a0000001-0000-0000-0000-000000000001";
  const rows: Record<string, CategoryLookupRow> = {
    "food-beverage": { slug: "food-beverage", is_active: true },
    "discontinued": { slug: "discontinued", is_active: false },
    [UUID]: { slug: "food-beverage", is_active: true },
  };
  const lookup = async (raw: string) => rows[raw] ?? null;

  test("accepts an active category slug and returns the canonical slug", async () => {
    const result = await validateCategory("food-beverage", lookup);
    expect(result.ok).toBe(true);
    expect(result.categorySlug).toBe("food-beverage");
  });

  test("trims the incoming value before lookup", async () => {
    const result = await validateCategory("  food-beverage  ", lookup);
    expect(result.ok).toBe(true);
    expect(result.categorySlug).toBe("food-beverage");
  });

  test("accepts a category UUID and normalises it to the canonical slug", async () => {
    const result = await validateCategory(UUID, lookup);
    expect(result.ok).toBe(true);
    expect(result.categorySlug).toBe("food-beverage");
  });

  test("rejects an unknown category with INVALID_CATEGORY", async () => {
    const result = await validateCategory("no-such-category", lookup);
    expect(result.ok).toBe(false);
    expect(result.categorySlug).toBeNull();
    expect(result.error).toBe(INVALID_CATEGORY_MESSAGE);
  });

  test("rejects an inactive category", async () => {
    const result = await validateCategory("discontinued", lookup);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(INVALID_CATEGORY_MESSAGE);
  });

  test("rejects a non-string category", async () => {
    const result = await validateCategory(42, lookup);
    expect(result.ok).toBe(false);
    expect(result.error).toBe(INVALID_CATEGORY_MESSAGE);
  });

  test("treats a missing/empty category as optional (ok, no slug)", async () => {
    for (const value of [undefined, null, "", "   "]) {
      const result = await validateCategory(value, lookup);
      expect(result.ok).toBe(true);
      expect(result.categorySlug).toBeNull();
    }
  });

  test("rejects a row whose slug is empty", async () => {
    const result = await validateCategory("blank", async () => ({ slug: "  ", is_active: true }));
    expect(result.ok).toBe(false);
    expect(result.error).toBe(INVALID_CATEGORY_MESSAGE);
  });

  test("the shared message is client-safe (no SQL/column names)", () => {
    expect(INVALID_CATEGORY_MESSAGE).not.toMatch(/is_active|select |column|pg_/i);
  });

  test("CATEGORY_UUID_RE recognises UUIDs only", () => {
    expect(CATEGORY_UUID_RE.test(UUID)).toBe(true);
    expect(CATEGORY_UUID_RE.test("food-beverage")).toBe(false);
  });
});

// ─── Category schema is the single source of truth ─────────────────────────

describe("category schema consistency", () => {
  const migration = read("db/migrations/040_verification_and_categories.sql");

  test("V0040 defines every column the Product API reads", () => {
    for (const column of ["is_active", "names", "description", "description_names", "image_url"]) {
      expect(migration).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
  });

  test("V0040 is idempotent (safe to re-apply at startup)", () => {
    expect(migration).toContain("ON CONFLICT (slug) DO UPDATE");
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS");
  });

  test("db/schema.sql documents the same category columns", () => {
    const schema = read("db/schema.sql");
    expect(schema).toContain("CREATE TABLE IF NOT EXISTS categories");
    expect(schema).toContain("is_active BOOLEAN NOT NULL DEFAULT TRUE");
  });

  test("no migration contains a backslash-escaped quote (psql-invalid)", () => {
    // Regression guard for the actual production failure: V0040 shipped
    // `'Men\'s Clothing'`. With standard_conforming_strings=on the literal ends
    // at `Men\` and psql aborts with "invalid command \'s", so the whole
    // --single-transaction migration (including the ALTERs that add is_active)
    // is rolled back. Doubling the quote is the only valid escape.
    const files = [
      ...readdirSync(join(REPO_ROOT, "db", "migrations"))
        .filter((f) => f.endsWith(".sql"))
        .map((f) => `db/migrations/${f}`),
      "db/run-update.sql",
      "db/run-sqleditor.sql",
      "db/schema.sql",
    ];
    for (const file of files) {
      expect(read(file)).not.toContain("\\'");
    }
  });

  test("V0040 apostrophe seed rows use the doubled-quote escape", () => {
    for (const value of ["Men''s Clothing", "Women''s Clothing", "Children''s Clothing"]) {
      expect(migration).toContain(`'${value}'`);
    }
  });

  test("db/run-update.sql history mirrors the same escape fix", () => {
    expect(read("db/run-update.sql")).toContain("'Men''s Clothing'");
  });

  test("product counts use the canonical slug stored in products.category_id", () => {
    const products = read("backend/routes/products.ts");
    expect(products).not.toContain("p.category_id = c.id");
    expect(products).toContain("p.category_id = c.slug");
  });

  test("no stale hard-coded category whitelist remains", () => {
    const products = read("backend/routes/products.ts");
    expect(products).not.toContain("VALID_CATEGORIES");
    expect(products).not.toContain('"general", "food", "daily"');
  });
});

// ─── Integration (needs DATABASE_URL) ──────────────────────────────────────

describe("categories table (integration)", () => {
  const hasDb = Boolean(process.env.DATABASE_URL);
  const testFn = hasDb ? test : test.skip;

  testFn("the live schema has the V0040 category columns", async () => {
    const { query } = await import("../db/index.js");
    const r = await query(
      `SELECT column_name, data_type FROM information_schema.columns
       WHERE table_name = 'categories'`,
    );
    const byName = new Map(r.rows.map((row: any) => [row.column_name, row.data_type]));
    expect(byName.has("is_active")).toBe(true);
    expect(byName.has("names")).toBe(true);
    expect(byName.has("description_names")).toBe(true);
  });

  testFn("products.category_id is TEXT (stores the canonical slug)", async () => {
    const { query } = await import("../db/index.js");
    const col = await query(
      `SELECT data_type FROM information_schema.columns
       WHERE table_name = 'products' AND column_name = 'category_id'`,
    );
    expect(col.rows[0]?.data_type).toBe("text");
  });

  testFn("the exact category lookup used by the Product API succeeds", async () => {
    const { query } = await import("../db/index.js");
    // Regression guard for `column "is_active" does not exist`: this is the
    // query resolveCategory() runs on every product create/edit.
    const lookup = await query("SELECT slug, is_active FROM categories WHERE slug = $1", ["__nonexistent__"]);
    expect(Array.isArray(lookup.rows)).toBe(true);

    const active = await query("SELECT COUNT(*)::int AS n FROM categories WHERE is_active = TRUE");
    expect(active.rows[0]?.n).toBeGreaterThan(0);
  });
});
