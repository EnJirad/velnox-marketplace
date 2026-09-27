import { ResumePaymentButton } from "@/components/shop/ResumePaymentButton";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { Button } from "@velnox/shared/components/ui/button";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { formatBaht, orderStripePayability } from "@velnox/shared/lib/commerce";
import { useLanguage } from "@/lib/i18n";
import { ArrowLeft, Loader2, Package, ShoppingCart, XCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

interface CancelledOrder {
  id: string;
  orderNumber: string;
  status: string;
  paymentStatus: string;
  total: number;
  payments?: Array<{ method: string; status: string }>;
}

/**
 * Stripe Checkout `cancel_url` landing page.
 *
 * Leaving Stripe cancels nothing: the order exists and is still unpaid, so this
 * page reads the AUTHORITATIVE state back from the API and offers to finish the
 * payment here (same rail the order was created with) instead of pretending the
 * purchase is over — or leaving the customer to find their own way to My Orders.
 */
export default function ShopCheckoutCancel() {
  const { t } = useLanguage();
  const [searchParams] = useSearchParams();
  const orderId = searchParams.get("order");
  const orderDetail = useAction(api.customer.orderDetail);

  const [order, setOrder] = useState<CancelledOrder | null>(null);
  const [loading, setLoading] = useState(Boolean(orderId));

  useEffect(() => {
    if (!orderId) {
      setLoading(false);
      return;
    }
    let alive = true;
    orderDetail({ orderId })
      .then((data) => {
        if (alive) setOrder((data as CancelledOrder) ?? null);
      })
      .catch((err) => console.error("Load order after Stripe cancel failed:", err))
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [orderId, orderDetail]);

  const payability = orderStripePayability(order);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />
      <main className="mx-auto flex w-full max-w-2xl flex-col items-center px-4 py-24 text-center sm:px-6">
        <span className="flex size-16 items-center justify-center rounded-full bg-slate-100">
          <XCircle className="size-8 text-slate-400" />
        </span>
        <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900">
          {t("checkoutCancel.title")}
        </h1>
        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-500">
          {t("checkoutCancel.description")}
        </p>

        {loading ? (
          <Loader2 className="mt-6 size-5 animate-spin text-slate-300" />
        ) : (
          <>
            {order && (
              <div className="mt-6 w-full rounded-2xl border border-slate-200 bg-white p-5 text-left">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-500">{t("checkout.orderNo")}</p>
                  <p className="font-mono text-sm font-semibold text-slate-900">{order.orderNumber}</p>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3">
                  <p className="text-sm text-slate-500">{t("checkout.total")}</p>
                  <p className="text-lg font-bold tabular-nums tracking-tight text-slate-900">{formatBaht(order.total)}</p>
                </div>
              </div>
            )}

            {payability.payable && orderId && (
              <div className="mt-4 w-full">
                <ResumePaymentButton
                  orderId={orderId}
                  method={payability.method}
                  returnPath={`/orders/${orderId}`}
                  onUnknownMethod="ask"
                  size="default"
                  className="w-full"
                />
              </div>
            )}

            <div className="mt-4 flex w-full flex-col gap-2 sm:flex-row">
              {orderId && (
                <Button variant="outline" className="flex-1 gap-1.5 border-slate-200 text-slate-700" asChild>
                  <Link to={`/orders/${orderId}`}>
                    <Package className="size-4" />
                    {t("checkout.viewOrders")}
                  </Link>
                </Button>
              )}
              <Button variant="outline" className="flex-1 gap-1.5 border-slate-200 text-slate-700" asChild>
                <Link to="/cart">
                  <ShoppingCart className="size-4" />
                  {t("checkoutCancel.backToCart")}
                </Link>
              </Button>
              <Button variant="outline" className="flex-1 border-slate-200 text-slate-700" asChild>
                <Link to="/">
                  <ArrowLeft className="size-4" />
                  {t("checkout.continueShopping")}
                </Link>
              </Button>
            </div>
          </>
        )}
      </main>
      <ShopFooter />
    </div>
  );
}
