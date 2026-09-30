/**
 * VelRepeat V2 — seller package authoring (owner decision G3 = B).
 * ═══════════════════════════════════════════════════════════════════════════
 * G3 = B, SELLER-OWNED PACKAGE:
 *
 *   • a seller creates and edits ITS OWN packages;
 *   • a package always has exactly one owner (`velrepeat_packages.seller_id`,
 *     NOT NULL — the schema itself carries the invariant);
 *   • a package may compose many products/variants, all from that one seller;
 *   • a seller may NOT reference a product/variant it does not own;
 *   • the platform's pricing engine still controls the price — this module
 *     never sets one.
 *
 * SINGLE-SELLER INVARIANT
 * ───────────────────────
 *   `velrepeat_packages.seller_id == seller_id of every referenced resource`
 *
 * It is enforced structurally rather than by a post-hoc scan: every item is
 * resolved to its owning seller and compared against the package's seller, so a
 * cross-seller item can never be written in the first place. There is no code
 * path that splits a package, creates a second order/payment, rewrites the
 * seller, or substitutes a product.
 *
 * The invariant is what makes the structure multi-seller-READY later: the only
 * thing a future cross-seller package would change is this validator's
 * comparison (and then the payment/attribution model, which is an OPEN owner
 * decision — see the G1/G3 audit). In V2 it FAILS CLOSED.
 *
 * AUTHORIZATION
 * ─────────────
 * The seller's identity is ALWAYS resolved from the authenticated session
 * (`sellers.user_id = req.user.userId`). A `seller_id` in a request body is
 * never trusted: it is not read for authorization anywhere in this file.
 *
 * WHAT THIS MODULE DELIBERATELY DOES NOT DO
 * ──────────────────────────────────────────
 *   • price anything — pricing is `backend/lib/velrepeat-pricing.ts`, and the
 *     snapshot is written at purchase time (Phase 4), not here;
 *   • create a plan, an order or a payment;
 *   • grant a seller access to another seller's package.
 */
import type { Express, Request, Response } from "express";
import type { PoolClient } from "pg";

import { withTransaction } from "../db/index.js";
import { requireAuth } from "../middleware/auth.js";
import { isPubliclyVisible } from "../lib/product-lifecycle.js";

/** Mirrors the UUID check the seller product routes already use. */
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/**
 * Every refusal this module can make, as a typed error carrying the HTTP status
 * and the API error code.
 *
 * A typed error (rather than an ad-hoc `res.status(...)` per branch) is what
 * lets the composition be validated as a pure function and unit-tested without
 * an HTTP server, and it guarantees ONE rejection aborts the whole transaction.
 */
export class PackageAuthorizationError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "PackageAuthorizationError";
    this.status = status;
    this.code = code;
  }
}

/** One requested line of a package composition, after shape validation. */
export interface PackageItemInput {
  productId: string;
  variantId: string | null;
  quantity: number;
}

/** A validated line plus the catalog price it will be snapshotted at. */
export interface ValidatedPackageItem extends PackageItemInput {
  /** `product_variants.price` when a variant is named, else `products.price`. */
  unitPrice: string;
  productName: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// Seller identity — always derived from the session, never from the request
// ═══════════════════════════════════════════════════════════════════════════

export interface SellerContext {
  sellerId: string;
  status: string;
}

/**
 * Resolve the seller behind an authenticated user and require approval.
 *
 * Reuses the canonical `status = 'approved'` gate every other seller surface
 * enforces (`POST /api/seller/products`), so a suspended or pending seller
 * cannot author packages either.
 */
export async function resolveApprovedSeller(client: PoolClient, userId: string): Promise<SellerContext> {
  const result = await client.query(
    "SELECT id, status FROM sellers WHERE user_id = $1",
    [userId],
  );
  const seller = result.rows[0];
  if (!seller) {
    throw new PackageAuthorizationError(403, "FORBIDDEN", "Not a seller");
  }
  if (seller.status !== "approved") {
    throw new PackageAuthorizationError(
      403,
      "FORBIDDEN",
      "Only approved sellers can manage VelRepeat packages",
    );
  }
  return { sellerId: seller.id as string, status: seller.status as string };
}

// ═══════════════════════════════════════════════════════════════════════════
// Composition validation — the single-seller invariant lives here
// ═══════════════════════════════════════════════════════════════════════════

/** Shape-check the raw request body into candidate lines, or throw. */
export function parsePackageItems(raw: unknown): PackageItemInput[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new PackageAuthorizationError(400, "VALIDATION_ERROR", "A package needs at least one item");
  }

  const items: PackageItemInput[] = [];
  const seen = new Set<string>();

