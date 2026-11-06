/**
 * IncomePayoutDetail — Net Payout Detail
 * Drill-down page showing actual payout after fees and returns
 */
import { AppHeader } from "@velnox/shared/components/AppHeader";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import {
  formatBaht, formatIsoDate, getOrderStatusMeta,
  shortOrderNumber,
} from "@velnox/shared/lib/commerce";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  AlertTriangle, BadgePercent, ChevronLeft, Landmark,
  PackageCheck, RefreshCw, TrendingDown, TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router";
import {
  bucketByPeriod, bucketLabel,
  type IncomeReportWithGrouped, type Period,
} from "@/lib/income-detail";

const periodLabels: Record<Period, string> = { daily: "\u0E23\u0E32\u0E22\u0E27\u0E31\u0E19", weekly: "\u0E23\u0E32\u0E22\u0E2A\u0E31\u0E1B\u0E14\u0E32\u0E2B\u0E4C", monthly: "\u0E23\u0E32\u0E22\u0E40\u0E14\u0E37\u0E2D\u0E19" };

export default function IncomePayoutDetail() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const sellerIncome = useAction(api.commerce.sellerIncomeReport);

  const period = (searchParams.get("period") ?? "daily") as Period;

  const [report, setReport] = useState<IncomeReportWithGrouped | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const r = await sellerIncome({ period });
      setReport(r as IncomeReportWithGrouped);
      setError(false);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [sellerIncome, period]);

  useEffect(() => { load(); }, [load]);

  const periodData = useMemo(() => {
    const g = report?.grouped ?? [];
    if (g.length === 0) return [];
    const buckets = bucketByPeriod(g, period);
    return buckets.slice(-15).map((b) => {
      // Gross − commission − returns = calculated net per period (real sums).
      const gross = Math.round(b.gross);
      const commission = Math.round(b.commission);
      const returns = Math.round(b.returns);
      return {
        label: bucketLabel(b.date, period),
        gross,
        commission,
        returns,
        payout: Math.max(0, gross - commission - returns),
      };
    });
  }, [report, period]);

  const maxVal = useMemo(() => Math.max(...periodData.map(d => d.gross), 1), [periodData]);

  const handlePeriodChange = (p: Period) => {
    setSearchParams({ period: p });
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <AppHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        {/* Header */}
        <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={() => window.history.back()} className="p-1.5">
              <ChevronLeft className="size-4" />
            </Button>
            <div>
              <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
                <Landmark className="size-4 text-emerald-700" /> {t("sellerDash.income.eyebrow")}
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {t("sellerDash.income.payoutDetail.title")}
              </h1>
              <p className="mt-1 text-sm text-slate-500">{t("sellerDash.income.payoutDetail.subtitle")}</p>
            </div>
          </div>
          <Button variant="outline" size="sm" className="border-slate-200 text-slate-600"
            onClick={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
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
            <Button className="mt-6 bg-slate-900 text-white hover:bg-slate-800"
              onClick={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
              <RefreshCw className="mr-1.5 size-4" />{t("sellerDash.income.retry")}
            </Button>
          </div>
        ) : (
          <>
              {report && (
                <>
            {/* ── Summary KPIs ────────────────────────────────────── */}
            <section className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[
                { icon: Landmark, label: t("sellerDash.income.payoutDetail.netAmount"), value: formatBaht(report.payout), sub: t("sellerDash.income.payoutDetail.title"), color: "text-emerald-700", bg: "bg-emerald-50" },
                { icon: TrendingUp, label: t("sellerDash.income.kpiGross"), value: formatBaht(report.gross), sub: `${report.grossCount.toLocaleString("th-TH")} \u0E0A\u0E34\u0E49\u0E19`, color: "text-emerald-600", bg: "bg-emerald-50" },
                { icon: BadgePercent, label: t("sellerDash.income.kpiFee"), value: `-${formatBaht(report.commission)}`, sub: t("sellerDash.income.kpiFeeSub"), color: "text-slate-600", bg: "bg-slate-50" },
                { icon: TrendingDown, label: t("sellerDash.income.kpiReturns"), value: `-${formatBaht(report.returns)}`, sub: t("sellerDash.income.kpiReturnsSub", { rate: `${(report.returnRate * 100).toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`, count: report.returnCount }), color: "text-amber-600", bg: "bg-amber-50" },
              ].map(({ icon: Icon, label, value, sub, color, bg }) => (
                <div key={label} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
                  <span className={`flex size-9 items-center justify-center rounded-[10px] ${bg} ${color} mb-3`}>
                    <Icon className="size-4.5" />
                  </span>
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className={`mt-1 text-xl font-bold tabular-nums tracking-tight ${color}`}>{value}</p>
                  {sub && <p className="mt-0.5 text-[11px] text-slate-400">{sub}</p>}
                </div>
              ))}
            </section>

            {/* ── Period Selector + Stacked Chart ─────────────────── */}
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Landmark className="size-4 text-emerald-700" /> {t("sellerDash.income.payoutDetail.chartTitle", { period: periodLabels[period] })}
                </h2>
                <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
                  {(["daily", "weekly", "monthly"] as Period[]).map((p) => (
                    <button key={p} onClick={() => handlePeriodChange(p)}
                      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${period === p ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}>
                      {periodLabels[p]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mt-6">
                {periodData.length === 0 ? (
                  <div className="flex flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center">
                    <Landmark className="size-6 text-slate-300" />
                    <p className="mt-2 text-sm text-slate-500">{t("sellerDash.income.payoutDetail.noData")}</p>
                    <p className="mt-1 text-xs text-slate-400">{t("sellerDash.income.payoutDetail.noDataDesc")}</p>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-end gap-1.5 h-32 sm:h-40" role="img" aria-label={`${periodLabels[period]} payout breakdown`}>
                      {periodData.map((d, i) => {
                        const grossH = (d.gross / (maxVal || 1)) * 100;
                        const commH = (d.commission / (maxVal || 1)) * 100;
                        const retH = (d.returns / (maxVal || 1)) * 100;
                        return (
                          <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                            <span className="text-[10px] font-semibold tabular-nums text-emerald-700">
                              {formatBaht(d.payout)}
                            </span>
                            <div className="w-full flex flex-col-reverse rounded-t-md overflow-hidden" style={{ height: `${grossH}%` }}>
                              <div className="w-full bg-gradient-to-t from-emerald-400 to-emerald-500 transition-all"
                                style={{ height: `${Math.max(0, grossH - commH - retH)}%` }} />
                              <div className="w-full bg-amber-400 transition-all"
                                style={{ height: `${retH}%` }} />
                              <div className="w-full bg-gradient-to-t from-slate-400 to-slate-500 transition-all"
                                style={{ height: `${commH}%` }} />
                            </div>
                            <span className="text-[9px] text-slate-400 truncate w-full text-center">{d.label}</span>
                          </div>
                        );
                      })}
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-4 text-[11px] text-slate-500">
                      <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-gradient-to-b from-emerald-400 to-emerald-500" /> {t("sellerDash.income.payoutDetail.colNet")}</span>
                      <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-amber-400" /> {t("sellerDash.income.payoutDetail.colReturns")}</span>
                      <span className="flex items-center gap-1"><span className="size-2.5 rounded-sm bg-slate-400" /> {t("sellerDash.income.payoutDetail.colFee")}</span>
                    </div>
                  </div>
                )}
              </div>
            </section>

            {/* ── Transaction Table ───────────────────────────────── */}
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="p-5 border-b border-slate-100">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <Landmark className="size-4 text-emerald-700" /> {t("sellerDash.income.payoutDetail.tableTitle")}
                </h2>
                <p className="mt-1 text-xs text-slate-500">{t("sellerDash.income.txCount", { count: report.transactions.length })}</p>
              </div>
              <div className="divide-y divide-slate-100">
                {report.transactions.map((tx) => {
                  const fee = tx.subtotal * (report.commissionRate / 100);
                  const net = tx.subtotal - fee;
                  return (
                    <div key={tx.order.id} className="p-4 sm:p-5 hover:bg-slate-50/60 transition-colors">
                      <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
                        <div className="col-span-2 sm:col-span-2">
                          <p className="text-sm font-semibold tabular-nums text-slate-900">
                            {shortOrderNumber(tx.order.orderNumber)}
                          </p>
                          <p className="text-xs text-slate-400">{formatIsoDate(tx.order.createdAt)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500">{t("sellerDash.income.payoutDetail.colGross")}</p>
                          <p className="text-sm font-semibold tabular-nums text-slate-900">{formatBaht(tx.subtotal)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500">{t("sellerDash.income.payoutDetail.colFee")}</p>
                          <p className="text-sm font-semibold tabular-nums text-red-500">-{formatBaht(fee)}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-xs text-slate-500">{t("sellerDash.income.payoutDetail.colNet")}</p>
                          <p className="text-sm font-bold tabular-nums text-emerald-700">{formatBaht(net)}</p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
            </>
              )}
          </>
        )}
      </main>
    </div>
  );
}
