import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { groupCartItems, type CartItem } from "../../src/modules/cart/domain/cart.ts";
import { CartService } from "../../src/modules/cart/services/cart-service.ts";
import type { DbQueryable } from "../../../database/src/types.ts";

describe("Commerce Core — Cart Domain", () => {
  it("groups cart items by seller/shop and computes exact satang subtotals", () => {
    const rawItems: (CartItem & { shopName: string })[] = [
      {
        id: "item_1",
        cartId: "cart_001",
        shopId: "shop_apple",
        shopName: "Apple Official",
        productId: "prod_iphone",
        variantId: null,
        productTitle: "iPhone 16 Pro",
        productImage: null,
        variantTitle: null,
        quantity: 1,
        priceMinor: 3990000n, // 39,900.00 THB
        totalMinor: 3990000n,
      },
      {
        id: "item_2",
        cartId: "cart_001",
        shopId: "shop_apple",
        shopName: "Apple Official",
        productId: "prod_case",
        variantId: null,
        productTitle: "Silicone Case",
        productImage: null,
        variantTitle: null,
        quantity: 2,
        priceMinor: 159000n, // 1,590.00 THB
        totalMinor: 318000n, // 3,180.00 THB
      },
      {
        id: "item_3",
        cartId: "cart_001",
        shopId: "shop_sony",
        shopName: "Sony Store",
        productId: "prod_wh1000xm5",
        variantId: null,
        productTitle: "Headphones",
        productImage: null,
        variantTitle: null,
        quantity: 1,
        priceMinor: 1290000n, // 12,900.00 THB
        totalMinor: 1290000n,
      },
    ];

    const cart = groupCartItems("cart_001", "usr_001", rawItems);
    assert.equal(cart.groups.length, 2);
    assert.equal(cart.totalItems, 4);

    const appleGroup = cart.groups.find((g) => g.shopId === "shop_apple")!;
    assert.equal(appleGroup.items.length, 2);
    assert.equal(appleGroup.subtotalMinor, 3990000n + 318000n); // 43,080.00 THB

    const sonyGroup = cart.groups.find((g) => g.shopId === "shop_sony")!;
    assert.equal(sonyGroup.items.length, 1);
    assert.equal(sonyGroup.subtotalMinor, 1290000n);

    assert.equal(cart.grandTotalMinor, appleGroup.subtotalMinor + sonyGroup.subtotalMinor);
  });

  it("handles adding, updating, and removing cart items", async () => {
    let cartItems: any[] = [];
    const mockDb: DbQueryable = {
      async query(sql: string, params?: any[]) {
        const q = sql.trim();
        if (q.includes("SELECT id FROM carts")) {
          return { rows: [{ id: "cart_test_1" }] };
        }
        if (q.includes("FROM products p") && q.includes("LIMIT 1")) {
          return {
            rows: [
              {
                id: params?.[0],
                status: "published",
                shop_id: "shop_01",
                title: "Test Item",
                price: "100.00",
              },
            ],
          };
        }
        if (q.includes("FROM product_variants")) {
          return { rows: [] };
        }
        if (q.includes("INSERT INTO cart_items")) {
          cartItems.push({
            id: "ci_1",
            cart_id: params?.[0],
            product_id: params?.[1],
            variant_id: params?.[2],
            quantity: params?.[3],
            shop_id: "shop_01",
            product_title: "Test Item",
            product_price: "100.00",
            shop_name: "Test Shop",
          });
          return { rows: [] };
        }
        if (q.includes("UPDATE cart_items SET quantity = $1")) {
          if (cartItems[0]) cartItems[0].quantity = params?.[0];
          return { rows: [] };
        }
        if (q.includes("DELETE FROM cart_items")) {
          cartItems = [];
          return { rows: [] };
        }
        if (q.includes("FROM cart_items ci")) {
          return { rows: cartItems };
        }
        return { rows: [] };
      },
    };

    // Add item
    const cartAfterAdd = await CartService.addItem(mockDb, "usr_1", {
      productId: "prod_01",
      quantity: 2,
    });
    assert.equal(cartAfterAdd.totalItems, 2);

    // Update item
    const cartAfterUpdate = await CartService.updateItem(mockDb, "usr_1", "ci_1", 5);
    assert.equal(cartAfterUpdate.totalItems, 5);

    // Remove item
    const cartAfterRemove = await CartService.removeItem(mockDb, "usr_1", "ci_1");
    assert.equal(cartAfterRemove.totalItems, 0);
  });
});