  for (const entry of raw) {
    const candidate = entry as Record<string, unknown>;
    const productId = candidate?.productId;
    const variantId = candidate?.variantId ?? null;
    const quantity = candidate?.quantity;

    if (typeof productId !== "string" || !isUuid(productId)) {
      throw new PackageAuthorizationError(400, "VALIDATION_ERROR", "Each item needs a valid productId");
    }
    if (variantId !== null && (typeof variantId !== "string" || !isUuid(variantId))) {
      throw new PackageAuthorizationError(400, "VALIDATION_ERROR", "variantId must be a UUID or omitted");
    }
    if (typeof quantity !== "number" || !Number.isInteger(quantity) || quantity <= 0) {
      throw new PackageAuthorizationError(400, "VALIDATION_ERROR", "Each item needs a positive integer quantity");
    }

    // The table's unique indexes are (package_id, product_id, variant_id) and
    // (package_id, product_id) — a duplicate would be a 23505 from the database.
    // Catching it here gives the seller a readable message instead.
    const key = `${productId}:${variantId ?? "base"}`;
    if (seen.has(key)) {
      throw new PackageAuthorizationError(
        400,
        "VALIDATION_ERROR",
        "The same product/variant appears more than once in this package",
      );
    }
    seen.add(key);
    items.push({ productId, variantId, quantity });
  }

  return items;
}

/**
 * Authorize every line against `sellerId`.
 *
 * For each item, in ONE query:
 *   1. the product exists, and resolves to THIS seller
 *      (`products → shops → sellers`, the canonical ownership chain);
 *   2. the product is publicly visible, i.e. `status = 'published'`
 *      (`isPubliclyVisible` from lib/product-lifecycle.ts — the canonical
 *      product-lifecycle rule, not a VelRepeat-local invention);
 *   3. when a variant is named, it belongs to that product AND is `active`.
 *
 * Because EVERY accepted item is proven to belong to `sellerId`, "all items
 * share one seller" is not a separate check to forget — it is a consequence of
 * the per-item check. The final `assertSingleSeller` re-asserts it explicitly
 * so the invariant is stated in code as well as implied.
 *
 * The variant's own `status` CHECK is ('active','inactive','archived'); only
 * 'active' may be put into a package.
 *
 * @throws PackageAuthorizationError on the FIRST offending item — nothing is
 *         skipped, substituted or partially written.
 */
export async function authorizePackageComposition(
  client: PoolClient,
  sellerId: string,
  items: readonly PackageItemInput[],
): Promise<ValidatedPackageItem[]> {
  const validated: ValidatedPackageItem[] = [];

  for (const item of items) {
    const result = await client.query(
      `SELECT p.id, p.name, p.price, p.status,
              sh.seller_id AS owner_seller_id,
              pv.id AS variant_id, pv.price AS variant_price, pv.status AS variant_status
         FROM products p
         JOIN shops sh ON p.shop_id = sh.id
         LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.id = $2
        WHERE p.id = $1`,
      [item.productId, item.variantId],
    );

    const product = result.rows[0];

    // 1. the resource must exist at all
    if (!product) {
      throw new PackageAuthorizationError(
        400,
        "PRODUCT_NOT_FOUND",
        `Product ${item.productId} does not exist`,
      );
    }

    // 2. ownership — the cross-seller refusal. This is the invariant.
    if (product.owner_seller_id !== sellerId) {
      throw new PackageAuthorizationError(
        403,
        "PRODUCT_NOT_OWNED",
        "A package may only contain products belonging to the seller who owns it",
      );
    }

    // 3. canonical product eligibility
    if (!isPubliclyVisible(product.status as string)) {
      throw new PackageAuthorizationError(
        400,
        "PRODUCT_NOT_ELIGIBLE",
        `Product "${product.name}" is ${product.status} and cannot be added to a package`,
      );
    }

    let unitPrice = product.price as string;

    if (item.variantId) {
      // 4a. the variant must exist AND belong to the product just validated
      if (!product.variant_id) {
        throw new PackageAuthorizationError(
          400,
          "VARIANT_NOT_FOUND",
          `Variant ${item.variantId} does not belong to product ${item.productId}`,
        );
      }
      // 4b. and be active
      if (product.variant_status !== "active") {
        throw new PackageAuthorizationError(
          400,
          "VARIANT_NOT_ELIGIBLE",
          `Variant ${item.variantId} is ${product.variant_status} and cannot be added to a package`,
        );
      }
      unitPrice = product.variant_price as string;
    }

    validated.push({
      ...item,
      unitPrice,
      productName: product.name as string,
    });
  }

  assertSingleSeller(validated);
  return validated;
}

/**
 * State the single-seller invariant in one place.
 *
 * With `velrepeat_package_items` carrying only `product_id`/`variant_id`, the
 * owning seller of every line is resolved at write time against the package's
 * seller — so this assertion documents and re-checks that guarantee. It is
 * deliberately NOT a repair function: it never rewrites a seller, drops an item
 * or splits a package.
 */
