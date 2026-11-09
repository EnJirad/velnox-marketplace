/**
 * IncomeCommissionDetail — รายละเอียดค่าธรรมเนียม 3% (Commission)
 * Drill-down page from Income KPI card
 */
import { AppHeader } from "@velnox/shared/components/AppHeader";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import {
  formatBaht, formatIsoDate, getOrderStatusMeta,
  shortOrderNumber, type StoreOrder, type StoreOrderItem,
} from "@velnox/shared/lib/commerce";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  AlertTriangle, BadgePercent, ChevronLeft, PackageCheck,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  bucketByPeriod, bucketLabel,
  type IncomeReportWithGrouped, type Period,
} from "@/lib/income-detail";

const periodLabels: Record<Period, string> = { daily: "รายวัน", weekly: "รายสัปดาห์", monthly: "รายเดือน" };

export default function IncomeCommissionDetail() {
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
    return buckets.slice(-15).map((b) => ({
      label: bucketLabel(b.date, period),
      value: Math.round(b.gross),
      commission: Math.round(b.commission),
    }));
  }, [report, period]);

  const maxVal = useMemo(() => Math.max(...periodData.map(d => d.value), 1), [periodData]);

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
                <BadgePercent className="size-4 text-slate-500" /> {t("sellerDash.income.eyebrow")}
              </p>
              <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
                {t("sellerDash.income.commissionDetail.title")}
              </h1>
              <p className="mt-1 text-sm text-slate-500">{t("sellerDash.income.commissionDetail.subtitle")}</p>
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
                { icon: BadgePercent, label: t("sellerDash.income.commissionDetail.totalFee"), value: `-${formatBaht(report.commission)}`, sub: `3% ของ ${formatBaht(report.gross)}`, color: "text-slate-600", bg: "bg-slate-50" },
                { icon: PackageCheck, label: t("sellerDash.income.kpiGross"), value: formatBaht(report.gross), sub: `${report.grossCount} ชิ้น`, color: "text-emerald-600", bg: "bg-emerald-50" },
                { icon: BadgePercent, label: "อัตราค่าธรรมเนียม", value: `${report.commissionRate}%`, sub: "ต่อชิ้น", color: "text-slate-600", bg: "bg-slate-50" },
                { icon: BadgePercent, label: "ค่าธรรมเนียมเฉลี่ย/ชิ้น", value: report.grossCount > 0 ? formatBaht(Math.round(report.commission / report.grossCount)) : "-", sub: report.grossCount > 0 ? `จาก ${report.grossCount.toLocaleString("th-TH")} ชิ้น` : "", color: "text-slate-600", bg: "bg-slate-50" },
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

            {/* ── Period Selector + Chart ─────────────────────────── */}
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <BadgePercent className="size-4 text-slate-500" /> {t("sellerDash.income.commissionDetail.chartTitle", { period: periodLabels[period] })}
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
                    <BadgePercent className="size-6 text-slate-300" />
                    <p className="mt-2 text-sm text-slate-500">{t("sellerDash.income.commissionDetail.noData")}</p>
                    <p className="mt-1 text-xs text-slate-400">{t("sellerDash.income.commissionDetail.noDataDesc")}</p>
                  </div>
                ) : (
                <div className="flex items-end gap-1.5 h-32 sm:h-40" role="img" aria-label={`${periodLabels[period]} commission chart`}>
                  {periodData.map((d, i) => (
                    <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                      <span className="text-[10px] font-semibold tabular-nums text-slate-900">
                        -{formatBaht(d.commission)}
                      </span>
                      <div className="w-full flex flex-col-reverse rounded-t-md">
                        <div className="w-full rounded-t-md bg-gradient-to-t from-slate-400 to-slate-500 transition-[width]"
                          style={{ height: `${Math.min((d.commission / (maxVal || 1)) * 100, 100)}%` }} />
                      </div>
                      <span className="text-[9px] text-slate-400 truncate w-full text-center">{d.label}</span>
                    </div>
                  ))}
                </div>
                )}
              </div>
            </section>

            {/* ── Transaction Table ───────────────────────────────── */}
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="p-5 border-b border-slate-100">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <BadgePercent className="size-4 text-slate-500" /> {t("sellerDash.income.commissionDetail.tableTitle")}
                </h2>
                <p className="mt-1 text-xs text-slate-500">{t("sellerDash.income.txCount", { count: report.transactions.length })}</p>
              </div>
              <div className="divide-y divide-slate-100">
                {report.transactions.map((tx) => {
                  const fee = tx.subtotal * (report.commissionRate / 100);
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
                      {tx.items.map((item) => (
                        <div key={`${item.id}-${item.productName}`} className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-slate-700 truncate">{item.productName}</p>
                            <p className="text-xs text-slate-400">{item.quantity} × {formatBaht(item.unitPrice)}</p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="text-sm font-semibold tabular-nums text-slate-900">{formatBaht(item.quantity * item.unitPrice)}</p>
                            <p className="text-[10px] text-slate-400">-{formatBaht(Math.round(item.quantity * item.unitPrice * report.commissionRate / 100))}</p>
                          </div>
                        </div>
                      ))}
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
