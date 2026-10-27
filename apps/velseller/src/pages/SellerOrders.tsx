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
} from "@velnox/shared/lib/commerce";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  AlertTriangle,
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
  "packing",
  "shipped",
  "delivered",
  "completed",
  "cancelled",
];

type StatusFilter = "all" | StoreOrderStatus;

/** One page of the seller's order queue (the server caps `limit` at 100). */
const PAGE_SIZE = 20;

/** `GET /api/seller/orders?paginated=1` */
interface SellerOrdersPage {
  orders: StoreOrder[];
  pagination?: { limit: number; offset: number; total: number; hasMore: boolean };
}

export default function SellerOrders() {
  const { t } = useLanguage();
  const sellerOrdersAction = useAction(api.commerce.sellerOrdersPaged);

  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  /** A failed request is an error state — not "you have no orders". */
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  /** Pagination: the queue grows page by page instead of stopping at the first 50. */
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const loadingMoreRef = useRef(false);
  /** The rows currently rendered — read by `loadMore` without a dependency edge. */
  const ordersRef = useRef<StoreOrder[]>([]);

  /**
   * The filter the newest in-flight request belongs to. A slow answer for "all"
   * must not overwrite the list the seller is now looking at under "shipped", so a
   * response is dropped unless its own filter is still the selected one.
   */
  const requestFilter = useRef<StatusFilter>("all");
  /** Sequence number: a stale response of the SAME filter is dropped too. */
  const loadSeqRef = useRef(0);

  /**
   * First page (or a refresh / a filter change). Always starts at offset 0, so a
   * filter change resets pagination instead of appending the new filter's first
   * page onto the previous filter's rows.
   */
  const load = useCallback(async () => {
    const filter = statusFilter;
    requestFilter.current = filter;
    const seq = ++loadSeqRef.current;
    setError(false);
    try {
      const page = (await sellerOrdersAction({
        limit: PAGE_SIZE,
        offset: 0,
        status: filter === "all" ? undefined : filter,
      })) as SellerOrdersPage | null;
      if (requestFilter.current !== filter || seq !== loadSeqRef.current) return;
      setOrders(page?.orders ?? []);
      setHasMore(Boolean(page?.pagination?.hasMore));
    } catch (err) {
      if (requestFilter.current !== filter || seq !== loadSeqRef.current) return;
      console.error("Load seller orders error:", err);
      setError(true);
    }
  }, [sellerOrdersAction, statusFilter]);

  /**
   * Next page for the CURRENT filter. A ref guards double taps, and the filter +
   * sequence checks make sure a page that arrives after the seller switched
   * filters (or refreshed) is thrown away rather than mixed into the new list.
   */
  const loadMore = useCallback(async () => {
    if (loadingMoreRef.current || !hasMore) return;
    const filter = statusFilter;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const seq = loadSeqRef.current;
    try {
      const page = (await sellerOrdersAction({
        limit: PAGE_SIZE,
        offset: ordersRef.current.length,
        status: filter === "all" ? undefined : filter,
      })) as SellerOrdersPage | null;
      if (requestFilter.current !== filter || seq !== loadSeqRef.current) return;
      const next = page?.orders ?? [];
      // Deduplicate by order id: a row that shifted between requests must not
      // appear twice.
      setOrders((prev) => {
        const seen = new Set(prev.map((o) => o.id));
        return [...prev, ...next.filter((o) => !seen.has(o.id))];
      });
      setHasMore(Boolean(page?.pagination?.hasMore));
      setError(false);
    } catch (err) {
      if (requestFilter.current !== filter || seq !== loadSeqRef.current) return;
      console.error("Load more seller orders error:", err);
      setError(true);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [sellerOrdersAction, statusFilter, hasMore]);

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

  ordersRef.current = orders;

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

          {/* Stale data + failed refresh: keep the rows, flag the failure. */}
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
            <div className="mt-4 space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="h-16 animate-pulse rounded-xl border border-slate-200 bg-white" />
              ))}
            </div>
          ) : error && orders.length === 0 ? (
            <div className="mt-6 flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-50">
                <AlertTriangle className="size-7 text-amber-600" />
              </span>
              <h2 className="mt-5 text-lg font-semibold text-slate-900">{t("common.error")}</h2>
              <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">{t("sellerOrders.desc")}</p>
              <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={retry}>
                <RefreshCw className="size-4" />
                {t("common.retry")}
              </Button>
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

              {/* Next page of the queue (same filter). */}
              {hasMore && (
                <div className="mt-6 flex justify-center">
                  <Button
                    variant="outline"
                    className="min-w-44 gap-1.5 border-slate-200 text-slate-700"
                    onClick={() => void loadMore()}
                    disabled={loadingMore}
                  >
                    {loadingMore ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    {loadingMore ? t("common.loadingMore") : t("common.loadMore")}
                  </Button>
                </div>
              )}
              {!hasMore && orders.length > PAGE_SIZE && (
                <p className="mt-6 text-center text-xs text-slate-400">{t("common.allLoaded")}</p>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
