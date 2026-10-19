/**
 * Velnox — seller authoring for SELLING UNITS (sets / packs).
 *
 * Endpoints:
 *   GET    /api/seller/products/:productId/selling-units                 — list (active + inactive)
 *   POST   /api/seller/products/:productId/selling-units                 — create a set/pack
 *   PATCH  /api/seller/products/:productId/selling-units/:unitId         — update (name/pieces/price/variant/status/sort)
 *   DELETE /api/seller/products/:productId/selling-units/:unitId         — RETIRE (status → inactive)
 *
 * WHY A SEPARATE MODULE
 *   `routes/products.ts` is far past the size this environment can edit and holds
 *   the product lifecycle. Selling units are their own resource with their own
 *   validation, so they live beside it — the same reason
 *   `routes/product-options.ts` exists for option groups and variants.
 *
 * WHAT A SELLING UNIT IS NOT
 *   It is not a minimum-order engine, a tier table or a per-pack stock: a set/pack
 *   is simply a way to sell the same product — its own name, its own `pieces`, its
 *   own price — and inventory is always counted in base pieces (`pieces * quantity`
 *   reserve/settle through the ONE existing authority in lib/inventory.ts).
 *
 * WHOLESALE (`isWholesale`)
 *   A unit may be marked wholesale: it and its price are then sent to, and buyable
 *   by, an APPROVED store account only (`lib/store-accounts.ts` is the one gate,
 *   `lib/selling-units.ts` the one place it is applied). It is still ONE price per
 *   unit rather than a second price table, and the flag defaults to false — so
 *   every set/pack authored before this feature keeps behaving exactly as it did.
 *   A seller may therefore offer the SAME size to both audiences (a retail
 *   "แพ็ค 12" and a wholesale "แพ็ค 12" at a different price); that is what the
 *   live-definition index below is keyed on `is_wholesale` for.
 *
 * VALIDATION (every rule is enforced HERE, on the server)
 *   * pieces : whole number > 0 (the database CHECK restates it)
 *   * price  : finite number >= 0 (the database CHECK restates it)
 *   * name   : non-empty, <= 60 characters
 *   * variant: must belong to THIS product
 *   * isWholesale: a real boolean, never a truthy string
 *   * one LIVE definition per (product, variant, pieces, audience) — a second
 *     active row for the same size AND the same audience is refused, so a shopper
 *     is never offered two different prices for the same thing
 *   * ownership: the product must belong to the calling, APPROVED seller
 *
 * RETIRE, NEVER DELETE
 *   A definition with order history must stay referenceable: `DELETE` sets
 *   `status = 'inactive'`. The order line keeps its own snapshot regardless, so
 *   retiring a set can never change what a past order consumed or cost.
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";
import { formatSellingUnit } from "../lib/selling-units.js";
import { WHOLESALE_ENABLED } from "../lib/features.js";

function param(req: Request, key: string): string {
  const val = req.params[key] as string | string[] | undefined;
  if (Array.isArray(val)) return val[0] ?? "";
  return val ?? "";
}

/** The APPROVED seller behind this session, or null (→ the existing 403 path). */
async function getSellerForUser(userId: string): Promise<{ id: string } | null> {
  const r = await query("SELECT id FROM sellers WHERE user_id = $1 AND status = 'approved'", [userId]);
  return r.rows[0] ?? null;
}

/** The product must belong to the calling seller — never trusted from the body. */
async function verifyProductOwnership(productId: string, sellerId: string): Promise<boolean> {
  const r = await query(
    `SELECT p.id FROM products p
      JOIN shops sh ON p.shop_id = sh.id
      WHERE p.id = $1 AND sh.seller_id = $2`,
    [productId, sellerId],
  );
  return r.rows.length > 0;
}

interface UnitInput {
  name?: unknown;
  pieces?: unknown;
  price?: unknown;
  variantId?: unknown;
  status?: unknown;
  sortOrder?: unknown;
  isWholesale?: unknown;
}

type ValidationResult =
  | {
      ok: true;
      name: string;
      pieces: number;
      price: number;
      status: "active" | "inactive";
      sortOrder: number | undefined;
      isWholesale: boolean | undefined;
    }
  | { ok: false; message: string };

/**
 * Validate the authored fields. `partial` skips the fields the caller did not
 * send, so the same rules serve POST (all required) and PATCH (only what changed).
 */
