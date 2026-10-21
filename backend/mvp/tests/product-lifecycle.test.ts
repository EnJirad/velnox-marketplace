/**
 * MVP product lifecycle — draft → submitted → approved → published, plus the
 * explicit re-approval rule for material edits.
 *
 * All transitions are performed through the real endpoints; the database
 * triggers remain the authority, so an illegal move is refused even if a
 * handler is changed. The material-change rule is what keeps a reviewed listing
 * from being silently replaced after approval.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { hasTestDatabase } from "../../tests/helpers/test-db.js";
import {
  api,
  createCategory,
  createPublishedProduct,
  createSeller,
  createUser,
  checkout,
  seedCart,
  startApp,
  stockRow,
  type TestApp,
  type TestSeller,
} from "./helpers/mvp-app.js";

const hasDb = hasTestDatabase() && Boolean(process.env.JWT_SECRET);
const itDb = hasDb ? test : test.skip;

describe("MVP product lifecycle (needs a test database + JWT_SECRET)", () => {
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

  async function draft(overrides: Record<string, unknown> = {}, seller?: TestSeller) {
    const s = seller ?? (await createSeller());
    const res = await api(app.base, "/api/mvp/seller/products", {
      method: "POST",
      cookie: s.cookie,
      body: { name: "Cotton Shirt", price: "250.00", stock: 5, ...overrides },
    });
    expect(res.status).toBe(201);
    return { seller: s, product: res.body.data.product as any };
  }

  async function publish(productId: string, seller: TestSeller) {
    const submitted = await api(app.base, `/api/mvp/seller/products/${productId}/submit`, {
      method: "POST",
      cookie: seller.cookie,
    });
    expect(submitted.status).toBe(200);
    const approved = await api(app.base, `/api/mvp/admin/products/${productId}/approve`, {
      method: "POST",
      cookie: admin.cookie,
    });
    expect(approved.status).toBe(200);
    const published = await api(app.base, `/api/mvp/seller/products/${productId}/publish`, {
      method: "POST",
      cookie: seller.cookie,
    });
    expect(published.status).toBe(200);
    return published.body.data.product as any;
  }

  itDb("never accepts a client-supplied status or price snapshot — a new product is a draft", async () => {
    const { product } = await draft({ status: "published", price: "10.5" });
    expect(product.status).toBe("draft");
    expect(product.price).toBe("10.50");
    expect(product.approvalStatus).toBeUndefined();
  });

  itDb("enforces the transition order: publish before approval is refused", async () => {
    const { seller, product } = await draft();
    const publish = await api(app.base, `/api/mvp/seller/products/${product.id}/publish`, {
      method: "POST",
      cookie: seller.cookie,
    });
    expect(publish.status).toBe(409);
    expect(publish.body.error.code).toBe("NOT_APPROVED");

    const approveDraft = await api(app.base, `/api/mvp/admin/products/${product.id}/approve`, {
      method: "POST",
      cookie: admin.cookie,
    });
    expect(approveDraft.status).toBe(409);
  });

  itDb("walks draft → submitted → approved → published and becomes publicly visible", async () => {
    const { seller, product } = await draft({ name: "Visible Jacket", price: "1200.00" });

    const submitted = await api(app.base, `/api/mvp/seller/products/${product.id}/submit`, {
      method: "POST",
      cookie: seller.cookie,
    });
    expect(submitted.body.data.product.status).toBe("submitted");
    expect(submitted.body.data.product.submittedAt).toBeTruthy();

    const hidden = await api(app.base, `/api/mvp/products/${product.slug}`);
    expect(hidden.status).toBe(404);

    const approved = await api(app.base, `/api/mvp/admin/products/${product.id}/approve`, {
      method: "POST",
      cookie: admin.cookie,
    });
    expect(approved.body.data.product.status).toBe("approved");
    expect(approved.body.data.product.approvedBy).toBeUndefined();

    const approvedHidden = await api(app.base, `/api/mvp/products/${product.slug}`);
    expect(approvedHidden.status).toBe(404);

    const published = await api(app.base, `/api/mvp/seller/products/${product.id}/publish`, {
      method: "POST",
      cookie: seller.cookie,
    });
    expect(published.body.data.product.status).toBe("published");

    const visible = await api(app.base, `/api/mvp/products/${product.slug}`);
    expect(visible.status).toBe(200);
    expect(visible.body.data.product.name).toBe("Visible Jacket");
  });

  itDb("carries a rejection reason back to the seller and allows resubmission", async () => {
    const { seller, product } = await draft();
    await api(app.base, `/api/mvp/seller/products/${product.id}/submit`, {
      method: "POST",
      cookie: seller.cookie,
    });

    const rejected = await api(app.base, `/api/mvp/admin/products/${product.id}/reject`, {
      method: "POST",
      cookie: admin.cookie,
      body: { reason: "Photos are not of the actual product" },
    });
    expect(rejected.status).toBe(200);

    const mine = await api(app.base, `/api/mvp/seller/products/${product.id}`, {
      cookie: seller.cookie,
    });
    expect(mine.body.data.product.status).toBe("rejected");
    expect(mine.body.data.product.rejectionReason).toBe("Photos are not of the actual product");

    const resubmitted = await api(app.base, `/api/mvp/seller/products/${product.id}/submit`, {
      method: "POST",
      cookie: seller.cookie,
    });
    expect(resubmitted.status).toBe(200);
    expect(resubmitted.body.data.product.status).toBe("submitted");
  });

  itDb("a MATERIAL edit to a published listing sends it back through review", async () => {
    const { seller, product } = await draft({ price: "99.00" });
    const published = await publish(product.id, seller);

    const edit = await api(app.base, `/api/mvp/seller/products/${product.id}`, {
      method: "PATCH",
      cookie: seller.cookie,
      body: { price: "89.00" },
    });
    expect(edit.status).toBe(200);
    expect(edit.body.data.product.status).toBe("draft");
    expect(edit.body.data.product.price).toBe("89.00");

    const gone = await api(app.base, `/api/mvp/products/${published.slug}`);
    expect(gone.status).toBe(404);

    // Re-publish requires a fresh approval.
    const publishAgain = await api(app.base, `/api/mvp/seller/products/${product.id}/publish`, {
      method: "POST",
      cookie: seller.cookie,
    });
    expect(publishAgain.status).toBe(409);
  });

  itDb("a stock change is NOT material — the listing stays published", async () => {
    const { seller, product } = await draft({ stock: 5 });
    const published = await publish(product.id, seller);

    const restock = await api(app.base, `/api/mvp/seller/products/${product.id}/inventory`, {
      method: "PUT",
      cookie: seller.cookie,
      body: { quantity: 42 },
    });
    expect(restock.status).toBe(200);
    expect(restock.body.data.product.status).toBe("published");
    expect(restock.body.data.product.stock.quantity).toBe(42);

    const stillVisible = await api(app.base, `/api/mvp/products/${published.slug}`);
    expect(stillVisible.status).toBe(200);
  });

  itDb("an image change is material; a no-op edit is not", async () => {
    const { seller, product } = await draft({
      images: [{ url: "https://cdn.example.invalid/a.jpg", alt: "" }],
    });
    await publish(product.id, seller);

    const same = await api(app.base, `/api/mvp/seller/products/${product.id}`, {
      method: "PATCH",
      cookie: seller.cookie,
      body: { images: [{ url: "https://cdn.example.invalid/a.jpg", alt: "" }] },
    });
    expect(same.body.data.product.status).toBe("published");

    const changed = await api(app.base, `/api/mvp/seller/products/${product.id}`, {
      method: "PATCH",
      cookie: seller.cookie,
      body: { images: [{ url: "https://cdn.example.invalid/b.jpg", alt: "new" }] },
    });
    expect(changed.body.data.product.status).toBe("draft");
    expect(changed.body.data.product.images).toHaveLength(1);
    expect(changed.body.data.product.images[0].url).toBe("https://cdn.example.invalid/b.jpg");
  });

  itDb("a submitted product is locked for the seller (no withdrawal edge exists)", async () => {
    const { seller, product } = await draft();
    await api(app.base, `/api/mvp/seller/products/${product.id}/submit`, {
      method: "POST",
      cookie: seller.cookie,
    });
    const edit = await api(app.base, `/api/mvp/seller/products/${product.id}`, {
      method: "PATCH",
      cookie: seller.cookie,
      body: { name: "Renamed while reviewing" },
    });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe("PRODUCT_LOCKED");
  });

  itDb("variant edits on a published product are material; adding a variant too", async () => {
    const { seller, product } = await draft({
      stock: undefined,
      variants: [{ name: "Red / M", price: "250.00", stock: 4 }],
    });
    await publish(product.id, seller);

    const variants = await api(app.base, `/api/mvp/seller/products/${product.id}`, {
      cookie: seller.cookie,
    });
    const variantId = variants.body.data.product.variants[0].id as string;

    const repriced = await api(
      app.base,
      `/api/mvp/seller/products/${product.id}/variants/${variantId}`,
      { method: "PATCH", cookie: seller.cookie, body: { price: "260.00" } },
    );
    expect(repriced.status).toBe(200);
    expect(repriced.body.data.product.status).toBe("draft");

    await publish(product.id, seller);
    const added = await api(app.base, `/api/mvp/seller/products/${product.id}/variants`, {
      method: "POST",
      cookie: seller.cookie,
      body: { name: "Blue / L", price: "270.00", stock: 2 },
    });
    expect(added.status).toBe(201);
    expect(added.body.data.product.status).toBe("draft");
    expect(added.body.data.product.variants).toHaveLength(2);
  });

  itDb("another seller's product is a 404, not a 403", async () => {
    const { product } = await draft();
    const other = await createSeller();
    const edit = await api(app.base, `/api/mvp/seller/products/${product.id}`, {
      method: "PATCH",
      cookie: other.cookie,
      body: { price: "1.00" },
    });
    expect(edit.status).toBe(404);
  });

  itDb("validates money and category input server-side", async () => {
    const seller = await createSeller();
    for (const price of ["-1", "12.345", "1e3", "abc", ""]) {
      const res = await api(app.base, "/api/mvp/seller/products", {
        method: "POST",
        cookie: seller.cookie,
        body: { name: "Bad price", price },
      });
      expect(res.status).toBe(400);
    }

    const badCategory = await api(app.base, "/api/mvp/seller/products", {
      method: "POST",
      cookie: seller.cookie,
      body: { name: "Unknown category", price: "10.00", categorySlug: "does-not-exist" },
    });
    expect(badCategory.status).toBe(400);
    expect(badCategory.body.error.code).toBe("CATEGORY_NOT_FOUND");

    const category = await createCategory();
    const good = await api(app.base, "/api/mvp/seller/products", {
      method: "POST",
      cookie: seller.cookie,
      body: { name: "Categorised", price: "10.00", categorySlug: category.slug },
    });
    expect(good.status).toBe(201);
    expect(good.body.data.product.categorySlug).toBe(category.slug);
  });

  itDb("cannot reduce stock below what open orders have reserved", async () => {
    const seeded = await seedCart(app.base, { adminId: admin.id, price: "40.00", stock: 5 });
    const placed = await checkout(app.base, seeded.buyer, seeded.cartId);
    expect(placed.status).toBe(201);
    expect(await stockRow(seeded.product.id)).toEqual({ quantity: 5, reserved: 1 });

    const tooLow = await api(app.base, `/api/mvp/seller/products/${seeded.product.id}/inventory`, {
      method: "PUT",
      cookie: seeded.seller.cookie,
      body: { quantity: 0 },
    });
    expect(tooLow.status).toBe(409);
    expect(tooLow.body.error.code).toBe("STOCK_BELOW_RESERVED");
    expect(await stockRow(seeded.product.id)).toEqual({ quantity: 5, reserved: 1 });
  });

  itDb("a product that was never published cannot be bought, even by id", async () => {
    const { product } = await draft({ stock: 3 });
    const buyer = await createUser();
    const add = await api(app.base, "/api/mvp/cart/items", {
      method: "POST",
      cookie: buyer.cookie,
      body: { productId: product.id, quantity: 1 },
    });
    expect(add.status).toBe(409);
    expect(add.body.error.code).toBe("PRODUCT_NOT_AVAILABLE");
  });

  itDb("creating a product with variants keeps ONE inventory row per variant", async () => {
    const { seller, product } = await draft({
      stock: undefined,
      variants: [
        { name: "S", price: "100.00", stock: 3 },
        { name: "M", price: "110.00", stock: 7 },
      ],
    });
    const detail = await api(app.base, `/api/mvp/seller/products/${product.id}`, {
      cookie: seller.cookie,
    });
    expect(detail.body.data.product.stock).toBeNull();
    expect(detail.body.data.product.variants).toHaveLength(2);
    expect(detail.body.data.product.variants[0].stock.quantity).toBe(3);
    expect(detail.body.data.product.variants[1].stock.quantity).toBe(7);
  });

  itDb("published product creation path also works when driven entirely by the API", async () => {
    const seller = await createSeller();
    const created = await api(app.base, "/api/mvp/seller/products", {
      method: "POST",
      cookie: seller.cookie,
      body: { name: "API Driven", price: "5.00", stock: 1 },
    });
    const product = await publish(created.body.data.product.id, seller);
    expect(product.status).toBe("published");
    const publicDetail = await api(app.base, `/api/mvp/products/${product.slug}`);
    expect(publicDetail.body.data.product.available).toBe(1);
  });

  itDb("a seeded published product is purchasable (fixture sanity)", async () => {
    const seller = await createSeller();
    const product = await createPublishedProduct(seller.id, admin.id);
    const detail = await api(app.base, `/api/mvp/products/${product.slug}`);
    expect(detail.status).toBe(200);
  });
});
