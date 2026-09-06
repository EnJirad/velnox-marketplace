import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { api } from "@velnox/shared/lib/api-routes";
import { formatBaht, formatLocaleDate, formatLocaleDateTime } from "@velnox/shared/lib/commerce";
import { useAction } from "@velnox/shared/lib/api-routes";
import {
  CalendarClock,
  CalendarDays,
  ImageOff,
  MapPin,
  Package,
  Pause,
  Play,
  RefreshCw,
  ShoppingBag,
  Trash2,
  Wallet,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

// ─── V2: Recurring plans ─────────────────────────────────────────────────────

interface VelRepeatPlanItem {
  id: string;
  productId: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  variantOptionLabels: string | null;
  shopId: string;
  shopName: string;
  quantity: number;
  unitPrice: number;
  productImageUrl: string | null;
}

interface VelRepeatShippingAddress {
  label?: string | null;
  recipientName?: string | null;
  phone?: string | null;
  line1?: string | null;
  line2?: string | null;
  subdistrict?: string | null;
  district?: string | null;
  province?: string | null;
  postalCode?: string | null;
  country?: string | null;
}

interface VelRepeatPlan {
  id: string;
  status: string;
  frequencyType: "days" | "weeks" | "months";
  intervalValue: number;
  nextRunAt: number | null;
  startedAt: number | null;
  endedAt: number | null;
  shippingAddressId: string | null;
  shippingAddress: VelRepeatShippingAddress | null;
  paymentMethod: string;
  currency: string;
  notes: string | null;
  items: VelRepeatPlanItem[];
  lastRun: { status: string; scheduledFor: string; completedAt: string; errorMessage: string } | null;
  createdAt: number;
}

// ─── V1: Buy-ahead packages (legacy) ─────────────────────────────────────────

interface VelRepeatPackage {
  id: string;
  productId: string;
  productName: string;
  productUnit: string;
  variantId: string | null;
  shopId: string;
  shopName: string;
  packageType: string;
  quantityTotal: number;
  quantityDelivered: number;
  unitPrice: number;
  regularUnitPrice: number;
  discountAmount: number;
  totalAmount: number;
  currency: string;
  status: string;
  intervalDays: number;
  startedAt: string | null;
  completedAt: string | null;
  productImageUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

const STATUS_META: Record<string, { badge: string; dot: string }> = {
  pending_payment: {
    badge: "bg-slate-100 text-slate-500 ring-slate-600/10 hover:bg-slate-100",
    dot: "bg-slate-400",
  },
  paid: {
    badge: "bg-blue-50 text-blue-700 ring-blue-600/15 hover:bg-blue-50",
    dot: "bg-blue-500",
  },
  active: {
    badge: "bg-[#ECFDF5] text-emerald-700 ring-emerald-600/15 hover:bg-[#ECFDF5]",
    dot: "bg-[#10B981]",
  },
  paused: {
    badge: "bg-amber-50 text-amber-700 ring-amber-600/15 hover:bg-amber-50",
    dot: "bg-amber-500",
  },
  out_of_stock: {
    badge: "bg-red-50 text-red-700 ring-red-600/15 hover:bg-red-50",
    dot: "bg-red-500",
  },
  completed: {
    badge: "bg-[#ECFDF5] text-emerald-700 ring-emerald-600/15 hover:bg-[#ECFDF5]",
    dot: "bg-[#10B981]",
  },
  cancelled: {
    badge: "bg-slate-100 text-slate-500 ring-slate-600/10 hover:bg-slate-100",
    dot: "bg-slate-400",
  },
  refunded: {
    badge: "bg-red-50 text-red-700 ring-red-600/15 hover:bg-red-50",
    dot: "bg-red-500",
  },
};

const STATUS_LABEL_KEY: Record<string, string> = {
  pending_payment: "velrepeat.statusPending",
  paid: "velrepeat.statusPaid",
  active: "velrepeat.statusActive",
  paused: "velrepeat.statusPaused",
  out_of_stock: "velrepeat.statusPaused",
  completed: "velrepeat.statusCompleted",
  cancelled: "velrepeat.statusCancelled",
  refunded: "velrepeat.statusRefunded",
};

const RUN_STATUS_LABEL_KEY: Record<string, string> = {
  success: "velrepeatPlan.runSuccess",
  failed: "velrepeatPlan.runFailed",
  out_of_stock: "velrepeatPlan.runOutOfStock",
  payment_failed: "velrepeatPlan.runPaymentFailed",
  item_unavailable: "velrepeatPlan.runItemUnavailable",
};

const UNIT_KEY: Record<string, string> = {
  days: "velrepeatPlan.unitDay",
  weeks: "velrepeatPlan.unitWeek",
  months: "velrepeatPlan.unitMonth",
};

export default function VelRepeatPage() {
  const { t, lang } = useLanguage();
  const myPackages = useAction(api.commerce.myVelRepeatPackages);
  const updatePackage = useAction(api.commerce.updateVelRepeatPackage);
  const myPlans = useAction(api.commerce.myVelRepeatPlans);
  const pausePlan = useAction(api.commerce.pauseVelRepeatPlan);
  const resumePlan = useAction(api.commerce.resumeVelRepeatPlan);
  const cancelPlan = useAction(api.commerce.cancelVelRepeatPlan);
  const runPlanNow = useAction(api.commerce.runVelRepeatPlanNow);

  const [packages, setPackages] = useState<VelRepeatPackage[] | null>(null);
  const [plans, setPlans] = useState<VelRepeatPlan[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(false);
    try {
      const [rows, planRows] = await Promise.all([
        myPackages(),
        myPlans(),
      ]);
      setPackages((rows ?? []) as unknown as VelRepeatPackage[]);
      setPlans((planRows ?? []) as unknown as VelRepeatPlan[]);
    } catch (err) {
      console.error("VelRepeat load error:", err);
      setLoadError(true);
      setPackages((prev) => prev ?? []);
      setPlans((prev) => prev ?? []);
    }
  }, [myPackages, myPlans]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (pkg: VelRepeatPackage, action: "pause" | "resume" | "cancel") => {
    setBusyId(pkg.id);
    try {
      await updatePackage({ packageId: pkg.id, action });
      const label =
        action === "resume"
          ? t("velrepeat.resumed")
          : action === "pause"
            ? t("velrepeat.pausedMsg")
            : t("velrepeat.cancelledMsg");
      toast.success(label);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("velrepeat.failed"));
    } finally {
      setBusyId(null);
    }
  };

  const planAction = async (
    plan: VelRepeatPlan,
    action: "pause" | "resume" | "cancel" | "run-now",
  ) => {
    setBusyId(plan.id);
    try {
      if (action === "pause") await pausePlan({ planId: plan.id });
      else if (action === "resume") await resumePlan({ planId: plan.id });
      else if (action === "cancel") await cancelPlan({ planId: plan.id });
      else await runPlanNow({ planId: plan.id });
      toast.success(
        action === "pause"
          ? t("velrepeat.pausedMsg")
          : action === "resume"
            ? t("velrepeat.resumed")
            : action === "cancel"
              ? t("velrepeat.cancelledMsg")
              : t("velrepeatPlan.runNowSuccess"),
      );
      await load();
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : action === "run-now"
            ? t("velrepeatPlan.runNowFailed")
            : t("velrepeat.failed"),
      );
    } finally {
      setBusyId(null);
    }
  };

  const packageTypeLabel = (type: string) => {
    switch (type) {
      case "weekly": return t("velrepeat.weekly");
      case "monthly": return t("velrepeat.monthly");
      default: return type;
    }
  };

  const planFrequencyLabel = (plan: VelRepeatPlan) => {
    const unit = t(UNIT_KEY[plan.frequencyType] ?? "velrepeatPlan.unitDay");
    return t("velrepeatPlan.everyLabel", { count: plan.intervalValue, unit });
  };

  /**
   * Calendar-day distance between today and the target date (local timezone —
   * never shifts the day, unlike naive UTC parsing of date-only values).
   */
  const relativeRunLabel = (ts: number | null): string => {
    if (!ts) return "";
    const now = new Date();
    const target = new Date(ts);
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startTarget = new Date(target.getFullYear(), target.getMonth(), target.getDate()).getTime();
    const diffDays = Math.round((startTarget - startToday) / 86_400_000);
    if (diffDays === 0) return t("velrepeatPlan.today");
    if (diffDays === 1) return t("velrepeatPlan.tomorrow");
    if (diffDays > 1) return t("velrepeatPlan.inDays", { count: diffDays });
    return t("velrepeatPlan.overdue", { count: Math.abs(diffDays) });
  };

  const planCycleTotal = (plan: VelRepeatPlan) =>
    plan.items.reduce((sum, i) => sum + i.unitPrice * i.quantity, 0);

  const formatAddress = (addr: VelRepeatShippingAddress | null): string => {
    if (!addr) return "";
    const parts = [addr.line1, addr.subdistrict, addr.district, addr.province, addr.postalCode]
      .filter((v): v is string => Boolean(v));
    const base = parts.join(", ");
    return addr.recipientName ? `${addr.recipientName} · ${base}` : base;
  };

  const paymentLabel = (method: string): string => {
    if (method === "cod") return t("paymentMethods.cod");
    if (method === "online") return t("paymentMethods.online");
    return method;
  };

  // Dashboard stats (computed from real plan data only)
  const activePlans = (plans ?? []).filter((p) => p.status === "active");
  const nextOrderTs = activePlans.length
    ? Math.min(...activePlans.map((p) => p.nextRunAt ?? Number.POSITIVE_INFINITY))
    : null;
  const perCycleSpend = activePlans.reduce((sum, p) => sum + planCycleTotal(p), 0);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <section className="border-b border-slate-100 bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <RefreshCw className="size-4 text-[#10B981]" />
            {t("velrepeat.eyebrow")}
          </p>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-900 sm:text-3xl">
            {t("velrepeat.title")}
          </h1>
          <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">{t("velrepeat.desc")}</p>
        </div>
      </section>

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {plans === null && packages === null ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={`stat-${i}`} className="h-24 rounded-2xl" />
              ))}
            </div>
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-2xl" />
            ))}
          </div>
        ) : (
          <div className="space-y-10">
            {/* ─── Dashboard stats (V2 plans) ───────────────────────── */}
            {(plans ?? []).length > 0 && (
              <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <Zap className="size-3.5 text-[#10B981]" />
                    {t("velrepeatPlan.statActive")}
                  </div>
                  <p className="mt-1.5 text-2xl font-extrabold tabular-nums text-slate-900">
                    {activePlans.length}
                  </p>
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <CalendarDays className="size-3.5 text-[#10B981]" />
                    {t("velrepeatPlan.statNextOrder")}
                  </div>
                  <p className="mt-1.5 text-base font-bold tabular-nums text-slate-900 sm:text-lg">
                    {nextOrderTs != null ? formatLocaleDate(nextOrderTs, lang) : "—"}
                  </p>
                  {nextOrderTs != null && (
                    <p className="mt-0.5 text-xs font-medium text-[#047857]">
                      {relativeRunLabel(nextOrderTs)}
                    </p>
                  )}
                </div>
                <div className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-xs font-medium text-slate-500">
                    <Wallet className="size-3.5 text-[#10B981]" />
                    {t("velrepeatPlan.statPerCycleSpend")}
                  </div>
                  <p className="mt-1.5 text-2xl font-extrabold tabular-nums text-slate-900">
                    {formatBaht(perCycleSpend)}
                  </p>
                </div>
              </section>
            )}

            {/* ─── Load error + retry ───────────────────────────────── */}
            {loadError && (plans ?? []).length === 0 && (
              <section className="flex flex-col items-center rounded-2xl border border-red-100 bg-red-50 px-6 py-10 text-center">
                <h3 className="text-sm font-semibold text-red-700">{t("velrepeatPlan.loadFailed")}</h3>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 gap-1.5 border-red-200 text-red-700 hover:bg-red-100"
                  onClick={() => void load()}
                >
                  <RefreshCw className="size-3.5" />
                  {t("common.retry")}
                </Button>
              </section>
            )}

            {/* ─── V2: Recurring plans ─────────────────────────────── */}
            <section>
              <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-900">
                <Zap className="size-4 text-[#10B981]" />
                {t("velrepeatPlan.myPlans")}
              </h2>

              {(plans ?? []).length === 0 ? (
                <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-[#ECFDF5]">
                    <CalendarClock className="size-6 text-[#10B981]" />
                  </span>
                  <h3 className="mt-4 text-sm font-semibold text-slate-900">{t("velrepeatPlan.noPlans")}</h3>
                  <p className="mt-1 max-w-sm text-xs leading-5 text-slate-500">{t("velrepeatPlan.noPlansDesc")}</p>
                  <Button
                    asChild
                    className="mt-5 gap-1.5"
                  >
                    <Link to="/products">
                      <ShoppingBag className="size-4" />
                      {t("velrepeat.pickProducts")}
                    </Link>
                  </Button>
                </div>
              ) : (
                <div className="space-y-3">
                  {(plans ?? []).map((plan) => {
                    const meta = STATUS_META[plan.status] ?? STATUS_META.active;
                    const labelKey = STATUS_LABEL_KEY[plan.status] ?? "velrepeat.statusActive";
                    const editable = ["active", "paused", "out_of_stock"].includes(plan.status);
                    const isExpanded = expandedId === plan.id;
                    const cycleTotal = planCycleTotal(plan);
                    const address = formatAddress(plan.shippingAddress);
                    const runStatusLabel = plan.lastRun
                      ? t(RUN_STATUS_LABEL_KEY[plan.lastRun.status] ?? plan.lastRun.status)
                      : "";
                    return (
                      <div key={plan.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                        <div className="p-4 sm:p-5">
                          {/* header: status + frequency */}
                          <div className="flex flex-wrap items-center gap-2">
                            <Badge className={`gap-1 rounded-full ring-1 ring-inset ${meta.badge}`}>
                              <span className={`size-1.5 rounded-full ${meta.dot}`} />
                              {t(labelKey) || plan.status}
                            </Badge>
                            <Badge className="rounded-full bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-600/10 hover:bg-slate-100">
                              {planFrequencyLabel(plan)}
                            </Badge>
                            {plan.items.length > 1 && (
                              <Badge className="rounded-full bg-slate-100 text-slate-500 ring-1 ring-inset ring-slate-600/10 hover:bg-slate-100">
                                {t("velrepeatPlan.itemsCount", { count: plan.items.length })}
                              </Badge>
                            )}
                          </div>

                          {/* next run — the hero info for active plans */}
                          {plan.status === "active" && plan.nextRunAt != null && (
                            <div className="mt-4 flex items-center justify-between gap-3 rounded-xl border border-emerald-100 bg-[#ECFDF5] px-4 py-3">
                              <div className="min-w-0">
                                <p className="text-[11px] font-medium uppercase tracking-wide text-[#047857]">
                                  {t("velrepeatPlan.nextRunLabel")}
                                </p>
                                <p className="mt-0.5 text-lg font-extrabold tabular-nums leading-tight text-slate-900 sm:text-xl">
                                  {formatLocaleDate(plan.nextRunAt, lang)}
                                </p>
                              </div>
                              <span className="shrink-0 rounded-full bg-white px-2.5 py-1 text-xs font-semibold text-[#047857] ring-1 ring-inset ring-emerald-200">
                                {relativeRunLabel(plan.nextRunAt)}
                              </span>
                            </div>
                          )}

                          {/* items */}
                          <div className="mt-4 space-y-2.5">
                            {plan.items.map((item) => (
                              <div key={item.id} className="flex min-w-0 items-center gap-3">
                                {item.productImageUrl ? (
                                  <img
                                    src={item.productImageUrl}
                                    alt={item.productName}
                                    className="size-12 shrink-0 rounded-xl border border-slate-100 object-cover sm:size-14"
                                    loading="lazy"
                                  />
                                ) : (
                                  <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-slate-50 sm:size-14">
                                    <ImageOff className="size-5 text-slate-300" />
                                  </span>
                                )}
                                <div className="min-w-0 flex-1">
                                  <Link
                                    to={`/products/${item.productId}`}
                                    className="block truncate text-sm font-semibold text-slate-900 hover:text-[#10B981]"
                                  >
                                    {item.productName}
                                  </Link>
                                  <p className="truncate text-xs text-slate-500">
                                    {item.variantOptionLabels || item.variantName || ""}
                                    {item.variantOptionLabels || item.variantName ? " · " : ""}
                                    <span className="font-semibold text-slate-700">×{item.quantity}</span>
                                  </p>
                                  {item.shopName && (
                                    <p className="truncate text-[11px] text-slate-400">{item.shopName}</p>
                                  )}
                                </div>
                                <span className="shrink-0 text-sm font-bold tabular-nums text-slate-900">
                                  {formatBaht(item.unitPrice * item.quantity)}
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* per-cycle total */}
                          <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
                            <span className="text-xs font-medium text-slate-500">{t("velrepeatPlan.itemsSubtotal")}</span>
                            <span className="text-sm font-bold tabular-nums text-slate-900">
                              {t("velrepeatPlan.perCycle", { amount: formatBaht(cycleTotal) })}
                            </span>
                          </div>

                          {/* delivery / payment / created */}
                          {(address || plan.paymentMethod) && (
                            <div className="mt-3 space-y-1.5">
                              {address && (
                                <p className="flex items-start gap-1.5 text-xs leading-5 text-slate-500">
                                  <MapPin className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
                                  <span className="min-w-0">
                                    <span className="font-medium text-slate-600">{t("velrepeatPlan.delivery")}: </span>
                                    <span className="break-words">{address}</span>
                                  </span>
                                </p>
                              )}
                              {plan.paymentMethod && (
                                <p className="flex items-center gap-1.5 text-xs leading-5 text-slate-500">
                                  <Wallet className="size-3.5 shrink-0 text-slate-400" />
                                  <span className="min-w-0">
                                    <span className="font-medium text-slate-600">{t("velrepeatPlan.payment")}: </span>
                                    {paymentLabel(plan.paymentMethod)}
                                  </span>
                                </p>
                              )}
                              <p className="flex items-center gap-1.5 text-xs leading-5 text-slate-400">
                                <CalendarClock className="size-3.5 shrink-0" />
                                {t("velrepeatPlan.createdOn", { date: formatLocaleDate(plan.createdAt, lang) })}
                              </p>
                            </div>
                          )}

                          {/* actions */}
                          <div className="mt-4 flex flex-wrap items-center gap-2">
                            {plan.status === "active" && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1.5 border-emerald-200 bg-[#ECFDF5] text-emerald-700 hover:bg-[#D1FAE5]"
                                  disabled={busyId === plan.id}
                                  onClick={() => planAction(plan, "run-now")}
                                >
                                  <Zap className="size-3.5" />
                                  {t("velrepeatPlan.runNow")}
                                </Button>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1.5 border-slate-200 text-slate-600"
                                  disabled={busyId === plan.id}
                                  onClick={() => planAction(plan, "pause")}
                                >
                                  <Pause className="size-3.5" />
                                  {t("velrepeat.pause")}
                                </Button>
                              </>
                            )}
                            {plan.status === "paused" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 border-emerald-200 bg-[#ECFDF5] text-emerald-700 hover:bg-[#D1FAE5]"
                                disabled={busyId === plan.id}
                                onClick={() => planAction(plan, "resume")}
                              >
                                <Play className="size-3.5" />
                                {t("velrepeat.resume")}
                              </Button>
                            )}
                            {plan.status === "out_of_stock" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 border-emerald-200 bg-[#ECFDF5] text-emerald-700 hover:bg-[#D1FAE5]"
                                disabled={busyId === plan.id}
                                onClick={() => planAction(plan, "resume")}
                              >
                                <Play className="size-3.5" />
                                {t("velrepeat.resume")}
                              </Button>
                            )}
                            {editable && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1.5 border-slate-200 text-slate-600"
                                  onClick={() => setExpandedId(isExpanded ? null : plan.id)}
                                >
                                  <CalendarDays className="size-3.5" />
                                  {t("velrepeatPlan.history")}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-1.5 text-red-600 hover:bg-red-50"
                                  disabled={busyId === plan.id}
                                  onClick={() => planAction(plan, "cancel")}
                                >
                                  <Trash2 className="size-3.5" />
                                  {t("velrepeat.cancel")}
                                </Button>
                              </>
                            )}
                          </div>

                          {plan.status === "out_of_stock" && (
                            <p className="mt-3 text-[11px] leading-4 text-red-600">{t("velrepeatPlan.outOfStockHint")}</p>
                          )}
                        </div>

                        {isExpanded && (
                          <div className="border-t border-slate-100 bg-slate-50 px-4 py-4 sm:px-5">
                            <p className="text-xs font-semibold text-slate-500">{t("velrepeatPlan.lastRun")}</p>
                            {plan.lastRun ? (
                              <div className="mt-1.5 space-y-1 text-xs leading-5 text-slate-600">
                                <p className="flex flex-wrap items-center gap-2">
                                  <Badge className="gap-1 rounded-full bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-600/10 hover:bg-slate-100">
                                    <span className="size-1.5 rounded-full bg-slate-400" />
                                    {runStatusLabel}
                                  </Badge>
                                  <span className="tabular-nums">
                                    {formatLocaleDateTime(plan.lastRun.completedAt || plan.lastRun.scheduledFor, lang)}
                                  </span>
                                </p>
                                {plan.lastRun.errorMessage && (
                                  <p className="break-words text-red-600">{plan.lastRun.errorMessage}</p>
                                )}
                              </div>
                            ) : (
                              <p className="mt-1.5 text-xs text-slate-400">—</p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>

            {/* ─── V1: Buy-ahead packages (legacy) ─────────────────── */}
            {(packages ?? []).length > 0 && (
              <section>
                <h2 className="mb-3 flex items-center gap-2 text-base font-bold text-slate-900">
                  <Package className="size-4 text-[#10B981]" />
                  {t("velrepeat.legacyPackages") || "VelRepeat Packages"}
                </h2>
                <div className="space-y-3">
                  {(packages ?? []).map((pkg) => {
                    const meta = STATUS_META[pkg.status] ?? STATUS_META.pending_payment;
                    const labelKey = STATUS_LABEL_KEY[pkg.status] ?? "velrepeat.statusPending";
                    const editable = ["active", "paused"].includes(pkg.status);
                    const progress = pkg.quantityTotal > 0 ? (pkg.quantityDelivered / pkg.quantityTotal) * 100 : 0;
                    const isExpanded = expandedId === `pkg-${pkg.id}`;
                    return (
                      <div
                        key={pkg.id}
                        className="rounded-2xl border border-slate-200 bg-white p-5"
                      >
                        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                          <Link to={`/products/${pkg.productId}`} className="shrink-0">
                            {pkg.productImageUrl ? (
                              <img
                                src={pkg.productImageUrl}
                                alt={pkg.productName}
                                className="size-16 rounded-[12px] border border-slate-100 object-cover"
                                loading="lazy"
                              />
                            ) : (
                              <span className="flex size-16 items-center justify-center rounded-[12px] bg-slate-50">
                                <ImageOff className="size-6 text-slate-300" />
                              </span>
                            )}
                          </Link>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <Link
                                to={`/products/${pkg.productId}`}
                                className="truncate text-sm font-semibold text-slate-900 hover:text-[#10B981]"
                              >
                                {pkg.productName}
                              </Link>
                              <Badge className={`gap-1 rounded-full ring-1 ring-inset ${meta.badge}`}>
                                <span className={`size-1.5 rounded-full ${meta.dot}`} />
                                {t(labelKey) || pkg.status}
                              </Badge>
                              <Badge className="rounded-full bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-600/10 hover:bg-slate-100">
                                {packageTypeLabel(pkg.packageType)}
                              </Badge>
                            </div>
                            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                              <span>
                                {pkg.quantityDelivered}/{pkg.quantityTotal} {pkg.productUnit}
                              </span>
                              <span>
                                {t("velrepeat.price")} <span className="font-semibold tabular-nums text-slate-900">{formatBaht(pkg.unitPrice)}</span>
                              </span>
                              <span className="font-semibold tabular-nums text-slate-900">
                                {formatBaht(pkg.totalAmount)}
                              </span>
                            </div>
                            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                              <div className="h-full rounded-full bg-[#10B981] transition-all" style={{ width: `${progress}%` }} />
                            </div>
                            <p className="mt-1 text-[11px] text-slate-400">
                              {pkg.status === "completed"
                                ? t("velrepeat.completedHint") || "All deliveries completed"
                                : pkg.status === "active"
                                  ? `${pkg.quantityDelivered}/${pkg.quantityTotal} delivered`
                                  : t("velrepeat.pausedHint")}
                            </p>
                          </div>

                          <div className="flex shrink-0 flex-wrap items-center gap-2">
                            {pkg.status === "active" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 border-slate-200 text-slate-600"
                                disabled={busyId === pkg.id}
                                onClick={() => changeStatus(pkg, "pause")}
                              >
                                <Pause className="size-3.5" />
                                {t("velrepeat.pause")}
                              </Button>
                            )}
                            {pkg.status === "paused" && (
                              <Button
                                variant="outline"
                                size="sm"
                                className="gap-1.5 border-emerald-200 bg-[#ECFDF5] text-emerald-700 hover:bg-[#D1FAE5]"
                                disabled={busyId === pkg.id}
                                onClick={() => changeStatus(pkg, "resume")}
                              >
                                <Play className="size-3.5" />
                                {t("velrepeat.resume")}
                              </Button>
                            )}
                            {editable && (
                              <>
                                <Button
                                  variant="outline"
                                  size="sm"
                                  className="gap-1.5 border-slate-200 text-slate-600"
                                  onClick={() => setExpandedId(isExpanded ? null : `pkg-${pkg.id}`)}
                                >
                                  {t("velrepeat.viewSchedule") || "View Schedule"}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="gap-1.5 text-red-600 hover:bg-red-50"
                                  disabled={busyId === pkg.id}
                                  onClick={() => changeStatus(pkg, "cancel")}
                                >
                                  <Trash2 className="size-3.5" />
                                  {t("velrepeat.cancel")}
                                </Button>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      <ShopFooter />
    </div>
  );
}