function validateUnit(body: UnitInput, partial: boolean): ValidationResult {
  // name
  let name: string | undefined;
  if (body.name !== undefined) {
    if (typeof body.name !== "string" || !body.name.trim()) {
      return { ok: false, message: "name is required" };
    }
    name = body.name.trim();
    if (name.length > 60) return { ok: false, message: "name must be 60 characters or fewer" };
  }
  if (!name && !partial) return { ok: false, message: "name is required" };

  // pieces — a positive whole number of base units (never 0, never negative)
  let pieces: number | undefined;
  if (body.pieces !== undefined) {
    const n = Number(body.pieces);
    if (!Number.isInteger(n) || n <= 0) {
      return { ok: false, message: "pieces must be a whole number greater than 0" };
    }
    if (n > 100000) return { ok: false, message: "pieces is unreasonably large" };
    pieces = n;
  }
  if (pieces === undefined && !partial) return { ok: false, message: "pieces is required" };

  // price — never negative; the platform does not silently correct money
  let price: number | undefined;
  if (body.price !== undefined) {
    const n = Number(body.price);
    if (!Number.isFinite(n) || n < 0) {
      return { ok: false, message: "price must be a number greater than or equal to 0" };
    }
    price = Math.round(n * 100) / 100;
  }
  if (price === undefined && !partial) return { ok: false, message: "price is required" };

  // status — active / inactive only
  let status: "active" | "inactive" | undefined;
  if (body.status !== undefined) {
    if (body.status !== "active" && body.status !== "inactive") {
      return { ok: false, message: "status must be 'active' or 'inactive'" };
    }
    status = body.status;
  }

  let sortOrder: number | undefined;
  if (body.sortOrder !== undefined) {
    const n = Number(body.sortOrder);
    if (!Number.isInteger(n) || n < 0) return { ok: false, message: "sortOrder must be a whole number >= 0" };
    sortOrder = n;
  }

  // isWholesale — a real boolean. Deliberately NOT `Boolean(value)`: the string
  // "false" is truthy, and quietly publishing a wholesale-only pack because a
  // form sent it as text would hide a product from every retail shopper.
  let isWholesale: boolean | undefined;
  if (body.isWholesale !== undefined) {
    if (typeof body.isWholesale !== "boolean") {
      return { ok: false, message: "isWholesale must be true or false" };
    }
    // PARKED 2026-10-19: wholesale is out of the MVP, so a crafted body cannot
    // create a new hidden tier. Refusing (rather than silently writing `false`)
    // keeps the seller's intent explicit; `false` is still accepted so an
    // existing mark can be cleared once the seller UI stops offering it.
    if (body.isWholesale === true && !WHOLESALE_ENABLED) {
      return { ok: false, message: "Wholesale selling units are not available." };
    }
    isWholesale = body.isWholesale;
  }

  return {
    ok: true,
    name: name ?? "",
    pieces: pieces ?? 1,
    price: price ?? 0,
    status: status ?? "active",
    sortOrder,
    isWholesale,
  };
}

