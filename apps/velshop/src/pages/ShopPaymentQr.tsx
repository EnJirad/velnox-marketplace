import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
import { Button } from "@velnox/shared/components/ui/button";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import { formatBaht } from "@velnox/shared/lib/commerce";
import { ArrowLeft, CheckCircle2, Clock3, Loader2, QrCode, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

/**
 * Owner-branded PromptPay QR — the customer pays WITHOUT leaving Velnox.
 *
 * The QR itself comes from the backend (`POST /api/payments/promptpay/intent`
 * → Stripe PaymentIntent with `payment_method_types: ["promptpay"]`), so the
 * money still settles through the SAME Stripe account and the SAME webhook
 * that already settles orders. Nothing about the payment rail is duplicated.
 *
 * States that must stay distinct (never a false "paid"):
 *   loading · not_configured (503) · expired · paid · error
 */
interface PromptPayIntent {
  paymentIntentId: string;
  amount: number;
  currency: string;
  status: string;
  qrData: string | null;
  qrImageUrl: string | null;
  expiresAt: string;
  orderNumber: string;
}

type PageState = "loading" | "ready" | "unavailable" | "expired" | "paid" | "error";

export default function ShopPaymentQr() {
  const { t } = useLanguage();
  const { orderId } = useParams<{ orderId: string }>();
  const navigate = useNavigate();
  const createIntent = useAction(api.payments.promptpayIntent);
  const checkStatus = useAction(api.payments.promptpayStatus);

  const [intent, setIntent] = useState<PromptPayIntent | null>(null);
  const [state, setState] = useState<PageState>("loading");
  const [secondsLeft, setSecondsLeft] = useState(0);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const start = useCallback(async () => {
    if (!orderId) return;
    setState("loading");
    try {
      const data = (await createIntent({ orderId })) as unknown as PromptPayIntent;
      setIntent(data);
      setState("ready");
      setSecondsLeft(Math.max(0, Math.round((new Date(data.expiresAt).getTime() - Date.now()) / 1000)));
    } catch (err) {
      // 503 = this deployment cannot take QR payments yet (no Stripe keys).
      const status = (err as { status?: number })?.status;
      setState(status === 503 ? "unavailable" : "error");
    }
  }, [orderId, createIntent]);

  useEffect(() => {
    void start();
  }, [start]);

  // Countdown to expiry — the customer must know the QR is time-bound.
  useEffect(() => {
    if (state !== "ready") return;
    const timer = setInterval(() => {
      setSecondsLeft((s) => {
        if (s <= 1) {
          setState("expired");
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [state]);

  // Poll the intent so the page flips to "paid" the moment Stripe confirms it.
  useEffect(() => {
    if (state !== "ready" || !intent) return;
    pollRef.current = setInterval(async () => {
      try {
        const res = (await checkStatus({ paymentIntentId: intent.paymentIntentId })) as unknown as {
          paid: boolean;
          status: string;
        };
        if (res.paid) {
          setState("paid");
          navigate(`/orders/${orderId}`, { replace: true });
        }
      } catch {
        /* a transient poll failure must not disturb the customer */
      }
    }, 4000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [state, intent, checkStatus, navigate, orderId]);

  const countdown = useMemo(() => {
    const m = Math.floor(secondsLeft / 60);
    const s = secondsLeft % 60;
    return `${m}:${String(s).padStart(2, "0")}`;
  }, [secondsLeft]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <main className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
        <Link
          to={`/orders/${orderId}`}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
        >
          <ArrowLeft className="size-4" />
          {t("paymentQr.backToOrder")}
        </Link>

        <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex items-center gap-2 border-b border-slate-100 px-5 py-4">
            <span className="flex size-9 items-center justify-center rounded-[10px] bg-[#ECFDF5]">
              <QrCode className="size-4 text-[#10B981]" />
            </span>
            <div>
              <h1 className="text-base font-bold text-slate-900">{t("paymentQr.title")}</h1>
              <p className="text-xs text-slate-500">{t("paymentQr.subtitle")}</p>
            </div>
          </div>

          <div className="px-5 py-6">
            {state === "loading" && (
              <div className="space-y-4">
                <Skeleton className="mx-auto size-56 rounded-xl" />
                <Skeleton className="h-4 w-2/3 mx-auto" />
              </div>
            )}

            {state === "unavailable" && (
              <div className="text-center">
                <Clock3 className="mx-auto size-8 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-700">{t("paymentQr.unavailable")}</p>
                <p className="mt-1 text-xs text-slate-500">{t("paymentQr.unavailableDesc")}</p>
                <Button className="mt-5 bg-slate-900 text-white hover:bg-slate-800" asChild>
                  <Link to={`/orders/${orderId}`}>{t("paymentQr.backToOrder")}</Link>
                </Button>
              </div>
            )}

            {state === "error" && (
              <div className="text-center">
                <p className="text-sm font-medium text-slate-700">{t("paymentQr.errorTitle")}</p>
                <Button className="mt-5 bg-slate-900 text-white hover:bg-slate-800" onClick={() => void start()}>
                  {t("tracking.retry")}
                </Button>
              </div>
            )}

            {state === "expired" && (
              <div className="text-center">
                <Clock3 className="mx-auto size-8 text-amber-400" />
                <p className="mt-3 text-sm font-medium text-slate-700">{t("paymentQr.expiredTitle")}</p>
                <p className="mt-1 text-xs text-slate-500">{t("paymentQr.expiredDesc")}</p>
                <Button className="mt-5 bg-slate-900 text-white hover:bg-slate-800" onClick={() => void start()}>
                  {t("paymentQr.newQr")}
                </Button>
              </div>
            )}

            {(state === "ready" || state === "paid") && intent && (
              <div className="text-center">
                <div className="mx-auto w-fit rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
                  {intent.qrImageUrl ? (
                    <img
                      src={intent.qrImageUrl}
                      alt={t("paymentQr.qrAlt")}
                      width={224}
                      height={224}
                      className="size-56 rounded-lg"
                    />
                  ) : (
                    <div className="flex size-56 items-center justify-center rounded-lg bg-slate-50 text-xs text-slate-400">
                      {t("paymentQr.noQr")}
                    </div>
                  )}
                </div>

                <p className="mt-4 text-2xl font-bold tabular-nums text-slate-900">
                  {formatBaht(intent.amount / 100)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">{t("paymentQr.orderRef", { no: intent.orderNumber })}</p>

                <div className="mt-4 inline-flex items-center gap-1.5 rounded-full bg-[#ECFDF5] px-3 py-1.5 text-xs font-medium text-emerald-700">
                  <Clock3 className="size-3.5" />
                  {state === "paid" ? t("paymentQr.paid") : t("paymentQr.expiresIn", { time: countdown })}
                </div>

                <ol className="mt-5 space-y-2 text-left text-xs text-slate-500">
                  <li>1. {t("paymentQr.step1")}</li>
                  <li>2. {t("paymentQr.step2")}</li>
                  <li>3. {t("paymentQr.step3")}</li>
                </ol>

                <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-slate-400">
                  <ShieldCheck className="size-3.5" />
                  {t("paymentQr.secureNote")}
                </p>

                {state === "paid" && (
                  <p className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600">
                    <CheckCircle2 className="size-4" /> {t("paymentQr.paid")}
                  </p>
                )}
                {state === "ready" && (
                  <p className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-slate-400">
                    <Loader2 className="size-3 animate-spin" /> {t("paymentQr.waiting")}
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      <ShopFooter />
    </div>
  );
}
