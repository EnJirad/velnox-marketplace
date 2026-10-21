/**
 * MVP cart + checkout entry point.
 *
 * ONE SELLER PER CART. A cart is created per `(user_id, seller_id)`
 * (`carts_one_per_seller`), and `cart_items` carries the same seller id under
 * two composite foreign keys — one to the cart, one to the product. A line that
 * named a different seller than the cart would be rejected by PostgreSQL, so a
 * mixed-seller cart is not merely discouraged, it is unrepresentable.
 *
 * The price stored on a cart line is a DISPLAY SNAPSHOT ONLY. Checkout re-reads
 * every price, product status and stock level from the database inside its own
 * transaction (`checkout.ts`), which is why editing a cart line can never change
 * what an order costs.
 *
 * SELLING UNITS (SETS / PACKS). A line names the selling unit the buyer chose;
 * `null` is the implicit base unit. The unit's own price is copied into the
 * display snapshot and its `base_quantity` decides how much stock the line will
 * hold (quantity × base_quantity, reserved in `checkout.ts`). A pack never gets
 * its own stock. The unit is part of the line's identity, so "2 × single" and
 * "1 × Pack 6" stay two lines instead of merging into one wrong one.
 */
import type { Express, Request, Response } from "express";
import { query, withTransaction } from "../db/index.js";
import { add, multiplyByQuantity, parseDecimal, toMoneyString, ZERO } from "../lib/money.js";
import { parseCheckoutBody, createOrder } from "./checkout.js";
import {
  badRequest,
  conflict,
  notFound,
  ok,
  pathUuid,
  queryOne,
  requireActiveUser,
  requireInt,
  requireUuid,
  route,
} from "./http.js";
import { loadOrderDetail } from "./orders.js";

const MAX_LINE_QUANTITY = 999;

interface CartLineRow {
  cart_id: string;
  seller_id: string;
  store_name: string;
  seller_slug: string;
  item_id: string | null;
  product_id: string | null;
  variant_id: string | null;
  selling_unit_id: string | null;
  quantity: number | null;
  price: string | null;
  product_name: string | null;
  product_slug: string | null;
  product_status: string | null;
  variant_name: string | null;
  variant_status: string | null;
  selling_unit_label: string | null;
  selling_unit_base_quantity: number | null;
  selling_unit_active: boolean | null;
  image_url: string | null;
  available_base: number | null;
}

export interface CartPayload {
  id: string;
  seller: { id: string; storeName: string; slug: string };
  items: Array<Record<string, unknown>>;
  subtotal: string;
  itemCount: number;
}

function groupCarts(rows: CartLineRow[]): CartPayload[] {
  const carts = new Map<string, CartPayload>();
  for (const row of rows) {
    let cart = carts.get(row.cart_id);
    if (!cart) {
      cart = {
        id: row.cart_id,
        seller: { id: row.seller_id, storeName: row.store_name, slug: row.seller_slug },
        items: [],
        subtotal: "0.00",
        itemCount: 0,
      };
      carts.set(row.cart_id, cart);
    }
    if (!row.item_id) continue;
    const quantity = Number(row.quantity ?? 0);
    const price = row.price ?? "0.00";
    const lineTotal = toMoneyString(multiplyByQuantity(parseDecimal(price), quantity));
    const baseQuantity = Number(row.selling_unit_base_quantity ?? 1);
    const availableBase = Number(row.available_base ?? 0);
    // `available` is expressed in THIS selling unit (packs left, not bags), and
    // a deactivated pack reports 0 so the UI can say it is no longer available.
    const available = row.selling_unit_active === false
      ? 0
      : Math.floor(availableBase / baseQuantity);
    cart.items.push({
      id: row.item_id,
      productId: row.product_id,
      productName: row.product_name,
      productSlug: row.product_slug,
      productStatus: row.product_status,
      variantId: row.variant_id,
      variantName: row.variant_name,
      variantStatus: row.variant_status,
      sellingUnitId: row.selling_unit_id,
      sellingUnitLabel: row.selling_unit_label,
      sellingUnitBaseQuantity: baseQuantity,
      sellingUnitActive: row.selling_unit_active !== false,
      baseQuantityTotal: quantity * baseQuantity,
      imageUrl: row.image_url,
      quantity,
      unitPrice: toMoneyString(parseDecimal(price)),
      lineTotal,
      available,
      availableBase,
    });
    cart.itemCount += quantity;
    cart.subtotal = toMoneyString(add(parseDecimal(cart.subtotal), parseDecimal(lineTotal)));
  }
  return [...carts.values()];
}

