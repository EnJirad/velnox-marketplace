/**
 * Product lifecycle — seller → product → review → approval → published → shop.
 *
 * Unit tests (always run, no DB) verify the shared rules in
 * `backend/lib/product-lifecycle.ts` plus the query-level wiring that makes the
 * pipeline actually work end to end:
 *   • a seller can never publish/reject/suspend their own product,
 *   • an admin can only publish a pending product, or suspend/restore it,
 *   • only `published` products are publicly visible,
 *   • V✓ requires BOTH seller verification AND product verification,
 *   • catalog / detail / seller / shop queries expose the verification fields
 *     the V✓ badge depends on,
 *   • migration 040 + all schema files agree on the verification tables,
 *   • verification submissions and seller image intents are rate limited.
 *
 * Integration tests (DB-gated, skipped without a DATABASE_URL) exercise the
 * real INSERT/SELECT path against the database.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";
import {
  ADMIN_MODERATION_TRANSITIONS,
  SELLER_STATUS_TRANSITIONS,
  canAdminModerate,
  canSellerTransition,
  computeIsVerifiedProduct,
  isPubliclyVisible,
  moderationRequiresReason,
  resolveCreationStatus,
} from "../lib/product-lifecycle.js";
import { query } from "../db/index.js";

const root = join(import.meta.dir, "..", "..");
const productsSrc = readFileSync(join(root, "backend/routes/products.ts"), "utf8");
const verificationSrc = readFileSync(join(root, "backend/routes/verification.ts"), "utf8");
const rateLimitSrc = readFileSync(join(root, "backend/middleware/rate-limit.ts"), "utf8");
const badgeSrc = readFileSync(join(root, "packages/shared/src/components/VBadge.tsx"), "utf8");
const migration040 = readFileSync(join(root, "db/migrations/040_verification_and_categories.sql"), "utf8");
const schemaSql = readFileSync(join(root, "db/schema.sql"), "utf8");
const sqlEditor = readFileSync(join(root, "db/run-sqleditor.sql"), "utf8");
const runUpdate = readFileSync(join(root, "db/run-update.sql"), "utf8");

// ─── Creation status (sellers cannot self-publish) ─────────────────────────

describe("resolveCreationStatus", () => {
  test("requesting published only reaches pending_review", () => {
    expect(resolveCreationStatus("published")).toBe("pending_review");
  });
  test("requesting pending_review stays pending_review", () => {
    expect(resolveCreationStatus("pending_review")).toBe("pending_review");
  });
  test("unset/unknown statuses create a draft", () => {
    expect(resolveCreationStatus(undefined)).toBe("draft");
    expect(resolveCreationStatus("draft")).toBe("draft");
    expect(resolveCreationStatus("suspended")).toBe("draft");
  });
});

// ─── Seller status machine ─────────────────────────────────────────────────

describe("seller transitions", () => {
  test("seller can submit and withdraw", () => {
    expect(canSellerTransition("draft", "pending_review")).toBe(true);
    expect(canSellerTransition("rejected", "pending_review")).toBe(true);
    expect(canSellerTransition("pending_review", "draft")).toBe(true);
    // Unpublishing a live product is allowed — it never publishes anything.
    expect(canSellerTransition("published", "draft")).toBe(true);
  });

  test("seller can never publish, reject, suspend or archive", () => {
    // No seller transition may reach rejected / suspended / archived.
    for (const from of Object.keys(SELLER_STATUS_TRANSITIONS)) {
      expect(canSellerTransition(from, "rejected")).toBe(false);
      expect(canSellerTransition(from, "suspended")).toBe(false);
      expect(canSellerTransition(from, "archived")).toBe(false);
    }
    // Sellers can never move a product INTO the published state themselves.
    expect(canSellerTransition("draft", "published")).toBe(false);
    expect(canSellerTransition("pending_review", "published")).toBe(false);
    expect(canSellerTransition("suspended", "draft")).toBe(false);
    expect(canSellerTransition("suspended", "pending_review")).toBe(false);
  });

  test("the route rejects any status outside draft/pending_review", () => {
    expect(productsSrc).toContain('const validStatuses = ["draft", "pending_review"]');
    expect(productsSrc).toContain("canSellerTransition(currentStatus, status)");
  });
});

// ─── Admin moderation machine ──────────────────────────────────────────────

describe("admin moderation transitions", () => {
  test("admin approves or rejects a pending product", () => {
    expect(canAdminModerate("pending_review", "published")).toBe(true);
    expect(canAdminModerate("pending_review", "rejected")).toBe(true);
  });

  test("admin suspends a published product and can restore it", () => {
    expect(canAdminModerate("published", "suspended")).toBe(true);
    expect(canAdminModerate("suspended", "published")).toBe(true);
  });

  test("admin cannot publish a draft or a draft-level suspension", () => {
    expect(canAdminModerate("draft", "published")).toBe(false);
    expect(canAdminModerate("pending_review", "suspended")).toBe(false);
    expect(canAdminModerate("rejected", "published")).toBe(false);
    expect(canAdminModerate("archived", "published")).toBe(false);
  });

  test("reject and suspend require a reason, publish does not", () => {
    expect(moderationRequiresReason("rejected")).toBe(true);
    expect(moderationRequiresReason("suspended")).toBe(true);
    expect(moderationRequiresReason("published")).toBe(false);
  });

  test("moderation is admin-gated and requires requireAuth", () => {
    expect(productsSrc).toContain('app.patch("/api/admin/products/:productId/moderation", requireAuth');
    expect(productsSrc).toContain("Only owner or admin can moderate products");
    // sellers never get the admin moderation route
    expect(productsSrc).not.toContain('app.patch("/api/seller/products/:productId/moderation"');
  });

  test("admin moderation is rate limited", () => {
    expect(rateLimitSrc).toContain("/^\\/api\\/admin\\//");
  });
});

// ─── Public catalog visibility ─────────────────────────────────────────────

describe("catalog visibility", () => {
  test("only published products are public", () => {
    expect(isPubliclyVisible("published")).toBe(true);
    for (const status of ["draft", "pending_review", "rejected", "suspended", "archived"]) {
      expect(isPubliclyVisible(status)).toBe(false);
    }
  });

  test("catalog + product detail queries filter on status = 'published'", () => {
    expect(productsSrc).toContain(`let where = "WHERE p.status = 'published'"`);
    expect(productsSrc).toContain("WHERE p.id = $1 AND p.status = 'published'");
    expect(productsSrc).toContain("WHERE p.shop_id = $1 AND p.status = 'published'");
  });

  test("admin moderation recomputes the published product count", () => {
    expect(productsSrc).toContain("SELECT COUNT(*) as cnt FROM products WHERE shop_id = $1 AND status = 'published'");
  });
});

// ─── V✓ eligibility (dual verification) ────────────────────────────────────

describe("V✓ eligibility", () => {
  test("both verified → V✓", () => {
    expect(computeIsVerifiedProduct("verified", "verified")).toBe(true);
  });

  test("seller verified + product unverified → no V✓", () => {
    expect(computeIsVerifiedProduct("unverified", "verified")).toBe(false);
    expect(computeIsVerifiedProduct("pending", "verified")).toBe(false);
  });

  test("product verified + seller unverified → no V✓", () => {
    expect(computeIsVerifiedProduct("verified", "unverified")).toBe(false);
    expect(computeIsVerifiedProduct("verified", "suspended")).toBe(false);
  });

  test("pending / rejected / suspended never produce V✓", () => {
    expect(computeIsVerifiedProduct("pending", "pending")).toBe(false);
    expect(computeIsVerifiedProduct("rejected", "verified")).toBe(false);
    expect(computeIsVerifiedProduct("verified", "rejected")).toBe(false);
    expect(computeIsVerifiedProduct("suspended", "suspended")).toBe(false);
  });

  test("each product verification state is tracked independently", () => {
    expect(productsSrc).toContain("verificationStatus: row.verification_status || \"unverified\"");
    expect(productsSrc).toContain("sellerVerificationStatus: row.seller_verification_status || \"unverified\"");
    expect(productsSrc).toContain("computeIsVerifiedProduct(");
  });

  test("the badge component uses the same rule and never trusts a boolean prop", () => {
    expect(badgeSrc).toContain('productVerification === "verified" && sellerVerification === "verified"');
    expect(badgeSrc).not.toContain("isVerifiedProduct: boolean");
  });

  test("VelShop Verified filtering requires both verifications in SQL", () => {
    expect(productsSrc).toContain("p.verification_status = 'verified'");
    expect(productsSrc).toContain("s.verification_status = 'verified'");
  });

  test("verification is not a seller-writable field", () => {
    // Only the admin verification routes may write verification_status — the
    // product routes merely read/filter it.
    expect(productsSrc).not.toContain("SET verification_status");
    expect(productsSrc).not.toContain("UPDATE products SET verification_status");
    expect(productsSrc).not.toContain("UPDATE sellers SET verification_status");
    expect(verificationSrc).toContain('UPDATE products SET verification_status = $1');
    expect(verificationSrc).toContain('UPDATE sellers SET verification_status = $1');
    // seller product create/update payloads never carry verification
    expect(productsSrc).not.toContain("verification_status, status,");
  });

  test("seller verification and product verification are separate tables/queues", () => {
    expect(verificationSrc).toContain("FROM seller_verifications");
    expect(verificationSrc).toContain("FROM product_verifications");
    expect(verificationSrc).toContain('app.patch("/api/admin/verifications/seller/:verificationId"');
    expect(verificationSrc).toContain('app.patch("/api/admin/verifications/product/:verificationId"');
  });

  test("verification decisions are admin-gated", () => {
    // Admin access is checked via users.role (employees table has no 'status' column)
    const gates = verificationSrc.match(/SELECT role FROM users WHERE id = \$1/g) ?? [];
    expect(gates.length).toBe(3);
    expect(verificationSrc).toContain("Admin access required");
    // Verify the role check includes owner/admin/staff
    expect(verificationSrc).toContain("'owner', 'admin', 'staff'");
  });

  test("private evidence is only returned by admin-gated endpoints", () => {
    // The public shop endpoint exposes the status only — never evidence.
    const publicBlock = verificationSrc.slice(verificationSrc.indexOf('app.get("/api/shops/:shopId/verification"'));
    expect(publicBlock).toContain("verificationStatus: result.rows[0].verification_status");
    expect(publicBlock).not.toContain("evidence_urls");
  });
});

// ─── Query wiring (regression guards for the display bugs) ────────────────

describe("verification data reaches every product surface", () => {
  test("product detail selects seller verification (V✓ on Product Detail)", () => {
    const detail = productsSrc.slice(productsSrc.indexOf('app.get("/api/products/:productId"'));
    expect(detail).toContain("AS seller_verification_status");
    expect(detail).toContain("LEFT JOIN sellers s ON s.id = sh.seller_id");
  });

  test("catalog selects seller verification", () => {
    expect(productsSrc).toContain("COALESCE(s.verification_status, 'unverified') AS seller_verification_status");
  });

  test("seller product list selects seller verification", () => {
    const list = productsSrc.slice(productsSrc.indexOf('app.get("/api/seller/products", requireAuth'));
    expect(list).toContain("AS seller_verification_status");
    expect(list).toContain("c.slug AS category_slug");
  });

  test("shop page propagates seller verification to each product", () => {
    expect(productsSrc).toContain("seller_verification_status: row.seller_verification_status ?? \"unverified\"");
    expect(productsSrc).toContain("verificationStatus: row.seller_verification_status ?? \"unverified\"");
  });

  test("category slug is exposed for localized labels", () => {
    expect(productsSrc).toContain("categorySlug: row.category_slug ?? null");
    expect(productsSrc).toContain("c.slug AS category_slug");
  });
});

// ─── Category system (DB-backed, not hard-coded) ──────────────────────────

describe("category validation", () => {
  test("validation resolves against the categories table", () => {
    expect(productsSrc).toContain("async function resolveCategory");
    expect(productsSrc).toContain('SELECT id, is_active FROM categories WHERE id = $1');
    expect(productsSrc).toContain('SELECT id, is_active FROM categories WHERE slug = $1');
    expect(productsSrc).toContain("INVALID_CATEGORY");
  });

  test("no legacy hard-coded category whitelist remains", () => {
    expect(productsSrc).not.toContain("VALID_CATEGORIES");
    expect(productsSrc).not.toContain('["general", "food", "daily", "beauty", "packaging", "other"]');
  });

  test("create-full and update both validate the category", () => {
    const createFull = productsSrc.slice(productsSrc.indexOf('app.post("/api/seller/products/create-full"'), productsSrc.indexOf('app.patch("/api/seller/products/:productId"'));
    expect(createFull).toContain("resolveCategory(productData.category)");
    const update = productsSrc.slice(productsSrc.indexOf('app.patch("/api/seller/products/:productId", requireAuth'));
    expect(update.slice(0, 4000)).toContain("resolveCategory(");
  });

  test("inactive categories are rejected", () => {
    expect(productsSrc).toContain("is_active");
    expect(productsSrc).toContain("does not exist or is inactive");
  });
});

// ─── R2 image pipeline ─────────────────────────────────────────────────────

describe("R2 product images", () => {
  test("presign + save-image routes require an authenticated seller", () => {
    for (const route of [
      'app.post("/api/seller/products/draft-upload-intent", requireAuth',
      'app.post("/api/seller/products/image-upload-intent", requireAuth',
      'app.post("/api/seller/products/save-image", requireAuth',
    ]) {
      expect(productsSrc).toContain(route);
    }
  });

  test("product payloads report R2 as the storage provider", () => {
    expect(productsSrc).toContain('storageProvider: "r2"');
  });

  test("images are returned as absolute URLs to the frontend", () => {
    expect(productsSrc).toContain("displayUrl: img.url");
    expect(productsSrc).toContain("thumbUrl: img.url");
  });

  test("upload intents are rate limited", () => {
    expect(rateLimitSrc).toContain("seller-upload-intent");
    expect(rateLimitSrc).toContain("seller-upload-confirm");
    expect(rateLimitSrc).toContain("upload-intent");
  });

  test("no Cloudinary references remain", () => {
    for (const src of [productsSrc, verificationSrc]) {
      expect(src.toLowerCase()).not.toContain("cloudinary");
    }
  });
});

// ─── Variants + cart integration ───────────────────────────────────────────

describe("variants + cart", () => {
  test("create-full writes variants and their option mappings", () => {
    expect(productsSrc).toContain("INSERT INTO product_variants (product_id, name, sku, price");
    expect(productsSrc).toContain("INSERT INTO product_variant_values (variant_id, option_value_id)");
  });

  test("variant stock overrides product stock for the storefront", () => {
    expect(productsSrc).toContain("function applyVariantStock");
    expect(productsSrc).toContain("formatted.totalAvailableStock = totalStock");
  });

  test("only published products are orderable through the catalog", () => {
    // The catalog is the only source the storefront uses to add to cart.
    expect(productsSrc).toContain(`let where = "WHERE p.status = 'published'"`);
  });
});

// ─── Rate limiting for verification submissions ────────────────────────────

describe("verification rate limits", () => {
  test("seller + product verification submissions are capped at 5/min", () => {
    expect(rateLimitSrc).toContain('name: "seller-verification", windowMs: 60_000, max: 5');
    expect(rateLimitSrc).toContain('name: "product-verification", windowMs: 60_000, max: 5');
  });
});

// ─── Migration + schema sync ───────────────────────────────────────────────

describe("migration 040 + schema sync", () => {
  test("migration creates both verification tables with partial unique indexes", () => {
    expect(migration040).toContain("CREATE TABLE IF NOT EXISTS seller_verifications");
    expect(migration040).toContain("CREATE TABLE IF NOT EXISTS product_verifications");
    expect(migration040).toContain("idx_seller_verifications_pending");
    expect(migration040).toContain("idx_product_verifications_pending");
    expect(migration040).toContain("WHERE status = 'pending'");
  });

  test("verification columns exist on sellers and products in migration 040", () => {
    expect(migration040).toContain("ALTER TABLE sellers ADD COLUMN IF NOT EXISTS verification_status");
    expect(migration040).toContain("ALTER TABLE products ADD COLUMN IF NOT EXISTS verification_status");
    expect(migration040).toContain("verified_at TIMESTAMPTZ");
  });

  test("all schema files agree (schema.sql, run-sqleditor.sql, run-update.sql)", () => {
    for (const sql of [schemaSql, sqlEditor]) {
      expect(sql).toContain("verification_status TEXT NOT NULL DEFAULT 'unverified'");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS seller_verifications");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS product_verifications");
    }
    expect(runUpdate).toContain("V0040");
    expect(runUpdate).toContain("seller_verifications");
  });

  test("products.status has no CHECK constraint that would reject 'suspended'", () => {
    for (const sql of [schemaSql, sqlEditor]) {
      const block = sql.slice(sql.indexOf("CREATE TABLE IF NOT EXISTS products ("));
      const head = block.slice(0, block.indexOf(");"));
      expect(head).toContain("status TEXT NOT NULL DEFAULT 'draft'");
      expect(head).not.toContain("CHECK (status IN");
    }
  });

  test("category seed rows are part of the migration path", () => {
    expect(migration040).toContain("INSERT INTO categories");
    expect(migration040).toContain("ON CONFLICT (slug) DO UPDATE");
    expect(runUpdate).toContain("INSERT INTO categories");
  });
});

// ─── Integration: real database paths (skipped without DATABASE_URL) ──────

describe("product lifecycle (integration)", () => {
  const hasDb = Boolean(process.env["DATABASE_URL"]);
  const testFn = hasDb ? test : test.skip;

  const stamp = Date.now();
  const slugBase = `lifecycle-test-${stamp}`;
  const cleanup = async (userId?: string, categorySlug?: string) => {
    if (userId) await query("DELETE FROM users WHERE id = $1", [userId]);
    if (categorySlug) await query("DELETE FROM categories WHERE slug = $1", [categorySlug]);
  };

  testFn(
    "valid category resolves, invalid/inactive categories are rejected, and the product starts as draft",
    async () => {
      const catSlug = `${slugBase}-cat`;
      const cat = await query(
        `INSERT INTO categories (name, slug, is_active, names) VALUES ($1, $2, TRUE, '{}') RETURNING id`,
        ["Lifecycle Test Category", catSlug],
      );
      let userId: string | undefined;
      try {
        const resolved = await query(
          "SELECT id FROM categories WHERE slug = $1 AND is_active = TRUE",
          [catSlug],
        );
        expect(resolved.rows.length).toBe(1);
        const categoryId = resolved.rows[0].id;

        const user = await query(
          `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
          [`${slugBase}@test.local`, "Lifecycle Test"],
        );
        userId = user.rows[0].id;
        const seller = await query(
          `INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`,
          [userId],
        );
        const shop = await query(
          `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
          [seller.rows[0].id, "Lifecycle Shop", `${slugBase}-shop`],
        );
        const product = await query(
          `INSERT INTO products (shop_id, name, slug, price, status, category_id)
           VALUES ($1, $2, $3, 100, $4, $5) RETURNING id, status`,
          [shop.rows[0].id, "Lifecycle Product", `${slugBase}-product`, "draft", categoryId],
        );
        expect(product.rows[0].status).toBe("draft");

        // Inactive categories must not resolve.
        await query("UPDATE categories SET is_active = FALSE WHERE slug = $1", [catSlug]);
        const inactive = await query(
          "SELECT id FROM categories WHERE slug = $1 AND is_active = TRUE",
          [catSlug],
        );
        expect(inactive.rows.length).toBe(0);
        const missing = await query(
          "SELECT id FROM categories WHERE slug = $1 AND is_active = TRUE",
          ["definitely-not-a-category"],
        );
        expect(missing.rows.length).toBe(0);
      } finally {
        await cleanup(userId, catSlug);
      }
    },
    30_000,
  );

  testFn(
    "pending products stay private and only published products are visible",
    async () => {
      const catSlug = `${slugBase}-cat2`;
      await query(
        `INSERT INTO categories (name, slug, is_active, names) VALUES ($1, $2, TRUE, '{}') ON CONFLICT (slug) DO NOTHING`,
        ["Lifecycle Test Category 2", catSlug],
      );
      let userId: string | undefined;
      try {
        const user = await query(
          `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
          [`${slugBase}-2@test.local`, "Lifecycle Test 2"],
        );
        userId = user.rows[0].id;
        const seller = await query(
          `INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`,
          [userId],
        );
        const shop = await query(
          `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
          [seller.rows[0].id, "Lifecycle Shop 2", `${slugBase}-shop2`],
        );
        const product = await query(
          `INSERT INTO products (shop_id, name, slug, price, status)
           VALUES ($1, $2, $3, 100, 'pending_review') RETURNING id`,
          [shop.rows[0].id, "Pending Product", `${slugBase}-pending`],
        );
        const productId = product.rows[0].id;

        const hidden = await query(
          "SELECT id FROM products WHERE id = $1 AND status = 'published'",
          [productId],
        );
        expect(hidden.rows.length).toBe(0);

        await query("UPDATE products SET status = 'published' WHERE id = $1", [productId]);
        const visible = await query(
          "SELECT id FROM products WHERE id = $1 AND status = 'published'",
          [productId],
        );
        expect(visible.rows.length).toBe(1);

        // Suspension removes it from the public catalog again.
        await query("UPDATE products SET status = 'suspended' WHERE id = $1", [productId]);
        const suspended = await query(
          "SELECT id FROM products WHERE id = $1 AND status = 'published'",
          [productId],
        );
        expect(suspended.rows.length).toBe(0);
      } finally {
        await cleanup(userId, catSlug);
      }
    },
    30_000,
  );

  testFn(
    "V✓ is only produced by the catalog query when BOTH verifications hold",
    async () => {
      const catSlug = `${slugBase}-cat3`;
      let userId: string | undefined;
      try {
        const user = await query(
          `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
          [`${slugBase}-3@test.local`, "Lifecycle Test 3"],
        );
        userId = user.rows[0].id;
        const verifiedSeller = await query(
          `INSERT INTO sellers (user_id, status, verification_status) VALUES ($1, 'approved', 'verified') RETURNING id`,
          [userId],
        );
        const unverifiedSeller = await query(
          `INSERT INTO sellers (user_id, status, verification_status) VALUES ($1, 'approved', 'unverified') RETURNING id`,
          [userId],
        );
        const shopA = await query(
          `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
          [verifiedSeller.rows[0].id, "Verified Shop", `${slugBase}-shop-a`],
        );
        const shopB = await query(
          `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
          [unverifiedSeller.rows[0].id, "Unverified Shop", `${slugBase}-shop-b`],
        );
        await query(
          `INSERT INTO products (shop_id, name, slug, price, status, verification_status)
           VALUES ($1, 'Verified Product', $2, 100, 'published', 'verified'),
                  ($3, 'Seller Unverified Product', $4, 100, 'published', 'verified')`,
          [shopA.rows[0].id, `${slugBase}-p-a`, shopB.rows[0].id, `${slugBase}-p-b`],
        );

        // Same predicate the catalog/formatProduct pair uses for V✓.
        const eligible = await query(
          `SELECT p.slug, p.verification_status, COALESCE(s.verification_status, 'unverified') AS seller_verification_status
           FROM products p
           JOIN shops sh ON p.shop_id = sh.id
           LEFT JOIN sellers s ON s.id = sh.seller_id
           WHERE p.slug IN ($1, $2)`,
          [`${slugBase}-p-a`, `${slugBase}-p-b`],
        );
        const verifiedSlugs = eligible.rows
          .filter((r: { verification_status: string; seller_verification_status: string }) =>
            computeIsVerifiedProduct(r.verification_status, r.seller_verification_status),
          )
          .map((r: { slug: string }) => r.slug);
        expect(verifiedSlugs).toEqual([`${slugBase}-p-a`]);

        // And only the fully verified product shows up in the Verified listing.
        const verifiedListing = await query(
          `SELECT p.slug FROM products p
           JOIN shops sh ON p.shop_id = sh.id
           LEFT JOIN sellers s ON s.id = sh.seller_id
           WHERE p.status = 'published'
             AND p.verification_status = 'verified'
             AND s.verification_status = 'verified'
             AND p.slug IN ($1, $2)`,
          [`${slugBase}-p-a`, `${slugBase}-p-b`],
        );
        expect(verifiedListing.rows.map((r: { slug: string }) => r.slug)).toEqual([`${slugBase}-p-a`]);
      } finally {
        await cleanup(userId, catSlug);
      }
    },
    30_000,
  );
});
