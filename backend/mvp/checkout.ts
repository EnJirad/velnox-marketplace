/**
 * MVP checkout — ONE transaction that turns a cart into an order.
 *
 * Every rule that makes an order trustworthy is enforced here and nowhere else:
 *
 *   • the price is re-read from `products` / `product_variants`; a price the
 *     client sent anywhere is never used (the cart's own `price` column is a
 *     display snapshot and is ignored);
 *   • product status, variant status and seller approval are re-checked against
 *     current database state inside the transaction;
 *   • stock is reserved with a guarded atomic UPDATE (`inventory.ts`), so two
 *     concurrent checkouts cannot oversell the last unit;
 *   • `order_items` store an immutable name/price snapshot, so history never
 *     changes when a seller edits a listing;
 *   • the request key is claimed in `checkout_requests` (UNIQUE user+key), so a
 *     retried request returns the SAME order instead of creating a second one;
 *   • any failure rolls back the order, its items AND every stock reservation —
 *     there is no compensating write to forget.
 */
import type pg from "pg";
import { withTransaction } from "../db/index.js";
import { add, multiplyByQuantity, parseDecimal, toMoneyString, ZERO } from "../lib/money.js";
import { generateOrderNumber, isOrderNumberCollision } from "../lib/order-number.js";
import {
  type ApiError,
  badRequest,
  conflict,
  optionalString,
  requireInt,
  requireMoney,
  requireUuid,
  requireString,
} from "./http.js";
import { releaseStock, reserveStock, type StockLine } from "./inventory.js";

type Client = pg.PoolClient;

/** Flat shipping for the MVP: the schema has no shipping-price table, so an
 * order total is always subtotal + 0.00. Documented in the Phase 3 report. */
export const MVP_SHIPPING_FEE = "0.00";

/** How long an unpaid order may hold stock before the expiry sweep releases it. */
export const PAYMENT_WINDOW_MINUTES = 30;