async function loadCarts(userId: string): Promise<CartPayload[]> {
  const result = await query(
    `SELECT c.id AS cart_id, c.seller_id, sp.store_name, sp.slug AS seller_slug,
            ci.id AS item_id, ci.product_id, ci.variant_id, ci.selling_unit_id,
            ci.quantity, ci.price,
            p.name AS product_name, p.slug AS product_slug, p.status AS product_status,
            v.name AS variant_name, v.status AS variant_status,
            su.label AS selling_unit_label,
            COALESCE(su.base_quantity, 1) AS selling_unit_base_quantity,
            su.is_active AS selling_unit_active,
            (SELECT pi.url FROM product_images pi
              WHERE pi.product_id = p.id ORDER BY pi.sort_order, pi.created_at LIMIT 1) AS image_url,
            COALESCE(i.quantity - i.reserved, 0)::int AS available_base
       FROM carts c
       JOIN seller_profiles sp ON sp.id = c.seller_id
       LEFT JOIN cart_items ci ON ci.cart_id = c.id
       LEFT JOIN products p ON p.id = ci.product_id
       LEFT JOIN product_variants v ON v.product_id = ci.product_id AND v.id = ci.variant_id
       LEFT JOIN product_selling_units su ON su.id = ci.selling_unit_id
       LEFT JOIN inventory i ON i.product_id = ci.product_id
                            AND i.variant_id IS NOT DISTINCT FROM ci.variant_id
      WHERE c.user_id = $1
      ORDER BY c.created_at, ci.added_at, ci.id`,
    [userId],
  );
  return groupCarts(result.rows as CartLineRow[]);
}

async function cartPayloadFor(userId: string, cartId: string): Promise<CartPayload | null> {
  const carts = await loadCarts(userId);
  return carts.find((cart) => cart.id === cartId) ?? null;
}

