/**
 * VelRepeat V2 — the customer flow a human can actually use.
 *
 *   package → commitment → frequency → review → draft plan → Stripe TEST
 *   Checkout → return → (the server decides) active → cycles → orders
 *
 * WHAT THIS PAGE IS NOT
 * ---------------------
 * It is not a developer panel and it fakes nothing:
 *
 *   • It never computes an authoritative price. The package list shows a
 *     per-cycle ESTIMATE the backend derived from the catalog; the number the
 *     customer is actually charged is the one `POST /api/velrepeat/v2/plans`
 *     returns from the frozen pricing snapshot, and this page renders THAT.
 *     Money is only ever rendered from a server response, never multiplied in
 *     the browser.
 *   • It never declares a payment successful. Coming back from Stripe means
 *     nothing here: the page reads the plan status from the backend and keeps
 *     showing "checking" until the server says `active`, because the webhook is
 *     the only thing that can move a plan.
 *   • It sends only what the backend accepts. `sellerId`, price, total and
 *     payment status are not part of any request this page makes.
 *
 * The frequency and commitment options come from the backend's own vocabulary
 * (VALID_FREQUENCIES / COMMITMENT_CYCLES_MAX), so a value the scheduler does
 * not understand can never be chosen here.
 */
import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { formatBaht, formatLocaleDate } from "@velnox/shared/lib/commerce";
import {
  AlertCircle,
  ArrowLeft,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Loader2,
  Package,
  RefreshCw,
  Store,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

// ─── Types (every one mirrors a real backend response) ─────────────────────

interface V2PackageSummary {
  id: string;
  name: string;
  description: string | null;
  itemCount: number;
  shopCount: number;
  previewCyclePrice: string;
  currency: string;
  imageUrl: string | null;
}

interface V2PackageItem {
  productId: string;
  variantId: string | null;
  productName: string;
  variantName: string | null;
  shopName: string;
  quantity: number;
  unitPrice: string;
  lineTotal: string;
  imageUrl: string | null;
}

interface V2PackageDetail {
  id: string;
  name: string;
  description: string | null;
  currency: string;
  basePrice: string;
  items: V2PackageItem[];
}

interface V2PlanSummary {
  id: string;
  status: string;
  frequencyType: FrequencyType;
  intervalValue: number;
  commitmentCycles: number | null;
  nextRunAt: string;
  currency: string;
  createdAt: string;
  packageId: string | null;
  packageName: string | null;
  cyclePrice: string | null;
  totalPrepaidAmount: string | null;
  cycleCount: number;
  paymentStatus: string | null;
}

interface V2CycleOrder {
  id: string;
  orderNumber: string;
  shopName: string | null;
  status: string;
  shippingStatus: string | null;
  trackingNumber: string | null;
}

interface V2Cycle {
  id: string;
  cycleNumber: number;
  status: string;
  scheduledAt: string;
  orders: V2CycleOrder[];
}

interface V2PlanDetail {
  plan: V2PlanSummary & { packageName: string | null };
  pricing: {
    currency: string;
    basePrice: string;
    discountAmount: string;
    cyclePrice: string;
    totalPrepaidAmount: string;
    effectiveDiscountPercent: string | null;
  } | null;
  items: Array<{ productName: string; shopName: string; variantName: string | null; quantity: number }>;
  cycles: V2Cycle[];
  payment: { status: string; method: string; amount: string; currency: string; paidAt: string | null } | null;
}

/**
 * The backend's OWN frequency vocabulary (`VALID_FREQUENCIES` in
 * `backend/jobs/velrepeat-scheduler.ts`). A cadence the scheduler does not
 * understand can never be offered here — the scheduler is the source of truth
 * and this list is a mirror of it, not a second definition.
 */
type FrequencyType = "days" | "weeks" | "months";
const FREQUENCY_TYPES: FrequencyType[] = ["days", "weeks", "months"];

/** `COMMITMENT_CYCLES_MAX` in the backend — the largest plan it can represent. */
const COMMITMENT_OPTIONS = [1, 2, 4, 8, 16];
const INTERVAL_OPTIONS = [1, 2, 3];

type Step = "packages" | "configure" | "review" | "detail";

// ─── Page ───────────────────────────────────────────────────────────────────

export default function VelRepeatV2Page() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  // Stripe returns the customer here with `?velrepeat_v2_payment=success|cancel
  // &plan=<id>`. That query is a ROUTE, not a verdict: it says where the
  // browser came back, never that money moved. The plan status below is read
  // from the server, and the page keeps waiting while it says `draft`.
  const [searchParams] = useSearchParams();
  const returnState = searchParams.get("velrepeat_v2_payment");
  const returnPlanId = searchParams.get("plan");

  const listPackages = useAction(api["api.velrepeatV2.packages"]);
  const getPackage = useAction(api["api.velrepeatV2.packageDetail"]);
  const listPlans = useAction(api["api.velrepeatV2.plans"]);
  const getPlan = useAction(api["api.velrepeatV2.planDetail"]);
  const createPlan = useAction(api["api.velrepeatV2.createPlan"]);
  const openPayment = useAction(api["api.velrepeatV2.payment"]);

  const [step, setStep] = useState<Step>("packages");

  // Package list
  const [packages, setPackages] = useState<V2PackageSummary[] | null>(null);
  const [packagesError, setPackagesError] = useState<string | null>(null);

  // Configuration
  const [selected, setSelected] = useState<V2PackageDetail | null>(null);
  const [commitment, setCommitment] = useState(4);
  const [frequencyType, setFrequencyType] = useState<FrequencyType>("weeks");
  const [intervalValue, setIntervalValue] = useState(2);

  // Review / creation
  const [created, setCreated] = useState<V2PlanDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  // One idempotency key per attempt: a retry after a failure uses a fresh one,
  // exactly like the order checkout.
  const requestKeyRef = useRef<string | null>(null);

  // My plans
  const [plans, setPlans] = useState<V2PlanSummary[] | null>(null);
  const [plansError, setPlansError] = useState<string | null>(null);
  const [planDetail, setPlanDetail] = useState<V2PlanDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadPackages = useCallback(async () => {
    setPackagesError(null);
    try {
      const res = (await listPackages({})) as { packages?: V2PackageSummary[] } | V2PackageSummary[];
      const list = Array.isArray(res) ? res : (res?.packages ?? []);
      setPackages(list);
    } catch (err) {
      console.error("velrepeat v2 packages:", err);
      setPackagesError(err instanceof Error ? err.message : t("velrepeatV2.packagesFailed"));
    }
  }, [listPackages, t]);

  const loadPlans = useCallback(async () => {
    setPlansError(null);
    try {
      const res = (await listPlans({})) as { plans?: V2PlanSummary[] } | V2PlanSummary[];
      setPlans(Array.isArray(res) ? res : (res?.plans ?? []));
    } catch (err) {
      console.error("velrepeat v2 plans:", err);
      setPlansError(err instanceof Error ? err.message : t("velrepeatV2.plansFailed"));
    }
  }, [listPlans, t]);

  useEffect(() => {
    void loadPackages();
    void loadPlans();
  }, [loadPackages, loadPlans]);

  const choosePackage = async (packageId: string) => {
    setActionError(null);
    try {
      const res = (await getPackage({ packageId })) as { package?: V2PackageDetail } | V2PackageDetail;
      const pkg = (res as { package?: V2PackageDetail }).package ?? (res as V2PackageDetail);
      setSelected(pkg);
      setStep("configure");
    } catch (err) {
      console.error("velrepeat v2 package:", err);
      toast.error(err instanceof Error ? err.message : t("velrepeatV2.packagesFailed"));
    }
  };

  /**
   * Create the draft, then open the REAL Stripe Checkout Session and go there.
   *
   * Order matters: the plan must exist before a payment can be attached to it,
   * and the plan stays `draft` until the webhook settles the charge. If the
   * redirect fails, the plan still exists and is resumable — nothing is lost.
   */
  const createAndPay = async () => {
    if (busy || !selected) return;
    setBusy(true);
    setActionError(null);
    requestKeyRef.current ??= crypto.randomUUID();
    try {
      // ONLY the four fields the backend accepts. Price, seller, ownership and
      // the total are all derived server-side.
      const res = (await createPlan({
        packageId: selected.id,
        commitmentCycles: commitment,
        frequencyType,
        intervalValue,
      })) as { plan?: { id: string } };

      const planId = res?.plan?.id;
      if (!planId) throw new Error(t("velrepeatV2.createFailed"));

      const payment = (await openPayment({
        planId,
        method: "CARD",
        requestKey: requestKeyRef.current,
      })) as { url?: string | null };

      if (typeof payment?.url !== "string" || payment.url.trim() === "") {
        // The plan exists but the payment page did not open. Take the customer
        // to the plan instead — it is resumable, and never claim success.
        throw new Error(t("velrepeatV2.paymentFailed"));
      }
      window.location.assign(payment.url);
    } catch (err) {
      console.error("velrepeat v2 create:", err);
      const message = err instanceof Error ? err.message : t("velrepeatV2.createFailed");
      setActionError(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  /** Open a plan, from the list or from the Stripe return. */
  const openPlan = useCallback(
    async (planId: string) => {
      setDetailError(null);
      setPlanDetail(null);
      setStep("detail");
      try {
        const res = (await getPlan({ planId })) as
          | { plan?: V2PlanDetail["plan"]; cycles?: V2Cycle[]; pricing?: V2PlanDetail["pricing"] }
          | V2PlanDetail;
        const detail = (
          res.plan && (res as { cycles?: V2Cycle[] }).cycles !== undefined
            ? res
            : { plan: (res as V2PlanDetail).plan, cycles: (res as V2PlanDetail).cycles, pricing: (res as V2PlanDetail).pricing }
        ) as V2PlanDetail;
        setPlanDetail(detail);
      } catch (err) {
        console.error("velrepeat v2 plan:", err);
        setDetailError(err instanceof Error ? err.message : t("velrepeatV2.loadPlanFailed"));
      }
    },
    [getPlan, t],
  );

  /**
   * After Stripe returns, show the plan and keep polling until the SERVER says
   * something other than `draft`. The webhook — not the browser — is what moves
   * `draft → active`, so a fast return, a slow webhook and a dropped webhook all
   * produce the same honest UI: "checking".
   */
  useEffect(() => {
    if (!returnPlanId) return;
    void openPlan(returnPlanId);
    if (returnState !== "success") return;
    const poll = async () => {
      await openPlan(returnPlanId);
    };
    const timer = setInterval(() => void poll(), 2500);
    // Stop once the server has settled on a real state, and always clean up.
    const stop = setInterval(() => {
      if (planDetail && planDetail.plan.status !== "draft") {
        clearInterval(timer);
        clearInterval(stop);
      }
    }, 1000);
    const cap = setTimeout(() => {
      clearInterval(timer);
      clearInterval(stop);
    }, 120_000);
    return () => {
      clearInterval(timer);
      clearInterval(stop);
      clearTimeout(cap);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [returnPlanId, returnState]);

  const frequencyLabel = useMemo(() => {
    const unit = frequencyType === "days" ? t("velrepeatV2.unitDay")
      : frequencyType === "weeks" ? t("velrepeatV2.unitWeek")
      : t("velrepeatV2.unitMonth");
    return t("velrepeatV2.everyN", { count: intervalValue, unit });
  }, [frequencyType, intervalValue, t]);

  /** The schedule the customer is about to commit to — a PREVIEW of instants. */
  const projectedSchedule = useMemo(() => {
    if (!selected) return [];
    const out: Date[] = [];
    const cursor = new Date();
    for (let i = 0; i < commitment; i += 1) {
      if (i > 0) {
        if (frequencyType === "days") cursor.setDate(cursor.getDate() + intervalValue);
        else if (frequencyType === "weeks") cursor.setDate(cursor.getDate() + intervalValue * 7);
        else cursor.setMonth(cursor.getMonth() + intervalValue);
      }
      out.push(new Date(cursor.getTime()));
    }
    return out;
  }, [selected, commitment, frequencyType, intervalValue]);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-background">
      <ShopHeader />
      <main className="mx-auto w-full max-w-3xl px-4 pb-24 pt-6">
        <div className="mb-5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => (step === "detail" ? setStep("packages") : setStep("packages"))}
            className="rounded-md p-2 text-muted-foreground hover:bg-muted"
            aria-label={t("velrepeatV2.back")}
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <div>
            <h1 className="text-xl font-semibold">{t("velrepeatV2.title")}</h1>
            <p className="text-sm text-muted-foreground">{t("velrepeatV2.subtitle")}</p>
          </div>
        </div>

        {step === "packages" && (
          <section className="space-y-6">
            <div className="space-y-3">
              <h2 className="text-base font-semibold">{t("velrepeatV2.stepPackage")}</h2>
              {packagesError && (
                <ErrorState message={packagesError} onRetry={() => void loadPackages()} />
              )}
              {!packagesError && packages === null && (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-24 w-full rounded-lg" />
                  ))}
                </div>
              )}
              {packages && packages.length === 0 && (
                <EmptyState message={t("velrepeatV2.noPackages")} detail={t("velrepeatV2.noPackagesDesc")} />
              )}
              {packages?.map((pkg) => (
                <button
                  key={pkg.id}
                  type="button"
                  onClick={() => void choosePackage(pkg.id)}
                  className="flex w-full items-center gap-3 rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/50"
                >
                  <div className="flex h-14 w-14 shrink-0 items-center justify-center overflow-hidden rounded-md bg-muted">
                    {pkg.imageUrl ? (
                      <img src={pkg.imageUrl} alt="" className="h-full w-full object-cover" />
                    ) : (
                      <Package className="h-6 w-6 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{pkg.name}</p>
                    {pkg.description && (
                      <p className="line-clamp-2 text-sm text-muted-foreground">{pkg.description}</p>
                    )}
                    <p className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
                      <span>{t("velrepeatV2.itemsCount", { count: pkg.itemCount })}</span>
                      <span className="inline-flex items-center gap-1">
                        <Store className="h-3 w-3" />
                        {t("velrepeatV2.shopsCount", { count: pkg.shopCount })}
                      </span>
                    </p>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="font-semibold">{formatBaht(Number(pkg.previewCyclePrice))}</p>
                    <p className="text-xs text-muted-foreground">
                      {t("velrepeatV2.perCycle", { amount: "" }).trim()}
                    </p>
                  </div>
                </button>
              ))}
              {packages && packages.length > 0 && (
                <p className="text-xs text-muted-foreground">{t("velrepeatV2.previewNote")}</p>
              )}
            </div>

            <div className="space-y-3">
              <h2 className="text-base font-semibold">{t("velrepeatV2.myPlans")}</h2>
              {plansError && <ErrorState message={plansError} onRetry={() => void loadPlans()} />}
              {!plansError && plans === null && <Skeleton className="h-20 w-full rounded-lg" />}
              {plans && plans.length === 0 && (
                <EmptyState message={t("velrepeatV2.noPlans")} detail={t("velrepeatV2.noPlansDesc")} />
              )}
              {plans?.map((plan) => (
                <button
                  key={plan.id}
                  type="button"
                  onClick={() => void openPlan(plan.id)}
                  className="w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-primary/50"
                >
                  <div className="flex items-center justify-between gap-2">
                    <p className="truncate font-medium">{plan.packageName ?? t("velrepeatV2.notFound")}</p>
                    <PlanStatusBadge status={plan.status} />
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {t("velrepeatV2.planCommitment")}: {plan.commitmentCycles ?? "—"} ·{" "}
                    {plan.frequencyType} {plan.intervalValue}
                  </p>
                </button>
              ))}
            </div>
          </section>
        )}

        {step === "configure" && selected && (
          <section className="space-y-5">
            <div className="rounded-lg border border-border bg-card p-4">
              <p className="font-medium">{selected.name}</p>
              <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
                {selected.items.map((item, i) => (
                  <li key={`${item.productId}-${item.variantId ?? "base"}-${i}`}>
                    {item.productName}
                    {item.variantName ? ` · ${item.variantName}` : ""} × {item.quantity} · {item.shopName}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm font-semibold">{formatBaht(Number(selected.basePrice))}</p>
            </div>

            <ChoiceGroup title={t("velrepeatV2.stepCommitment")} hint={t("velrepeatV2.commitmentHint")}>
              {COMMITMENT_OPTIONS.map((n) => (
                <Choice
                  key={n}
                  active={commitment === n}
                  onClick={() => setCommitment(n)}
                  label={t("velrepeatV2.commitmentCycles", { count: n })}
                />
              ))}
            </ChoiceGroup>

            <ChoiceGroup title={t("velrepeatV2.stepFrequency")}>
              <div className="flex flex-wrap gap-2">
                {FREQUENCY_TYPES.map((ft) => (
                  <Choice
                    key={ft}
                    active={frequencyType === ft}
                    onClick={() => setFrequencyType(ft)}
                    label={
                      ft === "days" ? t("velrepeatV2.unitDay")
                      : ft === "weeks" ? t("velrepeatV2.unitWeek")
                      : t("velrepeatV2.unitMonth")
                    }
                  />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {INTERVAL_OPTIONS.map((n) => (
                  <Choice key={n} active={intervalValue === n} onClick={() => setIntervalValue(n)} label={String(n)} />
                ))}
              </div>
              <p className="mt-2 text-sm text-muted-foreground">{frequencyLabel}</p>
            </ChoiceGroup>

            <Button className="w-full" onClick={() => setStep("review")}>
              {t("velrepeatV2.stepReview")}
            </Button>
          </section>
        )}

        {step === "review" && selected && (
          <section className="space-y-4">
            <h2 className="text-base font-semibold">{t("velrepeatV2.review")}</h2>
            <dl className="divide-y divide-border rounded-lg border border-border bg-card text-sm">
              <Row label={t("velrepeatV2.reviewPackage")} value={selected.name} />
              <Row label={t("velrepeatV2.reviewFrequency")} value={frequencyLabel} />
              <Row label={t("velrepeatV2.reviewCommitment")} value={String(commitment)} />
              <Row
                label={t("velrepeatV2.reviewCyclePrice")}
                value={formatBaht(Number(selected.basePrice))}
              />
            </dl>

            <div className="rounded-lg border border-border bg-card p-4 text-sm">
              <p className="mb-2 font-medium">{t("velrepeatV2.reviewProducts")}</p>
              <ul className="space-y-2">
                {selected.items.map((item, i) => (
                  <li key={`${item.productId}-${i}`} className="flex justify-between gap-2">
                    <span>
                      {item.productName}
                      {item.variantName ? ` · ${item.variantName}` : ""}
                      <span className="text-muted-foreground"> × {item.quantity}</span>
                      <span className="block text-xs text-muted-foreground">{item.shopName}</span>
                    </span>
                    <span className="shrink-0">{formatBaht(Number(item.lineTotal))}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-lg border border-border bg-card p-4 text-sm">
              <p className="mb-2 flex items-center gap-1 font-medium">
                <CalendarClock className="h-4 w-4" />
                {t("velrepeatV2.reviewSchedule")}
              </p>
              <ol className="space-y-1">
                {projectedSchedule.map((date, i) => (
                  <li key={date.toISOString()} className="flex justify-between gap-2">
                    <span className="text-muted-foreground">
                      {t("velrepeatV2.cycleNumber", { count: i + 1 })}
                    </span>
                    <span>{formatLocaleDate(date, lang)}</span>
                  </li>
                ))}
              </ol>
            </div>

            {actionError && <ErrorState message={actionError} onRetry={() => void createAndPay()} />}

            <Button className="w-full" disabled={busy} onClick={() => void createAndPay()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CreditCard className="mr-2 h-4 w-4" />}
              {busy ? t("velrepeatV2.creating") : t("velrepeatV2.createPlan")}
            </Button>
            <p className="text-center text-xs text-muted-foreground">
              {t("velrepeatV2.paymentPendingHint")}
            </p>
          </section>
        )}

        {step === "detail" && (
          <section className="space-y-4">
            {detailError && <ErrorState message={detailError} onRetry={() => void loadPlans()} />}
            {!detailError && !planDetail && <Skeleton className="h-64 w-full rounded-lg" />}
            {planDetail && <PlanDetailView detail={planDetail} />}
          </section>
        )}
      </main>
      <ShopFooter />
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-2.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}

function Choice({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-4 py-2 text-sm transition-colors ${
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card hover:bg-muted"
      }`}
    >
      {label}
    </button>
  );
}

function ChoiceGroup({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="mb-1 text-sm font-semibold">{title}</h2>
      {hint && <p className="mb-2 text-xs text-muted-foreground">{hint}</p>}
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  const { t } = useLanguage();
  return (
    <div className="flex flex-col items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm">
      <p className="flex items-center gap-2 text-destructive">
        <AlertCircle className="h-4 w-4 shrink-0" />
        {message}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RefreshCw className="mr-2 h-3.5 w-3.5" />
        {t("velrepeatV2.retry")}
      </Button>
    </div>
  );
}

function EmptyState({ message, detail }: { message: string; detail: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-muted/40 p-6 text-center text-sm">
      <p className="font-medium">{message}</p>
      <p className="mt-1 text-muted-foreground">{detail}</p>
    </div>
  );
}

function PlanStatusBadge({ status }: { status: string }) {
  const { t } = useLanguage();
  const label = (() => {
    switch (status) {
      case "draft": return t("velrepeatV2.statusDraft");
      case "active": return t("velrepeatV2.statusActive");
      case "paused": return t("velrepeatV2.statusPaused");
      case "processing": return t("velrepeatV2.statusProcessing");
      case "payment_failed": return t("velrepeatV2.statusPaymentFailed");
      case "cancelled": return t("velrepeatV2.statusCancelled");
      case "completed": return t("velrepeatV2.statusCompleted");
      case "out_of_stock": return t("velrepeatV2.statusOutOfStock");
      case "item_unavailable": return t("velrepeatV2.statusItemUnavailable");
      case "price_changed": return t("velrepeatV2.statusPriceChanged");
      default: return status;
    }
  })();
  return (
    <Badge variant={status === "active" ? "default" : "secondary"}>
      {status === "active" && <CheckCircle2 className="mr-1 h-3 w-3" />}
      {label}
    </Badge>
  );
}

/**
 * The plan detail: status, the frozen money, the cycle schedule, and the REAL
 * orders each cycle produced — one per shop, each openable and each with its own
 * tracking number.
 */
function PlanDetailView({ detail }: { detail: V2PlanDetail }) {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const pricing = detail.pricing;

  return (
    <>
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="flex items-center justify-between gap-2">
          <p className="font-medium">{detail.plan.packageName ?? t("velrepeatV2.title")}</p>
          <PlanStatusBadge status={detail.plan.status} />
        </div>
        {detail.plan.status === "draft" && (
          <p className="mt-2 flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t("velrepeatV2.checkingPayment")}
          </p>
        )}
        <dl className="mt-3 divide-y divide-border text-sm">
          <Row
            label={t("velrepeatV2.planCommitment")}
            value={String(detail.plan.commitmentCycles ?? "—")}
          />
          <Row
            label={t("velrepeatV2.planFrequency")}
            value={`${detail.plan.frequencyType} ${detail.plan.intervalValue}`}
          />
          {pricing && (
            <Row
              label={t("velrepeatV2.planTotal")}
              value={formatBaht(Number(pricing.totalPrepaidAmount))}
            />
          )}
          <Row label={t("velrepeatV2.planNextRun")} value={formatLocaleDate(new Date(detail.plan.nextRunAt), lang)} />
        </dl>
      </div>

      {detail.items.length > 0 && (
        <div className="rounded-lg border border-border bg-card p-4 text-sm">
          <p className="mb-2 font-medium">{t("velrepeatV2.reviewProducts")}</p>
          <ul className="space-y-1 text-muted-foreground">
            {detail.items.map((item, i) => (
              <li key={`${item.productName}-${i}`}>
                {item.productName} × {item.quantity} · {item.shopName}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="space-y-2">
        <h2 className="text-base font-semibold">{t("velrepeatV2.cycles")}</h2>
        {detail.cycles.length === 0 && (
          <EmptyState message={t("velrepeatV2.cycles")} detail={t("velrepeatV2.checkingPayment")} />
        )}
        {detail.cycles.map((cycle) => (
          <div key={cycle.id} className="rounded-lg border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium">{t("velrepeatV2.cycleNumber", { count: cycle.cycleNumber })}</p>
              <span className="text-sm text-muted-foreground">{formatLocaleDate(new Date(cycle.scheduledAt), lang)}</span>
            </div>
            <div className="mt-2">
              {cycle.orders.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("velrepeatV2.cycleNoOrders")}</p>
              ) : (
                <ul className="space-y-2">
                  {cycle.orders.map((order) => (
                    <li key={order.id} className="rounded-md border border-border p-2 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex min-w-0 items-center gap-1">
                          <Store className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{order.shopName ?? "—"}</span>
                        </span>
                        {/* The public order number is a STRING end to end: an
                            18-digit value does not survive a JS number. */}
                        <span className="shrink-0 font-mono text-xs">{order.orderNumber}</span>
                      </div>
                      {order.trackingNumber && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {t("velrepeatV2.tracking")}: {order.trackingNumber}
                        </p>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="mt-1 h-7 px-2 text-xs"
                        onClick={() => navigate(`/orders/${order.id}`)}
                      >
                        {t("velrepeatV2.openOrder")}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="pt-2 text-center">
        <Link to="/orders" className="text-sm text-primary underline">
          {t("nav.orders")}
        </Link>
      </div>
    </>
  );
}