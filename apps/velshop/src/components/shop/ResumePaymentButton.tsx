import { Button } from "@velnox/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { useLanguage } from "@/lib/i18n";
import { Check, CreditCard, Loader2, QrCode, type LucideIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

/**
 * "Pay now" for an order the backend will still accept a Stripe Checkout Session
 * for — the customer can choose the payment method AGAIN.
 *
 * WHY THIS EXISTS
 * ---------------
 * An unpaid order can be left behind in two ways: the customer abandons Stripe
 * Checkout, or the order is created and the session request then fails. Both
 * leave a real order that is still payable inside its reservation window, so the
 * customer must be able to pay it WITHOUT going back to the cart and without
 * creating a second order.
 *
 * The rules it obeys (all of them enforced server-side too):
 *   • the chooser lists the methods the BACKEND reports as enabled
 *     (`GET /api/payments/methods` → CARD / PROMPTPAY). Nothing is hard-coded, so
 *     a rail that is switched off can never be offered;
 *   • the rail the order already used is only PRESELECTED — never re-used
 *     silently. The customer may switch rails (a PromptPay attempt that failed
 *     can be retried by card), and the backend abandons a stale open session for
 *     a different method rather than charging the wrong one;
 *   • ONE button press in the chooser = order → Stripe session →
 *     `window.location.assign(url)` in the current tab, with no intermediate
 *     screen and nothing marked paid on the client;
 *   • a missing/empty session URL is an error, never a redirect to
 *     `undefined`/`null`;
 *   • the button enters its loading state on the first press and stays there
 *     while the request is in flight, so a double press cannot open two sessions
 *     (the backend additionally allows at most one active session per order);
 *   • coming BACK from Stripe (browser bfcache) re-enables the button instead of
 *     leaving it spinning forever.
 */

/** The rails this storefront can open a Stripe session for. */
type StripeRail = "CARD" | "PROMPTPAY";

interface ResumePaymentButtonProps {
  /** The order to pay (`parentOrderId` of a multi-shop checkout). */
  orderId: string;
  /** The rail recorded on the order's payment row, or null when not recorded. */
  method: StripeRail | null;
  /** Where the customer returns to; the backend keeps its own success/cancel URLs. */
  returnPath?: string;
  size?: "sm" | "default";
  className?: string;
  /** Extra classes for the primary/outline treatment used by each surface. */
  variant?: "primary" | "outline";
}

const RAIL_ICONS: Record<StripeRail, LucideIcon> = {
  CARD: CreditCard,
  PROMPTPAY: QrCode,
};

interface PaymentMethodsPayload {
  methods?: Array<{ id: string; enabled: boolean; stripePaymentMethodType: string | null }>;
}

export function ResumePaymentButton({
  orderId,
  method,
  returnPath,
  size = "sm",
  variant = "primary",
  className,
}: ResumePaymentButtonProps) {
  const { t } = useLanguage();
  const createStripeCheckout = useAction(api.stripe.createStripeCheckoutAction);
  const fetchPaymentMethods = useAction(api.payments.methods);

  const [open, setOpen] = useState(false);
  const [methods, setMethods] = useState<StripeRail[] | null>(null);
  const [selected, setSelected] = useState<StripeRail | null>(method);
  const [paying, setPaying] = useState(false);
  const [failed, setFailed] = useState(false);

  /**
   * A page restored from the bfcache (the customer pressed Back from Stripe) is
   * the SAME document that started a redirect, so its `paying` state is stale:
   * the request died with the navigation. Leaving the button disabled would
   * strand the customer on a screen where nothing can be clicked.
   */
  useEffect(() => {
    const restore = () => {
      setPaying(false);
      setOpen(false);
    };
    window.addEventListener("pageshow", restore);
    return () => window.removeEventListener("pageshow", restore);
  }, []);

  /** The enabled rails, straight from the backend's own payment configuration. */
  const loadMethods = useCallback(async () => {
    try {
      const res = (await fetchPaymentMethods()) as PaymentMethodsPayload;
      const available = (res?.methods ?? [])
        .filter((m) => m.enabled && (m.id === "CARD" || m.id === "PROMPTPAY"))
        .map((m) => m.id as StripeRail);
      setMethods(available);
    } catch (err) {
      console.error("Payment method discovery failed:", err);
      setMethods([]);
    }
  }, [fetchPaymentMethods]);

  const openChooser = () => {
    setFailed(false);
    setSelected(method);
    setOpen(true);
    if (methods === null) void loadMethods();
  };

  /** Guards the whole redirect: the first press wins, the rest are ignored. */
  const startPayment = async (chosen: StripeRail) => {
    if (paying) return;
    setPaying(true);
    setFailed(false);
    try {
      const res = (await createStripeCheckout({
        orderId,
        method: chosen,
        // A fresh idempotency key per attempt: the backend scope 'payment' row
        // replays a completed attempt and, for an unfinished one, answers 409
        // instead of opening a competing session. It is never a client-side
        // substitute for the server's own order-level uniqueness rule.
        requestKey: crypto.randomUUID(),
        returnPath: returnPath ?? `/orders/${orderId}`,
      })) as unknown as { url?: string | null };
      const url = res?.url;
      if (typeof url !== "string" || url.trim() === "") {
        // Never navigate to a missing URL — surface a retryable error instead.
        throw new Error(t("checkout.payStartFailed"));
      }
      window.location.assign(url);
    } catch (err) {
      console.error("Resume payment error:", err);
      setFailed(true);
      // Release the loading state so the customer can try again.
      setPaying(false);
      toast.error(err instanceof Error ? err.message : t("checkout.payStartFailed"));
    }
  };

  const buttonClass =
    variant === "primary"
      ? "gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
      : "gap-1.5 border-[#10B981]/30 bg-[#F0FDF9] text-[#10B981] hover:bg-[#D1FAE5]";

  return (
    <>
      <Button
        size={size}
        variant={variant === "primary" ? "default" : "outline"}
        className={`${buttonClass} ${className ?? ""}`}
        aria-busy={paying}
        disabled={paying}
        onClick={openChooser}
      >
        {paying ? <Loader2 className="size-3.5 animate-spin" /> : <CreditCard className="size-3.5" />}
        {paying ? t("orderDetail.payingNow") : t("orderReservation.payNow")}
      </Button>
      {failed && <p className="mt-1.5 text-xs text-rose-600">{t("checkout.payStartFailed")}</p>}

      <Dialog open={open} onOpenChange={(next) => !paying && setOpen(next)}>
        <DialogContent className="bg-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-slate-900">{t("orderDetail.choosePaymentTitle")}</DialogTitle>
            <DialogDescription>{t("orderDetail.choosePaymentDescAny")}</DialogDescription>
          </DialogHeader>

          {methods === null ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 animate-spin text-slate-300" />
            </div>
          ) : methods.length === 0 ? (
            <div className="py-2">
              <p className="text-sm text-slate-500">{t("paymentMethods.unavailable")}</p>
              <Button variant="outline" size="sm" className="mt-3 border-slate-200 text-slate-600" asChild>
                <Link to={`/orders/${orderId}`}>{t("orderDetail.backToOrders")}</Link>
              </Button>
            </div>
          ) : (
            <div className="grid gap-2">
              {methods.map((rail) => {
                const Icon = RAIL_ICONS[rail];
                const isSelected = selected === rail;
                return (
                  <button
                    key={rail}
                    type="button"
                    onClick={() => setSelected(rail)}
                    disabled={paying}
                    aria-pressed={isSelected}
                    className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${
                      isSelected
                        ? "border-[#10B981] bg-[#F0FDF9] ring-1 ring-[#10B981]/30"
                        : "border-slate-200 bg-white hover:border-slate-300"
                    }`}
                  >
                    <span
                      className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${
                        isSelected ? "bg-[#10B981] text-white" : "bg-slate-100 text-slate-500"
                      }`}
                    >
                      <Icon className="size-4" />
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-900">
                      {t(`paymentMethods.${rail.toLowerCase()}`)}
                    </span>
                    {isSelected && <Check className="size-4 shrink-0 text-[#10B981]" />}
                  </button>
                );
              })}
            </div>
          )}

          <DialogFooter className="gap-2 sm:justify-end">
            <Button
              variant="outline"
              className="border-slate-200 text-slate-600"
              onClick={() => setOpen(false)}
              disabled={paying}
            >
              {t("common.cancel")}
            </Button>
            <Button
              className="gap-1.5 bg-[#10B981] text-white hover:bg-emerald-600"
              disabled={paying || selected === null}
              onClick={() => selected && void startPayment(selected)}
            >
              {paying && <Loader2 className="size-4 animate-spin" />}
              {paying ? t("orderDetail.payingNow") : t("orderDetail.continueAction")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
