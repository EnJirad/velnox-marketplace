import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
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
  ORDER_STATUS_META,
  formatBaht,
  formatIsoDate,
  formatIsoDateTime,
  shortOrderNumber,
  type StoreOrder,
  type StoreSubscription,
} from "@velnox/shared/lib/commerce";
import {
  CalendarClock,
  ImageOff,
  Loader2,
  PackageSearch,
  RefreshCw,
  ShoppingBag,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { toast } from "sonner";

interface Loaded {
  orders: StoreOrder[];
  subscriptions: StoreSubscription[];
}

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

  const orders = data?.orders ?? [];
  const subscriptions = data?.subscriptions ?? [];

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
                const meta = ORDER_STATUS_META[order.status];
                const items = order.items ?? [];
                return (
                  <div
                    key={order.id}
                    className="rounded-xl border border-slate-200 bg-white transition-all duration-200 hover:-translate-y-0.5 hover:border-[#10B981]/40 hover:shadow-[0_12px_30px_rgba(15,23,42,0.06)]"
                  >
                    <Link to={`/orders/${order.id}`} className="block p-5">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-slate-900">
                            {t("orders.orderNo", { no: shortOrderNumber(order.orderNumber) })}
                          </p>
                          <p className="mt-0.5 text-xs text-slate-400">
                            {formatIsoDateTime(order.createdAt)} ·{" "}
                            {t("orders.pieces", {
                              count: order.itemCount ?? items.reduce((s, i) => s + i.quantity, 0),
                            })}
                          </p>
                        </div>
                        <Badge className={`gap-1.5 rounded-full ring-1 ring-inset ${meta.badge}`}>
                          <span className={`size-1.5 rounded-full ${meta.dot}`} />
                          {meta.label}
                        </Badge>
                      </div>

                      <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                        {items.map((item) => (
                          <div key={item.id} className="flex items-center justify-between gap-3 text-sm">
                            <span className="flex min-w-0 items-center gap-2.5">
                              {item.imageUrl ? (
                                <img
                                  src={item.imageUrl}
                                  alt=""
                                  className="size-9 shrink-0 rounded-lg border border-slate-100 object-cover"
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
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-3">
                              <span className="text-xs text-slate-400">
                                × {item.quantity}
                                {item.unit ? ` ${item.unit}` : ""}
                              </span>
                              <span className="font-medium tabular-nums text-slate-900">
                                {formatBaht(item.subtotal)}
                              </span>
                            </span>
                          </div>
                        ))}
                      </div>

                      <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                        <span className="text-sm text-slate-500">{t("orders.total")}</span>
                        <span className="text-lg font-bold tabular-nums tracking-tight text-slate-900">
                          {formatBaht(order.total)}
                        </span>
                        <span className="text-xs font-medium text-[#10B981]">{t("orders.viewDetail")}</span>
                      </div>
                    </Link>
                    <div className="flex items-center justify-end gap-2 border-t border-slate-100 px-5 py-3">
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
