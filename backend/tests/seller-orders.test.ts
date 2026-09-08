/**
 * Seller Order Management — tests.
 *
 * Unit tests cover the pure functions (order status state machine,
 * subscription display mapping). The integration test (skipped when no
 * DATABASE_URL is available) verifies the core multi-vendor safety rule:
 * a seller-scoped item query returns only that seller's items even when an
 * order contains products from two different sellers.
 */
import { describe, expect, test } from "bun:test";
import {
  canTransitionOrderStatus,
  fetchSellerItemsForOrders,
  isSellerOrderStatus,
  mapFrequencyType,
  mapPlanStatusToSubscriptionStatus,
  normalizeSellerOrderStatus,
} from "../routes/seller-orders.js";

// ─── Order status state machine ──────────────────────────────────────────────

describe("canTransitionOrderStatus", () => {
  test("allows the documented forward transitions", () => {
    expect(canTransitionOrderStatus("pending", "confirmed")).toBe(true);
    expect(canTransitionOrderStatus("pending", "cancelled")).toBe(true);
    expect(canTransitionOrderStatus("confirmed", "shipped")).toBe(true);
    expect(canTransitionOrderStatus("confirmed", "cancelled")).toBe(true);
    expect(canTransitionOrderStatus("shipped", "delivered")).toBe(true);
    expect(canTransitionOrderStatus("delivered", "completed")).toBe(true);
  });

  test("rejects skipping required states", () => {
    expect(canTransitionOrderStatus("pending", "shipped")).toBe(false);
    expect(canTransitionOrderStatus("pending", "delivered")).toBe(false);
    expect(canTransitionOrderStatus("pending", "completed")).toBe(false);
    expect(canTransitionOrderStatus("confirmed", "delivered")).toBe(false);
    expect(canTransitionOrderStatus("confirmed", "completed")).toBe(false);
    expect(canTransitionOrderStatus("shipped", "completed")).toBe(false);
  });

  test("terminal states cannot be changed", () => {
    expect(canTransitionOrderStatus("completed", "delivered")).toBe(false);
    expect(canTransitionOrderStatus("completed", "cancelled")).toBe(false);
    expect(canTransitionOrderStatus("cancelled", "pending")).toBe(false);
    expect(canTransitionOrderStatus("cancelled", "confirmed")).toBe(false);
  });

  test("rejects arbitrary/unknown status values", () => {
    expect(canTransitionOrderStatus("pending", "paid")).toBe(false);
    expect(canTransitionOrderStatus("paid", "pending")).toBe(false);
    expect(canTransitionOrderStatus("pending", "shipped_now")).toBe(false);
    expect(canTransitionOrderStatus("", "confirmed")).toBe(false);
  });
});

describe("normalizeSellerOrderStatus", () => {
  test("maps Stripe lifecycle statuses to fulfillment statuses", () => {
    expect(normalizeSellerOrderStatus("pending")).toBe("pending");
    expect(normalizeSellerOrderStatus("pending_payment")).toBe("pending");
    expect(normalizeSellerOrderStatus("paid")).toBe("pending");
    expect(normalizeSellerOrderStatus("confirmed")).toBe("confirmed");
    expect(normalizeSellerOrderStatus("shipped")).toBe("shipped");
    expect(normalizeSellerOrderStatus("delivered")).toBe("delivered");
    expect(normalizeSellerOrderStatus("completed")).toBe("completed");
    expect(normalizeSellerOrderStatus("cancelled")).toBe("cancelled");
    expect(normalizeSellerOrderStatus("payment_failed")).toBe("cancelled");
  });

  test("unknown values fall back to pending (never crashes the UI)", () => {
    expect(normalizeSellerOrderStatus("weird_value")).toBe("pending");
    expect(normalizeSellerOrderStatus("")).toBe("pending");
  });

  test("normalized statuses all have state-machine metadata", () => {
    for (const s of ["pending", "confirmed", "shipped", "delivered", "completed", "cancelled"]) {
      expect(isSellerOrderStatus(s)).toBe(true);
    }
  });
});

describe("isSellerOrderStatus", () => {
  test("accepts canonical statuses only", () => {
    for (const s of ["pending", "confirmed", "shipped", "delivered", "completed", "cancelled"]) {
      expect(isSellerOrderStatus(s)).toBe(true);
    }
    expect(isSellerOrderStatus("paid")).toBe(false);
    expect(isSellerOrderStatus("processing")).toBe(false);
    expect(isSellerOrderStatus(undefined)).toBe(false);
    expect(isSellerOrderStatus(null)).toBe(false);
    expect(isSellerOrderStatus(42)).toBe(false);
  });
});

// ─── Subscription (VelRepeat plan) display mapping ────────────────────────────

