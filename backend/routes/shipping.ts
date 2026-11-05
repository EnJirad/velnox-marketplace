/**
 * Server-authoritative shipping quotes.
 * ═══════════════════════════════════════════════════════════════════════════
 *   POST /api/customer/shipping/quote
 *     body: { addressId|shippingAddressId, cartItemIds?, buyNow? }
 *     200 : the priced delivery breakdown for EXACTLY this cart + address
 *
 * WHY THIS ENDPOINT EXISTS
 *
 * The storefront used to print "free shipping" and post an order with
 * `shipping_fee = 0`. There was no place a delivery price could come FROM, so
 * the customer was shown (and charged) a total that omitted it.
 *
 * This endpoint is that place. It prices the same rows checkout will price
 * (`lib/checkout-lines.ts`), through the same rules (`lib/shipping.ts`), and
 * stores the result with an expiry and a fingerprint of the exact cart and
 * address. Checkout then redeems the quote instead of trusting anything the
 * client says about money:
 *
 *   client → POST /shipping/quote → quoteId
 *   client → POST /checkout { shippingQuoteId } → server re-derives and compares
 *
 * Nothing here reads a price, quantity or fee from the request body. The client
 * may only NAME what it wants priced (its address, its cart lines, or a
 * product/variant/quantity for Buy Now).
 */
import type { Express, Request, Response } from "express";
import { requireAuth } from "../middleware/auth.js";
import { query } from "../db/index.js";
import { loadCheckoutLines } from "../lib/checkout-lines.js";
import {
  SHIPPING_METHOD,
  SHIPPING_QUOTE_TTL_MINUTES,
  ShippingError,
  buildShippingQuote,
  isSupportedDestination,
  shippingFingerprint,
  shippingQuoteExpiry,
  type QuotedLine,
} from "../lib/shipping.js";
import { insertShippingQuote, loadShopShippingConfigs } from "../lib/shipping-quote-store.js";

function fail(res: Response, status: number, code: string, message: string): void {
  res.status(status).json({ success: false, error: { code, message } });
}

