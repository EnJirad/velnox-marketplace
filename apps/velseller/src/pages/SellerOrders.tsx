import { OrderStatusBadge } from "@velnox/shared/components/order/OrderStatusBadge";
import { AppHeader } from "@velnox/shared/components/AppHeader";
import { Button } from "@velnox/shared/components/ui/button";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@velnox/shared/components/ui/table";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import {
  formatBaht, formatIsoDate, formatIsoDateTime,
  orderStatusI18nKey, shortOrderNumber,
  type StoreOrder, type StoreOrderStatus,
} from "@velnox/shared/lib/commerce";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  AlertTriangle, ChevronRight, Inbox, Loader2, RefreshCw, Search,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

const DAY_MS = 24 * 60 * 60 * 1000;
const FILTERABLE_STATUSES: StoreOrderStatus[] = [
  "pending", "confirmed", "packing", "shipped", "delivered", "completed", "cancelled",
];
type StatusFilter = "all" | StoreOrderStatus;
const PAGE_SIZE = 20;

interface SellerOrdersPage {
  orders: StoreOrder[];
  pagination?: { limit: number; offset: number; total: number; hasMore: boolean };
}

export default function SellerOrders() {
  const { t } = useLanguage();
  const sellerOrdersAction = useAction(api.commerce.sellerOrdersPaged);
  const [orders, setOrders] = useState<StoreOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const requestFilter = useRef<StatusFilter>("all");
  const loadSeqRef = useRef(0);

  const load = useCallback(async () => {
    const filter = statusFilter;
    requestFilter.current = filter;
    const seq = ++loadSeqRef.current;
    setError(false);
    try {
      const page = await sellerOrdersAction({ limit: PAGE_SIZE, offset: 0, status: filter === "all" ? undefined : filter }) as SellerOrdersPage | null;
      if (requestFilter.current !== filter || seq !== loadSeqRef.current) return;
      setOrders(page?.orders ?? []);
      setHasMore(Boolean(page?.pagination?.hasMore));
    } catch { setError(true); }
  }, [sellerOrdersAction, statusFilter]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    const filter = statusFilter;
    setLoadingMore(true);
    const seq = loadSeqRef.current;
    try {
      const page = await sellerOrdersAction({ limit: PAGE_SIZE, offset: orders.length, status: filter === "all" ? undefined : filter }) as SellerOrdersPage | null;
      if (requestFilter.current !== filter || seq !== loadSeqRef.current) return;
      const next = page?.orders ?? [];
      setOrders((prev) => { const seen = new Set(prev.map(o => o.id)); return [...prev, ...next.filter(o => !seen.has(o.id))]; });
      setHasMore(Boolean(page?.pagination?.hasMore));
    } catch { setError(true); }
    finally { setLoadingMore(false); }
  }, [sellerOrdersAction, statusFilter, hasMore, orders.length, loadingMore]);

  useEffect(() => { void load().finally(() => setLoading(false)); }, [load]);

  const statusFilters: (StatusFilter)[] = ["all", ...FILTERABLE_STATUSES];
  const itemCountOf = (o: StoreOrder) => o.itemCount ?? (o.items ?? []).reduce((s, i) => s + i.quantity, 0);
  const activeOrderCount = useMemo(() => orders.filter(o => !["completed", "cancelled", "delivered"].includes(o.status)).length, [orders]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-slate-400">{t("sellerOrders.eyebrow")}</p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{t("sellerOrders.title")}</h1>
          </div>
          {activeOrderCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-600/15">
              <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
              {activeOrderCount} {t("sellerOrders.active")}
            </span>
          )}
        </div>

        <section className="mt-6">
          {/* Status filter chips + Search bar */}
          <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("sellerOrders.filterAll") + "..."}
                className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100"
              />
            </div>
            <Button variant="outline" size="sm" className="shrink-0 border-slate-200 text-slate-600 h-10"
              onClick={() => { setLoading(true); void load().finally(() => setLoading(false)); }}>
              <RefreshCw className="mr-1.5 size-3.5" /> {t("common.refresh")}
            </Button>
          </div>

          {/* Status filter chips — horizontally scrollable on mobile */}
          <div className="mt-4 flex gap-2 overflow-x-auto pb-2" role="group" aria-label={t("sellerOrders.colStatus")}>
            {statusFilters.map((v) => {
              const active = statusFilter === v;
              return (
                <button key={v} type="button" aria-pressed={active}
                  onClick={() => setStatusFilter(v)}
                  className={`shrink-0 rounded-full px-4 py-2 text-xs font-medium transition-all ${
                    active ? "bg-slate-900 text-white shadow-sm" : "border border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                  }`}
                >
                  {v === "all" ? t("sellerOrders.filterAll") : t(orderStatusI18nKey(v))}
                </button>
              );
            })}
          </div>

          {/* Error bar (stale data preserved) */}
          {!loading && error && orders.length > 0 && (
            <div className="mt-4 flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
              <AlertTriangle className="size-4 shrink-0 text-amber-600" />
              <p className="text-sm text-amber-800">{t("common.error")}</p>
              <button onClick={() => { setLoading(true); void load().finally(() => setLoading(false)); }}
                className="ml-auto shrink-0 rounded-full border border-amber-300 px-3 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100"
              >{t("common.retry")}</button>
            </div>
          )}

          {/* Loading */}
          {loading && (
            <div className="mt-4 space-y-3">
              {[...Array(5)].map((_, i) => <div key={i} className="h-16 animate-pulse rounded-xl border border-slate-200 bg-white" />)}
            </div>
          )}

          {/* Error — no data */}
          {!loading && error && orders.length === 0 && (
            <div className="mt-8 flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-50"><AlertTriangle className="size-7 text-amber-600" /></span>
              <h2 className="mt-4 text-lg font-semibold text-slate-900">{t("common.error")}</h2>
              <p className="mt-1 text-sm text-slate-500">{t("sellerOrders.desc")}</p>
              <Button className="mt-6 bg-slate-900 text-white hover:bg-slate-800" onClick={() => { setLoading(true); void load().finally(() => setLoading(false)); }}>
                <RefreshCw className="mr-1.5 size-4" />{t("common.retry")}
              </Button>
            </div>
          )}

          {/* Empty */}
          {!loading && !error && orders.length === 0 && (
            <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-50"><Inbox className="size-7 text-emerald-500" /></span>
              <h2 className="mt-4 text-lg font-semibold text-slate-900">
                {t(statusFilter === "all" ? "sellerOrders.noOrdersTitle" : "sellerOrders.noOrdersFiltered")}
              </h2>
              <p className="mt-1 text-sm text-slate-500">{t("sellerOrders.noOrdersDesc")}</p>
            </div>
          )}

          {/* Order list */}
          {!loading && !error && orders.length > 0 && (
            <>
              {/* Desktop — clean table with status strip */}
              <div className="mt-4 hidden overflow-hidden rounded-xl border border-slate-200 bg-white lg:block">
                <Table className="min-w-[960px]">
                  <TableHeader>
                    <TableRow className="bg-slate-50/80 hover:bg-slate-50/80">
                      <TableHead className="pl-5 text-xs font-semibold uppercase tracking-wider text-slate-500">{t("sellerOrders.colOrder")}</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("sellerOrders.colCustomer")}</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("sellerOrders.colItems")}</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("sellerOrders.colTotal")}</TableHead>
                      <TableHead className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t("sellerOrders.colStatus")}</TableHead>
                      <TableHead className="pr-5 text-right text-xs font-semibold uppercase tracking-wider text-slate-500">{t("sellerOrders.colUpdated")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {orders.map((order) => (
                      <TableRow key={order.id} className="group cursor-pointer hover:bg-slate-50" onClick={() => window.location.href = `/seller/orders/${order.id}`}>
                        <TableCell className="pl-5">
                          <p className="font-semibold tabular-nums text-slate-900 group-hover:text-emerald-700 transition-colors">{shortOrderNumber(order.orderNumber)}</p>
                        </TableCell>
                        <TableCell>
                          <p className="text-sm text-slate-700">{order.customerName || "—"}</p>
                          <p className="text-xs text-slate-400">{order.customerPhone || ""}</p>
                        </TableCell>
                        <TableCell className="text-sm text-slate-600">{t("sellerOrders.itemCount", { count: itemCountOf(order) })}</TableCell>
                        <TableCell className="font-semibold tabular-nums text-slate-900">{formatBaht(order.total)}</TableCell>
                        <TableCell><OrderStatusBadge status={order.status} label={t(orderStatusI18nKey(order.status))} /></TableCell>
                        <TableCell className="pr-5 text-right text-xs text-slate-400">{formatIsoDateTime(order.updatedAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile — card layout with visual status indicator */}
              <div className="mt-4 space-y-3 lg:hidden">
                {orders.map((order) => (
                  <Link key={order.id} to={`/seller/orders/${order.id}`}
                    className="block rounded-xl border border-slate-200 bg-white transition-all hover:border-slate-300 active:scale-[0.99]"
                  >
                    <div className="flex items-center gap-4 p-4">
                      {/* Status color dot */}
                      <div className={`size-2 shrink-0 rounded-full ${
                        order.status === "completed" || order.status === "delivered" ? "bg-emerald-500" :
                        order.status === "cancelled" ? "bg-slate-300" :
                        order.status === "shipped" ? "bg-blue-500" :
                        order.status === "packing" ? "bg-amber-500" :
                        order.status === "pending" || order.status === "confirmed" ? "bg-emerald-400" : "bg-slate-400"
                      }`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="font-semibold tabular-nums text-slate-900">{shortOrderNumber(order.orderNumber)}</p>
                          <OrderStatusBadge status={order.status} label={t(orderStatusI18nKey(order.status))} />
                        </div>
                        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                          <span>{order.customerName || t("sellerOrders.anonymous")}</span>
                          <span>{formatIsoDate(order.createdAt)}</span>
                          <span className="font-semibold text-slate-900">{formatBaht(order.total)}</span>
                          <span>{t("sellerOrders.itemCount", { count: itemCountOf(order) })}</span>
                        </div>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-slate-300" />
                    </div>
                  </Link>
                ))}
              </div>

              {/* Load more */}
              {hasMore && (
                <div className="mt-6 flex justify-center">
                  <Button variant="outline" className="min-w-44 border-slate-200 text-slate-700"
                    onClick={() => void loadMore()} disabled={loadingMore}>
                    {loadingMore ? <Loader2 className="mr-2 size-4 animate-spin" /> : <RefreshCw className="mr-2 size-4" />}
                    {loadingMore ? t("common.loadingMore") : t("common.loadMore")}
                  </Button>
                </div>
              )}
              {!hasMore && orders.length > PAGE_SIZE && (
                <p className="mt-4 text-center text-xs text-slate-400">{t("common.allLoaded")}</p>
              )}
            </>
          )}
        </section>
      </main>
    </div>
  );
}
