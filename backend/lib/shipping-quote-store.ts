/**
 * Persistence for shipping quotes and the shops' shipping configuration.
 * ═══════════════════════════════════════════════════════════════════════════
 * A quote is a SERVER-MINTED claim: "for this exact cart and this exact
 * address, the delivery charge is X, until T". Checkout redeems it once.
 *
 * It lives in `shipping_quotes` rather than inside a client-carried token
 * because the database is already the idempotency store for this flow
 * (`checkout_requests`), and because a row can be consumed exactly once
 * (`consumed_at`) — something a self-contained token cannot express.
 *
 * Nothing here computes money: `lib/shipping.ts` does that. This module only
 * reads shop configuration and moves quote rows in and out of PostgreSQL.
 */
import { query } from "../db/index.js";
import type { ShopShippingConfig, ShippingQuote } from "./shipping.js";

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<any> };

/**
 * Shop shipping configuration for the given shop ids.
 *
 * `shopMap` keys use the literal "unknown" when a product has no shop; that is
 * not a UUID and must never reach the database. A shop id with no row (deleted
 * shop) is still returned with NULL configuration so its lines get priced with
 * the platform default instead of being silently dropped from the total.
 */
export async function loadShopShippingConfigs(
  shopIds: readonly string[],
): Promise<ShopShippingConfig[]> {
  const unique = [...new Set(shopIds)];
  if (unique.length === 0) return [];

  const uuids = unique.filter((id) => id !== "unknown" && id !== "");
  const configs: ShopShippingConfig[] = [];
  if (unique.some((id) => id === "unknown" || id === "")) {
    configs.push({
      shopId: null,
      shopName: null,
      shippingFee: null,
      freeShippingThreshold: null,
    });
  }

  if (uuids.length > 0) {
    const result = await query(
      `SELECT id, name, shipping_fee, free_shipping_threshold
         FROM shops WHERE id = ANY($1::uuid[])`,
      [uuids],
    );
    for (const row of result.rows) {
      configs.push({
        shopId: String(row.id),
        shopName: row.name ?? null,
        shippingFee: row.shipping_fee ?? null,
        freeShippingThreshold: row.free_shipping_threshold ?? null,
      });
    }
    const found = new Set(configs.map((c) => c.shopId));
    for (const id of uuids) {
      if (!found.has(id)) {
        configs.push({
          shopId: id,
          shopName: null,
          shippingFee: null,
          freeShippingThreshold: null,
        });
      }
    }
  }

  return configs;
}

export interface StoredShippingQuote {
  id: string;
  userId: string;
  addressId: string | null;
  fingerprint: string;
  currency: string;
  subtotal: string;
  shippingTotal: string;
  totalAmount: string;
  breakdown: unknown;
  expiresAt: string;
  consumedAt: string | null;
  checkoutGroupId: string | null;
}

/** Store a freshly computed quote and return its id + expiry. */
export async function insertShippingQuote(params: {
  userId: string;
  addressId: string | null;
  fingerprint: string;
  quote: ShippingQuote;
  expiresAt: Date;
}): Promise<{ id: string; expiresAt: Date }> {
  const result = await query(
    `INSERT INTO shipping_quotes
       (user_id, address_id, fingerprint, currency, subtotal, shipping_total, total_amount, breakdown, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id, expires_at`,
    [
      params.userId,
      params.addressId,
      params.fingerprint,
      params.quote.currency,
      params.quote.subtotal,
      params.quote.shippingTotal,
      params.quote.total,
      JSON.stringify(params.quote),
      params.expiresAt.toISOString(),
    ],
  );
  const row = result.rows[0];
  return { id: String(row.id), expiresAt: new Date(row.expires_at) };
}

function toStoredQuote(row: any): StoredShippingQuote {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    addressId: row.address_id ? String(row.address_id) : null,
    fingerprint: String(row.fingerprint),
    currency: String(row.currency ?? "THB"),
    subtotal: String(row.subtotal),
    shippingTotal: String(row.shipping_total),
    totalAmount: String(row.total_amount),
    breakdown: row.breakdown,
    expiresAt: new Date(row.expires_at).toISOString(),
    consumedAt: row.consumed_at ? new Date(row.consumed_at).toISOString() : null,
    checkoutGroupId: row.checkout_group_id ? String(row.checkout_group_id) : null,
  };
}

/**
 * Read a quote that belongs to `userId`. A quote minted for someone else is
 * indistinguishable from a missing one — ownership is part of the lookup, never
 * a check a caller can forget.
 */
export async function loadShippingQuote(
  quoteId: string,
  userId: string,
): Promise<StoredShippingQuote | null> {
  let rows;
  try {
    const result = await query(
      `SELECT id, user_id, address_id, fingerprint, currency, subtotal, shipping_total,
              total_amount, breakdown, expires_at, consumed_at, checkout_group_id
         FROM shipping_quotes WHERE id = $1 AND user_id = $2`,
      [quoteId, userId],
    );
    rows = result.rows;
  } catch (err: unknown) {
    // 22P02 = invalid uuid text — a malformed id is "no such quote", not a 500.
    if ((err as { code?: string })?.code === "22P02") return null;
    throw err;
  }
  if (rows.length === 0) return null;
  return toStoredQuote(rows[0]);
}

/**
 * Redeem a quote exactly once, inside the caller's transaction.
 *
 * The UPDATE is the arbitration point: `consumed_at IS NULL` and the expiry are
 * both in the WHERE clause, so two concurrent checkouts holding the same quote
 * cannot both win, and an expired quote cannot be redeemed by clock skew.
 * Returns false when the row was already used or has expired.
 */
export async function consumeShippingQuote(
  client: Queryable,
  quoteId: string,
  userId: string,
): Promise<boolean> {
  const result = await client.query(
    `UPDATE shipping_quotes
        SET consumed_at = NOW()
      WHERE id = $1 AND user_id = $2 AND consumed_at IS NULL AND expires_at > NOW()
      RETURNING id`,
    [quoteId, userId],
  );
  return result.rows.length > 0;
}

/** Link the redeemed quote to the purchase it priced, for audit. */
export async function attachShippingQuoteToGroup(
  client: Queryable,
  quoteId: string,
  checkoutGroupId: string,
): Promise<void> {
  await client.query(`UPDATE shipping_quotes SET checkout_group_id = $2 WHERE id = $1`, [
    quoteId,
    checkoutGroupId,
  ]);
}
