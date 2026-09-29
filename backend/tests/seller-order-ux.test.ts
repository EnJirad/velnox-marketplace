/**
 * Seller order UX — the rules the seller's order screens must obey.
 *
 * WHY THIS FILE EXISTS
 * -------------------
 * The seller order tab is where an order actually gets fulfilled, and it is the
 * one order surface that shows SOMEBODY ELSE'S data. What must hold:
 *
 *    1. `/seller/orders/:orderId` is a SELLER route behind `RequireRole
 *       role="seller"` — it is not the customer page, and a customer cannot open it;
 *    2. it reads `GET /api/seller/orders/:id`, which resolves the seller from the
 *       SESSION and verifies ownership inside the query. The page must never pass a
 *       seller id, and must never call the customer order endpoint;
 *    3. the status buttons come from `NEXT_ORDER_STATUSES`, which agrees with the
 *       backend's own `SELLER_ORDER_STATUS_TRANSITIONS` — the UI can only propose a
 *       move the API accepts, and a terminal order offers nothing;
 *    4. the status filter is applied SERVER-SIDE, so "shipped" shows the real
 *       shipped orders and not a client-side slice of one page;
 *    5. the customer's Order Detail no longer renders the shop block, while the
 *       backend still CARRIES shopId/shopName for the seller and velcenter;
 *    6. all new copy exists in th, en and my.
 *
 * Contract tests: they read the shipped source. No database is needed.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import { NEXT_ORDER_STATUSES, ORDER_STATUS_META } from "../../packages/shared/src/lib/commerce.ts";
import { translations } from "../../packages/shared/src/lib/i18n/locales/index";
import {
  SELLER_ORDER_STATUSES,
  SELLER_ORDER_STATUS_TRANSITIONS,
  normalizeSellerOrderStatus,
} from "../routes/seller-orders.js";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const SELLER_MAIN = "apps/velseller/src/main.tsx";
const SELLER_LIST = "apps/velseller/src/pages/SellerOrders.tsx";
const SELLER_DETAIL = "apps/velseller/src/pages/SellerOrderDetail.tsx";
const CUSTOMER_DETAIL = "apps/velshop/src/pages/ShopOrderDetail.tsx";
const API_ROUTES = "packages/shared/src/lib/api-routes.ts";
const LOCALES = ["th", "en", "my"] as const;

const locale = (lang: (typeof LOCALES)[number]) =>
  translations[lang] as unknown as Record<string, Record<string, string>>;

describe("seller orders — routing and access", () => {
  test("the detail page is routed under RequireRole(seller)", () => {
    const main = read(SELLER_MAIN);
    expect(main).toContain('path="/seller/orders/:orderId"');
    // The gate: every seller route is wrapped, so a customer gets the seller gate
    // rather than another seller's order.
    const route = main.slice(main.indexOf('path="/seller/orders/:orderId"'));
    expect(route.slice(0, 400)).toContain('<RequireRole role="seller">');
    expect(route.slice(0, 400)).toContain("<SellerOrderDetail />");
    // …and the page is code-split like the rest of the app.
    expect(main).toContain('lazy(() => import("@/pages/SellerOrderDetail"))');
  });

  test("the seller reads the SELLER endpoint, and never the customer one", () => {
    expect(read(API_ROUTES)).toContain(
      '"api.commerce.sellerOrderDetail": (a) => apiGet(`/api/seller/orders/${a.orderId}`)',
    );
    for (const page of [SELLER_LIST, SELLER_DETAIL]) {
      const src = read(page);
      // The seller app must not reach into a customer-only surface…
      expect(src).not.toContain("api.customer.");
      // …and it cannot name a seller: the server resolves it from the session.
      expect(src).not.toMatch(/sellerId\s*[:,]/);
    }
    expect(read(SELLER_DETAIL)).toContain("api.commerce.sellerOrderDetail");
  });

  test("the backend keeps verifying ownership without leaking existence", () => {
    const route = read("backend/routes/seller-orders.ts");
    // Ownership is part of the query, not a second client-side check.
    expect(route).toContain("WHERE o.id = $1 AND sh.seller_id = $2");
    // An order that is unknown and one that is another seller's answer IDENTICALLY.
    expect(route).toContain('code: "NOT_FOUND", message: "Order not found"');
    // Only this seller's items are ever selected.
    expect(route).toContain("WHERE oi.order_id = ANY($1) AND sh.seller_id = $2");
  });
});

describe("seller orders — the status state machine", () => {
  test("the seller statuses are the fulfilment set, and nothing else", () => {
    expect([...SELLER_ORDER_STATUSES]).toEqual([
      "pending",
      "confirmed",
      "shipped",
      "delivered",
      "completed",
      "cancelled",
    ]);
    // A payment-lifecycle row is judged by what it MEANS for fulfilment.
    expect(normalizeSellerOrderStatus("paid")).toBe("pending");
    expect(normalizeSellerOrderStatus("pending_payment")).toBe("pending");
    expect(normalizeSellerOrderStatus("expired")).toBe("cancelled");
    expect(normalizeSellerOrderStatus("refunded")).toBe("cancelled");
    expect(normalizeSellerOrderStatus("payment_failed")).toBe("cancelled");
  });

  test("NEXT_ORDER_STATUSES agrees with the backend's own transitions", () => {
    // The UI offers exactly what the API accepts — no more, no less.
    for (const status of SELLER_ORDER_STATUSES) {
      expect(NEXT_ORDER_STATUSES[status]).toEqual([...SELLER_ORDER_STATUS_TRANSITIONS[status]]);
    }
    // A payment-lifecycle status offers what its fulfilment meaning allows, so an
    // unpaid-but-paid-marked order still exposes the seller's first move.
    for (const raw of ["pending_payment", "paid", "expired", "payment_failed", "refunded"]) {
      const normalized = normalizeSellerOrderStatus(raw);
      expect(NEXT_ORDER_STATUSES[raw as keyof typeof NEXT_ORDER_STATUSES]).toEqual([
        ...SELLER_ORDER_STATUS_TRANSITIONS[normalized],
      ]);
    }
    // Terminal really means terminal: a finished or cancelled order moves nowhere.
    expect(NEXT_ORDER_STATUSES.completed).toEqual([]);
    expect(NEXT_ORDER_STATUSES.cancelled).toEqual([]);
  });

  test("the page proposes transitions from that table, not a hand-written list", () => {
    const detail = read(SELLER_DETAIL);
    expect(detail).toContain("NEXT_ORDER_STATUSES[order.status] ?? []");
    // Every status it can render has a translated label.
    expect(detail).toContain("t(orderStatusI18nKey(next))");
    expect(detail).toContain("t(orderStatusI18nKey(order.status))");
    // Cancelling restores stock server-side, so it is confirmed first.
    expect(detail).toContain("setConfirmStatus(next)");
    expect(detail).toContain("<AlertDialog");
    // A terminal order explains itself instead of showing an empty control.
    expect(detail).toContain('t("sellerOrders.statusTerminal")');
    // The transition is sent with the order id and the target status only.
    expect(detail).toContain("setOrderStatus({ orderId: order.id, status: next })");
  });
});

describe("seller orders — list, filters and i18n", () => {
  test("the status filter is applied server-side", () => {
    const routes = read(API_ROUTES);
    // The filter rides on the query string the API already supports.
    expect(routes).toContain("status: a?.status");
    const list = read(SELLER_LIST);
    expect(list).toContain('sellerOrdersAction({ limit: 50, status: filter === "all" ? undefined : filter })');
    // No client-side filtering masquerading as the whole result set.
    expect(list).not.toMatch(/orders\.filter\(/);
    // The filter chips are the six fulfilment statuses plus "all".
    expect(list).toContain("FILTERABLE_STATUSES");
    for (const status of SELLER_ORDER_STATUSES) {
      expect(list).toContain(`"${status}"`);
    }
    // A slow answer for a previously selected filter cannot overwrite the new one.
    expect(list).toContain("requestFilter");
  });

  test("every order opens the seller detail, from the table and from the card", () => {
    const list = read(SELLER_LIST);
    const links = list.match(/to=\{`\/seller\/orders\/\$\{order\.id\}`\}/g) ?? [];
    // One on the desktop table row, one on the mobile card.
    expect(links.length).toBe(2);
    // Desktop table + mobile cards both exist (one layout per width, not one squeezed).
    expect(list).toContain("hidden overflow-x-auto");
    expect(list).toContain("lg:hidden");
  });

  test("the customer detail no longer shows a shop block, but the data survives", () => {
    const customer = read(CUSTOMER_DETAIL);
    expect(customer).not.toContain('t("orderDetail.shopTitle")');
    expect(customer).not.toContain("order.shopName");
    // Hiding it on the customer surface did not touch the API contract.
    expect(read("backend/routes/seller-orders.ts")).toContain("shopName: r.shop_name");
    expect(read("backend/routes/cart.ts")).toContain("shop_name");
  });

  test("every new string exists in th, en and my", () => {
    const keys = [
      "eyebrow",
      "title",
      "desc",
      "listTitle",
      "filterAll",
      "itemCount",
      "openOrder",
      "customerTitle",
      "phone",
      "currentStatus",
      "statusChange",
      "statusUpdated",
      "statusUpdateFailed",
      "statusTerminal",
      "unitPrice",
      "quantity",
      "variant",
      "viewProduct",
      "colOrder",
      "colCustomer",
      "colItems",
      "colPayment",
      "colShipping",
      "colTotal",
      "colStatus",
      "colUpdated",
      "storeTotal",
      "noOrdersTitle",
      "noOrdersDesc",
      "noOrdersFiltered",
    ];
    for (const lang of LOCALES) {
      const ns = locale(lang).sellerOrders;
      expect(ns).toBeDefined();
      for (const key of keys) {
        expect(typeof ns[key]).toBe("string");
        expect(ns[key].trim().length).toBeGreaterThan(0);
      }
    }
    // The two Order Detail error states the customer side added.
    for (const lang of LOCALES) {
      expect(locale(lang).orderDetail.noAccess.trim().length).toBeGreaterThan(0);
      expect(locale(lang).orderDetail.noAccessDesc.trim().length).toBeGreaterThan(0);
    }
    // The seller shipping column never prints the raw "none" token.
    for (const lang of LOCALES) {
      expect(locale(lang).trackingLabels.none.trim().length).toBeGreaterThan(0);
    }
    // Every status a seller surface can label exists in all three languages.
    for (const status of Object.keys(ORDER_STATUS_META)) {
      for (const lang of LOCALES) {
        expect(locale(lang).orderStatus[status].trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("no Thai literal is hard-coded in the seller order pages", () => {
    for (const page of [SELLER_LIST, SELLER_DETAIL]) {
      const src = read(page);
      // The order surfaces are fully localized; the only Thai left in the app is
      // the pre-existing subscriptions block in the list, which this task did not
      // touch — so the check is scoped to the lines that are NOT that block.
      const withoutSubscriptions = src.slice(src.indexOf("Customer orders"));
      expect(withoutSubscriptions).not.toMatch(/[\u0E00-\u0E7F\u1000-\u109F]/);
    }
  });

  test("the seller order badge is the SHARED one, with a readable palette", () => {
    for (const page of [SELLER_LIST, SELLER_DETAIL]) {
      const src = read(page);
      expect(src).toContain("OrderStatusBadge");
      // The translated label is always passed, so the badge is never colour-only
      // and never falls back to the Thai seller copy on a localized surface.
      expect(src).toMatch(/<OrderStatusBadge\s+status=\{order\.status\}\s+label=/);
    }
    const badge = read("packages/shared/src/components/order/OrderStatusBadge.tsx");
    // Background + foreground + a ring: the trio that keeps a status readable on
    // the card it sits on (the old white-on-white pill was the defect).
    expect(badge).toContain("meta.badge");
    expect(badge).toContain("ring-1 ring-inset");
    expect(badge).toContain("orderStatusIcon(status)");
  });
});
