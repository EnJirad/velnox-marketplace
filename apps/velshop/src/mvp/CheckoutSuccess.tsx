/**
 * Stripe hosted-checkout return — SUCCESS.
 *
 * The `session_id` in the query string is NOT proof of payment. The order page
 * re-reads `GET /orders/:id/payment-status`, which is only updated by the signed
 * webhook. This page therefore says "payment submitted", never "paid".
 */
import { Button } from "@velnox/shared/components/ui/button";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { CheckCircle2 } from "lucide-react";
import { Link, useSearchParams } from "react-router";

export default function CheckoutSuccess() {
  const { t } = useLanguage();
  const [params] = useSearchParams();
  const orderId = params.get("order");

  return (
    <div className="mx-auto max-w-lg py-16 text-center">
      <span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-emerald-50">
        <CheckCircle2 className="size-7 text-[#10B981]" />
      </span>
      <h1 className="mt-4 text-2xl font-bold tracking-tight text-slate-900">
        {t("checkout.successTitle")}
      </h1>
      <p className="mt-2 text-sm leading-6 text-slate-500">{t("checkout.successDesc")}</p>
      <div className="mt-6 flex justify-center gap-2">
        {orderId && (
          <Button asChild className="bg-[#10B981] text-white hover:bg-[#059669]">
            <Link to={`/orders/${encodeURIComponent(orderId)}`}>{t("orders.viewDetail")}</Link>
          </Button>
        )}
        <Button asChild variant="outline">
          <Link to="/orders">{t("nav.orders")}</Link>
        </Button>
      </div>
    </div>
  );
}
