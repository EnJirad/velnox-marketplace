/**
 * VelRepeat V2 — seller-owned packages (owner decision G3 = B).
 * ═══════════════════════════════════════════════════════════════════════════
 * The single-seller invariant:
 *
 *     velrepeat_packages.seller_id == seller_id of every referenced resource
 *
 * Structural half runs everywhere (pure file reads). The integration half needs
 * a disposable database (`TEST_DATABASE_URL`, bootstrapped from
 * db/run-sqleditor.sql) and skips without one — exactly like every other
 * DB-gated suite here.
 *
 * Ownership is always resolved from the AUTHENTICATED SESSION
 * (`sellers.user_id`), never from a request body, so the structural half below
 * pins that too: a `seller_id` read off the request would be the whole bug.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import { hasTestDatabase } from "./helpers/test-db.js";
import { createTableBlock, unqualified } from "./helpers/canonical-schema.js";
import { purgeUsers } from "./helpers/purge.js";
import {
  PackageAuthorizationError,
  authorizePackageComposition,
  parsePackageItems,
  resolveApprovedSeller,
} from "../routes/velrepeat-packages.js";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

/**
 * Strip comments so a negative assertion describes CODE rather than the prose
 * around it — otherwise a doc comment saying "this module never substitutes a
 * product" would fail a test that forbids the word "substitute".
 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. Structural — the invariant is in the schema and the write path
// ═══════════════════════════════════════════════════════════════════════════

describe("G3 — package ownership is structural", () => {
  const schema = read("db/schema.sql");
  const bootstrap = read("db/run-sqleditor.sql");
  const route = read("backend/routes/velrepeat-packages.ts");
  const server = read("backend/server.ts");

  for (const sql of [schema, bootstrap]) {
    test("velrepeat_packages has a NOT NULL seller FK to the canonical seller identity", () => {
      expect(sql).toContain("seller_id UUID NOT NULL REFERENCES sellers(id) ON DELETE CASCADE");
    });

    test("the seller access path is indexed", () => {
      expect(unqualified(sql)).toContain(
        "CREATE INDEX IF NOT EXISTS idx_velrepeat_packages_seller ON velrepeat_packages (seller_id)",
      );
    });

    test("the package table still owns no inventory authority", () => {
      // Bound the slice by the table's OWN closing paren. db/run-sqleditor.sql is
      // the rerunnable reconciler and carries its index pass in a later part, so
      // anchoring the end on idx_velrepeat_packages_active would scan unrelated
      // tables (velrepeat_cycles carries an 'out_of_stock' status) and fail on
      // text that has nothing to do with this table.
      const block = createTableBlock(sql, "velrepeat_packages");
      expect(block).not.toBe("");
      expect(block).not.toContain("stock");
    });

    test("a multi-seller package is impossible by construction — items carry no seller", () => {
      // Ownership of every item is DERIVED through products → shops → sellers
      // and compared against the package's seller. There is no second seller
      // column that could disagree with the package owner.
      const itemsStart = sql.indexOf("CREATE TABLE IF NOT EXISTS velrepeat_package_items (");
      const itemsEnd = sql.indexOf("CREATE TABLE IF NOT EXISTS velrepeat_pricing_snapshots (");
      const itemsBlock = sql.slice(itemsStart, itemsEnd);
      expect(itemsBlock).not.toContain("seller_id");
    });
  }

  test("the routes are mounted", () => {
    expect(server).toContain('from "./routes/velrepeat-packages.js"');
    expect(server).toContain("setupVelRepeatPackageRoutes(app);");
  });

  test("seller identity comes from the session, never from the request body", () => {
    // The ONLY place a seller is resolved.
    expect(route).toContain("SELECT id, status FROM sellers WHERE user_id = $1");
    // No endpoint reads a seller id out of req.body.
    expect(route).not.toMatch(/req\.body\??\.seller_id/);
    expect(route).not.toMatch(/req\.body\.sellerId/);
  });

  test("every write claims ownership with seller_id in the WHERE clause", () => {
    expect(route).toContain("WHERE id = $1 AND seller_id = $2");
    expect(route).toContain("DELETE FROM velrepeat_packages WHERE id = $1 AND seller_id = $2");
  });

  test("cross-seller composition is refused, not repaired", () => {
    expect(route).toContain('"PRODUCT_NOT_OWNED"');
    // Checked against CODE, not prose: these words appear in this file's own
    // doc comments describing what the module refuses to do.
    const code = stripComments(route);
    for (const forbidden of ["splitPackage", "substitute", "reassign"]) {
      expect(code).not.toContain(forbidden);
    }
  });

  test("the route never sets a price", () => {
    // Pricing belongs to the pricing engine; a package row must not carry one.
    const code = stripComments(route);
    expect(code).not.toContain("unit_price =");
    expect(code).not.toContain("total_amount");
    expect(code).not.toContain("discount");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Shape validation — pure, no database
// ═══════════════════════════════════════════════════════════════════════════

describe("G3 — package composition shape", () => {
  const uuid = "11111111-2222-3333-4444-555555555555";
  const other = "11111111-2222-3333-4444-666666666666";

  test("a well-formed composition parses", () => {
    expect(parsePackageItems([{ productId: uuid, quantity: 2 }])).toEqual([
      { productId: uuid, variantId: null, quantity: 2 },
    ]);
    expect(parsePackageItems([{ productId: uuid, variantId: other, quantity: 1 }])).toEqual([
      { productId: uuid, variantId: other, quantity: 1 },
    ]);
  });

  test("an empty composition is refused", () => {
    expect(() => parsePackageItems([])).toThrow(PackageAuthorizationError);
    expect(() => parsePackageItems(null)).toThrow(PackageAuthorizationError);
  });

  test("quantity must be a positive integer", () => {
    for (const quantity of [0, -1, 1.5, "2", null, undefined]) {
      expect(() => parsePackageItems([{ productId: uuid, quantity }])).toThrow(
        PackageAuthorizationError,
      );
    }
  });

  test("a malformed productId or variantId is refused", () => {
    expect(() => parsePackageItems([{ productId: "not-a-uuid", quantity: 1 }])).toThrow(
      PackageAuthorizationError,
    );
    expect(() => parsePackageItems([{ productId: uuid, variantId: "nope", quantity: 1 }])).toThrow(
      PackageAuthorizationError,
    );
  });

  test("the same product/variant twice is refused before the database sees it", () => {
    expect(() =>
      parsePackageItems([
        { productId: uuid, quantity: 1 },
        { productId: uuid, quantity: 2 },
      ]),
    ).toThrow(PackageAuthorizationError);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Integration — ownership against a real database
// ═══════════════════════════════════════════════════════════════════════════

describe("G3 — package ownership (needs a test database)", () => {
  const hasDb = hasTestDatabase();
  const testFn = hasDb ? test : test.skip;

  let query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }>;
  let withClient: <T>(fn: (client: any) => Promise<T>) => Promise<T>;

  let tag = "";
  let sellerAId = "";
  let sellerBId = "";
  let userAId = "";
  let userBId = "";
  let pendingUserId = "";
  let productAId = "";
  let variantAId = "";
  let productBId = "";
  let draftProductAId = "";

  beforeAll(async () => {
    if (!hasDb) return;
    const db = await import("../db/index.js");
    query = db.query as never;
    withClient = db.withTransaction as never;
    const { randomUUID } = await import("crypto");
    tag = `vr3-${randomUUID().slice(0, 8)}`;

    const makeUser = async (name: string) => {
      const r = await query(
        `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
        [`${tag}-${name}@test.local`, `VelRepeat G3 ${name}`],
      );
      return r.rows[0].id as string;
    };
    const makeSeller = async (userId: string, status = "approved") => {
      const r = await query(
        `INSERT INTO sellers (user_id, status) VALUES ($1, $2) RETURNING id`,
        [userId, status],
      );
      return r.rows[0].id as string;
    };
    const makeShop = async (sellerId: string) => {
      const r = await query(
        `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
        [sellerId, `${tag}-shop-${sellerId.slice(0, 4)}`, `${tag}-s${sellerId.slice(0, 8)}`],
      );
      return r.rows[0].id as string;
    };
    const makeProduct = async (shopId: string, name: string, status = "published") => {
      // `tag` is unique per run and `name` differs per product, so the slug is
      // unique without reaching for Math.random — a fixture should not depend
      // on a random value to be reproducible.
      const r = await query(
        `INSERT INTO products (shop_id, name, slug, price, status)
         VALUES ($1, $2, $3, 100, $4) RETURNING id`,
        [shopId, `${tag}-${name}`, `${tag}-${name}`, status],
      );
      return r.rows[0].id as string;
    };

    userAId = await makeUser("a");
    userBId = await makeUser("b");
    const pendingUser = await makeUser("pending");
    pendingUserId = pendingUser;

    sellerAId = await makeSeller(userAId);
    sellerBId = await makeSeller(userBId);
    const pendingSellerId = await makeSeller(pendingUser, "pending");

    const shopA = await makeShop(sellerAId);
    const shopB = await makeShop(sellerBId);
    await makeShop(pendingSellerId);

    productAId = await makeProduct(shopA, "product-a");
    productBId = await makeProduct(shopB, "product-b");
    draftProductAId = await makeProduct(shopA, "product-draft", "draft");

    const variant = await query(
      `INSERT INTO product_variants (product_id, name, price, status)
       VALUES ($1, 'v1', 120, 'active') RETURNING id`,
      [productAId],
    );
    variantAId = variant.rows[0].id as string;

    // An archived variant on seller A's product — must not be packageable.
    await query(
      `INSERT INTO product_variants (product_id, name, price, status)
       VALUES ($1, 'archived-v', 90, 'archived')`,
      [productAId],
    );
  });

  afterAll(async () => {
    if (!hasDb) return;
    await query(`DELETE FROM velrepeat_packages WHERE seller_id = ANY($1::uuid[])`, [
      [sellerAId, sellerBId],
    ]);
    await purgeUsers([userAId, userBId, pendingUserId]);
  });

  testFn("a package cannot exist without an owner", async () => {
    let err: { code?: string } | null = null;
    try {
      await query(
        `INSERT INTO velrepeat_packages (name, description) VALUES ($1, $2)`,
        [`${tag} ownerless`, "must be refused"],
      );
    } catch (e) {
      err = e as { code?: string };
    }
    expect(err?.code).toBe("23502"); // not_null_violation
  });

  testFn("a seller creates their own package and may add their own products and variants", async () => {
    const created = await withClient(async (client) => {
      const seller = await resolveApprovedSeller(client, userAId);
      expect(seller.sellerId).toBe(sellerAId);

      const items = await authorizePackageComposition(client, seller.sellerId, [
        { productId: productAId, variantId: null, quantity: 2 },
        { productId: productAId, variantId: variantAId, quantity: 1 },
      ]);

      expect(items).toHaveLength(2);
      // The catalog price is snapshotted per line; a variant prices as the variant.
      expect(items[0].unitPrice).toBe("100.00");
      expect(items[1].unitPrice).toBe("120.00");

      const row = await client.query(
        `INSERT INTO velrepeat_packages (seller_id, name, description) VALUES ($1, $2, $3) RETURNING id`,
        [seller.sellerId, `${tag} package A`, "own products only"],
      );
      const packageId = row.rows[0].id as string;

      for (const item of items) {
        await client.query(
          `INSERT INTO velrepeat_package_items (package_id, product_id, variant_id, quantity)
           VALUES ($1, $2, $3, $4)`,
          [packageId, item.productId, item.variantId, item.quantity],
        );
      }
      return packageId;
    });

    const stored = await query(
      `SELECT seller_id FROM velrepeat_packages WHERE id = $1`,
      [created],
    );
    expect(stored.rows[0].seller_id).toBe(sellerAId);
  });

  testFn("a seller attempting another seller's product is REJECTED", async () => {
    await withClient(async (client) => {
      const seller = await resolveApprovedSeller(client, userAId);
      await expect(
        authorizePackageComposition(client, seller.sellerId, [
          { productId: productBId, variantId: null, quantity: 1 },
        ]),
      ).rejects.toThrow(PackageAuthorizationError);
    });
  });

  testFn("a mixed-seller package is REJECTED whole — the good item is not silently kept", async () => {
    await withClient(async (client) => {
      const seller = await resolveApprovedSeller(client, userAId);
      await expect(
        authorizePackageComposition(client, seller.sellerId, [
          { productId: productAId, variantId: null, quantity: 1 },
          { productId: productBId, variantId: null, quantity: 1 },
        ]),
      ).rejects.toThrow(PackageAuthorizationError);
    });
  });

  testFn("a variant belonging to another seller's product is REJECTED", async () => {
    await withClient(async (client) => {
      // Build a variant on seller B's product, then try to use it under A.
      const variantB = await client.query(
        `INSERT INTO product_variants (product_id, name, price, status)
         VALUES ($1, 'bv', 55, 'active') RETURNING id`,
        [productBId],
      );
      const seller = await resolveApprovedSeller(client, userAId);

      // Under product A: refused because the variant is not A's product's variant.
      await expect(
        authorizePackageComposition(client, seller.sellerId, [
          { productId: productAId, variantId: variantB.rows[0].id, quantity: 1 },
        ]),
      ).rejects.toThrow(PackageAuthorizationError);

      // Under product B: refused because product B is not A's product at all.
      await expect(
        authorizePackageComposition(client, seller.sellerId, [
          { productId: productBId, variantId: variantB.rows[0].id, quantity: 1 },
        ]),
      ).rejects.toThrow(PackageAuthorizationError);
    });
  });

  testFn("a non-public product (draft) is REJECTED", async () => {
    await withClient(async (client) => {
      const seller = await resolveApprovedSeller(client, userAId);
      await expect(
        authorizePackageComposition(client, seller.sellerId, [
          { productId: draftProductAId, variantId: null, quantity: 1 },
        ]),
      ).rejects.toThrow(PackageAuthorizationError);
    });
  });

  testFn("an archived variant of an otherwise valid product is REJECTED", async () => {
    await withClient(async (client) => {
      const seller = await resolveApprovedSeller(client, userAId);
      const archived = await client.query(
        `SELECT id FROM product_variants WHERE product_id = $1 AND status = 'archived'`,
        [productAId],
      );
      await expect(
        authorizePackageComposition(client, seller.sellerId, [
          { productId: productAId, variantId: archived.rows[0].id, quantity: 1 },
        ]),
      ).rejects.toThrow(PackageAuthorizationError);
    });
  });

  testFn("a non-existent product is REJECTED", async () => {
    await withClient(async (client) => {
      const seller = await resolveApprovedSeller(client, userAId);
      await expect(
        authorizePackageComposition(client, seller.sellerId, [
          { productId: "00000000-0000-0000-0000-000000000000", variantId: null, quantity: 1 },
        ]),
      ).rejects.toThrow(PackageAuthorizationError);
    });
  });

  testFn("an unapproved seller cannot author packages at all", async () => {
    await withClient(async (client) => {
      await expect(resolveApprovedSeller(client, pendingUserId)).rejects.toThrow(
        PackageAuthorizationError,
      );
    });
  });

  testFn("a non-seller user cannot author packages at all", async () => {
    await withClient(async (client) => {
      const { randomUUID } = await import("crypto");
      const plain = await client.query(
        `INSERT INTO users (email, name) VALUES ($1, $2) RETURNING id`,
        [`${tag}-plain-${randomUUID().slice(0, 8)}@test.local`, "not a seller"],
      );
      try {
        await expect(resolveApprovedSeller(client, plain.rows[0].id)).rejects.toThrow(
          PackageAuthorizationError,
        );
      } finally {
        await purgeUsers([plain.rows[0].id as string]);
      }
    });
  });

  testFn("one seller's packages are never visible to another seller", async () => {
    const mine = await query(`SELECT id FROM velrepeat_packages WHERE seller_id = $1`, [sellerAId]);
    const theirs = await query(`SELECT id FROM velrepeat_packages WHERE seller_id = $1`, [sellerBId]);
    const mineIds = mine.rows.map((r) => r.id as string);
    const theirIds = theirs.rows.map((r) => r.id as string);
    for (const id of theirIds) expect(mineIds).not.toContain(id);

    // And the ownership-scoped write cannot reach another seller's row.
    await withClient(async (client) => {
      if (theirIds.length === 0) return;
      const updated = await client.query(
        `UPDATE velrepeat_packages SET name = 'hijacked'
          WHERE id = $1 AND seller_id = $2 RETURNING id`,
        [theirIds[0], sellerAId],
      );
      expect(updated.rows).toHaveLength(0);
    });
  });
});
