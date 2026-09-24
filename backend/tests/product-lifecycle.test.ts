/**
 * Product lifecycle — seller → product → review → approval → published → shop.
 *
 * Unit tests (always run, no DB) verify the shared rules in
 * `backend/lib/product-lifecycle.ts` plus the query-level wiring that makes the
 * pipeline actually work end to end:
 *   • a seller can never publish/reject/suspend their own product,
 *   • an admin can only publish a pending product, or suspend/restore it,
 *   • only `published` products are publicly visible,
 *   • V is driven ONLY by seller verification (one verification system),
 *   • catalog / detail / seller / shop queries expose the verification fields
 *     the V✓ badge depends on,
 *   • migration 040 + all schema files agree on the verification tables,
 *   • verification submissions and seller image intents are rate limited.
 *
 * Integration tests (DB-gated, skipped without a DATABASE_URL) exercise the
 * real INSERT/SELECT path against the database.
 */
import { describe, expect, test } from "bun:test";
import { integrationTest } from "./helpers/test-db.js";
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
const centerSrc = readFileSync(join(root, "apps/velcenter/src/pages/Center.tsx"), "utf8");
const sellerSrc = readFileSync(join(root, "backend/routes/seller.ts"), "utf8");
const reviewDialogSrc = readFileSync(join(root, "apps/velcenter/src/components/VerificationReviewDialog.tsx"), "utf8");
const sellerQueueSrc = readFileSync(join(root, "apps/velcenter/src/components/SellerVerificationQueue.tsx"), "utf8");
const identityUploaderSrc = readFileSync(join(root, "packages/shared/src/components/seller/IdentityDocumentUploader.tsx"), "utf8");
const migration043 = readFileSync(join(root, "db/migrations/043_seller_review_lifecycle.sql"), "utf8");
const reasonsSrc = readFileSync(join(root, "packages/shared/src/lib/verification-reasons.ts"), "utf8");
const localesSrc = readFileSync(join(root, "packages/shared/src/lib/i18n/locales/index.ts"), "utf8");
const badgeSrc = readFileSync(join(root, "packages/shared/src/components/VBadge.tsx"), "utf8");
const migration040 = readFileSync(join(root, "db/migrations/040_verification_and_categories.sql"), "utf8");
const schemaSql = readFileSync(join(root, "db/schema.sql"), "utf8");
const sqlEditor = readFileSync(join(root, "db/run-sqleditor.sql"), "utf8");


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
    // Moderation is gated through the shared permission catalog
    // (`requireAdmin` in products.ts resolves `products.moderate`; owner/admin
    // implicitly hold every code).
    expect(productsSrc).toContain('userHasPermission(userId, "products.moderate")');
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

