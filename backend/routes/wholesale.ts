/**
 * WHOLESALE TIER MANAGEMENT — seller-facing configuration.
 * ═══════════════════════════════════════════════════════════════════════════
 *   GET    /api/seller/products/:productId/wholesale        — read tiers
 *   PUT    /api/seller/products/:productId/wholesale        — replace all tiers
 *
 * WHY ONE PUT INSTEAD OF CRUD
 *
 * A tier table is only valid as a WHOLE: every tier of a scope must share one
 * pack size, at most one tier may claim a given `min_packs`, and an empty table
 * is a legitimate state ("retail only"). Per-row writes make it possible to
 * reach a half-valid table (two pack sizes, two rows at min_packs = 5) between
 * two successful requests, and a buyer can be priced during that window. One
 * replace, in one transaction, means a buyer either sees the previous price
 * list or the new one.
 *
 * AUTHORIZATION
 *   The product is resolved THROUGH the authenticated user's seller row
 *   (`shops.seller_id`), so a seller can only ever write their own catalogue.
 *   A variant id is checked against that same product before it is stored.
 *
 * VALIDATION (all server-side, all refused with 400 rather than clamped)
 *   pack_size        integer 2..1000
 *   min_packs        integer 1..100000, unique per scope
 *   price_per_pack   > 0, at most 2 decimals
 *   tier count       <= 20 per scope
 *   every tier of a scope carries the SAME pack_size
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query, getClient } from "../db/index.js";

const MAX_TIERS = 20;
const MAX_PACK_SIZE = 1000;
const MAX_MIN_PACKS = 100_000;
const MONEY_RE = /^\d{1,9}(\.\d{1,2})?$/;

export interface ParsedTier {
  variantId: string | null;
  packSize: number;
  minPacks: number;
  pricePerPack: string;
}

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ success: false, error: { code, message } });
}

/** The seller's own shop, or null when the caller is not an approved seller. */
async function shopForUser(userId: string): Promise<{ sellerId: string; shopId: string } | null> {
  const result = await query(
    `SELECT s.id AS seller_id, sh.id AS shop_id
       FROM sellers s
       JOIN shops sh ON sh.seller_id = s.id
      WHERE s.user_id = $1 AND s.status = 'approved'
      LIMIT 1`,
    [userId],
  );
  const row = result.rows[0];
  return row ? { sellerId: String(row.seller_id), shopId: String(row.shop_id) } : null;
}

/**
 * Parse and validate the whole tier list for one product.
 *
 * Returns either the normalised rows or the FIRST validation error — the caller
 * answers 400 and nothing is written.
 */
export function parseWholesaleTiers(
  raw: unknown,
  productVariantIds: ReadonlySet<string>,
): { ok: true; tiers: ParsedTier[] } | { ok: false; message: string } {
  if (raw === undefined || raw === null) return { ok: true, tiers: [] };
  if (!Array.isArray(raw)) return { ok: false, message: "tiers must be an array" };
  if (raw.length > MAX_TIERS) return { ok: false, message: `no more than ${MAX_TIERS} tiers per product` };

  const tiers: ParsedTier[] = [];
  const seen = new Set<string>();

  for (const [index, entry] of raw.entries()) {
    if (entry === null || typeof entry !== "object") {
      return { ok: false, message: `tier ${index + 1} must be an object` };
    }
    const row = entry as Record<string, unknown>;

    const variantRaw = row.variantId ?? null;
    if (variantRaw !== null && typeof variantRaw !== "string") {
      return { ok: false, message: `tier ${index + 1}: variantId must be a string or null` };
    }
    const variantId = variantRaw as string | null;
    if (variantId !== null && !productVariantIds.has(variantId)) {
      return { ok: false, message: `tier ${index + 1}: variant does not belong to this product` };
    }

    const packSize = Number(row.packSize);
    if (!Number.isInteger(packSize) || packSize < 2 || packSize > MAX_PACK_SIZE) {
      return { ok: false, message: `tier ${index + 1}: packSize must be an integer between 2 and ${MAX_PACK_SIZE}` };
    }

    const minPacks = Number(row.minPacks);
    if (!Number.isInteger(minPacks) || minPacks < 1 || minPacks > MAX_MIN_PACKS) {
      return { ok: false, message: `tier ${index + 1}: minPacks must be an integer between 1 and ${MAX_MIN_PACKS}` };
    }

    const priceText = String(row.pricePerPack ?? "").trim();
    if (!MONEY_RE.test(priceText)) {
      return { ok: false, message: `tier ${index + 1}: pricePerPack must be a positive amount with at most 2 decimals` };
    }
    const price = Number(priceText);
    if (!Number.isFinite(price) || price <= 0) {
      return { ok: false, message: `tier ${index + 1}: pricePerPack must be greater than 0` };
    }

    // A scope (product + variant) owns ONE pack size and one row per min_packs.
    const scope = variantId ?? "product";
    const packKey = `${variantId ?? ""}:pack`;
    const minKey = `${scope}:${minPacks}`;
    if (seen.has(minKey)) {
      return { ok: false, message: `tier ${index + 1}: another tier already uses minPacks = ${minPacks} for this scope` };
    }
    seen.add(minKey);
    seen.add(`${packKey}:${packSize}`);
    tiers.push({ variantId, packSize, minPacks, pricePerPack: price.toFixed(2) });
  }

  // Every tier of the same scope must share one pack size.
  const packSizeByScope = new Map<string, number>();
  for (const tier of tiers) {
    const scope = tier.variantId ?? "product";
    const existing = packSizeByScope.get(scope);
    if (existing === undefined) packSizeByScope.set(scope, tier.packSize);
    else if (existing !== tier.packSize) {
      return {
        ok: false,
        message: `every tier of the same product/variant must use one pack size (${existing} vs ${tier.packSize})`,
      };
    }
  }

  return { ok: true, tiers };
}

