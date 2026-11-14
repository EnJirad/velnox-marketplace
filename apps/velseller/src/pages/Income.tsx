/**
 * Income — Seller earnings dashboard.
 *
 * Features:
 * - KPI cards (gross, returns, commission, net payout)
 * - Period selector (daily / weekly / monthly)
 * - Return analytics (10% threshold tracking per day/week/month)
 * - Product breakdown table
 * - SVG bar/line charts (no dependency)
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppHeader } from "@velnox/shared/components/AppHeader";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { SegmentedOption } from "@velnox/shared/components/ui/segmented";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import {
  commissionOf, formatBaht, formatCommissionRate, formatIsoDate, getOrderStatusMeta,
  shortOrderNumber, type StoreOrder, type StoreOrderItem,
} from "@velnox/shared/lib/commerce";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  AlertTriangle, BadgePercent, ChevronDown, ChevronRight, Landmark, Loader2,
  PackageCheck, Receipt, RefreshCw, ShieldCheck, TrendingUp, TrendingDown, Wallet,
  BarChart3, PieChart, ArrowUpRight, CalendarDays, PackageSearch,
} from "lucide-react";
import { toast } from "@velnox/shared/lib/flash-toast";
import { Link } from "react-router";
import {
  bucketByPeriod, bucketLabel,
  type GroupedDay, type Period,
} from "@/lib/income-detail";

const pct = (value: number) => `${(value * 100).toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`;

interface TransactionRow {
  order: StoreOrder; items: StoreOrderItem[]; subtotal: number; pending: boolean;
}

interface IncomeReport {
  gross: number; grossCount: number; grossDeliveredCount: number; returns: number; returnCount: number; returnShippedCount: number;
  commission: number; commissionRate: number; returnRate: number;
  returnCoverage: number; payout: number; transactions: TransactionRow[];
  grouped?: GroupedDay[];
  items?: Array<{
    orderId: string;
    orderStatus: string;
    itemId: string;
    productName: string;
    quantity: number;
    unitPrice: number;
    subtotal: number;
    isCommissionEligible: boolean;
    commissionAmount: number;
    isReturnEligible: boolean;
    returnAmount: number;
  }>;
}

export default function Income() {
  const sellerIncome = useAction(api.commerce.sellerIncomeReport);
  const { t } = useLanguage();
  const [report, setReport] = useState<IncomeReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [period, setPeriod] = useState<Period>("daily");
  const [showReturnDetail, setShowReturnDetail] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await sellerIncome();
      setReport(r as IncomeReport);
      setError(false);
    } catch {
      setError(true);
    }
  }, [sellerIncome]);

  useEffect(() => {
    let alive = true;
    load().finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [load]);

  const { gross, grossCount, grossDeliveredCount, returns, returnCount, returnShippedCount, commission, commissionRate, returnRate, returnCoverage, payout, transactions, grouped, items } = report ?? { gross: 0, grossCount: 0, grossDeliveredCount: 0, returns: 0, returnCount: 0, returnShippedCount: 0, commission: 0, commissionRate: 0.03, returnRate: 0, returnCoverage: 0, payout: 0, transactions: [] as TransactionRow[], grouped: undefined as GroupedDay[] | undefined, items: [] };

  // Real per-day buckets from the backend, aggregated to the selected period.
  // Empty until actual orders exist — never a synthetic spread.
  const periodData = useMemo(() => {
    const g = grouped ?? [];
    if (g.length === 0) return [];
    const buckets = bucketByPeriod(g, period);
    return buckets.slice(-15).map((b) => ({
      label: bucketLabel(b.date, period),
      value: Math.round(b.gross),
      returns: Math.round(b.returns),
    }));
  }, [grouped, period]);

  const maxVal = Math.max(...periodData.map(d => d.value), 1);

  // Return overage per policy: 10% coverage
  const overageAmount = Math.max(0, returns - gross * returnCoverage);

  const periodLabels: Record<Period, string> = { daily: "รายวัน", weekly: "รายสัปดาห์", monthly: "รายเดือน" };

  return (
    <div className="min-h-screen bg-background text-slate-900">
      <AppHeader />

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
              <Wallet className="size-4 text-emerald-500" /> {t("sellerDash.income.eyebrow")}
            </p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{t("sellerDash.income.title")}</h1>
            <p className="mt-1 text-sm text-slate-500">{t("sellerDash.income.subtitle")}</p>
          </div>
          <Button variant="outline" size="sm" className="border-slate-200 text-slate-600" onClick={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
            <RefreshCw className="mr-1.5 size-3.5" /> {t("common.refresh")}
          </Button>
        </div>

        {loading ? (
          <div className="mt-8 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[...Array(4)].map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
            </div>
          </div>
        ) : error ? (
          <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-50"><AlertTriangle className="size-7 text-amber-600" /></span>
            <h2 className="mt-4 text-lg font-semibold text-slate-900">{t("sellerDash.income.errorTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("sellerDash.income.errorDesc")}</p>
            <Button className="mt-6 bg-slate-900 text-white hover:bg-slate-800" onClick={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
              <RefreshCw className="mr-1.5 size-4" />{t("sellerDash.income.retry")}
            </Button>
          </div>
        ) : (
          <>
            {/* ── KPI Cards (clickable → drill-down detail) ────── */}
            <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { href: "/seller/income/gross", icon: TrendingUp, label: t("sellerDash.income.kpiGross"), value: formatBaht(gross), sub: t("sellerDash.income.kpiGrossSub", { count: grossCount }), color: "text-emerald-600", bg: "bg-emerald-50" },
                { href: "/seller/income/returns", icon: TrendingDown, label: t("sellerDash.income.kpiReturns"), value: formatBaht(returns), sub: t("sellerDash.income.kpiReturnsSub", { rate: pct(returnRate), count: returnCount }), color: "text-amber-600", bg: "bg-amber-50" },
                { href: "/seller/income/commission", icon: BadgePercent, label: t("sellerDash.income.kpiFee"), value: `-${formatBaht(commission)}`, sub: t("sellerDash.income.kpiFeeSub"), color: "text-slate-600", bg: "bg-slate-50" },
                { href: "/seller/income/payout", icon: Wallet, label: t("sellerDash.income.kpiPayout"), value: formatBaht(payout), sub: t("sellerDash.income.kpiPayoutSub"), color: "text-emerald-700", bg: "bg-emerald-50" },
              ].map(({ href, icon: Icon, label, value, sub, color, bg }) => (
                <Link key={label} to={href} className="group rounded-2xl border border-slate-200 bg-white p-4 sm:p-5 transition-[transform,border-color,box-shadow] hover:-translate-y-0.5 hover:border-emerald-300 hover:shadow-md">
                  <span className={`flex size-9 items-center justify-center rounded-md ${bg} ${color} mb-3`}>
                    <Icon className="size-4.5" />
                  </span>
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className={`mt-1 text-xl font-bold tabular-nums tracking-tight ${color.includes("emerald") ? "text-emerald-700" : color.includes("amber") ? "text-amber-700" : "text-slate-900"}`}>
                    {value}
                  </p>
                  <p className="mt-0.5 text-2xs text-slate-400">{sub}</p>
                  <p className="mt-2 flex items-center gap-1 text-2xs font-semibold text-emerald-600 opacity-0 transition-opacity group-hover:opacity-100">
                    ดูรายละเอียด <ChevronRight className="size-3" />
                  </p>
                </Link>
              ))}
            </section>

            {/* ── Period Selector + Charts ─────────────────────── */}
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <BarChart3 className="size-4 text-emerald-500" /> ภาพรวม {periodLabels[period]}
                </h2>
                <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                  {(["daily", "weekly", "monthly"] as Period[]).map((p) => (
                    <SegmentedOption key={p} active={period === p} onClick={() => setPeriod(p)}>{periodLabels[p]}</SegmentedOption>
                  ))}
                </div>
              </div>

              <div className="mt-6">
                {periodData.length === 0 ? (
                  <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center">
                    <BarChart3 className="size-6 text-slate-300" />
                    <p className="mt-2 text-sm text-slate-500">ยังไม่มีข้อมูลรายได้ราย{periodLabels[period]}</p>
                    <p className="mt-1 text-xs text-slate-400">ข้อมูลจะปรากฏเมื่อมีคำสั่งซื้อที่เสร็จสิ้นจริง</p>
                  </div>
                ) : (
                <div className="flex h-40 items-stretch gap-1.5 sm:h-48" role="img" aria-label={`${periodLabels[period]} revenue chart`}>
                  {periodData.map((d, i) => (
                    <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center">
                      {/* Value on top, bar in the middle, label at the bottom.
                          The bar area is its own box with a DEFINITE height, so a
                          percentage bar has something to be a percentage OF: the
                          rows are `base` + `bar` (flex-1) + `label`. Previously the
                          value label sat above the bar inside the same full-height
                          column, so the bar's 100% could exceed the space left and
                          the column simply clipped — a tall period showed no bar.
                          A 6px floor keeps a small day visible instead of a
                          hairline. */}
                      <span className="mb-1 text-2xs font-semibold tabular-nums text-slate-900">
                        {formatBaht(d.value).replace("฿", "")}
                      </span>
                      <div className="flex w-full flex-1 items-end" style={{ minHeight: 0 }}>
                        <div
                          className="w-full rounded-t-md bg-emerald-500 transition-[height] duration-300 ease-out"
                          style={{
                            height: `${Math.max((d.value / maxVal) * 100, d.value > 0 ? 6 : 0)}%`,
                          }}
                        />
                      </div>
                      <span className="mt-1 w-full truncate text-center text-2xs text-slate-400">{d.label}</span>
                    </div>
                  ))}
                </div>
                )}
              </div>
            </section>

            {/* ── Product Breakdown ────────────────────────────── */}
            {transactions.length > 0 && (
              <section className="mt-6 rounded-2xl border border-slate-200 bg-white overflow-hidden">
                <div className="p-5 border-b border-slate-100">
                  <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                    <Receipt className="size-4 text-emerald-500" /> {t("sellerDash.income.recentTitle")}
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">{t("sellerDash.income.txCount", { count: transactions.length })}</p>
                </div>
                <div className="divide-y divide-slate-100">
                  {transactions.map((tx) => {
                    const fee = commissionOf(tx.subtotal, commissionRate);
                    return (
                      <div key={tx.order.id} className="p-4 sm:p-5 hover:bg-slate-50/60 transition-colors">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div>
                            <p className="text-sm font-semibold tabular-nums text-slate-900">
                              {shortOrderNumber(tx.order.orderNumber)}
                            </p>
                            <p className="text-xs text-slate-400">{formatIsoDate(tx.order.createdAt)}</p>
                          </div>
                          <Badge variant="secondary" className={`text-xs ${getOrderStatusMeta(tx.order.status)?.badge ?? "bg-slate-100"}`}>
                            {getOrderStatusMeta(tx.order.status)?.label ?? tx.order.status}
                          </Badge>
                        </div>

                        {/* Items */}
                        {tx.items.map((item) => (
                          <div key={`${item.id}-${item.productName}`} className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-slate-700 truncate">{item.productName}</p>
                              <p className="text-xs text-slate-400">{item.quantity} × {formatBaht(item.unitPrice)}</p>
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-sm font-semibold tabular-nums text-slate-900">{formatBaht(item.quantity * item.unitPrice)}</p>
                              <p className="text-2xs text-slate-400">ค่าธรรมเนียม -{formatBaht(commissionOf(item.quantity * item.unitPrice, commissionRate))}</p>
                            </div>
                          </div>
                        ))}

                        {/* Summary */}
                        <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                          <span>รวม {tx.items.length} รายการ</span>
                          <span className="font-semibold text-slate-900">
                            {tx.pending ? "รอดำเนินการ" : `${formatBaht(tx.subtotal)}`}
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <p className="flex items-center justify-center gap-1.5 px-5 py-4 text-xs text-slate-400 border-t border-slate-100">
                  <PackageCheck className="size-3.5 text-emerald-500" />
                  {t("sellerDash.income.feeFootnote")}
                </p>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