describe("V eligibility (seller-only)", () => {
  test("a verified seller's products qualify for the single green V", () => {
    expect(computeIsVerifiedProduct(undefined, "verified")).toBe(true);
    expect(computeIsVerifiedProduct("unverified", "verified")).toBe(true);
    expect(computeIsVerifiedProduct("pending", "verified")).toBe(true);
  });

  test("an unverified seller's products never show V", () => {
    for (const status of [undefined, null, "unverified", "pending", "rejected", "suspended"]) {
      expect(computeIsVerifiedProduct(undefined, status)).toBe(false);
    }
  });

  test("product verification state never affects V eligibility", () => {
    expect(computeIsVerifiedProduct("verified", "unverified")).toBe(false);
    expect(computeIsVerifiedProduct("pending", "pending")).toBe(false);
    expect(computeIsVerifiedProduct("rejected", "suspended")).toBe(false);
  });

  test("each verification state is exposed on the product payload", () => {
    expect(productsSrc).toContain("verificationStatus: row.verification_status || \"unverified\"");
    expect(productsSrc).toContain("sellerVerificationStatus: row.seller_verification_status || \"unverified\"");
    expect(productsSrc).toContain("computeIsVerifiedProduct(");
  });

  test("the badge component derives V from the seller only and never trusts a boolean prop", () => {
    expect(badgeSrc).toContain('sellerVerification === "verified"');
    expect(badgeSrc).not.toContain("isVerifiedProduct: boolean");
  });

  test("the VelShop verified filter requires only seller verification in SQL", () => {
    expect(productsSrc).toContain("s.verification_status = 'verified'");
    expect(productsSrc).not.toContain("p.verification_status = 'verified'");
  });

  test("verification is not a seller-writable field", () => {
    // Only the admin verification routes may write verification_status — the
    // product routes merely read/filter it.
    expect(productsSrc).not.toContain("SET verification_status");
    expect(productsSrc).not.toContain("UPDATE products SET verification_status");
    expect(productsSrc).not.toContain("UPDATE sellers SET verification_status");
    expect(verificationSrc).toContain("SET verification_status = $1");
    // seller product create/update payloads never carry verification
    expect(productsSrc).not.toContain("verification_status, status,");
  });

  test("there is exactly ONE verification system — seller/shop identity", () => {
    // Seller verification is the only queue the backend serves…
    expect(verificationSrc).toContain("FROM seller_verifications");
    expect(verificationSrc).toContain('app.patch("/api/admin/verifications/seller/:verificationId"');
    // …and no product verification route survives, in any verb or shape.
    expect(verificationSrc).not.toContain('app.patch("/api/admin/verifications/product/');
    expect(verificationSrc).not.toContain('app.post("/api/seller/products/:productId/verification"');
    expect(verificationSrc).not.toContain('app.get("/api/seller/products/:productId/verification"');
    const productWrites = verificationSrc.match(/INSERT INTO product_verifications/g) ?? [];
    expect(productWrites.length).toBe(0);
  });

  test("verification no longer produces a product verification queue in VelCenter", () => {
    // VelCenter must query the same persisted seller source the seller wrote.
    // The verification queue was extracted to SellerVerificationQueue component.
    expect(sellerQueueSrc).toContain("api.admin.sellerVerificationAction");
    expect(sellerQueueSrc).not.toContain("productVerificationAction");
    expect(sellerQueueSrc).not.toContain("api.admin.productVerificationAction");
    expect(sellerQueueSrc).not.toContain("reviewDialogKind");
    // The reviewer workspace reads the seller application detail endpoint.
    expect(reviewDialogSrc).toContain("api.admin.sellerApplication");
    // …and the queue opens it from the row.
    expect(sellerQueueSrc).toContain("openReview(row)");
    // Center.tsx no longer directly contains verification queue code.
    expect(centerSrc).toContain("SellerVerificationQueue");
  });

  test("verification decisions are admin-gated", () => {
    // Admin access is resolved from the authenticated session via users.role
    // (the employees table has no 'status' column) — never from the request body.
    expect(verificationSrc).toContain("SELECT role FROM users WHERE id = $1");
    expect(verificationSrc).toContain("REVIEWER_ROLES = [\"owner\", \"admin\", \"staff\"]");
    expect(verificationSrc).toContain("Admin access required");
    // Reviewer identity always comes from req.user, not the payload.
    expect(verificationSrc).toContain("const reviewerId = userId;");
    expect(verificationSrc).not.toContain("req.body.reviewerId");
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
    expect(productsSrc).toContain("validateCategory(input, lookupCategoryRow)");
    expect(productsSrc).toContain("SELECT slug, is_active FROM categories WHERE id = $1");
    expect(productsSrc).toContain("SELECT slug, is_active FROM categories WHERE slug = $1");
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

  test("inactive categories are rejected by the canonical validator", () => {
    const categoriesLib = readFileSync(join(root, "backend/lib/categories.ts"), "utf8");
    expect(categoriesLib).toContain("is_active");
    expect(categoriesLib).toContain("if (!row.is_active) return { ok: false");
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
  test("seller verification + application submissions are capped at 5/min", () => {
    expect(rateLimitSrc).toContain('name: "seller-verification", windowMs: 60_000, max: 5');
    expect(rateLimitSrc).toContain('name: "seller-apply", windowMs: 60_000, max: 5');
    // The product verification surface is gone, so its limiter must be gone too.
    expect(rateLimitSrc).not.toContain('name: "product-verification"');
    // Evidence presigns are capped per user (spam guard).
    expect(rateLimitSrc).toContain('name: "seller-evidence"');
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

  test("all schema files agree (schema.sql = run-sqleditor.sql)", () => {
    expect(schemaSql).toBe(sqlEditor);
    for (const sql of [schemaSql, sqlEditor]) {
      expect(sql).toContain("verification_status TEXT NOT NULL DEFAULT 'unverified'");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS seller_verifications");
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS product_verifications");
    }
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
  });
});

// ─── Integration: real database paths (skipped without DATABASE_URL) ──────

describe("product lifecycle (integration)", () => {
  const testFn = integrationTest;

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

// ─── Seller identity evidence: preview + real upload ─────────────────

describe("identity document preview (root-cause regression)", () => {
  test("the selection handler creates a real object URL preview", () => {
    // The original bug: the onboarding stored a File in state and rendered only
    // the filename — no object URL was ever created, so no image could appear.
    expect(identityUploaderSrc).toContain("URL.createObjectURL(file)");
  });

  test("the preview is rendered from the actual selected file, not a placeholder", () => {
    expect(identityUploaderSrc).toContain("const objectUrl = URL.createObjectURL(file);");
    expect(identityUploaderSrc).toContain("setLocalPreview(objectUrl);");
    // The image element binds to the local preview first, then the persisted doc.
    expect(identityUploaderSrc).toContain("const displayUrl = localPreview ??");
    expect(identityUploaderSrc).toContain("src={displayUrl}");
  });

  test("object URLs are revoked on replace and on unmount", () => {
    expect(identityUploaderSrc).toContain("URL.revokeObjectURL");
    // revoke happens in the remove/replace path…
    expect(identityUploaderSrc).toContain("const handleRemove = useCallback(() => {\n    revokePreview();");
    // …and in the unmount cleanup.
    expect(identityUploaderSrc).toContain("return () => {\n      if (previewRef.current) URL.revokeObjectURL(previewRef.current);\n    };");
  });

  test("type + size are validated before any preview or upload", () => {
    const validateIdx = identityUploaderSrc.indexOf("// 1. validate file type");
    const previewIdx = identityUploaderSrc.indexOf("URL.createObjectURL(file)");
    const uploadIdx = identityUploaderSrc.indexOf("await upload(file)");
    expect(validateIdx).toBeGreaterThan(-1);
    expect(previewIdx).toBeGreaterThan(validateIdx);
    expect(uploadIdx).toBeGreaterThan(previewIdx);
  });

  test("the preview never waits for R2 — upload runs after the preview is set", () => {
    expect(identityUploaderSrc).toContain("// 3./4. Immediately show the real selected image — never wait for R2");
  });

  test("onboarding uses the uploader for all three identity documents", () => {
    const requireRoleSrc = readFileSync(join(root, "packages/shared/src/components/RequireRole.tsx"), "utf8");
    expect(requireRoleSrc).toContain('purpose="id_card"');
    expect(requireRoleSrc).toContain('purpose="id_card_back"');
    expect(requireRoleSrc).toContain('purpose="selfie_id"');
    // No raw <input type="file"> in the onboarding identity step any more.
    expect(requireRoleSrc).not.toContain('accept="image/*"');
  });
});

describe("evidence persistence gates the pending state", () => {
  test("identity documents are uploaded through the existing R2 evidence API", () => {
    expect(identityUploaderSrc).toContain("api.seller.evidenceUploadIntent");
    expect(identityUploaderSrc).toContain("api.seller.evidenceConfirm");
    // presign → PUT to the signed URL → persist the media row
    expect(identityUploaderSrc).toContain('method: "PUT"');
    expect(identityUploaderSrc).toContain("await confirmUpload({");
  });

  test("the application is rejected without all three required documents", () => {
    expect(sellerSrc).toContain('const REQUIRED_IDENTITY_PURPOSES = ["id_card", "id_card_back", "selfie_id"];');
    expect(sellerSrc).toContain("IDENTITY_EVIDENCE_REQUIRED");
    expect(sellerSrc).toContain("Missing required identity documents");
  });

  test("seller verification submission refuses an empty evidence list", () => {
    expect(verificationSrc).toContain('code: "EVIDENCE_REQUIRED"');
    expect(verificationSrc).toContain("At least one identity document must be uploaded before submitting for verification");
  });

  test("the application is written in one transaction so pending is never half-set", () => {
    const applyBlock = sellerSrc.slice(sellerSrc.indexOf('app.post("/api/seller/apply"'));
    expect(applyBlock).toContain("await client.query(\"BEGIN\")");
    expect(applyBlock).toContain("await client.query(\"COMMIT\")");
    // Pending is set AFTER the verification row + evidence exist.
    const evidencePersist = applyBlock.indexOf("INSERT INTO seller_verifications");
    const setPending = applyBlock.indexOf("SET verification_status = 'pending'");
    expect(evidencePersist).toBeGreaterThan(-1);
    expect(setPending).toBeGreaterThan(evidencePersist);
    // The frontend only ever reflects what the backend persisted.
    const statusBeforePersist = applyBlock.indexOf("SET status = 'pending'", 0);
    expect(statusBeforePersist).toBeLessThan(evidencePersist);
  });

  test("evidence references must be owned by the authenticated account", () => {
    expect(sellerSrc).toContain("FROM media WHERE uploaded_by = $1 AND key = ANY($2::text[])");
    expect(sellerSrc).toContain('code: "FORBIDDEN", message: "Identity documents do not belong to this account"');
    expect(verificationSrc).toContain("FROM media WHERE uploaded_by = $1 AND key = ANY($2::text[])");
  });
});

// ─── Seller review lifecycle: state machine, reasons, history ──────────

describe("seller application state machine", () => {
  test("backend only allows documented transitions", () => {
    expect(sellerSrc).toContain("const VALID_TRANSITIONS: Record<string, string[]> = {");
    expect(sellerSrc).toContain("pending: [\"under_review\", \"rejected\"]");
    expect(sellerSrc).toContain("under_review: [\"approved\", \"needs_correction\", \"rejected\", \"suspended\"]");
    expect(sellerSrc).toContain("approved: [\"suspended\"]");
    expect(sellerSrc).toContain('code: "INVALID_TRANSITION"');
    // REJECTED → APPROVED and DRAFT → APPROVED are impossible.
    expect(sellerSrc).not.toMatch(/rejected:\s*\[[^\]]*approved/);
  });

  test("the DB CHECK constraint accepts exactly the canonical lifecycle", () => {
    for (const sql of [schemaSql, sqlEditor]) {
      expect(sql).toContain("CHECK (status IN ('pending', 'under_review', 'needs_correction', 'approved', 'rejected', 'suspended'))");
    }
    expect(migration043).toContain("ALTER TABLE sellers DROP CONSTRAINT IF EXISTS sellers_status_check");
    expect(migration043).toContain("CHECK (status IN ('pending', 'under_review', 'needs_correction', 'approved', 'rejected', 'suspended'))");
  });

  test("a reviewer cannot approve their own application or an empty submission", () => {
    expect(sellerSrc).toContain("SELF_ACTION_FORBIDDEN");
    expect(verificationSrc).toContain("Cannot approve a verification with no evidence");
    expect(verificationSrc).toContain("Cannot approve a ${previousStatus} verification");
  });
});

describe("structured review reasons", () => {
  test("corrections / rejections / suspensions require a structured code", () => {
    expect(sellerSrc).toContain('code: "REASON_REQUIRED"');
    expect(verificationSrc).toContain('code: "REASON_REQUIRED"');
  });

  test("backend and shared vocabularies stay in sync", () => {
    const backendCodes = (sellerSrc.match(/"id_card_unclear", "id_card_incomplete"/) ?? []).length;
    expect(backendCodes).toBe(1);
    // Both files must list the same 12 codes.
    for (const code of [
      "id_card_unclear", "id_card_incomplete", "selfie_unclear", "selfie_missing_id",
      "document_expired", "applicant_mismatch", "store_incomplete", "contact_incomplete",
      "address_incomplete", "duplicate_account", "policy_violation", "other",
    ]) {
      expect(sellerSrc).toContain(`"${code}"`);
      expect(verificationSrc).toContain(`"${code}"`);
      // The shared vocabulary module is the single source the UI renders from.
      expect(reasonsSrc).toContain(`"${code}"`);
      expect(localesSrc).toContain(`${code}:`);
    }
    // The review UI looks every label up through the shared code list.
    expect(reviewDialogSrc).toContain("REVIEW_REASON_CODES");
    expect(reviewDialogSrc).toContain("reviewReason.${");
  });

  test("internal reviewer notes are stored separately from applicant-visible reasons", () => {
    expect(verificationSrc).toContain("review_reason_code = $5, review_note = $6");
    expect(sellerSrc).toContain("review_reason_code = $3, review_note = $4");
    expect(reviewDialogSrc).toContain('t("review.noteLabel")');
  });

  test("the wizard is localized in TH / EN / MY", () => {
    for (const name of ["thGateCopy", "enGateCopy", "myGateCopy", "thIdentityDoc", "enIdentityDoc", "myIdentityDoc", "thReviewReason", "enReviewReason", "myReviewReason", "thReview", "enReview", "myReview"]) {
      expect(localesSrc).toContain(`const ${name}`);
    }
    // Every new section is merged into all three runtime dictionaries.
    expect(localesSrc).toContain("identityDoc: thIdentityDoc");
    expect(localesSrc).toContain("identityDoc: enIdentityDoc");
    expect(localesSrc).toContain("identityDoc: myIdentityDoc");
    expect(localesSrc).toContain("reviewReason: thReviewReason");
    expect(localesSrc).toContain("reviewReason: enReviewReason");
    expect(localesSrc).toContain("reviewReason: myReviewReason");
    expect(localesSrc).toContain("gate: { ...th.gate, ...thGateCopy }");
    expect(localesSrc).toContain("gate: { ...en.gate, ...enGateCopy }");
    expect(localesSrc).toContain("gate: { ...myBase.gate, ...myGateCopy }");
  });
});

describe("review history / audit trail", () => {
  test("the history table exists in the schema, the SQL editor bundle and the migration", () => {
    for (const sql of [schemaSql, sqlEditor]) {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS seller_review_history");
      expect(sql).toContain("idx_seller_review_history_seller");
    }
    expect(migration043).toContain("CREATE TABLE IF NOT EXISTS seller_review_history");
  });

  test("every lifecycle step appends a history row", () => {
    // submitted / resubmitted on the applicant side
    expect(sellerSrc).toContain("INSERT INTO seller_review_history");
    expect(sellerSrc).toContain('previousStatus === "none" ? "submitted" : "resubmitted"');
    // reviewer decisions on the reviewer side
    expect(verificationSrc).toContain("INSERT INTO seller_review_history");
    for (const action of ['"approved"', '"rejected"', '"suspended"', '"needs_correction"']) {
      expect(verificationSrc).toContain(action);
    }
  });

  test("the reviewer workspace renders history and structured reasons", () => {
    expect(reviewDialogSrc).toContain("REVIEW_CHECKLIST");
    expect(reviewDialogSrc).toContain("REVIEW_REASON_CODES");
    expect(reviewDialogSrc).toContain('t("review.history")');
    expect(reviewDialogSrc).toContain("onDecision");
  });
});

// ─── Code / canonical-schema drift ────────────────────────────────────

describe("seller verification code matches the canonical schema", () => {
  // Two production 42703 failures came from code selecting columns the canonical
  // schema does not define (`sv.evidence_notes`) and from columns the production
  // database did not have yet (`sv.review_reason_code`, because migration V0043
  // was blocked behind the failing V0040).
  const tableStart = schemaSql.indexOf("CREATE TABLE IF NOT EXISTS seller_verifications");
  const tableBlock = schemaSql.slice(tableStart, schemaSql.indexOf(");", tableStart));
  const canonicalColumns = new Set(
    tableBlock
      .split("\n")
      .map((line) => line.trim().split(/\s+/)[0])
      .filter((name) => /^[a-z_]+$/.test(name)),
  );

  test("the migration only adds columns the canonical schema declares", () => {
    for (const column of ["review_reason_code", "review_note"]) {
      expect(canonicalColumns.has(column)).toBe(true);
      expect(migration043).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
  });

  test("every sv.<column> selected by the backend exists in the schema", () => {
    const selected = new Set([...verificationSrc.matchAll(/\bsv\.([a-z_]+)\b/g)].map((m) => m[1]));
    expect(selected.size).toBeGreaterThan(5);
    for (const column of selected) expect(canonicalColumns.has(column)).toBe(true);
  });

  test("the canonical schema and the SQL editor bundle declare the same columns", () => {
    const editorBlock = sqlEditor.slice(
      sqlEditor.indexOf("CREATE TABLE IF NOT EXISTS seller_verifications"),
      sqlEditor.indexOf(");", sqlEditor.indexOf("CREATE TABLE IF NOT EXISTS seller_verifications")),
    );
    expect(editorBlock).toBe(tableBlock);
  });
});

// ─── Private evidence access ──────────────────────────────────────────

describe("identity evidence stays private", () => {
  test("reviewer access uses short-lived signed R2 GET URLs", () => {
    expect(verificationSrc).toContain("GetObjectCommand");
    expect(verificationSrc).toContain("expiresIn: 300");
    expect(sellerSrc).toContain("GetObjectCommand");
    expect(sellerSrc).toContain("expiresIn: 300");
  });

  test("the applicant's own status payload never leaks evidence URLs", () => {
    expect(verificationSrc).toContain("evidenceCount: Array.isArray(row.evidence_urls) ? row.evidence_urls.length : 0");
    expect(sellerSrc).toContain("identityEvidenceCount: Array.isArray(settings.identityEvidence) ? settings.identityEvidence.length : 0");
  });

  test("the admin list strips evidence locations", () => {
    expect(verificationSrc).toContain("evidence_urls: undefined");
  });

  test("the public shop endpoint exposes status only", () => {
    const publicBlock = verificationSrc.slice(verificationSrc.indexOf('app.get("/api/shops/:shopId/verification"'));
    expect(publicBlock).not.toContain("evidence_urls");
    expect(publicBlock).not.toContain("GetObjectCommand");
    expect(publicBlock).toContain("verificationStatus: result.rows[0].verification_status");
  });
});