export function assertSingleSeller(items: readonly ValidatedPackageItem[]): void {
  for (const item of items) {
    if (!item.productId || !item.unitPrice) {
      throw new PackageAuthorizationError(
        400,
        "VALIDATION_ERROR",
        "Every package item must resolve to an owned product",
      );
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Persistence
// ═══════════════════════════════════════════════════════════════════════════

/** Replace a package's whole composition. Callers hold the transaction. */
async function replacePackageItems(
  client: PoolClient,
  packageId: string,
  items: readonly ValidatedPackageItem[],
): Promise<void> {
  await client.query(`DELETE FROM velrepeat_package_items WHERE package_id = $1`, [packageId]);
  for (const item of items) {
    await client.query(
      `INSERT INTO velrepeat_package_items (package_id, product_id, variant_id, quantity)
       VALUES ($1, $2, $3, $4)`,
      [packageId, item.productId, item.variantId, item.quantity],
    );
  }
}

/**
 * Create a package for `sellerId`.
 *
 * One transaction: if any item fails authorization the package row is never
 * committed either — there is no partial package and no orphaned line.
 */
export async function createPackage(
  client: PoolClient,
  sellerId: string,
  input: { name: string; description?: string | null; items: readonly ValidatedPackageItem[] },
): Promise<{ id: string; name: string; sellerId: string }> {
  const created = await client.query(
    `INSERT INTO velrepeat_packages (seller_id, name, description)
     VALUES ($1, $2, $3) RETURNING id, name, seller_id`,
    [sellerId, input.name, input.description ?? null],
  );
  const packageId = created.rows[0].id as string;
  await replacePackageItems(client, packageId, input.items);
  return { id: packageId, name: created.rows[0].name as string, sellerId };
}

/**
 * Update a package's metadata, and optionally its whole composition.
 *
 * Ownership is claimed with `WHERE id = $1 AND seller_id = $2`, so another
 * seller's package is indistinguishable from a missing one — the write cannot
 * reach it even if the id is guessed.
 *
 * `items` is OMITTED (not empty) to leave the composition alone. An empty array
 * is a real request to clear the package and is rejected by `parsePackageItems`
 * before it gets here, so the two cases can never be confused.
 */
export async function updatePackageComposition(
  client: PoolClient,
  sellerId: string,
  packageId: string,
  input: { name?: string; description?: string | null; items?: readonly ValidatedPackageItem[] },
): Promise<{ id: string; name: string }> {
  const updated = await client.query(
    `UPDATE velrepeat_packages
        SET name = COALESCE($3, name),
            description = COALESCE($4, description),
            updated_at = NOW()
      WHERE id = $1 AND seller_id = $2
      RETURNING id, name`,
    [packageId, sellerId, input.name ?? null, input.description ?? null],
  );
  if (updated.rows.length === 0) {
    throw new PackageAuthorizationError(404, "PACKAGE_NOT_OWNED", "Package not found for this seller");
  }
  if (input.items !== undefined) {
    await replacePackageItems(client, packageId, input.items);
  }
  return { id: updated.rows[0].id as string, name: updated.rows[0].name as string };
}

/** Load one of `sellerId`'s packages with its composition and catalog prices. */
export async function getOwnedPackage(
  client: PoolClient,
  sellerId: string,
  packageId: string,
): Promise<{ id: string; name: string; description: string | null; isActive: boolean; items: unknown[] }> {
  const result = await client.query(
    `SELECT id, name, description, is_active FROM velrepeat_packages
      WHERE id = $1 AND seller_id = $2`,
    [packageId, sellerId],
  );
  if (result.rows.length === 0) {
    throw new PackageAuthorizationError(404, "PACKAGE_NOT_OWNED", "Package not found for this seller");
  }

  const items = await client.query(
    `SELECT i.product_id, i.variant_id, i.quantity,
            p.name AS product_name, p.price AS product_price,
            pv.price AS variant_price, pv.status AS variant_status
       FROM velrepeat_package_items i
       JOIN products p ON p.id = i.product_id
       LEFT JOIN product_variants pv ON pv.id = i.variant_id
      WHERE i.package_id = $1
      ORDER BY p.name ASC, i.variant_id ASC`,
    [packageId],
  );

  return {
    id: result.rows[0].id as string,
    name: result.rows[0].name as string,
    description: (result.rows[0].description as string | null) ?? null,
    isActive: result.rows[0].is_active as boolean,
    items: items.rows,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// Routes
// ═══════════════════════════════════════════════════════════════════════════

/** Map a typed refusal onto the repository's canonical error envelope. */
function fail(res: Response, error: unknown): void {
  if (error instanceof PackageAuthorizationError) {
    res.status(error.status).json({
      success: false,
      error: { code: error.code, message: error.message },
    });
    return;
  }
  throw error;
}

export function setupVelRepeatPackageRoutes(app: Express): void {
  /** Every handler: session → approved seller → validate → authorize → write. */
  const withSeller = async (
    req: Request,
    res: Response,
    run: (client: PoolClient, seller: SellerContext) => Promise<{ status: number; body: unknown }>,
  ): Promise<void> => {
    try {
      const userId = req.user!.userId;
      const outcome = await withTransaction(async (client) => {
        const seller = await resolveApprovedSeller(client, userId);
        return run(client, seller);
      });
      res.status(outcome.status).json(outcome.body);
    } catch (error) {
      try {
        fail(res, error);
      } catch (unexpected) {
        console.error("[velrepeat-packages] unexpected failure:", {
          message: unexpected instanceof Error ? unexpected.message : String(unexpected),
        });
        res.status(500).json({
          success: false,
          error: { code: "INTERNAL_ERROR", message: "Could not manage the package" },
        });
      }
    }
  };

  app.get("/api/seller/velrepeat/packages", requireAuth, async (req: Request, res: Response) => {
    await withSeller(req, res, async (client, seller) => {
      const result = await client.query(
        `SELECT p.id, p.name, p.description, p.is_active, p.created_at, p.updated_at,
                COALESCE(i.item_count, 0) AS item_count
           FROM velrepeat_packages p
           LEFT JOIN (
             SELECT package_id, COUNT(*)::int AS item_count
               FROM velrepeat_package_items GROUP BY package_id
           ) i ON i.package_id = p.id
          WHERE p.seller_id = $1
          ORDER BY p.created_at DESC`,
        [seller.sellerId],
      );
      return { status: 200, body: { success: true, data: { packages: result.rows } } };
    });
  });

  app.post("/api/seller/velrepeat/packages", requireAuth, async (req: Request, res: Response) => {
    await withSeller(req, res, async (client, seller) => {
      const name = typeof req.body?.name === "string" ? req.body.name.trim() : "";
      if (name === "") {
        throw new PackageAuthorizationError(400, "VALIDATION_ERROR", "Package name is required");
      }
      const description =
        typeof req.body?.description === "string" ? req.body.description.trim() : null;

      const items = parsePackageItems(req.body?.items);
      const authorized = await authorizePackageComposition(client, seller.sellerId, items);
      const created = await createPackage(client, seller.sellerId, {
        name,
        description,
        items: authorized,
      });
      return {
        status: 201,
        body: { success: true, data: { package: created, items: authorized } },
      };
    });
  });

  app.patch(
    "/api/seller/velrepeat/packages/:packageId",
    requireAuth,
    async (req: Request, res: Response) => {
      await withSeller(req, res, async (client, seller) => {
        const packageId = String(req.params.packageId ?? "");
        if (!isUuid(packageId)) {
          throw new PackageAuthorizationError(400, "VALIDATION_ERROR", "Invalid package id");
        }

        const name = typeof req.body?.name === "string" ? req.body.name.trim() : undefined;
        if (name !== undefined && name === "") {
          throw new PackageAuthorizationError(400, "VALIDATION_ERROR", "Package name cannot be empty");
        }
        const description =
          typeof req.body?.description === "string" ? req.body.description.trim() : undefined;

        // Confirm ownership BEFORE any write, then validate whatever the caller
        // actually sent. An omitted `items` leaves the composition untouched.
        await getOwnedPackage(client, seller.sellerId, packageId);

        let authorized: ValidatedPackageItem[] | undefined;
        if (req.body?.items !== undefined) {
          authorized = await authorizePackageComposition(
            client,
            seller.sellerId,
            parsePackageItems(req.body.items),
          );
        }

        const updated = await updatePackageComposition(client, seller.sellerId, packageId, {
          name,
          description,
          ...(authorized ? { items: authorized } : {}),
        });
        return { status: 200, body: { success: true, data: { package: updated } } };
      });
    },
  );

  app.delete(
    "/api/seller/velrepeat/packages/:packageId",
    requireAuth,
    async (req: Request, res: Response) => {
      await withSeller(req, res, async (client, seller) => {
        const packageId = String(req.params.packageId ?? "");
        if (!isUuid(packageId)) {
          throw new PackageAuthorizationError(400, "VALIDATION_ERROR", "Invalid package id");
        }
        const deleted = await client.query(
          `DELETE FROM velrepeat_packages WHERE id = $1 AND seller_id = $2 RETURNING id`,
          [packageId, seller.sellerId],
        );
        if (deleted.rows.length === 0) {
          throw new PackageAuthorizationError(
            404,
            "PACKAGE_NOT_OWNED",
            "Package not found for this seller",
          );
        }
        return { status: 200, body: { success: true, data: { deleted: packageId } } };
      });
    },
  );
}