export function setupMvpCartRoutes(app: Express): void {
  // ── Read my carts ────────────────────────────────────────────────────────
  app.get(
    "/api/mvp/cart",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const carts = await loadCarts(req.sessionUser!.id);
      ok(res, {
        carts,
        itemCount: carts.reduce((total, cart) => total + cart.itemCount, 0),
      });
    }),
  );

  // ── Add / increment a line ───────────────────────────────────────────────
  app.post(
    "/api/mvp/cart/items",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const userId = req.sessionUser!.id;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const productId = requireUuid(body.productId, "productId");
      const variantId =
        body.variantId === undefined || body.variantId === null
          ? null
          : requireUuid(body.variantId, "variantId");
      // Absent/null = the implicit base unit. The server resolves the label,
      // base quantity and price from the database; the client sends ids only.
      const sellingUnitId =
        body.sellingUnitId === undefined || body.sellingUnitId === null
          ? null
          : requireUuid(body.sellingUnitId, "sellingUnitId");
      const quantity =
        body.quantity === undefined || body.quantity === null
          ? 1
          : requireInt(body.quantity, "quantity", { min: 1, max: MAX_LINE_QUANTITY });

      const result = await withTransaction(async (client) => {
        // Current, authoritative state — the client sends ids and a quantity only.
        const product = await client.query(
          `SELECT p.id, p.seller_id, p.price, p.status, sp.status AS seller_status
             FROM products p
             JOIN seller_profiles sp ON sp.id = p.seller_id
            WHERE p.id = $1`,
          [productId],
        );
        const row = product.rows[0] as
          | { id: string; seller_id: string; price: string; status: string; seller_status: string }
          | undefined;
        if (!row) throw notFound("PRODUCT_NOT_FOUND", "Product not found");
        if (row.status !== "published" || row.seller_status !== "approved") {
          throw conflict("PRODUCT_NOT_AVAILABLE", "This product is not available for sale");
        }

        let unitPrice = row.price;
        if (variantId) {
          const variant = await client.query(
            `SELECT id, price, status FROM product_variants WHERE id = $1 AND product_id = $2`,
            [variantId, productId],
          );
          const v = variant.rows[0] as { id: string; price: string; status: string } | undefined;
          if (!v || v.status !== "active") {
            throw conflict("VARIANT_NOT_AVAILABLE", "This variant is not available");
          }
          unitPrice = v.price;
        }

        // A pack may only be added when it is an ACTIVE unit of the exact
        // product/variant being added. Its price is the seller's price for the
        // pack — never base price × quantity.
        if (sellingUnitId) {
          const unit = await client.query(
            `SELECT id, price, is_active
               FROM product_selling_units
              WHERE id = $1
                AND product_id = $2
                AND variant_id IS NOT DISTINCT FROM $3::uuid`,
            [sellingUnitId, productId, variantId],
          );
          const u = unit.rows[0] as { id: string; price: string; is_active: boolean } | undefined;
          if (!u || !u.is_active) {
            throw conflict("SELLING_UNIT_NOT_AVAILABLE", "This pack is not available for sale");
          }
          unitPrice = u.price;
        }

        const cart = await client.query(
          `INSERT INTO carts (user_id, seller_id)
           VALUES ($1, $2)
           ON CONFLICT (user_id, seller_id) DO UPDATE SET updated_at = NOW()
           RETURNING id`,
          [userId, row.seller_id],
        );
        const cartId = (cart.rows[0] as { id: string }).id;

        // The expression index makes (cart, product, variant-or-null,
        // selling-unit-or-null) unique, so this is one atomic increment rather
        // than read-then-write — while a different selling unit is a DIFFERENT
        // line, never a merge into the wrong one.
        await client.query(
          `INSERT INTO cart_items
             (cart_id, seller_id, product_id, variant_id, selling_unit_id, quantity, price)
           VALUES ($1, $2, $3, $4::uuid, $5::uuid, $6, $7)
           ON CONFLICT (
             cart_id, product_id,
             COALESCE(variant_id, '00000000-0000-0000-0000-000000000000'::uuid),
             COALESCE(selling_unit_id, '00000000-0000-0000-0000-000000000000'::uuid)
           )
           DO UPDATE SET quantity = LEAST(cart_items.quantity + EXCLUDED.quantity, $8),
                         price = EXCLUDED.price,
                         updated_at = NOW()`,
          [
            cartId,
            row.seller_id,
            productId,
            variantId,
            sellingUnitId,
            quantity,
            unitPrice,
            MAX_LINE_QUANTITY,
          ],
        );

        return cartId;
      });

      ok(res, { cart: await cartPayloadFor(userId, result) }, 201);
    }),
  );

  // ── Change a line's quantity ─────────────────────────────────────────────
  app.patch(
    "/api/mvp/cart/items/:id",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const userId = req.sessionUser!.id;
      const itemId = pathUuid(req.params.id);
      const body = (req.body ?? {}) as Record<string, unknown>;
      const quantity = requireInt(body.quantity, "quantity", { min: 1, max: MAX_LINE_QUANTITY });

      const cartId = await withTransaction(async (client) => {
        const owned = await client.query(
          `SELECT ci.id, ci.cart_id
             FROM cart_items ci
             JOIN carts c ON c.id = ci.cart_id
            WHERE ci.id = $1 AND c.user_id = $2
            FOR UPDATE`,
          [itemId, userId],
        );
        const row = owned.rows[0] as { id: string; cart_id: string } | undefined;
        if (!row) throw notFound("CART_ITEM_NOT_FOUND", "Cart item not found");
        await client.query(
          `UPDATE cart_items SET quantity = $2, updated_at = NOW() WHERE id = $1`,
          [itemId, quantity],
        );
        return row.cart_id;
      });

      ok(res, { cart: await cartPayloadFor(userId, cartId) });
    }),
  );

  // ── Remove a line ────────────────────────────────────────────────────────
  app.delete(
    "/api/mvp/cart/items/:id",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const userId = req.sessionUser!.id;
      const itemId = pathUuid(req.params.id);

      const cartId = await withTransaction(async (client) => {
        const owned = await client.query(
          `DELETE FROM cart_items ci
            USING carts c
            WHERE ci.id = $1 AND c.id = ci.cart_id AND c.user_id = $2
            RETURNING ci.cart_id`,
          [itemId, userId],
        );
        const row = owned.rows[0] as { cart_id: string } | undefined;
        if (!row) throw notFound("CART_ITEM_NOT_FOUND", "Cart item not found");
        return row.cart_id;
      });

      const cart = await cartPayloadFor(userId, cartId);
      ok(res, { cart });
    }),
  );

  // ── Checkout ─────────────────────────────────────────────────────────────
  app.post(
    "/api/mvp/checkout",
    requireActiveUser,
    route(async (req: Request, res: Response) => {
      const userId = req.sessionUser!.id;
      const body = (req.body ?? {}) as Record<string, unknown>;
      const parsed = parseCheckoutBody(body);

      const result = await createOrder({
        userId,
        cartId: parsed.cartId,
        sellerId: parsed.sellerId,
        addressId: parsed.addressId,
        address: parsed.address,
        requestKey: parsed.requestKey,
        notes: parsed.notes,
      });

      const detail = await loadOrderDetail(result.orderId, { kind: "customer", userId });
      if (!detail) throw new Error(`checkout created order ${result.orderId} that cannot be read back`);

      ok(
        res,
        { order: detail, replayed: result.replayed },
        result.replayed ? 200 : 201,
      );
    }),
  );
}

/** Exported for the orders router's payload consistency. */
export async function cartSubtotal(userId: string): Promise<string> {
  const carts = await loadCarts(userId);
  if (carts.length === 0) return "0.00";
  return carts.reduce(
    (total, cart) => toMoneyString(add(parseDecimal(total), parseDecimal(cart.subtotal))),
    "0.00",
  );
}

export { badRequest };
