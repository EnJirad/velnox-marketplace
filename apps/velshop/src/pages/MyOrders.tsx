import { ResumePaymentButton } from "@/components/shop/ResumePaymentButton";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
import { OrderStatusBadge } from "@velnox/shared/components/order/OrderStatusBadge";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import {
  formatBaht,
  formatIsoDate,
  formatIsoDateTime,
  formatPaymentCountdown,
  orderStatusI18nKey,
  orderStripePayability,
  paymentReservationPhase,
  paymentReservationProgress,
  paymentReservationState,
  paymentReservationTone,
  shortOrderNumber,
  type PaymentReservationTone,
  type StoreOrder,
} from "@velnox/shared/lib/commerce";
import {
  AlertTriangle,
  CalendarClock,
  Clock3,
  ImageOff,
  Loader2,
  PackageSearch,
  RefreshCw,
  ShoppingBag,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

interface Loaded {
  orders: StoreOrder[];
}

/**
 * Urgency styling for a running countdown: GREEN → YELLOW → RED (then the dark
 * EXPIRED notice). Design-system tokens only; the clock, the translated note and
 * the expired text always carry the state as well as the colour.
 */
const RESERVATION_TONE_TEXT: Record<PaymentReservationTone, string> = {
  green: "text-emerald-700",
  yellow: "text-amber-700",
  red: "text-rose-700",
  expired: "text-slate-400",
};
const RESERVATION_TONE_TRACK: Record<PaymentReservationTone, string> = {
  green: "bg-emerald-100",
  yellow: "bg-amber-100",
  red: "bg-rose-100",
  expired: "bg-slate-200",
};
const RESERVATION_TONE_FILL: Record<PaymentReservationTone, string> = {
  green: "bg-emerald-500",
  yellow: "bg-amber-500",
  red: "bg-rose-500",
  expired: "bg-slate-400",
};

export default function MyOrders() {
  const { t } = useLanguage();
  const myOrdersAction = useAction(api.commerce.myOrders);
  const stripePaymentStatus = useAction(api.stripe.stripePaymentStatusAction);
  const [searchParams, setSearchParams] = useSearchParams();

  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  /**
   * A failed load is an ERROR state, never "you have no orders". The last good
   * list stays on screen (with a non-blocking banner) when a refresh fails.
   */
  const [error, setError] = useState(false);

  // Stripe hosted-checkout return (Phase 14): `?payment=success|cancelled`
  // is appended by the session's success/cancel URLs. Verify against the
  // gateway (the webhook may not have landed yet) and surface the outcome.
  useEffect(() => {
    const payment = searchParams.get("payment");
    const orderId = searchParams.get("order");
    if (!payment || !orderId) return;
    setSearchParams({ order: orderId }, { replace: true });
    if (payment === "cancelled") {
      toast.error(t("orders.paymentCancelled"));
      return;
    }
    if (payment === "success") {
      stripePaymentStatus({ parentOrderId: orderId })
        .then((res) => {
          const paid = Boolean((res as unknown as { paid?: boolean })?.paid);
          toast.success(paid ? t("orders.paymentSuccess") : t("orders.paymentPending"));
          return myOrdersAction({ limit: 50 });
        })
        .then((orders) => setData((prev) => (prev ? { ...prev, orders } : prev)))
        .catch((err) => console.error("Stripe payment status check failed:", err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const load = useCallback(async () => {
    try {
      const orders = await myOrdersAction({ limit: 50 });
      setData({ orders });
      setError(false);
    } catch (err) {
      console.error("Load orders error:", err);
      setError(true);
    }
  }, [myOrdersAction]);

  useEffect(() => {
    let alive = true;
    void load().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  const retry = useCallback(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  /**
   * Presentation-only clock for the payment-reservation countdowns.
   *
   * The DEADLINE comes from the API (`paymentExpiresAt`, computed by the
   * backend) and the backend enforces it; this state exists only to re-render
   * the remaining time. Nothing here may change an order's status — that is the
   * "no client timer as source of truth" rule, and why a skewed client clock can
   * only ever mis-render a number.
   */
  const [now, setNow] = useState(() => Date.now());

  const orders = data?.orders ?? [];

  /**
   * ONE purchase, N fulfillment orders.
   *
   * A checkout across several shops produces one canonical ORDER per shop —
   * each with its own fulfilment, shipment and tracking — all sharing ONE
   * `checkoutGroupId`. The history groups them so the customer still sees
   * "this order I placed today", while each shop keeps a separate, separately
   * trackable order underneath.
   *
   * An order with no group (a legacy row) is its own group, so nothing is ever
   * hidden or merged.
   */
  const purchases = useMemo(() => {
    const byGroup = new Map<string, { key: string; groupId: string | null; orders: StoreOrder[]; createdAt: number }>();
    for (const order of orders) {
      const groupId = order.checkoutGroupId ?? null;
      const key = groupId ?? `order:${order.id}`;
      const existing = byGroup.get(key);
      if (existing) existing.orders.push(order);
      else byGroup.set(key, { key, groupId, orders: [order], createdAt: order.createdAt });
    }
    return [...byGroup.values()].sort((a, b) => b.createdAt - a.createdAt);
  }, [orders]);

  /** Is any order still counting down? Only then does the clock need to tick. */
  const hasOpenReservation = useMemo(
    () =>
      orders.some((order: StoreOrder) => {
        const phase = paymentReservationPhase(order, now);
        return phase === "active";
      }),
    [orders, now],
  );

  useEffect(() => {
    if (!hasOpenReservation) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [hasOpenReservation]);

  /**
   * Re-read the authoritative list when the tab becomes visible again (a phone
   * that was locked, or a return from another tab): the countdown must never be
   * the only thing that knows time passed.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "visible") void load();
    };
    window.addEventListener("visibilitychange", onVisibility);
    return () => window.removeEventListener("visibilitychange", onVisibility);
  }, [load]);

  /**
   * When a countdown lapses, refetch ONCE for that order. The expiry sweep may
   * already have written `expired` and released the stock; until the API answers,
   * the card shows the expired state rather than a negative timer. The ref stops
   * a lapse from refetching in a loop.
   */
  const refetchedFor = useRef<Set<string>>(new Set());
  useEffect(() => {
    const lapsed = orders.find(
      (order: StoreOrder) =>
        paymentReservationPhase(order, now) === "expired" &&
        order.status !== "expired" &&
        order.status !== "paid",
    );
    if (!lapsed || refetchedFor.current.has(lapsed.id)) return;
    refetchedFor.current.add(lapsed.id);
    void load();
  }, [orders, now, load]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <ShoppingBag className="size-4 text-[#10B981]" />
            {t("orders.eyebrow")}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("orders.title")}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">{t("orders.desc")}</p>
        </div>

        {/* Order history */}
        <section className="mt-8">
          <h2 className="text-base font-semibold text-slate-900">{t("orders.historyTitle")}</h2>

          {/* Stale data + a failed refresh: keep the orders, flag the failure. */}
          {!loading && error && orders.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-2 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-3">
              <AlertTriangle className="size-4 shrink-0 text-amber-600" />
              <p className="text-sm text-amber-800">{t("common.error")}</p>
              <button
                type="button"
                onClick={retry}
                className="ml-auto rounded-[10px] border border-amber-300 px-3 py-1.5 text-xs font-semibold text-amber-800 transition-colors hover:bg-amber-100"
              >
                {t("common.retry")}
              </button>
            </div>
          )}

          {loading ? (
            <div className="mt-8 space-y-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-36 animate-pulse rounded-xl border border-slate-200 bg-white" />
              ))}
            </div>
          ) : error && orders.length === 0 ? (
            <div className="mt-8 flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-50">
                <AlertTriangle className="size-7 text-amber-600" />
              </span>
              <h2 className="mt-5 text-lg font-semibold text-slate-900">{t("common.error")}</h2>
              <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">{t("orders.desc")}</p>
              <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={retry}>
                <RefreshCw className="size-4" />
                {t("common.retry")}
              </Button>
            </div>
          ) : orders.length === 0 ? (
            <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-[#ECFDF5]">
                <PackageSearch className="size-7 text-[#10B981]" />
              </span>
              <h2 className="mt-5 text-lg font-semibold text-slate-900">{t("orders.emptyTitle")}</h2>
              <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">{t("orders.emptyDesc")}</p>
              <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" asChild>
                <Link to="/">
                  <ShoppingBag className="size-4" />
                  {t("orders.goShopping")}
                </Link>
              </Button>
            </div>
          ) : (
            <div className="mt-3 space-y-4">
              {purchases.map((purchase) => (
              <div key={purchase.key} className="space-y-3">
              {purchase.orders.length > 1 && (
                <div className="rounded-lg border border-[#10B981]/30 bg-[#ECFDF5]/60 px-3 py-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-[#047857]">
                    {t("orders.purchaseGroup")}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-600">
                    {t("orders.purchaseGroupMeta", { count: purchase.orders.length })}
                  </p>
                </div>
              )}
              {purchase.orders.map((order: StoreOrder) => {
                // The badge TEXT must follow the shopper's language — the shared
                // `meta.label` stays the Thai seller-side fallback.
                const statusLabel = t(orderStatusI18nKey(order.status));
                const items = order.items ?? [];
                // An order that is still payable keeps its "continue payment"
                // entry point here, so a customer who left Stripe never has to go
                // back to the cart (which no longer holds the items) to pay.
                const payability = orderStripePayability(order);
                // The reservation window (Fixed 30-minute Payment Reservation):
                // the deadline is the backend's, this only renders it.
                const reservation = paymentReservationState(order, now);
                const reservationPhase = paymentReservationPhase(order, now);
                // This card's OWN urgency tier and its share of the ORIGINAL
                // window (the backend's reservation length — unknown length means
                // no bar, never a made-up denominator).
                const tone = paymentReservationTone(reservation.remainingMs);
                const totalMs = order.reservationMinutes ? order.reservationMinutes * 60_000 : null;
                const progress = paymentReservationProgress(reservation.remainingMs, totalMs);
                const reservationNote =
                  tone === "red"
                    ? t("orderReservation.criticalNote")
                    : tone === "yellow"
                      ? t("orderReservation.urgentNote")
                      : t("orderReservation.windowNote");
                return (
                  <div
                    key={order.id}
                    className="rounded-xl border border-slate-200 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-[#10B981]/40 hover:shadow-[0_12px_30px_rgba(15,23,42,0.06)]"
                  >
                    {/*
                      Header: the order number on the LEFT, the status badge TOP RIGHT
                      of the same row. The badge used to sit at the bottom of the card
                      next to the total, where it read as part of the money block; and
                      the whole card used to be one big link, which made every product in
                      it open the ORDER instead of the product.
                    */}
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 p-5 pb-4">
                      <Link to={`/orders/${order.id}`} className="group min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold text-slate-900 transition-colors group-hover:text-[#10B981]">
                          {t("orders.orderNo", { no: shortOrderNumber(order.orderNumber) })}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {formatIsoDateTime(order.createdAt)} ·{" "}
                          {t("orders.pieces", {
                            count: order.itemCount ?? items.reduce((s, i) => s + i.quantity, 0),
                          })}
                        </p>
                      </Link>
                      <OrderStatusBadge status={order.status} label={statusLabel} />
                    </div>

                    {/*
                      Items — each product row is its OWN link to the product page, so
                      tapping a product opens the PRODUCT. The order number above is what
                      opens the order. A product that is no longer on sale renders as an
                      unlinkable row with an honest label rather than a dead link.
                    */}
                    <ul className="mx-5 list-none space-y-2 border-t border-slate-100 pb-1 pl-0 pt-4">
                      {items.map((item) => {
                        const productAvailable = item.productStatus === "published";
                        const row = (
                          <>
                            {item.imageUrl ? (
                              <img
                                src={item.imageUrl}
                                alt=""
                                className={`size-9 shrink-0 rounded-lg border border-slate-100 object-cover ${
                                  productAvailable ? "" : "opacity-60"
                                }`}
                                loading="lazy"
                              />
                            ) : (
                              <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-slate-50">
                                <ImageOff className="size-3.5 text-slate-300" />
                              </span>
                            )}
                            <span className="min-w-0">
                              <span className="block truncate text-slate-600">{item.productName}</span>
                              {item.variantName && (
                                <span className="block truncate text-xs text-slate-400">{item.variantName}</span>
                              )}
                              {!productAvailable && (
                                <span className="block truncate text-xs text-amber-600">
                                  {t("orderDetail.productUnavailable")}
                                </span>
                              )}
                            </span>
                          </>
                        );
                        return (
                          <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
                            {productAvailable ? (
                              <Link
                                to={`/products/${item.productId}`}
                                className="flex min-w-0 items-center gap-2.5 transition-colors hover:text-[#10B981]"
                              >
                                {row}
                              </Link>
                            ) : (
                              <span className="flex min-w-0 items-center gap-2.5">{row}</span>
                            )}
                            <span className="flex shrink-0 items-center gap-3">
                              <span className="text-xs text-slate-400">
                                × {item.quantity}
                                {item.unit ? ` ${item.unit}` : ""}
                              </span>
                              <span className="font-medium tabular-nums text-slate-900">
                                {formatBaht(item.subtotal)}
                              </span>
                            </span>
                          </li>
                        );
                      })}
                    </ul>

                    {/*
                        The card's own status, with ITS countdown underneath.

                        Position matters (ORDER UX POLISH): the status and the timer sit
                        together at the bottom-left of THIS card, so it is never ambiguous
                        which order a running clock belongs to. There is one presentation
                        clock for the whole list, and each card derives its own remaining
                        time from its own `paymentExpiresAt` — never a shared deadline.
                      */}
                      <div className="flex flex-wrap items-end justify-between gap-3 border-t border-slate-100 px-5 pb-5 pt-4">
                        <div className="min-w-0">
                          {reservationPhase === "active" && (
                            <>
                              <p
                                role="timer"
                                aria-live="off"
                                className={`flex items-center gap-1.5 text-sm font-semibold tabular-nums ${RESERVATION_TONE_TEXT[tone]}`}
                              >
                                <Clock3 className="size-3.5 shrink-0" />
                                {t("orderReservation.payWithin", {
                                  time: formatPaymentCountdown(reservation.remainingMs),
                                })}
                              </p>

                              {progress !== null && (
                                <div
                                  className="mt-2 max-w-48"
                                  role="progressbar"
                                  aria-valuemin={0}
                                  aria-valuemax={100}
                                  aria-valuenow={Math.round(progress * 100)}
                                  aria-label={t("orderReservation.expiresIn")}
                                >
                                  <div className={`h-1.5 overflow-hidden rounded-full ${RESERVATION_TONE_TRACK[tone]}`}>
                                    <div
                                      className={`h-full rounded-full transition-all duration-1000 ease-linear ${RESERVATION_TONE_FILL[tone]}`}
                                      style={{ width: `${Math.max(1, Math.round(progress * 100))}%` }}
                                    />
                                  </div>
                                </div>
                              )}

                              <p className={`mt-1.5 text-xs font-medium ${RESERVATION_TONE_TEXT[tone]}`}>
                                {reservationNote}
                              </p>
                            </>
                          )}

                          {reservationPhase === "expired" && (
                            /*
                              The dark state the spec asks for: no negative clock,
                              and the "stock returned" sentence only once the
                              backend has actually written `expired`. */
                            <div className="rounded-lg bg-slate-900 px-3 py-2">
                              <p className="flex items-center gap-1.5 text-xs font-semibold text-white">
                                <XCircle className="size-3.5 shrink-0 text-slate-400" />
                                {t("orderReservation.expiredTitle")}
                              </p>
                              {order.status === "expired" && (
                                <p className="mt-1 text-[11px] leading-4 text-slate-300">
                                  {t("orderReservation.expiredDesc")}
                                </p>
                              )}
                            </div>
                          )}
                        </div>

                        <div className="ml-auto text-right">
                          <p className="text-xs text-slate-500">{t("orders.total")}</p>
                          <p className="text-lg font-bold tabular-nums tracking-tight text-slate-900">
                            {formatBaht(order.total)}
                          </p>
                        </div>
                      </div>
                    <div className="flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-slate-200 text-slate-600"
                        asChild
                      >
                        <Link to={`/orders/${order.id}`}>{t("orders.viewDetail")}</Link>
                      </Button>
                      {payability.payable && (
                        <ResumePaymentButton
                          orderId={order.id}
                          // The list carries the newest payment method; it is used
                          // only to PRESELECT the chooser. The customer picks the
                          // rail again (the chooser must be reachable even when
                          // nothing was recorded, which is why the method is
                          // allowed to be null).
                          method={payability.method}
                          returnPath={`/orders/${order.id}`}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
              </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <ShopFooter />
    </div>
  );
}
