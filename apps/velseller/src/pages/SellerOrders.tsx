import { OrderStatusBadge } from "@velnox/shared/components/order/OrderStatusBadge";
import { AppHeader } from "@velnox/shared/components/AppHeader";
import { Button } from "@velnox/shared/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@velnox/shared/components/ui/table";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import {
  formatBaht,
  formatIsoDate,
  formatIsoDateTime,
  orderStatusI18nKey,
  shortOrderNumber,
  type StoreOrder,
  type StoreOrderStatus,
  type StoreSubscription,
} from "@velnox/shared/lib/commerce";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  CalendarClock,
  ChevronRight,
  Inbox,
  Loader2,
  PackageSearch,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The statuses the seller order tab can filter by.
 *
 * These are the SIX fulfilment statuses the backend's own state machine speaks
 * (`SELLER_ORDER_STATUSES` in `backend/routes/seller-orders.ts`), which is exactly
 * what `normalizeSellerOrderStatus()` maps every raw `orders.status` onto. A
 * payment-lifecycle row therefore appears under the fulfilment status it MEANS —
 * `paid` as `pending` (payment state lives in `payments`), `expired` as
 * `cancelled` — so a filter chip can never ask for a status the API would answer
 * with an empty list for.
 *
 * The filter is applied SERVER-SIDE (`GET /api/seller/orders?status=…`), so what
 * is on screen is the real set for that status, never a client-side slice of one
 * page of results presented as if it were everything.
 */
const FILTERABLE_STATUSES: StoreOrderStatus[] = [
  "pending",
  "confirmed",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
];

type StatusFilter = "all" | StoreOrderStatus;

