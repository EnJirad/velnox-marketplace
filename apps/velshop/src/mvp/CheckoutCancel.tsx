/**
 * Stripe hosted-checkout return — CANCELLED.
 *
 * Nothing was charged. The order still exists as `pending_payment` until it
 * expires or the buyer pays, so the retry path is the order page (which asks the
 * server, not this page, whether a payment is still possible).
 */
import { Button } from "@velnox/shared/components/ui/button";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { XCircle } from "lucide-react";
import { Link, useSearchParams } from "react-router";

export default function CheckoutCancel() {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  const orderId = params.get("order");

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-50">
        <XCircle className="size-7 text-amber-500" />
      </span>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
        {t("orders.paymentCancelled")}
      </h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">
        {t("checkout.paymentNotStartedDesc")}
      </p>
      <div className="mt-6 flex justify-center gap-2">
        {orderId && (
          <Button asChild className="bg-[#10B981] text-white hover:bg-[#059669]">
            <Link to={`/orders/${encodeURIComponent(orderId)}`}>{t("checkout.payNow")}</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link to="/cart">{t("nav.cart")}</Link>
        </Button>
      </div>
    </div>
  );
}
