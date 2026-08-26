import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { Button } from "@velnox/shared/components/ui/button";
import { useLanguage } from "@/lib/i18n";
import { useCart } from "@/lib/cart";
import { formatBaht } from "@velnox/shared/lib/commerce";
import { apiUrl } from "@velnox/shared/lib/sites";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import {
  CheckCircle2,
  Clock,
  CreditCard,
  Loader2,
  Package,
  ShoppingBag,
  Store,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

interface OrderData {
  id: string;
  orderNumber: string | null;
  status: string;
  subtotal: number;
  shippingFee: number;
  discount: number;
  total: number;
  currency: string;
  items: Array<{
    id: string;
    productName: string;
    quantity: number;
    price: number;
    imageUrl: string | null;
  }>;
  payment: {
    provider: string;
    status: string;
    paidAt: string | null;
  } | null;
  createdAt: string;
}

const STATUS_META: Record<string, { icon: typeof CheckCircle2; color: string; bg: string; labelKey: string }> = {
  paid: { icon: CheckCircle2, color: "text-[#10B981]", bg: "bg-[#ECFDF5]", labelKey: "checkoutSuccess.paid" },
  pending: { icon: Clock, color: "text-amber-500", bg: "bg-amber-50", labelKey: "checkoutSuccess.pending" },
  pending_payment: { icon: Clock, color: "text-amber-500", bg: "bg-amber-50", labelKey: "checkoutSuccess.pendingPayment" },
  cancelled: { icon: XCircle, color: "text-red-500", bg: "bg-red-50", labelKey: "checkoutSuccess.cancelled" },
  payment_failed: { icon: XCircle, color: "text-red-500", bg: "bg-red-50", labelKey: "checkoutSuccess.paymentFailed" },
};

export default function ShopCheckoutSuccess() {
  const { t } = useLanguage();
  const { isAuthenticated } = useAuth();
  const { reload: reloadCart } = useCart();
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get("order");
  const sessionId = searchParams.get("session_id");

  const [order, setOrder] = useState<OrderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const attemptsRef = useRef(0);

  const fetchOrder = useCallback(async () => {
    if (!orderId) return;
    try {
      const res = await fetch(`${apiUrl}/api/orders/${orderId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch order");
      const json = await res.json();
      if (json.success && json.data) {
        setOrder(json.data);
        // Reload cart since order was created
        reloadCart();
        return true;
      }
      throw new Error(json.error?.message || "Order not found");
    } catch (err) {
      console.error("Fetch order error:", err);
      return false;
    }
  }, [orderId, reloadCart]);

  // Initial fetch + polling for webhook completion
  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      setError(t("checkoutSuccess.noOrder"));
      return;
    }

    let alive = true;

    const poll = async () => {
      if (!alive) return;
      const ok = await fetchOrder();
      if (ok && alive) {
        setLoading(false);
        // If status is still pending/pending_payment, keep polling
        // (webhook may not have fired yet)
        if (attemptsRef.current < 30) {
          const orderData = await fetch(`${apiUrl}/api/orders/${orderId}`, { credentials: "include" })
            .then((r) => r.json())
            .catch(() => null);
          const status = orderData?.data?.status;
          if (status && ["paid", "cancelled", "payment_failed"].includes(status)) {
            return; // Terminal state — stop polling
          }
          attemptsRef.current++;
          pollRef.current = setTimeout(poll, 3000);
        }
      } else if (alive) {
        setLoading(false);
        setError(t("checkoutSuccess.orderNotFound"));
      }
    };

    poll();
    return () => {
      alive = false;
      if (pollRef.current) clearTimeout(pollRef.current);
    };
  }, [orderId, fetchOrder, t]);

  if (!orderId) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <ShopHeader />
        <main className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-24 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
            <ShoppingBag className="size-7 text-slate-400" />
          </span>
          <h1 className="mt-5 text-xl font-bold text-slate-900">{t("checkoutSuccess.noOrder")}</h1>
          <p className="mt-2 text-sm text-slate-500">{t("checkoutSuccess.noOrderDesc")}</p>
          <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" asChild>
            <Link to="/">{t("checkout.continueShopping")}</Link>
          </Button>
        </main>
      </div>
    );
  }

  const meta = order ? STATUS_META[order.status] ?? STATUS_META.pending : null;
  const StatusIcon = meta?.icon ?? Clock;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />
      <main className="mx-auto w-full max-w-2xl px-4 py-14 sm:px-6">
        {loading ? (
          <div className="flex flex-col items-center py-16">
            <Loader2 className="size-8 animate-spin text-[#10B981]" />
            <p className="mt-4 text-sm text-slate-500">{t("checkoutSuccess.loading")}</p>
            {sessionId && (
              <p className="mt-2 text-xs text-slate-400">{t("checkoutSuccess.verifyingPayment")}</p>
            )}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center text-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-red-50">
              <XCircle className="size-8 text-red-500" />
            </span>
            <h1 className="mt-5 text-2xl font-bold text-slate-900">{t("checkoutSuccess.error")}</h1>
            <p className="mt-2 text-sm text-slate-500">{error}</p>
            <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" asChild>
              <Link to="/">{t("checkout.continueShopping")}</Link>
            </Button>
          </div>
        ) : order ? (
          <>
            <div className="flex flex-col items-center text-center">
              <span className={`flex size-16 items-center justify-center rounded-full ${meta?.bg ?? "bg-slate-100"}`}>
                <StatusIcon className={`size-8 ${meta?.color ?? "text-slate-400"}`} />
              </span>
              <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">
                {t(meta?.labelKey ?? "checkoutSuccess.pending")}
              </h1>
              <p className="mt-2 text-sm text-slate-500">{t("checkoutSuccess.thankYou")}</p>
            </div>

            <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-6">
              <div className="flex items-center justify-between">
                <p className="text-sm text-slate-500">{t("checkout.orderNo")}</p>
                <p className="font-mono text-sm font-semibold text-slate-900">{order.orderNumber || order.id.slice(0, 8)}</p>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <p className="text-sm text-slate-500">{t("checkout.total")}</p>
                <p className="text-xl font-bold tabular-nums tracking-tight text-slate-900">{formatBaht(order.total)}</p>
              </div>

              {order.payment && (
                <div className="mt-3 flex items-center justify-between">
                  <p className="text-sm text-slate-500">{t("checkoutSuccess.paymentStatus")}</p>
                  <span className="flex items-center gap-1.5 text-sm font-medium">
                    <CreditCard className="size-3.5 text-[#10B981]" />
                    {order.payment.status === "paid" ? t("checkoutSuccess.paid") : t("checkoutSuccess.pending")}
                  </span>
                </div>
              )}

              {order.items.length > 0 && (
                <div className="mt-5 space-y-3 border-t border-slate-100 pt-5">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex items-center gap-3">
                      {item.imageUrl ? (
                        <img src={item.imageUrl} alt={item.productName} className="size-12 rounded-lg object-cover" />
                      ) : (
                        <span className="flex size-12 items-center rounded-lg bg-slate-50">
                          <Package className="size-5 text-slate-300" />
                        </span>
                      )}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-900">{item.productName}</p>
                        <p className="text-xs text-slate-400">× {item.quantity}</p>
                      </div>
                      <p className="text-sm font-medium tabular-nums text-slate-900">{formatBaht(item.price * item.quantity)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Button className="flex-1 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" asChild>
                <Link to="/orders">
                  <Package className="size-4" />
                  {t("checkout.trackOrder")}
                </Link>
              </Button>
              <Button variant="outline" className="flex-1 border-slate-200 text-slate-700" asChild>
                <Link to="/">{t("checkout.continueShopping")}</Link>
              </Button>
            </div>

            {order.status === "pending" || order.status === "pending_payment" ? (
              <p className="mt-4 text-center text-xs text-slate-400">
                {t("checkoutSuccess.polling")}
              </p>
            ) : null}
          </>
        ) : null}
      </main>
      <ShopFooter />
    </div>
  );
}