export default function SellerOrders() {
  const { t } = useLanguage();
  const sellerOrdersAction = useAction(api.commerce.sellerOrders);
  const sellerSubscriptionsAction = useAction(api.commerce.sellerSubscriptions);
  const processDue = useAction(api.commerce.processDueSubscriptions);

  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [subscriptions, setSubscriptions] = useState<StoreSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  // "now" captured outside render so subscription due-dates are pure
  const [now, setNow] = useState(0);

  /**
   * The filter the newest in-flight request belongs to. A slow answer for "all"
   * must not overwrite the list the seller is now looking at under "shipped", so a
   * response is dropped unless its own filter is still the selected one.
   */
  const requestFilter = useRef<StatusFilter>("all");

  useEffect(() => {
    const timer = setTimeout(() => setNow(Date.now()), 0);
    return () => clearTimeout(timer);
  }, []);

  const load = useCallback(async () => {
    const filter = statusFilter;
    requestFilter.current = filter;
    const [o, s] = await Promise.all([
      sellerOrdersAction({ limit: 50, status: filter === "all" ? undefined : filter }),
      sellerSubscriptionsAction(),
    ]);
    if (requestFilter.current !== filter) return;
    setOrders(o);
    setSubscriptions(s);
  }, [sellerOrdersAction, sellerSubscriptionsAction, statusFilter]);

  useEffect(() => {
    let alive = true;
    const filter = statusFilter;
    requestFilter.current = filter;
    Promise.all([
      sellerOrdersAction({ limit: 50, status: filter === "all" ? undefined : filter }),
      sellerSubscriptionsAction(),
    ])
      .then(([o, s]) => {
        if (!alive || requestFilter.current !== filter) return;
        setOrders(o);
        setSubscriptions(s);
      })
      .catch((err) => console.error("Load seller orders error:", err))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [sellerOrdersAction, sellerSubscriptionsAction, statusFilter]);

  const handleProcessDue = async () => {
    setProcessing(true);
    try {
      const result = await processDue();
      toast.success(
        result.created > 0
          ? `สร้างออเดอร์รายเดือนแล้ว ${result.created} ออเดอร์${result.skipped > 0 ? ` (ข้าม ${result.skipped} — สต็อกไม่พอ)` : ""}`
          : result.skipped > 0
            ? `ข้าม ${result.skipped} ออเดอร์ (สต็อกไม่พอ)`
            : "ยังไม่มีรอบครบกำหนด",
      );
      await load();
    } catch (error) {
      console.error("Process due subscriptions error:", error);
      toast.error(error instanceof Error ? error.message : "ไม่สำเร็จ กรุณาลองอีกครั้ง");
    } finally {
      setProcessing(false);
    }
  };

  /** Translated label for the order's payment status, falling back to the raw value. */
  const paymentLabel = useCallback(
    (status: string) => {
      const key = `paymentLabels.${status.toLowerCase()}`;
      const value = t(key);
      return value === key ? status : value;
    },
    [t],
  );

  /** Translated label for the shipment status, falling back to the raw value. */
  const trackingLabel = useCallback(
    (status: string) => {
      const key = `trackingLabels.${status.toLowerCase()}`;
      const value = t(key);
      return value === key ? status : value;
    },
    [t],
  );

  const statusFilters = useMemo(() => ["all" as const, ...FILTERABLE_STATUSES], []);
  const itemCountOf = (order: StoreOrder) =>
    order.itemCount ?? (order.items ?? []).reduce((sum, i) => sum + i.quantity, 0);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <AppHeader />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            {t("sellerOrders.eyebrow")}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("sellerOrders.title")}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">{t("sellerOrders.desc")}</p>
        </div>

        {/* Monthly subscriptions (velshop สั่งรายเดือน) */}
        <section className="mt-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-[10px] bg-[#ECFDF5]">
                <CalendarClock className="size-4 text-[#10B981]" />
              </span>
              <div>
                <h2 className="text-base font-semibold text-slate-900">การสั่งรายเดือนของลูกค้า</h2>
                <p className="text-xs text-slate-400">
                  ลูกค้าสมัครรับสินค้าเป็นรอบ — กดสร้างออเดอร์เมื่อถึงรอบครบกำหนด
                </p>
              </div>
            </div>
            <Button
              className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
              onClick={handleProcessDue}
              disabled={processing}
            >
              {processing ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
              สร้างออเดอร์รอบครบกำหนด
            </Button>
          </div>

          {loading ? (
            <div className="mt-3 flex h-20 items-center justify-center rounded-xl border border-slate-200 bg-white">
              <Loader2 className="size-5 animate-spin text-slate-300" />
            </div>
          ) : subscriptions.length === 0 ? (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-5">
              <CalendarClock className="size-5 text-slate-300" />
              <p className="text-sm text-slate-500">ยังไม่มีลูกค้าสมัครสั่งรายเดือน</p>
            </div>
          ) : (
            <>
              {/* Desktop: table */}
              <div className="mt-3 hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5 text-slate-400">ลูกค้า</TableHead>
                      <TableHead className="text-slate-400">สินค้า</TableHead>
                      <TableHead className="text-slate-400">รอบ</TableHead>
                      <TableHead className="pr-5 text-right text-slate-400">รอบถัดไป</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {subscriptions.map((sub) => {
                      const due = new Date(`${sub.nextOrderDate}T00:00:00`).getTime() - now;
                      return (
                        <TableRow key={sub.id} className="hover:bg-slate-50/60">
                          <TableCell className="pl-5">
                            <p className="font-medium text-slate-900">{sub.customerName || "สมาชิก"}</p>
                            <p className="text-xs text-slate-400">{sub.customerEmail ?? "—"}</p>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm text-slate-600">
                              {sub.productName ?? "สินค้าถูกลบ"}{" "}
                              <span className="text-slate-400">× {sub.quantity}</span>
                            </p>
                          </TableCell>
                          <TableCell>
                            <p className="text-sm text-slate-600">ทุก {sub.intervalDays} วัน</p>
                          </TableCell>
                          <TableCell className="pr-5 text-right">
                            <p className="text-sm text-slate-600">{formatIsoDate(sub.nextOrderDate)}</p>
                            <p className={`text-xs ${due <= 0 ? "font-medium text-rose-600" : "text-slate-400"}`}>
                              {due <= 0 ? "ถึงรอบแล้ว" : `อีก ${Math.max(0, Math.round(due / DAY_MS))} วัน`}
                            </p>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile: app-like subscription cards */}
              <div className="mt-3 space-y-3 md:hidden">
                {subscriptions.map((sub) => {
                  const due = new Date(`${sub.nextOrderDate}T00:00:00`).getTime() - now;
                  return (
                    <div
                      key={sub.id}
                      className="rounded-xl border border-slate-200 bg-white p-4 transition-all duration-200 active:scale-[0.99]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {sub.customerName || "สมาชิก"}
                          </p>
                          <p className="mt-0.5 truncate text-xs text-slate-400">{sub.customerEmail ?? "—"}</p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium ${
                            due <= 0
                              ? "bg-rose-50 text-rose-600"
                              : "bg-slate-100 text-slate-500"
                          }`}
                        >
                          {due <= 0 ? "ถึงรอบแล้ว" : `อีก ${Math.max(0, Math.round(due / DAY_MS))} วัน`}
                        </span>
                      </div>

                      <div className="mt-3 rounded-[10px] bg-slate-50 px-3 py-2.5 text-sm">
                        <p className="truncate text-slate-700">
                          {sub.productName ?? "สินค้าถูกลบ"}{" "}
                          <span className="text-slate-400">× {sub.quantity}</span>
                        </p>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <p className="text-xs text-slate-400">รอบ: ทุก {sub.intervalDays} วัน</p>
                        <p className="text-xs font-medium text-slate-700">
                          ถัดไป {formatIsoDate(sub.nextOrderDate)}
                        </p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </section>

        {/* ── Customer orders ──────────────────────────────────────────────── */}
        <section className="mt-8">
          <h2 className="text-base font-semibold text-slate-900">{t("sellerOrders.listTitle")}</h2>

          {/*
            Status filters. The chip labels come from `orderStatus.*` — the SAME copy
            the badges below use — so the selected chip and the badge on a row can
            never disagree about what a status is called. Status is carried by the
            text, not by the colour of the chip.
          */}
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("sellerOrders.colStatus")}>
            {statusFilters.map((value) => {
              const active = statusFilter === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setStatusFilter(value)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900"
                  }`}
                >
                  {value === "all" ? t("sellerOrders.filterAll") : t(orderStatusI18nKey(value))}
                </button>
              );
            })}
          </div>

          {loading ? (
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl border border-slate-200 bg-white" />
              ))}
            </div>
          ) : orders.length === 0 ? (
            <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-[#ECFDF5]">
                {statusFilter === "all" ? (
                  <Inbox className="size-7 text-[#10B981]" />
                ) : (
                  <PackageSearch className="size-7 text-[#10B981]" />
                )}
              </span>
              <h2 className="mt-5 text-lg font-semibold text-slate-900">
                {t(statusFilter === "all" ? "sellerOrders.noOrdersTitle" : "sellerOrders.noOrdersFiltered")}
              </h2>
              <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">
                {t("sellerOrders.noOrdersDesc")}
              </p>
            </div>
          ) : (
            <>
              {/* ── Desktop: one readable table, one row per order ───────────── */}
              <div className="mt-4 hidden overflow-x-auto rounded-xl border border-slate-200 bg-white lg:block">
                <Table className="min-w-[960px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead className="pl-5 text-slate-400">{t("sellerOrders.colOrder")}</TableHead>
                      <TableHead className="text-slate-400">{t("sellerOrders.colCustomer")}</TableHead>
                      <TableHead className="text-slate-400">{t("sellerOrders.colItems")}</TableHead>
                      <TableHead className="text-slate-400">{t("sellerOrders.colPayment")}</TableHead>
                      <TableHead className="text-slate-400">{t("sellerOrders.colShipping")}</TableHead>
                      <TableHead className="text-right text-slate-400">{t("sellerOrders.colTotal")}</TableHead>
                      <TableHead className="text-slate-400">{t("sellerOrders.colStatus")}</TableHead>
                      <TableHead className="pr-5 text-right text-slate-400">
                        {t("sellerOrders.colUpdated")}
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id} className="hover:bg-slate-50/60">
                        <TableCell className="pl-5">
                          <Link
                            to={`/seller/orders/${order.id}`}
                            className="font-medium tabular-nums text-slate-900 underline-offset-4 transition-colors hover:text-[#10B981] hover:underline"
                          >
                            {shortOrderNumber(order.orderNumber)}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm text-slate-700">{order.customerName || "—"}</p>
                          <p className="text-xs text-slate-400">{order.customerPhone || "—"}</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm text-slate-600">
                            {t("sellerOrders.itemCount", { count: itemCountOf(order) })}
                          </p>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm text-slate-600">{paymentLabel(order.paymentStatus)}</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm text-slate-600">{trackingLabel(order.shippingStatus)}</p>
                        </TableCell>
                        <TableCell className="text-right">
                          <p className="text-sm font-semibold tabular-nums text-slate-900">
                            {formatBaht(order.total)}
                          </p>
                        </TableCell>
                        <TableCell>
                          <OrderStatusBadge status={order.status} label={t(orderStatusI18nKey(order.status))} />
                        </TableCell>
                        <TableCell className="pr-5 text-right">
                          <p className="text-xs text-slate-400">{formatIsoDateTime(order.updatedAt)}</p>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* ── Mobile / tablet: the same order, as a tappable card ──────── */}
              <div className="mt-4 space-y-3 lg:hidden">
                {orders.map((order) => (
                  <Link
                    key={order.id}
                    to={`/seller/orders/${order.id}`}
                    className="block rounded-xl border border-slate-200 bg-white p-4 transition-all duration-200 active:scale-[0.99]"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold tabular-nums text-slate-900">
                          {shortOrderNumber(order.orderNumber)}
                        </p>
                        <p className="mt-0.5 text-xs text-slate-400">
                          {formatIsoDate(order.createdAt)} ·{" "}
                          {t("sellerOrders.itemCount", { count: itemCountOf(order) })}
                        </p>
                      </div>
                      <OrderStatusBadge status={order.status} label={t(orderStatusI18nKey(order.status))} />
                    </div>

                    <dl className="mt-3 space-y-1 border-t border-slate-100 pt-3 text-sm">
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-400">{t("sellerOrders.customerTitle")}</dt>
                        <dd className="min-w-0 truncate font-medium text-slate-700">
                          {order.customerName || "—"}
                        </dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-400">{t("sellerOrders.colPayment")}</dt>
                        <dd className="text-slate-600">{paymentLabel(order.paymentStatus)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-400">{t("sellerOrders.colShipping")}</dt>
                        <dd className="text-slate-600">{trackingLabel(order.shippingStatus)}</dd>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <dt className="text-slate-400">{t("sellerOrders.colTotal")}</dt>
                        <dd className="font-semibold tabular-nums text-slate-900">
                          {formatBaht(order.total)}
                        </dd>
                      </div>
                    </dl>

                    <p className="mt-3 flex items-center justify-end gap-1 text-xs font-medium text-[#10B981]">
                      {t("sellerOrders.openOrder")}
                      <ChevronRight className="size-3.5" />
                    </p>
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}