export function registerWholesaleRoutes(app: Express): void {
  // ── GET /api/seller/products/:productId/wholesale ──────────────────────────
  app.get("/api/seller/products/:productId/wholesale", requireAuth, async (req: Request, res: Response) => {
    try {
      const shop = await shopForUser(req.user!.userId);
      if (!shop) {
        fail(res, 403, "FORBIDDEN", "Seller access required");
        return;
      }
      const productId = String(req.params.productId);

      const product = await query(
        `SELECT id, price FROM products WHERE id = $1 AND shop_id = $2`,
        [productId, shop.shopId],
      );
      if (product.rows.length === 0) {
        // Same answer for "not yours" and "does not exist" — no existence leak.
        fail(res, 404, "NOT_FOUND", "Product not found");
        return;
      }

      const tiers = await query(
        `SELECT id, variant_id, pack_size, min_packs, price_per_pack
           FROM wholesale_tiers WHERE product_id = $1
          ORDER BY variant_id NULLS FIRST, min_packs ASC`,
        [productId],
      );

      res.json({
        success: true,
        data: {
          productId,
          retailPrice: product.rows[0].price,
          tiers: tiers.rows.map((r) => ({
            id: r.id,
            variantId: r.variant_id,
            packSize: Number(r.pack_size),
            minPacks: Number(r.min_packs),
            pricePerPack: String(r.price_per_pack),
          })),
        },
      });
    } catch (err) {
      console.error("[wholesale] read error:", err);
      fail(res, 500, "DB_ERROR", "Failed to read wholesale tiers");
    }
  });

  // ── PUT /api/seller/products/:productId/wholesale ──────────────────────────
  app.put("/api/seller/products/:productId/wholesale", requireAuth, async (req: Request, res: Response) => {
    try {
      const shop = await shopForUser(req.user!.userId);
      if (!shop) {
        fail(res, 403, "FORBIDDEN", "Seller access required");
        return;
      }
      const productId = String(req.params.productId);

      const product = await query(
        `SELECT id, status FROM products WHERE id = $1 AND shop_id = $2`,
        [productId, shop.shopId],
      );
      if (product.rows.length === 0) {
        fail(res, 404, "NOT_FOUND", "Product not found");
        return;
      }
      const status = String(product.rows[0].status);
      if (status === "suspended" || status === "archived") {
        // Terminal products are read-only for sellers (same rule as PATCH).
        fail(res, 403, "FORBIDDEN", "Product is suspended/archived — contact admin");
        return;
      }

      const variantRes = await query(`SELECT id FROM product_variants WHERE product_id = $1`, [productId]);
      const variantIds = new Set<string>(variantRes.rows.map((r: any) => String(r.id)));

      const parsed = parseWholesaleTiers(req.body?.tiers, variantIds);
      if (!parsed.ok) {
        fail(res, 400, "VALIDATION_ERROR", parsed.message);
        return;
      }

      // Replace in ONE transaction: a buyer is priced against the old list or
      // the new one, never a half-written table.
      const client = await getClient();
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM wholesale_tiers WHERE product_id = $1`, [productId]);
        for (const tier of parsed.tiers) {
          await client.query(
            `INSERT INTO wholesale_tiers (product_id, variant_id, pack_size, min_packs, price_per_pack)
             VALUES ($1, $2, $3, $4, $5)`,
            [productId, tier.variantId, tier.packSize, tier.minPacks, tier.pricePerPack],
          );
        }
        await client.query("COMMIT");
      } catch (txErr) {
        await client.query("ROLLBACK").catch(() => {});
        throw txErr;
      } finally {
        client.release();
      }

      res.json({ success: true, data: { productId, tierCount: parsed.tiers.length } });
    } catch (err) {
      console.error("[wholesale] write error:", err);
      fail(res, 500, "DB_ERROR", "Failed to save wholesale tiers");
    }
  });
}
