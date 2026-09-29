import { ResumePaymentButton } from "@/components/shop/ResumePaymentButton";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
import { OrderStatusBadge } from "@velnox/shared/components/order/OrderStatusBadge";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@velnox/shared/components/ui/select";
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
  type StoreSubscription,
} from "@velnox/shared/lib/commerce";
import {
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
  subscriptions: StoreSubscription[];
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
  const mySubscriptionsAction = useAction(api.commerce.mySubscriptions);
  const pauseSubscription = useAction(api.commerce.pauseSubscription);
  const stripePaymentStatus = useAction(api.stripe.stripePaymentStatusAction);
  const [searchParams, setSearchParams] = useSearchParams();

  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [repeatOrder, setRepeatOrder] = useState<StoreOrder | null>(null);
  const [repeatUnit, setRepeatUnit] = useState<"days" | "weeks" | "months">("days");
  const [repeatValue, setRepeatValue] = useState(30);
  const [repeating, setRepeating] = useState(false);
  const repeatOrderNow = useAction(api.commerce.repeatOrderNow);

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
    const [orders, subscriptions] = await Promise.all([
      myOrdersAction({ limit: 50 }),
      mySubscriptionsAction(),
    ]);
    setData({ orders, subscriptions });
  }, [myOrdersAction, mySubscriptionsAction]);

  useEffect(() => {
    let alive = true;
    Promise.all([myOrdersAction({ limit: 50 }), mySubscriptionsAction()])
      .then(([orders, subscriptions]) => alive && setData({ orders, subscriptions }))
      .catch((err) => console.error("Load orders error:", err))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [myOrdersAction, mySubscriptionsAction]);

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
  const subscriptions = data?.subscriptions ?? [];

  /** Is any order still counting down? Only then does the clock need to tick. */
  const hasOpenReservation = useMemo(
    () =>
      orders.some((order: StoreOrder) => {
        const phase = paymentReservationPhase(order, now);
        return phase === "active" || phase === "urgent";
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

  const handleRepeat = async () => {
    if (!repeatOrder || repeating) return;
    setRepeating(true);
    try {
      await repeatOrderNow({
        orderId: repeatOrder.id,
        frequencyType: repeatUnit,
        intervalValue: repeatValue,
      });
      toast.success(t("velrepeatPlan.repeatSuccess"));
      setRepeatOrder(null);
    } catch (error) {
      console.error("Repeat order error:", error);
      toast.error(error instanceof Error ? error.message : t("velrepeatPlan.repeatFailed"));
    } finally {
      setRepeating(false);
    }
  };

  const handleCancel = async (subscriptionId: string) => {
    setCancellingId(subscriptionId);
    try {
      await pauseSubscription({ subscriptionId, status: "cancelled" });
      toast.success(t("orders.cancelSuccess"));
      await load();
    } catch (error) {
      console.error("Cancel subscription error:", error);
      toast.error(t("orders.cancelFailed"));
    } finally {
      setCancellingId(null);
    }
  };

  const daysLeft = useMemo(
    () => (nextOrderDate: string) => {
      const diff = new Date(`${nextOrderDate}T00:00:00`).getTime() - Date.now();
      return Math.max(0, Math.round(diff / (24 * 60 * 60 * 1000)));
    },
    [],
  );

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

        {/* Monthly subscriptions */}
        <section className="mt-8">
          <div className="flex items-center gap-2">
            <span className="flex size-8 items-center justify-center rounded-[10px] bg-[#ECFDF5]">
              <CalendarClock className="size-4 text-[#10B981]" />
            </span>
            <h2 className="text-base font-semibold text-slate-900">{t("orders.monthlyTitle")}</h2>
          </div>

          {loading ? (
            <div className="mt-3 flex h-20 items-center justify-center rounded-xl border border-slate-200 bg-white">
              <Loader2 className="size-5 animate-spin text-slate-300" />
            </div>
          ) : subscriptions.length === 0 ? (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-5">
              <CalendarClock className="size-5 text-slate-300" />
              <p className="text-sm text-slate-500">{t("orders.monthlyEmpty")}</p>
            </div>
          ) : (
            <div className="mt-3 space-y-3">
              {subscriptions.map((sub) => (
                <div
                  key={sub.id}
                  className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    {sub.productImageUrl ? (
                      <img
                        src={sub.productImageUrl}
                        alt=""
                        className="size-12 shrink-0 rounded-[10px] object-cover"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex size-12 shrink-0 items-center justify-center rounded-[10px] bg-slate-100">
                        <ImageOff className="size-5 text-slate-300" />
                      </span>
                    )}
                    <div>
                      <p className="text-sm font-semibold text-slate-900">
                        {sub.productName ?? t("orders.productDeleted")}{" "}
                        <span className="font-normal text-slate-400">× {sub.quantity}</span>
                      </p>
                      <p className="mt-1 text-xs text-slate-400">
                        {t("orders.every", {
                          days: sub.intervalDays,
                          date: formatIsoDate(sub.nextOrderDate),
                          left: daysLeft(sub.nextOrderDate),
                        })}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      className={`gap-1.5 rounded-full ring-1 ring-inset ${
                        sub.status === "active"
                          ? "bg-emerald-50 text-emerald-700 ring-emerald-600/15"
                          : "bg-slate-100 text-slate-500 ring-slate-600/10"
                      }`}
                    >
                      <span
                        className={`size-1.5 rounded-full ${
                          sub.status === "active" ? "bg-emerald-500" : "bg-slate-400"
                        }`}
                      />
                      {sub.status === "active" ? t("orders.active") : t("orders.cancelled")}
                    </Badge>
                    {sub.status === "active" && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-slate-200 text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600"
                        onClick={() => handleCancel(sub.id)}
                        disabled={cancellingId === sub.id}
                      >
                        {cancellingId === sub.id ? (
                          <Loader2 className="size-3.5 animate-spin" />
                        ) : (
                          <XCircle className="size-3.5" />
                        )}
                        {t("orders.cancel")}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Order history */}
        <section className="mt-8">
          <h2 className="text-base font-semibold text-slate-900">{t("orders.historyTitle")}</h2>

          {loading ? (
            <div className="mt-8 space-y-4">
              {Array.from({ length: 2 }).map((_, i) => (
                <div key={i} className="h-36 animate-pulse rounded-xl border border-slate-200 bg-white" />
              ))}
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
              {orders.map((order: StoreOrder) => {
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
                          {(reservationPhase === "active" || reservationPhase === "urgent") && (
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
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1.5 border-[#10B981]/30 bg-[#F0FDF9] text-[#10B981] hover:bg-[#D1FAE5]"
                        onClick={() => {
                          setRepeatUnit("days");
                          setRepeatValue(30);
                          setRepeatOrder(order);
                        }}
                      >
                        <RefreshCw className="size-3.5" />
                        {t("velrepeatPlan.repeatOrder")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </main>

      {/* VelRepeat repeat-now dialog */}
      <Dialog open={repeatOrder !== null} onOpenChange={(open) => { if (!open) setRepeatOrder(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <RefreshCw className="size-4 text-[#10B981]" />
              {t("velrepeatPlan.repeatOrderTitle")}
            </DialogTitle>
            <DialogDescription>{t("velrepeatPlan.repeatOrderDesc")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div>
              <label className="text-xs font-semibold text-slate-600">{t("velrepeatPlan.frequency")}</label>
              <div className="mt-1.5 flex gap-2">
                <Select value={repeatUnit} onValueChange={(v) => setRepeatUnit(v as "days" | "weeks" | "months")}>
                  <SelectTrigger className="w-36 border-slate-200 bg-white">
                    <SelectValue placeholder="days" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="days">{t("velrepeatPlan.unitDay")}</SelectItem>
                    <SelectItem value="weeks">{t("velrepeatPlan.unitWeek")}</SelectItem>
                    <SelectItem value="months">{t("velrepeatPlan.unitMonth")}</SelectItem>
                  </SelectContent>
                </Select>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={repeatValue}
                  onChange={(e) => setRepeatValue(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                  className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#10B981] focus:ring-2 focus:ring-[#10B981]/20"
                  aria-label={t("velrepeatPlan.frequency")}
                />
              </div>
              <p className="mt-1.5 text-xs text-slate-500">
                {repeatUnit === "days"
                  ? t("velrepeatPlan.everyDays", { count: repeatValue })
                  : repeatUnit === "weeks"
                    ? t("velrepeatPlan.everyWeeks", { count: repeatValue })
                    : t("velrepeatPlan.everyMonths", { count: repeatValue })}
              </p>
            </div>
          </div>

          <DialogFooter className="gap-2 sm:justify-end">
            <Button variant="outline" onClick={() => setRepeatOrder(null)} className="border-slate-200 text-slate-700">
              {t("common.cancel")}
            </Button>
            <Button
              className="gap-1.5 bg-[#10B981] text-white hover:bg-emerald-600"
              onClick={handleRepeat}
              disabled={repeating || repeatValue <= 0}
            >
              {repeating && <Loader2 className="size-4 animate-spin" />}
              {repeating ? t("velrepeatPlan.creating") : t("velrepeatPlan.start")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShopFooter />
    </div>
  );
}