export function setupShippingRoutes(app: Express): void {
  // ── POST /api/customer/shipping/quote ─────────────────────────────────────
  app.post("/api/customer/shipping/quote", requireAuth, async (req: Request, res: Response) => {
    try {
      const userId = req.user!.userId;
      const body = req.body ?? {};

      // A client-supplied fee would make this endpoint pointless — refuse it
      // loudly instead of silently ignoring it.
      for (const field of ["shippingFee", "shipping_fee", "shippingTotal", "total", "amount"] as const) {
        if (body[field] !== undefined && body[field] !== null && body[field] !== "") {
          fail(
            res,
            400,
            "CLIENT_AMOUNT_NOT_ACCEPTED",
            `The client cannot supply "${field}": shipping is computed by the server.`,
          );
          return;
        }
      }

      // ── The delivery destination ────────────────────────────────────────
      // The address row must belong to the caller, and only destinations the
      // implemented rule can price are accepted. An unsupported country is a
      // REFUSAL, never a silent 0 THB delivery.
      const addressId = (body.addressId ?? body.shippingAddressId) as string | undefined;
      if (!addressId || typeof addressId !== "string") {
        fail(res, 400, "ADDRESS_REQUIRED", "Select a delivery address to see the shipping fee.");
        return;
      }
      let address: any;
      try {
        const addrResult = await query(
          `SELECT id, country, city, state, postal_code FROM addresses WHERE id = $1 AND user_id = $2`,
          [addressId, userId],
        );
        address = addrResult.rows[0];
      } catch (err: any) {
        // 22P02 = not a uuid — treat as "no such address", not a server error.
        if (err?.code !== "22P02") throw err;
        address = undefined;
      }
      if (!address) {
        fail(res, 403, "ADDRESS_NOT_FOUND", "Shipping address was not found for this account.");
        return;
      }
      if (!isSupportedDestination(address.country)) {
        fail(
          res,
          422,
          "SHIPPING_DESTINATION_UNSUPPORTED",
          "We cannot deliver to this address yet. Please choose a delivery address in Thailand.",
        );
        return;
      }

      // ── The exact lines being priced ────────────────────────────────────
      const cartItemIds = Array.isArray(body.cartItemIds) ? (body.cartItemIds as string[]) : undefined;
      let buyNow: { productId: string; variantId: string | null; quantity: number } | null = null;
      if (body.buyNow && typeof body.buyNow === "object") {
        const raw = body.buyNow as { productId?: unknown; variantId?: unknown; quantity?: unknown };
        if (typeof raw.productId !== "string" || !raw.productId) {
          fail(res, 400, "VALIDATION_ERROR", "buyNow.productId is required");
          return;
        }
        if (raw.variantId !== undefined && raw.variantId !== null && typeof raw.variantId !== "string") {
          fail(res, 400, "VALIDATION_ERROR", "buyNow.variantId must be a string or null");
          return;
        }
        buyNow = {
          productId: raw.productId,
          variantId: (raw.variantId as string | null | undefined) ?? null,
          quantity: typeof raw.quantity === "number" ? raw.quantity : Number(raw.quantity),
        };
      }

      const loaded = await loadCheckoutLines(userId, cartItemIds, buyNow);
      if (!loaded.ok) {
        fail(res, loaded.error.status, loaded.error.code, loaded.error.message);
        return;
      }
      const { items } = loaded.value;

      const quotedLines: QuotedLine[] = items.map((item: any) => ({
        productId: String(item.product_id),
        variantId: item.variant_id ?? null,
        shopId: item.shop_id ?? null,
        shopName: item.shop_name ?? null,
        quantity: Number(item.quantity),
        // `loadCheckoutLines` re-resolved the CURRENT server price (retail, or a
        // wholesale tier for a verified business buyer) — the quote is priced
        // with exactly what checkout will persist.
        unitPrice: String(item.price),
        lineTotal: item.lineTotalMoney ?? undefined,
        wholesale: item.wholesale
          ? {
              packSize: item.wholesalePackSize ?? null,
              packs: item.wholesalePacks ?? null,
              tierPrice: item.wholesaleTierPrice ?? null,
            }
          : null,
      }));

      const shopIds = [...new Set(quotedLines.map((line) => line.shopId ?? "unknown"))];
      const shopConfigs = await loadShopShippingConfigs(shopIds);

      let quote;
      try {
        quote = buildShippingQuote(quotedLines, shopConfigs);
      } catch (err) {
        if (err instanceof ShippingError) {
          fail(res, 400, err.code, err.message);
          return;
        }
        throw err;
      }

      const expiresAt = shippingQuoteExpiry();
      const stored = await insertShippingQuote({
        userId,
        addressId: String(address.id),
        fingerprint: shippingFingerprint(quotedLines, String(address.id)),
        quote,
        expiresAt,
      });

      res.json({
        success: true,
        data: {
          quoteId: stored.id,
          expiresAt: stored.expiresAt.toISOString(),
          expiresInSeconds: SHIPPING_QUOTE_TTL_MINUTES * 60,
          method: SHIPPING_METHOD,
          currency: quote.currency,
          subtotal: quote.subtotal,
          discount: quote.discount,
          shippingTotal: quote.shippingTotal,
          total: quote.total,
          itemCount: quote.itemCount,
          shops: quote.shops,
          // Per LINE breakdown so the storefront can show pack size, packs and
          // whether a tier applied. Display only: checkout re-derives all of it.
          lines: items.map((item: any) => ({
            productId: String(item.product_id),
            variantId: item.variant_id ?? null,
            quantity: Number(item.quantity),
            unitPrice: String(item.price),
            lineTotal: item.lineTotalMoney ?? null,
            wholesale: item.wholesale === true,
            packSize: item.wholesalePackSize ?? null,
            packs: item.wholesalePacks ?? null,
            pricePerPack: item.wholesaleTierPrice ?? null,
            reason: item.wholesaleReason ?? null,
          })),
        },
      });
    } catch (err) {
      console.error("[shipping] quote error:", err);
      fail(res, 500, "SHIPPING_QUOTE_FAILED", "Could not calculate shipping for this cart.");
    }
  });
}