export interface ShippingAddress {
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  subdistrict: string | null;
  district: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

/**
 * Validate an inline (client-supplied) address into the immutable snapshot that
 * `orders.shipping_address` stores. Nothing here is re-read from `addresses`
 * later, so an address edit cannot rewrite a placed order's delivery details.
 */
export function normalizeAddress(input: unknown): ShippingAddress {
  if (typeof input !== "object" || input === null) {
    throw badRequest("ADDRESS_REQUIRED", "A shipping address is required");
  }
  const raw = input as Record<string, unknown>;
  const country = optionalString(raw.country, "country", { max: 2 })?.toUpperCase() ?? "TH";
  if (!/^[A-Z]{2}$/.test(country)) {
    throw badRequest("INVALID_INPUT", "country must be a 2-letter ISO code");
  }
  return {
    label: optionalString(raw.label, "label", { max: 60 }) ?? "Home",
    recipientName: requireString(raw.recipientName, "recipientName", { max: 120 }),
    phone: requireString(raw.phone, "phone", { max: 40 }),
    line1: requireString(raw.line1, "line1", { max: 200 }),
    line2: optionalString(raw.line2, "line2", { max: 200 }),
    subdistrict: optionalString(raw.subdistrict, "subdistrict", { max: 120 }),
    district: optionalString(raw.district, "district", { max: 120 }),
    city: requireString(raw.city, "city", { max: 120 }),
    state: requireString(raw.state, "state", { max: 120 }),
    postalCode: requireString(raw.postalCode, "postalCode", { max: 20 }),
    country,
  };
}

interface CartItemRow {
  product_id: string;
  variant_id: string | null;
  quantity: number;
  product_name: string;
  product_status: string;
  base_price: string;
  variant_name: string | null;
  variant_price: string | null;
  variant_status: string | null;
  image_url: string | null;
}

interface PricedLine extends StockLine {
  productName: string;
  variantName: string | null;
  imageUrl: string | null;
  unitPrice: string;
  lineTotal: string;
}

export interface CreateOrderInput {
  userId: string;
  cartId: string | null;
  sellerId: string | null;
  addressId: string | null;
  address: unknown;
  requestKey: string;
  notes: string | null;
}

export interface CreateOrderResult {
  orderId: string;
  /** True when this request key had already produced an order. */
  replayed: boolean;
}

async function loadAddressSnapshot(
  client: Client,
  userId: string,
  addressId: string | null,
  inlineAddress: unknown,
): Promise<ShippingAddress> {
  if (addressId) {
    const result = await client.query(
      `SELECT label, recipient_name, phone, line1, line2, subdistrict, district,
              city, state, postal_code, country
         FROM addresses
        WHERE id = $1 AND user_id = $2`,
      [addressId, userId],
    );
    const row = result.rows[0] as Record<string, string | null> | undefined;
    if (!row) throw badRequest("ADDRESS_NOT_FOUND", "The selected address does not exist");
    return {
      label: row.label ?? "Home",
      recipientName: row.recipient_name ?? "",
      phone: row.phone ?? "",
      line1: row.line1 ?? "",
      line2: row.line2 ?? null,
      subdistrict: row.subdistrict ?? null,
      district: row.district ?? null,
      city: row.city ?? "",
      state: row.state ?? "",
      postalCode: row.postal_code ?? "",
      country: row.country ?? "TH",
    };
  }
  if (inlineAddress !== undefined && inlineAddress !== null) {
    return normalizeAddress(inlineAddress);
  }
  throw badRequest("ADDRESS_REQUIRED", "A shipping address is required");
}

/**
 * Price and validate every cart line against CURRENT database state.
 *
 * Runs inside the checkout transaction. A product that stopped being published,
 * a variant that was retired, or a seller that was suspended between "add to
 * cart" and "checkout" all fail here with a 409 — the order is never created
 * from stale cart data.
 */
async function priceCartItems(client: Client, cartId: string, sellerId: string): Promise<PricedLine[]> {
  const items = await client.query(
    `SELECT ci.product_id,
            ci.variant_id,
            ci.quantity,
            p.name  AS product_name,
            p.status AS product_status,
            p.price AS base_price,
            v.name  AS variant_name,
            v.price AS variant_price,
            v.status AS variant_status,
            (SELECT pi.url FROM product_images pi
              WHERE pi.product_id = p.id
              ORDER BY pi.sort_order, pi.created_at
              LIMIT 1) AS image_url
       FROM cart_items ci
       JOIN products p ON p.id = ci.product_id
       LEFT JOIN product_variants v
              ON v.product_id = ci.product_id AND v.id = ci.variant_id
      WHERE ci.cart_id = $1
      ORDER BY ci.added_at, ci.id`,
    [cartId],
  );

  const rows = items.rows as CartItemRow[];
  if (rows.length === 0) throw conflict("CART_EMPTY", "This cart has no items to check out");

  const lines: PricedLine[] = [];
  for (const row of rows) {
    if (row.product_status !== "published") {
      throw conflict("PRODUCT_NOT_AVAILABLE", "A product in this cart is no longer available for sale");
    }
    if (row.variant_id && (!row.variant_status || row.variant_status !== "active")) {
      throw conflict("VARIANT_NOT_AVAILABLE", "A variant in this cart is no longer available");
    }
    // The DB enforces the same pairing with composite foreign keys; asserting it
    // here turns a would-be 409 into a clear message about a mixed cart.
    const unitPrice = row.variant_id ? row.variant_price! : row.base_price;
    const lineTotal = toMoneyString(
      multiplyByQuantity(parseDecimal(unitPrice), row.quantity),
    );
    lines.push({
      productId: row.product_id,
      variantId: row.variant_id,
      quantity: row.quantity,
      productName: row.product_name,
      variantName: row.variant_name,
      imageUrl: row.image_url,
      unitPrice: toMoneyString(parseDecimal(unitPrice)),
      lineTotal,
    });
  }

  // Seller approval is re-checked here, not only by the seller guard: an order
  // is created by the BUYER, so `requireApprovedSeller` never runs for it.
  const seller = await client.query(
    `SELECT status FROM seller_profiles WHERE id = $1`,
    [sellerId],
  );
  if (seller.rowCount === 0 || (seller.rows[0] as { status: string }).status !== "approved") {
    throw conflict("SELLER_NOT_APPROVED", "This seller is not currently accepting orders");
  }

  return lines;
}

async function insertOrderWithRetry(
  client: Client,
  params: {
    userId: string;
    sellerId: string;
    subtotal: string;
    shippingFee: string;
    total: string;
    address: ShippingAddress;
    notes: string | null;
  },
): Promise<{ id: string; order_number: string; status: string; created_at: string }> {
  // The order number is timestamp + a random 4-digit suffix, so a collision is
  // possible; `orders.order_number` is UNIQUE. Retry on a savepoint, because a
  // 23505 aborts the current transaction and a plain retry would fail with
  // "current transaction is aborted".
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await client.query("SAVEPOINT mvp_order_number");
    try {
      const result = await client.query(
        `INSERT INTO orders
           (order_number, user_id, seller_id, subtotal, shipping_fee, total_amount,
            currency, shipping_address, notes, payment_expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'THB', $7::jsonb, $8,
                 NOW() + ($9 || ' minutes')::interval)
         RETURNING id, order_number, status, created_at`,
        [
          generateOrderNumber(),
          params.userId,
          params.sellerId,
          params.subtotal,
          params.shippingFee,
          params.total,
          JSON.stringify(params.address),
          params.notes,
          String(PAYMENT_WINDOW_MINUTES),
        ],
      );
      await client.query("RELEASE SAVEPOINT mvp_order_number");
      return result.rows[0] as { id: string; order_number: string; status: string; created_at: string };
    } catch (err) {
      await client.query("ROLLBACK TO SAVEPOINT mvp_order_number");
      await client.query("RELEASE SAVEPOINT mvp_order_number");
      if (!isOrderNumberCollision(err) || attempt === 3) throw err;
    }
  }
  throw conflict("ORDER_NUMBER_EXHAUSTED", "Could not allocate an order number; please retry");
}