export function setupProductSellingUnitRoutes(app: Express): void {
  // ── GET /api/seller/products/:productId/selling-units ────────────────────
  app.get("/api/seller/products/:productId/selling-units", requireAuth, async (req: Request, res: Response) => {
    try {
      const seller = await getSellerForUser(req.user!.userId);
      if (!seller) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } });
        return;
      }
      const productId = param(req, "productId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      const result = await query(
        `SELECT id, product_id, variant_id, name, pieces, price, status, sort_order, is_wholesale
           FROM product_selling_units
          WHERE product_id = $1
          ORDER BY sort_order ASC, pieces ASC, created_at ASC`,
        [productId],
      );
      res.json({ success: true, data: result.rows.map(formatSellingUnit) });
    } catch (err) {
      console.error("[selling-units] list error:", err);
      res.status(500).json({ success: false, error: { code: "DB_ERROR", message: "Failed to load selling units" } });
    }
  });

  // ── POST /api/seller/products/:productId/selling-units ───────────────────
  app.post("/api/seller/products/:productId/selling-units", requireAuth, async (req: Request, res: Response) => {
    try {
      const seller = await getSellerForUser(req.user!.userId);
      if (!seller) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } });
        return;
      }
      const productId = param(req, "productId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      const parsed = validateUnit(req.body ?? {}, false);
      if (!parsed.ok) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.message } });
        return;
      }

      // The variant must belong to this product — a set of another product's
      // variant would price and reserve the wrong stock.
      const variantId = req.body?.variantId ?? null;
      if (variantId !== null && typeof variantId !== "string") {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "variantId must be a string" } });
        return;
      }
      if (variantId) {
        const v = await query("SELECT id FROM product_variants WHERE id = $1 AND product_id = $2", [variantId, productId]);
        if (v.rows.length === 0) {
          res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "Variant does not belong to this product" } });
          return;
        }
      }

      const product = await query("SELECT id FROM products WHERE id = $1", [productId]);
      if (product.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Product not found" } });
        return;
      }

      const maxSort = await query(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort
           FROM product_selling_units WHERE product_id = $1`,
        [productId],
      );
      const sortOrder = parsed.sortOrder ?? maxSort.rows[0]?.next_sort ?? 0;

      try {
        const result = await query(
          `INSERT INTO product_selling_units (product_id, variant_id, name, pieces, price, status, sort_order, is_wholesale)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id, product_id, variant_id, name, pieces, price, status, sort_order, is_wholesale`,
          [productId, variantId, parsed.name, parsed.pieces, parsed.price, parsed.status, sortOrder, parsed.isWholesale ?? false],
        );
        res.json({ success: true, data: formatSellingUnit(result.rows[0]) });
      } catch (insertErr: any) {
        // The partial unique index is the FINAL authority on "one live
        // definition per size": a race between two create requests cannot
        // produce two active rows for the same (product, variant, pieces).
        if (insertErr?.code === "23505") {
          res.status(409).json({
            success: false,
            error: { code: "DUPLICATE_SELLING_UNIT", message: "An active selling unit with this many pieces already exists for this audience" },
          });
          return;
        }
        throw insertErr;
      }
    } catch (err) {
      console.error("[selling-units] create error:", err);
      res.status(500).json({ success: false, error: { code: "CREATE_FAILED", message: "Failed to create selling unit" } });
    }
  });

  // ── PATCH /api/seller/products/:productId/selling-units/:unitId ──────────
  app.patch("/api/seller/products/:productId/selling-units/:unitId", requireAuth, async (req: Request, res: Response) => {
    try {
      const seller = await getSellerForUser(req.user!.userId);
      if (!seller) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } });
        return;
      }
      const productId = param(req, "productId");
      const unitId = param(req, "unitId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      const parsed = validateUnit(req.body ?? {}, true);
      if (!parsed.ok) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: parsed.message } });
        return;
      }

      const existing = await query(
        "SELECT id, pieces FROM product_selling_units WHERE id = $1 AND product_id = $2",
        [unitId, productId],
      );
      if (existing.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Selling unit not found" } });
        return;
      }

      const fields: string[] = [];
      const values: any[] = [];
      let i = 1;
      if (req.body?.name !== undefined) { fields.push(`name = $${i++}`); values.push(parsed.name); }
      if (req.body?.pieces !== undefined) { fields.push(`pieces = $${i++}`); values.push(parsed.pieces); }
      if (req.body?.price !== undefined) { fields.push(`price = $${i++}`); values.push(parsed.price); }
      if (req.body?.status !== undefined) { fields.push(`status = $${i++}`); values.push(parsed.status); }
      if (parsed.sortOrder !== undefined) { fields.push(`sort_order = $${i++}`); values.push(parsed.sortOrder); }
      if (parsed.isWholesale !== undefined) { fields.push(`is_wholesale = $${i++}`); values.push(parsed.isWholesale); }

      if (fields.length === 0) {
        res.status(400).json({ success: false, error: { code: "VALIDATION_ERROR", message: "No updatable field was provided" } });
        return;
      }

      values.push(unitId, productId);
      try {
        const result = await query(
          `UPDATE product_selling_units
              SET ${fields.join(", ")}, updated_at = NOW()
            WHERE id = $${i++} AND product_id = $${i}
          RETURNING id, product_id, variant_id, name, pieces, price, status, sort_order, is_wholesale`,
          values,
        );
        if (result.rows.length === 0) {
          res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Selling unit not found" } });
          return;
        }
        res.json({ success: true, data: formatSellingUnit(result.rows[0]) });
      } catch (updateErr: any) {
        if (updateErr?.code === "23505") {
          res.status(409).json({
            success: false,
            error: { code: "DUPLICATE_SELLING_UNIT", message: "An active selling unit with this many pieces already exists for this audience" },
          });
          return;
        }
        throw updateErr;
      }
    } catch (err) {
      console.error("[selling-units] update error:", err);
      res.status(500).json({ success: false, error: { code: "UPDATE_FAILED", message: "Failed to update selling unit" } });
    }
  });

  // ── DELETE /api/seller/products/:productId/selling-units/:unitId ─────────
  // RETIRE: status → 'inactive'. Never a row delete: order lines reference the
  // definition, and retiring must not rewrite what a past order was.
  app.delete("/api/seller/products/:productId/selling-units/:unitId", requireAuth, async (req: Request, res: Response) => {
    try {
      const seller = await getSellerForUser(req.user!.userId);
      if (!seller) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not a seller" } });
        return;
      }
      const productId = param(req, "productId");
      const unitId = param(req, "unitId");
      if (!(await verifyProductOwnership(productId, seller.id))) {
        res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Product does not belong to this seller" } });
        return;
      }

      const result = await query(
        `UPDATE product_selling_units
            SET status = 'inactive', updated_at = NOW()
          WHERE id = $1 AND product_id = $2
        RETURNING id, product_id, variant_id, name, pieces, price, status, sort_order, is_wholesale`,
        [unitId, productId],
      );
      if (result.rows.length === 0) {
        res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "Selling unit not found" } });
        return;
      }
      res.json({ success: true, data: formatSellingUnit(result.rows[0]) });
    } catch (err) {
      console.error("[selling-units] retire error:", err);
      res.status(500).json({ success: false, error: { code: "DELETE_FAILED", message: "Failed to retire selling unit" } });
    }
  });
}
