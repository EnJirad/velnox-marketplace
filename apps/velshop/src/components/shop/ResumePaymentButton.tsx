import { Button } from "@velnox/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { useLanguage } from "@/lib/i18n";
import { CreditCard, Loader2, QrCode, type LucideIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

/**
 * "Continue payment" for an order that the backend will still accept a Stripe
 * Checkout Session for.
 *
 * WHY THIS EXISTS
 * ---------------
 * An unpaid order can be left behind in two ways: the customer abandons Stripe
 * Checkout, or the order is created and the session request then fails. Both
 * leave a real order that is payable, so the customer must be able to resume it
 * WITHOUT going back to the cart and without creating a second order.
 *
 * The rules it obeys (all of them enforced server-side too):
 *   • the method comes from the order's OWN payment record — a PromptPay
 *     customer is never redirected to a card form by a default;
 *   • when no method was recorded the customer is asked (never guessed), using
 *     the backend's own method discovery;
 *   • ONE button press = order → Stripe session → `window.location.assign(url)`
 *     in the current tab, with no intermediate screen;
 *   • a missing/empty session URL is an error, never a redirect to
 *     `undefined`/`null`;
 *   • the button enters its loading state on the first click and stays there
 *     while the request is in flight, so a double click cannot open two
 *     sessions (the backend additionally allows at most one active session per
 *     order).
 */

interface ResumePaymentButtonProps {
  /** The order to pay (`parentOrderId` of a multi-shop checkout). */
  orderId: string;
  /** The rail recorded on the order's payment row, or null when not recorded. */
  method: "CARD" | "PROMPTPAY" | null;
  /** Where the customer returns to; the backend keeps its own success/cancel URLs. */
  returnPath?: string;
  /**
   * When the recorded method is unknown: `"ask"` opens the method chooser,
   * `"link"` sends the customer to the order page (which can ask), `"hidden"`
   * renders nothing.
   */
  onUnknownMethod?: "ask" | "link" | "hidden";
  size?: "sm" | "default";
  className?: string;
  /** Extra classes for the primary/outline treatment used by each surface. */
  variant?: "primary" | "outline";
}

const METHOD_ICONS: Record<"CARD" | "PROMPTPAY", LucideIcon> = {
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
  onUnknownMethod = "ask",
  size = "sm",
  variant = "primary",
  className,
}: ResumePaymentButtonProps) {
  const { t } = useLanguage();
  const createStripeCheckout = useAction(api.stripe.createStripeCheckoutAction);
  const fetchPaymentMethods = useAction(api.payments.methods);

  const [paying, setPaying] = useState(false);
  const [chooserOpen, setChooserOpen] = useState(false);
  const [methods, setMethods] = useState<Array<"CARD" | "PROMPTPAY"> | null>(null);
  const [failed, setFailed] = useState(false);

  /** Guards the whole redirect: the first click wins, the rest are ignored. */
  const startPayment = async (chosen: "CARD" | "PROMPTPAY") => {
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

  const openChooser = async () => {
    setChooserOpen(true);
    if (methods !== null) return;
    try {
      const res = (await fetchPaymentMethods()) as PaymentMethodsPayload;
      const available = (res?.methods ?? [])
        .filter((m) => m.enabled && (m.id === "CARD" || m.id === "PROMPTPAY"))
        .map((m) => m.id as "CARD" | "PROMPTPAY");
      setMethods(available);
    } catch (err) {
      console.error("Payment method discovery failed:", err);
      setMethods([]);
    }
  };

  const buttonClass =
    variant === "primary"
      ? "gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
      : "gap-1.5 border-[#10B981]/30 bg-[#F0FDF9] text-[#10B981] hover:bg-[#D1FAE5]";

  const label = paying ? t("orderDetail.payingNow") : t("orderDetail.payOnlineNow");

  // No recorded rail and the caller cannot ask here — hand over to the order
  // page instead of guessing a method.
  if (method === null && onUnknownMethod === "link") {
    return (
      <Button variant="outline" size={size} className={`${buttonClass} ${className ?? ""}`} asChild>
        <Link to={`/orders/${orderId}`}>{t("orders.choosePaymentMethod")}</Link>
      </Button>
    );
  }
  if (method === null && onUnknownMethod === "hidden") return null;

  return (
    <>
      <Button
        size={size}
        variant={variant === "primary" ? "default" : "outline"}
        className={`${buttonClass} ${className ?? ""}`}
        aria-busy={paying}
        disabled={paying}
        onClick={() => {
          if (method === null) {
            void openChooser();
            return;
          }
          void startPayment(method);
        }}
      >
        {paying ? <Loader2 className="size-3.5 animate-spin" /> : <CreditCard className="size-3.5" />}
        {label}
      </Button>
      {failed && <p className="mt-1.5 text-xs text-rose-600">{t("checkout.payStartFailed")}</p>}

      <Dialog open={chooserOpen} onOpenChange={(open) => !paying && setChooserOpen(open)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("orderDetail.choosePaymentTitle")}</DialogTitle>
            <DialogDescription>{t("orderDetail.choosePaymentDesc")}</DialogDescription>
          </DialogHeader>
          {methods === null ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="size-5 animate-spin text-slate-300" />
            </div>
          ) : methods.length === 0 ? (
            <p className="py-4 text-sm text-slate-500">{t("paymentMethods.unavailable")}</p>
          ) : (
            <div className="grid gap-2">
              {methods.map((m) => {
                const Icon = METHOD_ICONS[m];
                return (
                  <Button
                    key={m}
                    variant="outline"
                    className="justify-start gap-2 border-slate-200 text-slate-700"
                    disabled={paying}
                    onClick={() => void startPayment(m)}
                  >
                    {paying ? <Loader2 className="size-4 animate-spin" /> : <Icon className="size-4 text-[#10B981]" />}
                    {t(`paymentMethods.${m.toLowerCase()}`)}
                  </Button>
                );
              })}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
