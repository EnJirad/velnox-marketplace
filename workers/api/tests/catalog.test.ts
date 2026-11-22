import { describe, expect, it } from "bun:test";
import { createApplication } from "../src/app.js";

describe("Catalog Domain Tests (Categories, Products, Shops)", () => {
  const app = createApplication();

  it("GET /api/v1/categories returns hierarchical category tree", async () => {
    const res = await app.request("/api/v1/categories");
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThanOrEqual(2);

    // Verify root node structure
    const electronics = json.data.find((c: any) => c.slug === "electronics");
    expect(electronics).toBeDefined();
    expect(electronics.level).toBe(1);
    expect(Array.isArray(electronics.children)).toBe(true);

    // Verify children
    const smartphones = electronics.children.find((c: any) => c.slug === "smartphones-tablets");
    expect(smartphones).toBeDefined();
    expect(smartphones.level).toBe(2);
    expect(smartphones.parentId).toBe(electronics.id);
  });

  it("GET /api/v1/categories/:slug returns single category", async () => {
    const res = await app.request("/api/v1/categories/electronics");
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.slug).toBe("electronics");
    expect(json.data.name).toBe("Electronics");
  });

  it("GET /api/v1/categories/:slug returns 404 for unknown category", async () => {
    const res = await app.request("/api/v1/categories/non-existent-category");
    expect(res.status).toBe(404);

    const json = (await res.json()) as any;
    expect(json.success).toBe(false);
    expect(json.error.code).toBe("NOT_FOUND");
  });

  it("GET /api/v1/products returns paginated product list with satang to decimal mapping", async () => {
    const res = await app.request("/api/v1/products?limit=10");
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThanOrEqual(1);

    const product = json.data[0];
    expect(product.id).toBeDefined();
    expect(product.name).toBeDefined();
    expect(typeof product.price).toBe("number");
    expect(product.currency).toBe("THB");
    expect(json.pagination).toBeDefined();
    expect(json.pagination.page).toBe(1);
  });

  it("GET /api/v1/products filters by keyword search", async () => {
    const res = await app.request("/api/v1/products?q=UltraBook");
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.data[0].name).toContain("UltraBook");
  });

  it("GET /api/v1/products filters by categoryId", async () => {
    const res = await app.request("/api/v1/products?categoryId=00000000-0000-0000-0000-000000000002");
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.length).toBe(1);
    expect(json.data[0].slug).toBe("velnox-pro-max-smartphone-256gb");
  });

  it("GET /api/v1/products/:id returns detailed product with variants", async () => {
    const res = await app.request("/api/v1/products/prod-001");
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.id).toBe("prod-001");
    expect(json.data.description).toBeDefined();
    expect(Array.isArray(json.data.variants)).toBe(true);
    expect(json.data.variants.length).toBe(2);
    expect(json.data.variants[0].sku).toBe("VPRO-BLK-256");
  });

  it("GET /api/v1/shops/:id returns shop storefront information", async () => {
    const res = await app.request("/api/v1/shops/shop-001");
    expect(res.status).toBe(200);

    const json = (await res.json()) as any;
    expect(json.success).toBe(true);
    expect(json.data.name).toBe("Velnox Official Flagship");
    expect(json.data.slug).toBe("velnox-official");
    expect(json.data.status).toBe("active");
  });
});
