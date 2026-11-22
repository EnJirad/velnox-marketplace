import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCategoryTree, type Category } from "../../src/modules/catalog/domain/category.ts";
import { CatalogService } from "../../src/modules/catalog/services/catalog-service.ts";
import type { DbQueryable } from "../../../database/src/types.ts";

describe("Commerce Core — Catalog Domain", () => {
  it("builds hierarchical category tree with parent-child relationships", () => {
    const flat: Category[] = [
      {
        id: "cat_electronics",
        slug: "electronics",
        names: { th: "อิเล็กทรอนิกส์", en: "Electronics" },
        parentId: null,
        sortOrder: 1,
        icon: "lucide:laptop",
        imageUrl: null,
        isActive: true,
      },
      {
        id: "cat_laptops",
        slug: "laptops",
        names: { th: "แล็ปท็อป", en: "Laptops" },
        parentId: "cat_electronics",
        sortOrder: 1,
        icon: null,
        imageUrl: null,
        isActive: true,
      },
      {
        id: "cat_phones",
        slug: "smartphones",
        names: { th: "สมาร์ตโฟน", en: "Smartphones" },
        parentId: "cat_electronics",
        sortOrder: 2,
        icon: null,
        imageUrl: null,
        isActive: true,
      },
    ];

    const tree = buildCategoryTree(flat);
    assert.equal(tree.length, 1);
    assert.equal(tree[0].slug, "electronics");
    assert.equal(tree[0].children.length, 2);
    assert.equal(tree[0].children[0].slug, "laptops");
    assert.equal(tree[0].children[1].slug, "smartphones");
  });

  it("lists published products and resolves product detail", async () => {
    const mockDb: DbQueryable = {
      async query(sql: string, params?: any[]) {
        const q = sql.trim();
        if (q.includes("SELECT COUNT(*)")) {
          return { rows: [{ total: 1 }] };
        }
        if (q.includes("FROM products p") && q.includes("LIMIT 1")) {
          return {
            rows: [
              {
                id: "prod_001",
                shop_id: "shop_001",
                category_id: "electronics",
                title: "Velnox Pro Max",
                description: "Flagship device",
                price: "29990.00",
                status: "published",
                images: ["https://r2.velnox.live/p1.jpg"],
                rating: 4.9,
                sales_count: 120,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
                shop_name: "Official Tech",
                shop_status: "approved",
                cat_id: "cat_electronics",
                cat_slug: "electronics",
                cat_names: { th: "อิเล็กทรอนิกส์" },
                available_stock: 45,
              },
            ],
          };
        }
        if (q.includes("FROM product_variants")) {
          return { rows: [] };
        }
        if (q.includes("FROM products p")) {
          return {
            rows: [
              {
                id: "prod_001",
                shop_id: "shop_001",
                category_id: "electronics",
                title: "Velnox Pro Max",
                description: "Flagship device",
                price: "29990.00",
                status: "published",
                images: ["https://r2.velnox.live/p1.jpg"],
                rating: 4.9,
                sales_count: 120,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const list = await CatalogService.getProducts(mockDb, { categorySlug: "electronics" });
    assert.equal(list.total, 1);
    assert.equal(list.products[0].title, "Velnox Pro Max");
    assert.equal(list.products[0].priceMinor, 2999000n);

    const detail = await CatalogService.getProductDetail(mockDb, "prod_001");
    assert.equal(detail.id, "prod_001");
    assert.equal(detail.shop.name, "Official Tech");
    assert.equal(detail.shop.isVerified, true);
    assert.equal(detail.stock, 45);
  });
});
