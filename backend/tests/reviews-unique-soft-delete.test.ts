/**
 * P1 #6 — product_reviews uniqueness + product soft-delete.
 *
 * Unit tests (always run) verify the migration/schema sync: the unique
 * constraint must be present in the migration file AND in all three schema
 * files (schema.sql / run-sqleditor.sql / run-update.sql).
 *
 * Integration tests (DB-gated, skipped without DATABASE_URL) verify:
 *   1. The atomic ON CONFLICT upsert collapses concurrent double-submits
 *      into ONE review row per (product, user); the latest rating wins.
 *   2. The UNIQUE(product_id, user_id) constraint rejects a second row.
 *   3. Soft-delete (archive) preserves reviews + VelRepeat plan items that a
 *      hard DELETE used to CASCADE away, and removes the product from the
 *      published catalog.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

// ─── Migration / schema sync (pure, always runs) ───────────────────────────

describe("P1 #6 migration + schema sync", () => {
  const root = join(import.meta.dir, "../..");

  test("migration 038 adds the unique constraint and dedupe + recompute", () => {
    const sql = readFileSync(join(root, "db/migrations/038_product_reviews_unique.sql"), "utf8");
    expect(sql).toContain("uq_product_reviews_product_user");
    expect(sql).toContain("ALTER TABLE product_reviews");
    expect(sql).toContain("UNIQUE (product_id, user_id)");
    // dedupe keeps the newest review per (product, user)
    expect(sql).toContain("DELETE FROM product_reviews a");
    // aggregates are recomputed after the dedupe
    expect(sql).toContain("AVG(rating)");
    expect(sql).toContain("review_count");
  });

  test("schema.sql and run-sqleditor.sql carry the inline UNIQUE constraint", () => {
    for (const file of ["db/schema.sql", "db/run-sqleditor.sql"]) {
      const sql = readFileSync(join(root, file), "utf8");
      const block = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS product_reviews"));
      const createEnd = block.indexOf(");");
      expect(block.slice(0, createEnd), file).toContain("UNIQUE (product_id, user_id)");
    }
  });

  test("run-update.sql appends the V0038 migration", () => {
    const sql = readFileSync(join(root, "db/run-update.sql"), "utf8");
    expect(sql).toContain("Migration: V0038");
    expect(sql).toContain("uq_product_reviews_product_user");
  });
});

// ─── Integration (needs DATABASE_URL) ──────────────────────────────────────

describe("product_reviews uniqueness + soft delete (integration)", () => {
  const hasDb = Boolean(process.env.DATABASE_URL);
  const testFn = hasDb ? test : test.skip;

  /** Idempotently ensure the migration-038 constraint exists on the test DB. */
  async function ensureUniqueConstraint() {
    const { query } = await import("../db/index.js");
    await query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'uq_product_reviews_product_user'
        ) THEN
          ALTER TABLE product_reviews
            ADD CONSTRAINT uq_product_reviews_product_user UNIQUE (product_id, user_id);
        END IF;
      END $$;
    `);
  }

  async function seed() {
    const { query } = await import("../db/index.js");
    const tag = Date.now() + "-" + Math.random().toString(36).slice(2, 8);
    const mkUser = async (email: string) => {
      const u = await query("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id", [
        email,
        "P1#6 Test",
      ]);
      return u.rows[0].id as string;
    };
    const userId = await mkUser(`p16-customer-${tag}@test.local`);
    const seller = await query(
      "INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id",
      [userId],
    );
    const sellerId = seller.rows[0].id as string;
    const shop = await query(
      "INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id",
      [sellerId, "P1#6 Shop", `p16-shop-${tag}`],
    );
    const shopId = shop.rows[0].id as string;
    const prod = await query(
      "INSERT INTO products (shop_id, name, slug, price, status) VALUES ($1, $2, $3, 100, 'published') RETURNING id",
      [shopId, "P1#6 Product", `p16-product-${tag}`],
    );
    const productId = prod.rows[0].id as string;
    return { query, userId, sellerId, shopId, productId };
  }

  testFn("upsert collapses concurrent double-submits into one review (latest rating wins)", async () => {
    await ensureUniqueConstraint();
    const { query, userId, shopId, productId } = await seed();

    const upsert = async (rating: number, comment: string) => {
      const r = await query(
        `INSERT INTO product_reviews (product_id, user_id, shop_id, order_id, rating, comment, status)
         VALUES ($1, $2, $3, NULL, $4, $5, 'approved')
         ON CONFLICT (product_id, user_id) DO UPDATE
           SET rating = EXCLUDED.rating,
               comment = EXCLUDED.comment,
               status = 'approved',
               updated_at = NOW()
         RETURNING id`,
        [productId, userId, shopId, rating, comment],
      );
      return r.rows[0].id as string;
    };

    const firstId = await upsert(4, "first submit");
    const secondId = await upsert(2, "second submit");
    expect(secondId).toBe(firstId); // same row, not a duplicate

    const rows = await query(
      "SELECT rating, comment FROM product_reviews WHERE product_id = $1 AND user_id = $2",
      [productId, userId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].rating).toBe(2);
    expect(rows.rows[0].comment).toBe("second submit");
  });

  testFn("unique constraint rejects a second review row for the same (product, user)", async () => {
    await ensureUniqueConstraint();
    const { query, userId, shopId, productId } = await seed();

    await query(
      `INSERT INTO product_reviews (product_id, user_id, shop_id, rating, comment, status)
       VALUES ($1, $2, $3, 5, 'one', 'approved')`,
      [productId, userId, shopId],
    );

    let rejected = false;
    try {
      await query(
        `INSERT INTO product_reviews (product_id, user_id, shop_id, rating, comment, status)
         VALUES ($1, $2, $3, 3, 'two', 'approved')`,
        [productId, userId, shopId],
      );
    } catch {
      rejected = true;
    }
    expect(rejected).toBe(true);

    const rows = await query(
      "SELECT COUNT(*)::int AS c FROM product_reviews WHERE product_id = $1 AND user_id = $2",
      [productId, userId],
    );
    expect(rows.rows[0].c).toBe(1);
  });

  testFn("archiving a product preserves reviews + VelRepeat items and hides it from the catalog", async () => {
    const { query, userId, sellerId, shopId, productId } = await seed();
    await ensureUniqueConstraint();

    // customer review
    await query(
      `INSERT INTO product_reviews (product_id, user_id, shop_id, rating, comment, status)
       VALUES ($1, $2, $3, 5, 'great product', 'approved')`,
      [productId, userId, shopId],
    );

    // VelRepeat plan + item referencing the product
    const plan = await query(
      `INSERT INTO velrepeat_plans (user_id, status, frequency_type, interval_value, next_run_at)
       VALUES ($1, 'active', 'weeks', 2, NOW() + interval '7 days') RETURNING id`,
      [userId],
    );
    const planId = plan.rows[0].id as string;
    await query(
      `INSERT INTO velrepeat_items (plan_id, product_id, shop_id, seller_id, quantity, unit_price)
       VALUES ($1, $2, $3, $4, 1, 100)`,
      [planId, productId, shopId, sellerId],
    );

    // What DELETE /api/seller/products/:productId now does: archive, not delete
    await query(`UPDATE products SET status = 'archived', updated_at = NOW() WHERE id = $1`, [productId]);

    // product row survives as archived
    const prod = await query("SELECT status FROM products WHERE id = $1", [productId]);
    expect(prod.rows).toHaveLength(1);
    expect(prod.rows[0].status).toBe("archived");

    // catalog (status = 'published') no longer returns it
    const catalog = await query("SELECT id FROM products WHERE id = $1 AND status = 'published'", [productId]);
    expect(catalog.rows).toHaveLength(0);

    // review survived (hard DELETE used to CASCADE it away)
    const reviews = await query("SELECT id FROM product_reviews WHERE product_id = $1", [productId]);
    expect(reviews.rows).toHaveLength(1);

    // VelRepeat item survived (hard DELETE used to CASCADE it away)
    const items = await query("SELECT id FROM velrepeat_items WHERE product_id = $1", [productId]);
    expect(items.rows).toHaveLength(1);
  });
});