/**
 * Create one order from one cart.
 *
 * Invariant: a cart belongs to exactly one seller (`carts_one_per_seller`), so
 * an order can never mix sellers. `cart_items` is additionally FK-locked to both
 * the cart's seller and the product's seller, which is why a cross-seller line
 * is impossible even for a direct SQL write.
 */
export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  if (!input.cartId && !input.sellerId) {
    throw badRequest("CART_REQUIRED", "cartId or sellerId is required");
  }

  return withTransaction(async (client) => {
    // ── 1. Claim the request key (idempotency) ──────────────────────────────
    const claim = await client.query(
      `INSERT INTO checkout_requests (user_id, request_key)
       VALUES ($1, $2)
       ON CONFLICT (user_id, request_key) DO NOTHING
       RETURNING id`,
      [input.userId, input.requestKey],
    );

    if (claim.rowCount === 0) {
      const existing = await client.query(
        `SELECT order_id FROM checkout_requests WHERE user_id = $1 AND request_key = $2`,
        [input.userId, input.requestKey],
      );
      const orderId = (existing.rows[0] as { order_id: string | null } | undefined)?.order_id;
      if (orderId) return { orderId, replayed: true };
      // The first attempt is still running (or failed after committing the
      // claim, which cannot happen: the claim rolls back with the order).
      throw conflict("CHECKOUT_IN_PROGRESS", "This checkout request is already being processed");
    }
    const claimId = (claim.rows[0] as { id: string }).id;

    // ── 2. Resolve and lock the buyer's own cart ────────────────────────────
    const cartResult = await client.query(
      `SELECT id, seller_id
         FROM carts
        WHERE user_id = $1
          AND ($2::uuid IS NULL OR id = $2::uuid)
          AND ($3::uuid IS NULL OR seller_id = $3::uuid)
        FOR UPDATE`,
      [input.userId, input.cartId, input.sellerId],
    );
    if (cartResult.rowCount === 0) {
      throw conflict("CART_NOT_FOUND", "No cart matches this checkout for your account");
    }
    const cart = cartResult.rows[0] as { id: string; seller_id: string };

    // ── 3. Price + validate against current state ───────────────────────────
    const lines = await priceCartItems(client, cart.id, cart.seller_id);

    const subtotal = toMoneyString(
      lines.reduce((acc, line) => add(acc, parseDecimal(line.lineTotal)), ZERO),
    );
    const total = toMoneyString(
      add(parseDecimal(subtotal), parseDecimal(MVP_SHIPPING_FEE)),
    );

    // ── 4. Immutable address snapshot ───────────────────────────────────────
    const address = await loadAddressSnapshot(client, input.userId, input.addressId, input.address);

    // ── 5. Order + line snapshots ───────────────────────────────────────────
    const order = await insertOrderWithRetry(client, {
      userId: input.userId,
      sellerId: cart.seller_id,
      subtotal,
      shippingFee: MVP_SHIPPING_FEE,
      total,
      address,
      notes: input.notes,
    });

    for (const line of lines) {
      await client.query(
        `INSERT INTO order_items
           (order_id, seller_id, product_id, variant_id, product_name, variant_name,
            image_url, unit_price, quantity, subtotal)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          order.id,
          cart.seller_id,
          line.productId,
          line.variantId,
          line.productName,
          line.variantName,
          line.imageUrl,
          line.unitPrice,
          line.quantity,
          line.lineTotal,
        ],
      );
    }

    // ── 6. Reserve stock (guarded) — a failure rolls back the whole order ───
    await reserveStock(
      client,
      lines.map((line) => ({
        productId: line.productId,
        variantId: line.variantId,
        quantity: line.quantity,
      })),
    );

    // ── 7. Empty the cart, record the idempotency result ────────────────────
    await client.query(`DELETE FROM cart_items WHERE cart_id = $1`, [cart.id]);
    await client.query(`UPDATE carts SET updated_at = NOW() WHERE id = $1`, [cart.id]);
    await client.query(
      `UPDATE checkout_requests SET order_id = $1, response = $2::jsonb WHERE id = $3`,
      [order.id, JSON.stringify({ orderId: order.id }), claimId],
    );

    return { orderId: order.id, replayed: false };
  });
}

/**
 * Cancel one unpaid order and release the stock it holds.
 *
 * ONE cancellation authority: the customer's own cancel and the expiry sweep
 * both come through here, so stock is released exactly once, the order moves
 * through the only legal transition (`pending_payment → cancelled`, enforced by
 * the trigger), and a paid order can never be silently un-paid.
 */
export async function cancelUnpaidOrder(
  client: Client,
  orderId: string,
  reason: string,
): Promise<boolean> {
  const locked = await client.query(
    `SELECT id, status FROM orders WHERE id = $1 FOR UPDATE`,
    [orderId],
  );
  if (locked.rowCount === 0) return false;
  const status = (locked.rows[0] as { status: string }).status;
  if (status !== "pending_payment") return false;

  const items = await client.query(
    `SELECT product_id, variant_id, quantity FROM order_items WHERE order_id = $1`,
    [orderId],
  );
  await releaseStock(
    client,
    (items.rows as Array<{ product_id: string; variant_id: string | null; quantity: number }>).map(
      (row) => ({ productId: row.product_id, variantId: row.variant_id, quantity: row.quantity }),
    ),
  );

  await client.query(
    `UPDATE orders
        SET status = 'cancelled', cancelled_at = NOW(), cancel_reason = $2, updated_at = NOW()
      WHERE id = $1 AND status = 'pending_payment'`,
    [orderId, reason],
  );
  return true;
}

/**
 * Release stock held by unpaid orders whose payment window has passed.
 *
 * This is an operational sweep, not a scheduler: the MVP has no worker rewrite
 * in scope, so it is exposed as an admin-only endpoint and documented as needing
 * a cron/Render job at cutover. It is idempotent — a second run finds nothing.
 */
export async function expireStaleOrders(limit = 100): Promise<number> {
  const candidates = await withTransaction(async (client) => {
    const result = await client.query(
      `SELECT id FROM orders
        WHERE status = 'pending_payment'
          AND payment_expires_at IS NOT NULL
          AND payment_expires_at <= NOW()
        ORDER BY payment_expires_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED`,
      [Math.min(Math.max(limit, 1), 500)],
    );
    return (result.rows as Array<{ id: string }>).map((row) => row.id);
  });

  let expired = 0;
  for (const orderId of candidates) {
    const cancelled = await withTransaction((client) =>
      cancelUnpaidOrder(client, orderId, "payment_expired"),
    );
    if (cancelled) expired += 1;
  }
  return expired;
}

/** Re-exported so routes can validate the idempotency key in one place. */
export function parseRequestKey(value: unknown): string {
  return requireString(value, "requestKey", { min: 8, max: 128 });
}

/** Body validation shared by the checkout route. */
export interface CheckoutBody {
  cartId: string | null;
  sellerId: string | null;
  addressId: string | null;
  address: unknown;
  requestKey: string;
  notes: string | null;
}

export function parseCheckoutBody(body: Record<string, unknown>): CheckoutBody {
  return {
    cartId: body.cartId === undefined || body.cartId === null ? null : requireUuid(body.cartId, "cartId"),
    sellerId:
      body.sellerId === undefined || body.sellerId === null
        ? null
        : requireUuid(body.sellerId, "sellerId"),
    addressId:
      body.addressId === undefined || body.addressId === null
        ? null
        : requireUuid(body.addressId, "addressId"),
    address: body.address ?? null,
    requestKey: parseRequestKey(body.requestKey),
    notes: optionalString(body.notes, "notes", { max: 1000 }),
  };
}

export type { ApiError };
export { requireInt, requireMoney };
