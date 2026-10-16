/**
 * Velnox — selling units (sell a product by the piece, the set or the pack).
 *
 * THE CONTRACT, in one place
 * --------------------------
 *   quantity              number of SELLING UNITS — pieces, or sets/packs
 *   price                 price PER SELLING UNIT (a pack price is the pack price)
 *   selling_unit_pieces   BASE pieces per selling unit; 1 for a plain line
 *   base units            quantity * selling_unit_pieces
 *
 * BASE UNITS are the ONLY quantity `inventory`, `product_variants.stock` and
 * `products.sold_count` ever see. There is exactly one stock authority in this
 * codebase and this module does not add a second one: it converts, it validates,
 * and it hands the number to the existing reserve/commit/release paths.
 *
 * WHY `pieces` IS READ FROM THE LINE, NOT LOOKED UP
 * -------------------------------------------------
 * A cart or order line carries its OWN `selling_unit_pieces` snapshot. The
 * definition can be re-priced or retired later, and the line must still mean what
 * it meant when it was written: a line that sold 12 pieces consumes 12 for ever,
 * even if the seller later changes that pack to 24. `selling_unit_id` is only a
 * reference for display and re-validation.
 */
import type pg from "pg";

/** A `query`-shaped executor: the pool helper and a transaction client both fit. */
export type SqlExecutor = (
  sql: string,
  params?: unknown[],
) => Promise<{ rows: any[] }>;

/**
 * A transaction client, as an executor. `withTransaction` hands out a
 * `pg.PoolClient`; this keeps the resolution code identical inside and outside a
 * transaction instead of growing a second copy per call site.
 */
export function clientExecutor(client: pg.PoolClient): SqlExecutor {
  return (sql: string, params?: unknown[]) => client.query(sql, params as any[]);
}

/**
 * THE base-unit conversion. Every stock path calls this (or the matching SQL
 * fragment below) instead of doing its own arithmetic, so there is one
 * definition of "how many pieces is this line".
 *
 * Defensive by construction: a negative or non-finite quantity converts to 0 and
 * a missing/invalid `pieces` to 1, so a conversion bug can never INFLATE a stock
 * movement. Malformed input is refused earlier, by the validators.
 */
export function baseUnits(quantity: unknown, pieces: unknown): number {
  const q = Math.floor(Number(quantity));
  const p = Math.floor(Number(pieces));
  if (!Number.isFinite(q) || q <= 0) return 0;
  return q * (Number.isFinite(p) && p > 0 ? p : 1);
}

/**
 * The same conversion as SQL, for statements that read `order_items` directly.
 * Mirrors `baseUnits()`; the two must stay one definition of the rule.
 */
export function orderItemBaseQuantitySql(alias = "order_items"): string {
  return `(${alias}.quantity * ${alias}.selling_unit_pieces)`;
}

export interface ResolvedSellingUnit {
  id: string;
  name: string;
  /** Base pieces one selling unit is worth. Always >= 1. */
  pieces: number;
  /** Price PER SELLING UNIT. */
  price: number;
}

export type SellingUnitResolution =
  | { ok: true; unit: ResolvedSellingUnit | null }
  | { ok: false; code: string; message: string };

/**
 * Resolve the selling unit a cart/checkout line refers to, or refuse it.
 *
 * Returns `{ ok: true, unit: null }` for a plain line (no selling unit): buying
 * one piece is the product's own price, and it needs no definition row.
 *
 * Every refusal is a 4xx the caller can surface verbatim: a selling unit that
 * belongs to another product, another variant, or that has been retired is a
 * CRAFTED REQUEST (or a stale page), never something to silently re-price.
 */
export async function resolveSellingUnit(
  exec: SqlExecutor,
  sellingUnitId: unknown,
  productId: string,
  variantId: string | null,
): Promise<SellingUnitResolution> {
  if (sellingUnitId === undefined || sellingUnitId === null || sellingUnitId === "") {
    return { ok: true, unit: null };
  }
  if (typeof sellingUnitId !== "string") {
    return { ok: false, code: "VALIDATION_ERROR", message: "sellingUnitId must be a string" };
  }

  const res = await exec(
    `SELECT id, product_id, variant_id, name, pieces, price, status
       FROM product_selling_units WHERE id = $1`,
    [sellingUnitId],
  );
  const row = res.rows[0];
  if (!row) {
    return { ok: false, code: "SELLING_UNIT_NOT_FOUND", message: "Selling unit was not found." };
  }
  if (row.status !== "active") {
    return { ok: false, code: "SELLING_UNIT_UNAVAILABLE", message: "This selling unit is no longer available." };
  }
  if (row.product_id !== productId) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Selling unit does not belong to this product." };
  }
  if ((row.variant_id ?? null) !== (variantId ?? null)) {
    return { ok: false, code: "VALIDATION_ERROR", message: "Selling unit does not belong to the selected variant." };
  }

  const pieces = Math.floor(Number(row.pieces));
  const price = Number(row.price);
  if (!Number.isFinite(pieces) || pieces <= 0) {
    return { ok: false, code: "SELLING_UNIT_UNAVAILABLE", message: "This selling unit is misconfigured." };
  }
  if (!Number.isFinite(price) || price < 0) {
    return { ok: false, code: "SELLING_UNIT_UNAVAILABLE", message: "This selling unit is misconfigured." };
  }

  return {
    ok: true,
    unit: {
      id: row.id,
      name: String(row.name ?? ""),
      pieces,
      price,
    },
  };
}

/** The public shape of a selling unit in a product payload / seller response. */
export function formatSellingUnit(row: any) {
  const pieces = Math.floor(Number(row.pieces)) || 1;
  const price = Number(row.price) || 0;
  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id ?? null,
    name: row.name,
    pieces,
    price,
    /** Derived for DISPLAY only — never stored (a stored unit price drifts on rounding). */
    pricePerPiece: Math.round((price / pieces) * 100) / 100,
    status: row.status,
    sortOrder: row.sort_order ?? 0,
  };
}

/** Every ACTIVE selling unit of a product, grouped as the product payload needs it. */
export async function loadSellingUnits(
  exec: SqlExecutor,
  productIds: string[],
): Promise<Map<string, ReturnType<typeof formatSellingUnit>[]>> {
  const byProduct = new Map<string, ReturnType<typeof formatSellingUnit>[]>();
  if (productIds.length === 0) return byProduct;
  let rows: any[];
  try {
    rows = (
      await exec(
        `SELECT id, product_id, variant_id, name, pieces, price, status, sort_order
           FROM product_selling_units
          WHERE product_id = ANY($1) AND status = 'active'
          ORDER BY sort_order ASC, pieces ASC, created_at ASC`,
        [productIds],
      )
    ).rows;
  } catch (err: any) {
    // 42P01 = the table does not exist on a database that has not run migration
    // 058 yet. Marketing a product without its sets/packs is the correct
    // degradation: the plain single-unit line is still sellable.
    if (err?.code !== "42P01") throw err;
    console.warn("[selling-units] product_selling_units table not found — serving single-unit lines only");
    return byProduct;
  }
  for (const row of rows) {
    const list = byProduct.get(row.product_id) ?? [];
    list.push(formatSellingUnit(row));
    byProduct.set(row.product_id, list);
  }
  return byProduct;
}
