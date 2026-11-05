/**
 * Checkout line resolution — the ONE place a purchasable line is read.
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS FILE EXISTS
 *
 * `POST /api/customer/checkout` used to carry the whole "which rows am I
 * charging?" logic inline: three SELECT variants (buy-now / selected cart items
 * / whole cart), a publication check, a variant-aware stock check, and a price
 * revalidation that replaces a stale `cart_items.price` snapshot with the
 * CURRENT server price.
 *
 * The shipping quote endpoint must price EXACTLY the same rows. If the two
 * paths could disagree, the customer would be quoted one subtotal and charged
 * another — the defect class this work exists to close — so the query text and
 * the validation rules live here and are imported by both callers.
 *
 * This module is a MOVE, not a redesign: every status code, error code and
 * message is the one the inline code returned, because existing tests assert
 * them. The only change is the shape — a returned `{ ok:false, error }` instead
 * of writing an HTTP response — so a caller that is not a route can reuse it.
 *
 * `validateAndPriceLines` MUTATES `row.price` in place, exactly as the inline
 * code did, and reports whether any price changed so checkout can tell the
 * customer. Nothing here writes to the database.
 */
import { query } from "../db/index.js";
import { validateCheckoutQuantity } from "./inventory.js";
import { priceLine, type WholesaleTier } from "./wholesale.js";

/** A 4xx the caller must return verbatim; never a priced order. */
export interface CheckoutLineFailure {
  status: number;
  code: string;
  message: string;
}

export interface LoadedCheckoutLines {
  /** null only for buy-now, which does not touch the cart. */
  cartId: string | null;
  items: any[];
  priceChanged: boolean;
}

export type LoadError = { ok: false; error: CheckoutLineFailure };

/**
 * Buy Now loads its ONE line from the product tables — never from a cart row —
 * so the cart is untouched and the quantity is exactly the one the customer
 * chose (it used to be the cart line's quantity, which made a "Buy Now 1"
 * charge an existing cart quantity of 3).
 */
const BUY_NOW_LINE_SQL = `
  SELECT p.id AS product_id, p.name AS product_name, p.shop_id,
         p.status AS product_status, p.price AS product_price, p.unit,
         i.quantity AS stock_qty, i.reserved,
         sh.name AS shop_name,
         (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url,
         pv.id AS variant_id, pv.price AS variant_price, pv.stock AS variant_stock,
         pv.status AS variant_status
  FROM products p
  LEFT JOIN inventory i ON i.product_id = p.id
  LEFT JOIN shops sh ON p.shop_id = sh.id
  LEFT JOIN product_variants pv ON pv.product_id = p.id AND pv.id = $2
  WHERE p.id = $1`;

const CART_LINE_SQL = `
  SELECT ci.*, p.name AS product_name, p.shop_id, p.status AS product_status,
         p.price AS product_price, p.unit,
         i.quantity AS stock_qty, i.reserved,
         sh.name AS shop_name,
         (SELECT url FROM product_images WHERE product_id = p.id ORDER BY sort_order ASC LIMIT 1) AS product_image_url
  FROM cart_items ci
  JOIN products p ON ci.product_id = p.id
  LEFT JOIN inventory i ON i.product_id = p.id
  LEFT JOIN shops sh ON p.shop_id = sh.id
  WHERE ci.cart_id = $1`;

/**
 * Resolve the rows a checkout (or a shipping quote) is about.
 *
 * A client can only NAME what it wants to buy (cart item ids, or a
 * product/variant/quantity); every price, shop and stock figure comes from the
 * database.
 */
