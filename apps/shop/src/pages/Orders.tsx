import { Link } from "react-router";
import { useEffect, useState } from "react";
import { Package, ChevronRight } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { useI18n } from "@velnox/i18n";
import { useAuth } from "@velnox/hooks";
import { ordersApi } from "@velnox/api";
import { formatPrice, formatDate } from "@velnox/utils";
import type { Order } from "@velnox/types";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@velnox/ui/EmptyState";
import { Skeleton } from "@velnox/ui/Skeleton";

const statusColors: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-800",
  confirmed: "bg-blue-100 text-blue-800",
  processing: "bg-purple-100 text-purple-800",
  shipped: "bg-indigo-100 text-indigo-800",
  delivered: "bg-green-100 text-green-800",
  cancelled: "bg-red-100 text-red-800",
};

export default function Orders() {
  const { t } = useI18n();
  const { isAuthenticated } = useAuth();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    ordersApi
      .list()
      .then((res: { orders: Order[] }) => setOrders(res.orders))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <Layout>
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <h1 className="text-2xl font-bold mb-2">{t("common.orders")}</h1>
          <p className="text-muted-foreground mb-6">{t("common.login")}</p>
          <Link to="/auth">
            <Button>{t("common.login")}</Button>
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold tracking-tight mb-8">{t("common.order_history")}</h1>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/60 p-6 space-y-3">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-24" />
              </div>
            ))}
          </div>
        ) : orders.length === 0 ? (
          <EmptyState
            icon={<Package className="h-8 w-8 text-muted-foreground/40" />}
            title={t("common.no_orders")}
            description={t("common.continue_shopping")}
            action={
              <Link to="/products">
                <Button>{t("common.browse_products")}</Button>
              </Link>
            }
          />
        ) : (
          <div className="space-y-4">
            {orders.map((order) => (
              <Link key={order.id} to={`/orders/${order.id}`} className="block rounded-xl border border-border/60 p-6 hover:border-accent/30 hover:shadow-sm transition-all">
                <div className="flex items-center justify-between">
                  <div className="space-y-1">
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-medium">#{order.id.slice(0, 8)}</p>
                      <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${statusColors[order.status] || ""}`}>
                        {t(`common.${order.status}`)}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{formatDate(order.createdAt)}</p>
                    <p className="text-base font-semibold">{formatPrice(order.totalAmount, order.currency as "THB")}</p>
                  </div>
                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
