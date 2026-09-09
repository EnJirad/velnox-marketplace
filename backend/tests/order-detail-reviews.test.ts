/**
 * P1 #3 — Order detail review contract.
 *
 * Unit tests (always run) verify the server-side review input validation:
 *   • rating must be an integer 1–5
 *   • comment must be 1–2000 characters after trimming
 *
 * Integration tests (DB-gated, skipped without DATABASE_URL) verify the
 * verified-purchase eligibility rule:
 *   • an orderId supplied with a review must be the authenticated user's
 *     own order AND must contain the reviewed product
 *   • another user's order must never count as a verified purchase
 */
import { describe, expect, test } from "bun:test";
import { validateReviewInput, verifyOrderContainsProduct } from "../lib/reviews.js";

// ─── Review input validation (pure, always runs) ───────────────────────────

describe("validateReviewInput", () => {
  test("accepts a valid rating + comment (trims whitespace)", () => {
    const r = validateReviewInput({ rating: 5, comment: "  สินค้าดีมาก  " });
    expect(r.error).toBeNull();
    expect(r.rating).toBe(5);
    expect(r.comment).toBe("สินค้าดีมาก");
  });

  test("rejects rating 0", () => {
    const r = validateReviewInput({ rating: 0, comment: "ok" });
    expect(r.error).not.toBeNull();
  });

  test("rejects rating 6", () => {
    const r = validateReviewInput({ rating: 6, comment: "ok" });
    expect(r.error).not.toBeNull();
  });

  test("rejects non-integer rating 4.5", () => {
    const r = validateReviewInput({ rating: 4.5, comment: "ok" });
    expect(r.error).not.toBeNull();
  });

  test("rejects missing rating", () => {
    const r = validateReviewInput({ comment: "ok" });
    expect(r.error).not.toBeNull();
  });

  test("rejects empty comment", () => {
    const r = validateReviewInput({ rating: 4, comment: "" });
    expect(r.error).not.toBeNull();
  });

  test("rejects whitespace-only comment", () => {
    const r = validateReviewInput({ rating: 4, comment: "   " });
    expect(r.error).not.toBeNull();
  });

  test("rejects comment over 2000 characters", () => {
    const r = validateReviewInput({ rating: 4, comment: "x".repeat(2001) });
    expect(r.error).not.toBeNull();
  });

  test("accepts a 2000-character comment (boundary)", () => {
    const r = validateReviewInput({ rating: 4, comment: "x".repeat(2000) });
    expect(r.error).toBeNull();
  });
});

// ─── Verified-purchase eligibility (needs DATABASE_URL) ────────────────────

describe("verifyOrderContainsProduct (integration)", () => {
  const hasDb = Boolean(process.env.DATABASE_URL);
  const testFn = hasDb ? test : test.skip;

  /**
   * Seed: userA owns orderA containing productA; userB owns orderB also
   * containing productA (so "orderB for userA" must NOT verify).
   * productB exists but is not in orderA.
   */
  async function seed() {
    const { query } = await import("../db/index.js");
    const mkUser = async (email: string) => {
      const u = await query("INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id", [email, "Review Test"]);
      return u.rows[0].id as string;
    };
    const userIdA = await mkUser("review-a@test.local");
    const userIdB = await mkUser("review-b@test.local");

    const seller = await query("INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id", [userIdA]);
    const sellerId = seller.rows[0].id as string;
    const shop = await query("INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id", [
      sellerId,
      "Review Shop",
      "review-shop-" + Date.now(),
    ]);
    const shopId = shop.rows[0].id as string;

    const mkProduct = async (name: string) => {
      const p = await query("INSERT INTO products (shop_id, name, slug, price, status) VALUES ($1, $2, $3, 100, 'published') RETURNING id", [
        shopId,
        name,
        name.toLowerCase().replace(/\s+/g, "-") + "-" + Math.random().toString(36).slice(2, 8),
      ]);
      return p.rows[0].id as string;
    };
    const productIdA = await mkProduct("Review Product A");
    const productIdB = await mkProduct("Review Product B");

    const mkOrder = async (userId: string, productId: string) => {
      const o = await query(
        "INSERT INTO orders (user_id, shop_id, status, total_amount, currency) VALUES ($1, $2, 'delivered', 100, 'THB') RETURNING id",
        [userId, shopId],
      );
      const orderId = o.rows[0].id as string;
      await query(
        `INSERT INTO order_items (order_id, product_id, shop_id, product_name, product_name_snapshot, quantity, price, subtotal)
         VALUES ($1, $2, $3, $4, $4, 1, 100, 100)`,
        [orderId, productId, shopId, "Review Product"],
      );
      return orderId;
    };
    const orderIdA = await mkOrder(userIdA, productIdA);
    const orderIdB = await mkOrder(userIdB, productIdA);

    return { userIdA, userIdB, productIdA, productIdB, orderIdA, orderIdB };
  }

  testFn("own order containing the product → verified purchase", async () => {
    const s = await seed();
    expect(await verifyOrderContainsProduct(s.userIdA, s.productIdA, s.orderIdA)).toBe(true);
  });

  testFn("another user's order → NOT a verified purchase", async () => {
    const s = await seed();
    expect(await verifyOrderContainsProduct(s.userIdA, s.productIdA, s.orderIdB)).toBe(false);
  });

  testFn("own order without the product → NOT a verified purchase", async () => {
    const s = await seed();
    expect(await verifyOrderContainsProduct(s.userIdA, s.productIdB, s.orderIdA)).toBe(false);
  });

  testFn("non-existent order → NOT a verified purchase", async () => {
    const s = await seed();
    expect(await verifyOrderContainsProduct(s.userIdA, s.productIdA, "00000000-0000-4000-8000-000000000000")).toBe(false);
  });
});