export async function loadCheckoutLines(
  userId: string,
  cartItemIds: string[] | undefined,
  buyNow: { productId: string; variantId: string | null; quantity: number } | null,
): Promise<{ ok: true; value: LoadedCheckoutLines } | LoadError> {
  // Buy Now does not need a cart: a customer can buy a product directly without
  // ever having added anything to it.
  const cartResult = await query("SELECT id FROM carts WHERE user_id = $1", [userId]);
  const cartId: string | null = cartResult.rows[0]?.id ?? null;
  if (!cartId && !buyNow) {
    return { ok: false, error: { status: 400, code: "EMPTY_CART", message: "Cart is empty" } };
  }

  let items: any[];
  if (buyNow) {
    const productRes = await query(BUY_NOW_LINE_SQL, [buyNow.productId, buyNow.variantId]);
    const row = productRes.rows[0];
    if (!row) {
      return {
        ok: false,
        error: { status: 400, code: "PRODUCT_UNAVAILABLE", message: "This product is no longer available" },
      };
    }
    if (buyNow.variantId && !row.variant_id) {
      return {
        ok: false,
        error: { status: 400, code: "VARIANT_NOT_FOUND", message: "The selected variant was not found" },
      };
    }
    items = [
      {
        ...row,
        // A synthetic line: it has no cart row, so nothing is deleted from the
        // cart at the end of the transaction.
        id: null,
        cart_id: null,
        quantity: buyNow.quantity,
        price: row.variant_id ? (row.variant_price ?? row.product_price) : row.product_price,
      },
    ];
  } else if (Array.isArray(cartItemIds) && cartItemIds.length > 0) {
    items = (await query(`${CART_LINE_SQL} AND ci.id = ANY($2)`, [cartId, cartItemIds])).rows;
  } else {
    items = (await query(CART_LINE_SQL, [cartId])).rows;
  }

  if (items.length === 0) {
    return { ok: false, error: { status: 400, code: "EMPTY_CART", message: "Cart is empty" } };
  }

  // ── Wholesale context (resolved SERVER-SIDE, per request) ──────────────
  // The buyer's status is read from the database here, never taken from the
  // client and never cached in a token: a suspended business falls back to
  // retail on its very next pricing pass.
  const businessRes = await query(
    `SELECT status FROM business_verifications WHERE user_id = $1`,
    [userId],
  );
  const buyerIsVerifiedBusiness = businessRes.rows[0]?.status === "verified";

  for (const item of items) {
    item.buyerIsVerifiedBusiness = buyerIsVerifiedBusiness;
    item.wholesaleTiers = await loadWholesaleTiers(item.product_id, item.variant_id ?? null);
  }

  const validation = await validateAndPriceLines(items);
  if (!validation.ok) return validation;

  return { ok: true, value: { cartId, items, priceChanged: validation.priceChanged } };
}

/**
 * The seller's tiers for exactly this (product, variant) pair.
 *
 * `variant_id` NULL means the PRODUCT's tiers — the same pair the seller saved
 * from the wholesale editor — so a variant without tiers is never silently
 * priced with another variant's pack.
 */
async function loadWholesaleTiers(
  productId: string,
  variantId: string | null,
): Promise<WholesaleTier[]> {
  const result = await query(
    `SELECT pack_size, min_packs, price_per_pack
       FROM wholesale_tiers
      WHERE product_id = $1
        AND ((variant_id = $2) OR (variant_id IS NULL AND $2 IS NULL))
      ORDER BY min_packs ASC`,
    [productId, variantId],
  );
  return result.rows.map((row: any) => ({
    packSize: Number(row.pack_size),
    minPacks: Number(row.min_packs),
    pricePerPack: String(row.price_per_pack),
  }));
}

/**
 * Price one line through the wholesale rule and record the outcome ON the row.
 *
 * `retailPrice` is the CURRENT server price (variant price for a variant line,
 * product price otherwise). `item.price` keeps the 2-decimal per-unit value for
 * display and legacy readers; `item.lineTotalMoney` is the EXACT amount that
 * becomes `order_items.subtotal`, and the pack identity is carried so the order
 * can snapshot it.
 */