describe("mapPlanStatusToSubscriptionStatus", () => {
  test("active/processing plans show as active", () => {
    expect(mapPlanStatusToSubscriptionStatus("active")).toBe("active");
    expect(mapPlanStatusToSubscriptionStatus("processing")).toBe("active");
  });

  test("terminal plans show as cancelled", () => {
    expect(mapPlanStatusToSubscriptionStatus("cancelled")).toBe("cancelled");
    expect(mapPlanStatusToSubscriptionStatus("completed")).toBe("cancelled");
  });

  test("recoverable-but-not-running states show as paused", () => {
    expect(mapPlanStatusToSubscriptionStatus("paused")).toBe("paused");
    expect(mapPlanStatusToSubscriptionStatus("out_of_stock")).toBe("paused");
    expect(mapPlanStatusToSubscriptionStatus("payment_failed")).toBe("paused");
    expect(mapPlanStatusToSubscriptionStatus("draft")).toBe("paused");
  });
});

describe("mapFrequencyType", () => {
  test("maps velrepeat frequency types", () => {
    expect(mapFrequencyType("days")).toBe("daily");
    expect(mapFrequencyType("weeks")).toBe("weekly");
    expect(mapFrequencyType("months")).toBe("monthly");
    expect(mapFrequencyType("whatever")).toBe("custom");
  });
});

// ─── Integration: multi-vendor ownership scoping (needs DATABASE_URL) ────────

describe("seller order ownership scoping (integration)", () => {
  const hasDb = Boolean(process.env.DATABASE_URL);
  const testFn = hasDb ? test : test.skip;

  testFn(
    "a seller-scoped item query returns only that seller's items from a shared order",
    async () => {
      const { query } = await import("../db/index.js");
      const { randomUUID } = await import("crypto");
      const tag = `so-test-${randomUUID().slice(0, 8)}`;

      const mkUser = async (email: string) => {
        const u = await query(
          `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
          [email, "Owner Test"],
        );
        return u.rows[0].id as string;
      };

      const customerId = await mkUser(`${tag}-customer@test.local`);
      const sellerAUser = await mkUser(`${tag}-a@test.local`);
      const sellerBUser = await mkUser(`${tag}-b@test.local`);

      const mkSeller = async (userId: string, suffix: string) => {
        const s = await query(
          `INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`,
          [userId],
        );
        const sellerId = s.rows[0].id as string;
        const shop = await query(
          `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
          [sellerId, `${tag}-${suffix} shop`, `${tag}-${suffix}`],
        );
        const shopId = shop.rows[0].id as string;
        const product = await query(
          `INSERT INTO products (shop_id, name, slug, price, status)\n           VALUES ($1, $2, $3, 100, 'published') RETURNING id`,
          [shopId, `${tag}-${suffix} product`, `${tag}-${suffix}-p`],
        );
        const productId = product.rows[0].id as string;
        await query(
          `INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 10, 0)`,
          [productId],
        );
        return { sellerId, shopId, productId };
      };

      const sellerA = await mkSeller(sellerAUser, "a");
      const sellerB = await mkSeller(sellerBUser, "b");

      try {
        // One order containing items from BOTH sellers' shops.
        const order = await query(
          `INSERT INTO orders (user_id, status, total_amount, currency)\n           VALUES ($1, 'pending', 200, 'THB') RETURNING id`,
          [customerId],
        );
        const orderId = order.rows[0].id as string;

        for (const s of [sellerA, sellerB]) {
          await query(
            `INSERT INTO order_items (order_id, product_id, shop_id, product_name,\n                                      product_name_snapshot, quantity, price, subtotal)\n             VALUES ($1, $2, $3, $4, $4, 1, 100, 100)`,
            [orderId, s.productId, s.shopId, `${tag} item`],
          );
        }

        // Seller A must only see A's item (1), never B's (2).
        const itemsForA = await fetchSellerItemsForOrders([orderId], sellerA.sellerId);
        expect(itemsForA[orderId]).toHaveLength(1);
        expect(itemsForA[orderId]![0]!.sellerId).toBe(sellerA.sellerId);

        const itemsForB = await fetchSellerItemsForOrders([orderId], sellerB.sellerId);
        expect(itemsForB[orderId]).toHaveLength(1);
        expect(itemsForB[orderId]![0]!.sellerId).toBe(sellerB.sellerId);

        // An unrelated seller sees nothing.
        const otherUser = await mkUser(`${tag}-c@test.local`);
        const other = await mkSeller(otherUser, "c");
        const itemsForC = await fetchSellerItemsForOrders([orderId], other.sellerId);
        expect(itemsForC[orderId] ?? []).toHaveLength(0);
      } finally {
        await query(`DELETE FROM users WHERE id = ANY($1)`, [[customerId, sellerAUser, sellerBUser]]);
      }
    },
    30_000,
  );
});