/**
 * MVP order history: `/orders`.
 *
 * `GET /api/mvp/orders` is scoped to the session's own user inside the backend
 * query — the page cannot ask for somebody else's orders, and it never filters
 * by a user id it holds in the browser.
 */
import { Button } from "@velnox/shared/components/ui/button";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { getMvpApi } from "@velnox/shared/mvp";
import { MvpEmpty, MvpErrorState, MvpLoading, formatDate, formatMoney, useMvpQuery } from "@velnox/shared/mvp/ui";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { OrderStatusBadge } from "./components";

export default function OrdersPage() {
  const { t } = useLanguage();
  const orders = useMvpQuery(() => getMvpApi().orders.list(), []);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">{t("orders.title")}</h1>
        <p className="mt-1 text-sm text-slate-500">{t("orders.desc")}</p>
      </div>

      {orders.loading ? (
        <MvpLoading label={t("common.loading")} />
      ) : orders.error ? (
        <MvpErrorState error={orders.error} onRetry={orders.reload} />
      ) : (orders.data ?? []).length === 0 ? (
        <MvpEmpty title={t("orders.emptyTitle")} description={t("orders.emptyDesc")}>
          <Button asChild className="bg-[#10B981] text-white hover:bg-[#059669]">
            <Link to="/products">{t("orders.goShopping")}</Link>
          </Button>
        </MvpEmpty>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {(orders.data ?? []).map((order) => (
            <Link
              key={order.id}
              to={`/orders/${encodeURIComponent(order.id)}`}
              className="flex items-center gap-3 border-b border-slate-100 p-4 last:border-b-0 hover:bg-slate-50"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-bold text-slate-900">{order.order_number}</p>
                  <OrderStatusBadge status={order.status} />
                </div>
                <p className="mt-1 truncate text-xs text-slate-500">
                  {order.store_name} · {order.item_count} item{order.item_count === 1 ? "" : "s"} ·{" "}
                  {formatDate(order.created_at)}
                </p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-slate-900">
                  {formatMoney(order.total_amount, order.currency)}
                </p>
              </div>
              <ChevronRight className="size-4 shrink-0 text-slate-300" />
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