function applyWholesalePricing(item: any, retailPrice: string): void {
  const tiers: WholesaleTier[] = item.wholesaleTiers ?? [];
  const verified = item.buyerIsVerifiedBusiness === true;
  const priced = priceLine(Number(item.quantity), retailPrice, verified ? tiers : [], verified);
  item.price = priced.unitPriceMoney;
  item.lineTotalMoney = priced.lineTotalMoney;
  item.wholesale = priced.wholesale;
  item.wholesalePackSize = priced.packSize;
  item.wholesalePacks = priced.packs;
  item.wholesaleTierPrice = priced.tierPricePerPack;
  item.wholesaleReason = priced.reason;
}

/**
 * Validate all items — variant-aware stock check. Also re-read the CURRENT
 * server price for every item: the final price must never come from a stale
 * cart snapshot. If a price changed, we charge the current price and flag it so
 * the client can tell the customer (never silently charge either side).
 */
export async function validateAndPriceLines(
  items: any[],
): Promise<{ ok: true; priceChanged: boolean } | LoadError> {
  let priceChanged = false;
  for (const item of items) {
    // Server-side quantity validation — never trust the frontend.
    const qtyError = validateCheckoutQuantity(item.quantity);
    if (qtyError) {
      return {
        ok: false,
        error: {
          status: 400,
          code: "VALIDATION_ERROR",
          message: `Invalid quantity for "${item.product_name}": ${qtyError}`,
        },
      };
    }
    if (item.product_status !== "published") {
      return {
        ok: false,
        error: {
          status: 400,
          code: "PRODUCT_UNAVAILABLE",
          message: `Product "${item.product_name}" is no longer available`,
        },
      };
    }
    if (item.variant_id) {
      // Variant stock is source of truth — must succeed or stop checkout
      let varStock;
      try {
        varStock = await query(
          `SELECT stock, status, price FROM product_variants WHERE id = $1`,
          [item.variant_id],
        );
      } catch {
        return {
          ok: false,
          error: {
            status: 503,
            code: "STOCK_UNAVAILABLE",
            message: `Stock information is unavailable for "${item.product_name}". Please try again later.`,
          },
        };
      }
      if (varStock.rows.length === 0) {
        return {
          ok: false,
          error: {
            status: 400,
            code: "VARIANT_NOT_FOUND",
            message: `Variant for "${item.product_name}" was not found.`,
          },
        };
      }
      const v = varStock.rows[0];
      const variantStock = Number(v.stock);
      if (v.stock == null || !Number.isFinite(variantStock)) {
        return {
          ok: false,
          error: {
            status: 503,
            code: "STOCK_UNAVAILABLE",
            message: `Stock data is unavailable for "${item.product_name}". Please try again later.`,
          },
        };
      }
      if (v.status !== "active" || item.quantity > variantStock) {
        return {
          ok: false,
          error: {
            status: 400,
            code: "INSUFFICIENT_STOCK",
            message: `Insufficient stock for "${item.product_name}" (variant: ${variantStock} available)`,
          },
        };
      }
      // Price revalidation — charge the CURRENT variant price, never a stale snapshot.
      const variantPrice = Number(v.price);
      if (Number.isFinite(variantPrice) && variantPrice >= 0 && Math.abs(variantPrice - parseFloat(item.price)) > 0.005) {
        item.price = variantPrice;
        priceChanged = true;
      }
      applyWholesalePricing(item, String(v.price));
      if (item.wholesale) priceChanged = true;
    } else {
      const available = (item.stock_qty ?? 0) - (item.reserved ?? 0);
      if (item.quantity > available) {
        return {
          ok: false,
          error: {
            status: 400,
            code: "INSUFFICIENT_STOCK",
            message: `Insufficient stock for "${item.product_name}"`,
          },
        };
      }
      // Price revalidation for non-variant products.
      const productPrice = Number(item.product_price);
      if (Number.isFinite(productPrice) && productPrice >= 0 && Math.abs(productPrice - parseFloat(item.price)) > 0.005) {
        item.price = productPrice;
        priceChanged = true;
      }
      applyWholesalePricing(item, String(item.product_price));
      if (item.wholesale) priceChanged = true;
    }
  }

  return { ok: true, priceChanged };
}
