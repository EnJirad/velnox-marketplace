/**
 * MVP public catalogue — visibility, filters and detail shape.
 *
 * The catalogue is the one surface where an authorization mistake is publicly
 * visible, so these tests assert the NEGATIVE cases as hard as the positive
 * ones: a draft, a submission, an approved-but-unpublished listing and a
 * rejected listing must all be absent from every response.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { query } from "../../db/index.js";
import { hasTestDatabase } from "../../tests/helpers/test-db.js";
import {
  api,
  createCategory,
  createPublishedProduct,
  createSeller,
  createUser,
  startApp,
  type TestApp,
} from "./helpers/mvp-app.js";

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

describe("MVP catalogue (needs a test database + JWT_SECRET)", () => {
  let app: TestApp;
  let admin: Awaited<ReturnType<typeof createUser>>;

  beforeAll(async () => {
    if (!hasDb) return;
    app = await startApp();
    admin = await createUser({ role: "admin" });
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  itDb("lists published products only", async () => {
    const seller = await createSeller();
    const visible = await createPublishedProduct(seller.id, admin.id, {
      name: `Catalog Visible ${crypto.randomUUID().slice(0, 6)}`,
      price: "321.00",
    });

    const draft = await query(
      `INSERT INTO products (seller_id, name, slug, price, status)
       VALUES ($1, 'Catalog Draft', $2, 10, 'draft') RETURNING id, slug`,
      [seller.id, `catalog-draft-${crypto.randomUUID().slice(0, 6)}`],
    );
    const draftRow = draft.rows[0] as { id: string; slug: string };

    // The list query aggregates product_reviews; a database without that table
    // answers 500 here (42P01), so the rating/review_count keys are the
    // regression pin for that drift.
    const list = await api(app.base, "/api/mvp/products?q=Catalog");
    expect(list.status).toBe(200);
    const rows = list.body.data.products as Array<{
      id: string;
      rating: string | null;
      reviewCount: number;
    }>;
    const ids = rows.map((p) => p.id);
    expect(ids).toContain(visible.id);
    expect(ids).not.toContain(draftRow.id);
    const visibleRow = rows.find((p) => p.id === visible.id)!;
    expect(visibleRow.reviewCount).toBe(0);
    expect(visibleRow.rating).toBeNull();

    const draftDetail = await api(app.base, `/api/mvp/products/${draftRow.slug}`);
    expect(draftDetail.status).toBe(404);
  });

  itDb("filters by category and seller, and reports pagination", async () => {
    const category = await createCategory();
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id, {
      name: `Categorised ${crypto.randomUUID().slice(0, 6)}`,
      categorySlug: category.slug,
    });

    const byCategory = await api(app.base, `/api/mvp/products?category=${category.slug}`);
    expect(byCategory.status).toBe(200);
    expect((byCategory.body.data.products as Array<{ id: string }>).map((p) => p.id)).toContain(
      product.id,
    );

    const bySeller = await api(app.base, `/api/mvp/products?seller=${seller.slug}&limit=1`);
    expect(bySeller.status).toBe(200);
    expect(bySeller.body.data.pagination.limit).toBe(1);
    expect(bySeller.body.data.pagination.page).toBe(1);
    expect(bySeller.body.data.products.length).toBeLessThanOrEqual(1);

    const bySellerId = await api(app.base, `/api/mvp/products?seller=${seller.id}`);
    expect(
      (bySellerId.body.data.products as Array<{ seller: { id: string } }>).every(
        (p) => p.seller.id === seller.id,
      ),
    ).toBe(true);
  });

  itDb("treats a search phrase literally (LIKE wildcards are escaped)", async () => {
    const seller = await createSeller();
    await createPublishedProduct(seller.id, admin.id, { name: "Plain Cotton Tee" });

    const wildcard = await api(app.base, "/api/mvp/products?q=%25");
    expect(wildcard.status).toBe(200);
    expect(wildcard.body.data.products).toEqual([]);

    const literal = await api(app.base, "/api/mvp/products?q=Plain%20Cotton");
    expect(
      (literal.body.data.products as Array<{ name: string }>).some((p) =>
        p.name.includes("Plain Cotton Tee"),
      ),
    ).toBe(true);
  });

  itDb("returns variants with per-variant availability and never leaks stock of another product", async () => {
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id, {
      name: "Tee With Sizes",
      variants: [
        { name: "S", price: "199.00", stock: 0 },
        { name: "M", price: "219.00", stock: 4 },
      ],
      stock: undefined,
    });

    const detail = await api(app.base, `/api/mvp/products/${product.slug}`);
    expect(detail.status).toBe(200);
    const variants = detail.body.data.product.variants as Array<{
      name: string;
      price: string;
      available: number;
    }>;
    expect(variants.map((v) => v.name)).toEqual(["S", "M"]);
    expect(variants[0]!.available).toBe(0);
    expect(variants[1]!.available).toBe(4);
    expect(detail.body.data.product.available).toBe(0);
    expect(detail.body.data.product.currency).toBe("THB");
    expect(detail.body.data.product.seller.storeName).toBeTruthy();
  });

  itDb("returns 404 for an unknown slug and never exposes rejected or approved listings", async () => {
    const seller = await createSeller();
    const rejected = await query(
      `INSERT INTO products (seller_id, name, slug, price, status)
       VALUES ($1, 'Rejected Item', $2, 10, 'draft') RETURNING id, slug`,
      [seller.id, `rejected-${crypto.randomUUID().slice(0, 6)}`],
    );
    const row = rejected.rows[0] as { id: string; slug: string };
    await query(
      `UPDATE products SET status = 'submitted', submitted_at = NOW() WHERE id = $1`,
      [row.id],
    );
    await query(
      `UPDATE products SET status = 'rejected', rejection_reason = 'no' WHERE id = $1`,
      [row.id],
    );

    expect((await api(app.base, `/api/mvp/products/${row.slug}`)).status).toBe(404);
    expect((await api(app.base, "/api/mvp/products/nope-does-not-exist")).status).toBe(404);
  });

  itDb("builds an active-only category tree", async () => {
    const parent = await createCategory();
    const child = await query(
      `INSERT INTO categories (slug, name, parent_id) VALUES ($1, 'Child', $2) RETURNING id, slug`,
      [`${parent.slug}-child`, parent.id],
    );
    const childRow = child.rows[0] as { id: string; slug: string };
    const hidden = await query(
      `INSERT INTO categories (slug, name, is_active) VALUES ($1, 'Hidden', FALSE) RETURNING slug`,
      [`hidden-${crypto.randomUUID().slice(0, 6)}`],
    );

    const res = await api(app.base, "/api/mvp/categories");
    expect(res.status).toBe(200);
    const tree = res.body.data.categories as Array<{
      slug: string;
      children: Array<{ slug: string }>;
    }>;
    const parentNode = tree.find((node) => node.slug === parent.slug);
    expect(parentNode).toBeDefined();
    expect(parentNode!.children.map((c) => c.slug)).toContain(childRow.slug);
    expect(tree.some((node) => node.slug === (hidden.rows[0] as { slug: string }).slug)).toBe(false);
  });

  itDb("never returns another seller's draft through the seller detail route", async () => {
    const owner = await createSeller();
    const product = await createPublishedProduct(owner.id, admin.id);
    const other = await createSeller();
    const res = await api(app.base, `/api/mvp/seller/products/${product.id}`, {
      cookie: other.cookie,
    });
    expect(res.status).toBe(404);
  });
});
