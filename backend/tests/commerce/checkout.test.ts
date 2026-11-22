import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CheckoutService } from "../../src/modules/checkout/services/checkout-service.ts";
import type { DbQueryable } from "../../../database/src/types.ts";
import { ConflictError, ValidationError } from "../../src/core/errors/app-error.ts";

describe("Commerce Core — Checkout Domain", () => {
  it("splits multi-shop cart into distinct orders under a single checkout_group", async () => {
    let groupCreated = false;
    let ordersCount = 0;
    let cartCleared = false;
    let reservedStockCount = 0;

    const mockCartItems = [
      {
        id: "ci_1",
        cart_id: "c_1",
        product_id: "p_1",
        variant_id: null,
        quantity: 1,
        product_title: "Item 1",
        product_price: "500.00",
        shop_id: "shop_a",
        shop_name: "Shop A",
      },
      {
        id: "ci_2",
        cart_id: "c_1",
        product_id: "p_2",
        variant_id: null,
        quantity: 2,
        product_title: "Item 2",
        product_price: "250.00",
        shop_id: "shop_b",
        shop_name: "Shop B",
      },
    ];

    const mockDb: DbQueryable = {
      async query(sql: string, params?: any[]) {
        const q = sql.trim();
        if (q.includes("FROM checkout_groups") && q.includes("idempotency_key = $1")) {
          return { rows: [] }; // Not a duplicate
        }
        if (q.includes("SELECT id FROM carts")) {
          return { rows: [{ id: "c_1" }] };
        }
        if (q.includes("FROM cart_items ci")) {
          return { rows: mockCartItems };
        }
        if (q.includes("UPDATE inventory") && q.includes("reserved = reserved + $1")) {
          reservedStockCount += params?.[0] ?? 0;
          return { rows: [{ id: "inv_1" }] };
        }
        if (q.includes("INSERT INTO inventory_movements")) {
          return { rows: [] };
        }
        if (q.includes("INSERT INTO checkout_groups")) {
          groupCreated = true;
          return {
            rows: [
              {
                id: "cg_new_001",
                user_id: params?.[0],
                idempotency_key: params?.[1],
                status: "pending",
                total_amount: params?.[2],
                currency: "THB",
                created_at: new Date().toISOString(),
              },
            ],
          };
        }
        if (q.includes("INSERT INTO orders")) {
          ordersCount++;
          return { rows: [{ id: `ord_${ordersCount}` }] };
        }
        if (q.includes("INSERT INTO order_items")) {
          return { rows: [{ id: `item_${Math.random()}` }] };
        }
        if (q.includes("DELETE FROM cart_items WHERE cart_id = $1")) {
          cartCleared = true;
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    const result = await CheckoutService.checkout(mockDb, "usr_10", "idemp_checkout_999");

    assert.equal(groupCreated, true);
    assert.equal(ordersCount, 2); // Split into Shop A and Shop B
    assert.equal(result.orders.length, 2);
    assert.equal(reservedStockCount, 3); // 1 for p_1 + 2 for p_2
    assert.equal(cartCleared, true);
    assert.equal(result.checkoutGroup.totalAmountMinor, 100000n); // 1,000.00 THB

    // Fixed 30-minute reservation deadline check
    const diffMs = result.paymentExpiresAtMs - Date.now();
    assert.ok(diffMs > 28 * 60 * 1000 && diffMs <= 30 * 60 * 1000);
  });

  it("handles duplicate checkout idempotently without recreating orders or re-reserving stock", async () => {
    let reReservedStock = false;

    const mockDb: DbQueryable = {
      async query(sql: string) {
        const q = sql.trim();
        if (q.includes("FROM checkout_groups") && q.includes("idempotency_key = $1")) {
          return {
            rows: [
              {
                id: "cg_existing",
                user_id: "usr_10",
                idempotency_key: "idemp_duplicate_key",
                status: "pending",
                total_amount: "500.00",
                currency: "THB",
                created_at: new Date().toISOString(),
              },
            ],
          };
        }
        if (q.includes("FROM orders") && q.includes("checkout_group_id = $1")) {
          return {
            rows: [
              {
                id: "ord_existing_1",
                checkout_group_id: "cg_existing",
                shop_id: "shop_1",
                status: "pending",
                total_amount: "500.00",
                payment_expires_at: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
              },
            ],
          };
        }
        if (q.includes("FROM order_items WHERE oi.order_id = $1")) {
          return {
            rows: [
              {
                id: "oi_1",
                order_id: "ord_existing_1",
                product_id: "p_1",
                quantity: 1,
                unit_price: "500.00",
                total_price: "500.00",
                product_title: "Existing Item",
              },
            ],
          };
        }
        if (q.includes("UPDATE inventory")) {
          reReservedStock = true;
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    const result = await CheckoutService.checkout(mockDb, "usr_10", "idemp_duplicate_key");

    assert.equal(result.checkoutGroup.id, "cg_existing");
    assert.equal(result.orders.length, 1);
    assert.equal(result.orders[0].id, "ord_existing_1");
    assert.equal(reReservedStock, false); // No duplicate stock reservation
  });

  it("rolls back and throws ConflictError if stock is insufficient", async () => {
    let rolledBack = false;

    const mockDb: DbQueryable = {
      async query(sql: string) {
        const q = sql.trim();
        if (q.includes("FROM checkout_groups") && q.includes("idempotency_key = $1")) {
          return { rows: [] };
        }
        if (q.includes("SELECT id FROM carts")) return { rows: [{ id: "c_1" }] };
        if (q.includes("FROM cart_items ci")) {
          return {
            rows: [
              {
                id: "ci_1",
                cart_id: "c_1",
                product_id: "p_out",
                variant_id: null,
                quantity: 10,
                product_title: "Hot Product",
                product_price: "100.00",
                shop_id: "shop_1",
                shop_name: "Shop 1",
              },
            ],
          };
        }
        if (q.includes("BEGIN")) return { rows: [] };
        if (q.includes("UPDATE inventory SET reserved = reserved + $1")) {
          // Out of stock
          return { rows: [] };
        }
        if (q.includes("ROLLBACK")) {
          rolledBack = true;
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    await assert.rejects(
      () => CheckoutService.checkout(mockDb, "usr_1", "idemp_out_of_stock"),
      (err: any) => err instanceof ConflictError && err.code === "INSUFFICIENT_STOCK",
    );
    assert.equal(rolledBack, true);
  });
});
