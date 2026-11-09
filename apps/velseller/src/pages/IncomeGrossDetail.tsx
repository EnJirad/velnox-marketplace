/**
 * IncomeGrossDetail — รายละเอียดยอดขายรวม (Gross Sales)
 * Drill-down page from Income KPI card
 */
import { AppHeader } from "@velnox/shared/components/AppHeader";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import {
  formatBaht, formatIsoDate, getOrderStatusMeta,
  shortOrderNumber, type StoreOrderItem,
} from "@velnox/shared/lib/commerce";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  AlertTriangle, ChevronLeft, PackageCheck, PackageSearch,
  RefreshCw, TrendingUp,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import {
  bucketByPeriod, bucketLabel,
  type IncomeReportWithGrouped, type TransactionRow, type GroupedDay, type Period,
} from "@/lib/income-detail";

const periodLabels: Record<Period, string> = { daily: "รายวัน", weekly: "รายสัปดาห์", monthly: "รายเดือน" };

export default function IncomeGrossDetail() {
  const { t } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const sellerIncome = useAction(api.commerce.sellerIncomeReport);

  const period = (searchParams.get("period") ?? "daily") as Period;

  const [report, setReport] = useState<IncomeReportWithGrouped | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await sellerIncome();
      setReport(r as IncomeReportWithGrouped);
      setError(false);
    } catch { setError(true); }
  }, [sellerIncome]);

  useEffect(() => {
    let alive = true;
    load().finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [load]);

  const { gross, grossCount, transactions, grouped } = report ?? { gross: 0, grossCount: 0, transactions: [] as TransactionRow[], grouped: undefined as GroupedDay[] | undefined };

  // Real date-grouped buckets from the backend, aggregated into the selected
  // period. Empty when the seller has no orders. Never a synthetic split.
  const periodData = useMemo(() => {
    const g = grouped ?? [];
    if (g.length === 0) return [];
    const buckets = bucketByPeriod(g, period);
    // Keep the most recent 15 buckets so the chart stays readable.
    return buckets.slice(-15).map((b) => ({
      label: bucketLabel(b.date, period),
      value: Math.round(b.gross),
    }));
  }, [grouped, period]);

  const maxVal = Math.max(...periodData.map(d => d.value), 1);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <AppHeader />

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
        <Link to="/seller/income" className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-600 hover:text-emerald-700">
          <ChevronLeft className="size-3.5" />
          {t("common.back")}
        </Link>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
              <TrendingUp className="size-4 text-emerald-500" /> {t("sellerDash.income.eyebrow")}
            </p>
            <h1 className="mt-0.5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">ยอดขายรวม</h1>
            <p className="mt-1 text-sm text-slate-500">รายละเอียดยอดขายทั้งหมดของร้านค้า</p>
          </div>
          <div className="flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
            {(["daily", "weekly", "monthly"] as Period[]).map((p) => (
              <button key={p} onClick={() => setSearchParams({ period: p })}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${period === p ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-700"}`}
              >{periodLabels[p]}</button>
            ))}
          </div>
        </div>

        {loading ? (
          <div className="mt-8 space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[...Array(4)].map((_, i) => <div key={i} className="h-24 animate-pulse rounded-2xl border border-slate-200 bg-white" />)}
            </div>
          </div>
        ) : error ? (
          <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <AlertTriangle className="size-7 text-amber-600" />
            <h2 className="mt-4 text-lg font-semibold text-slate-900">{t("sellerDash.income.errorTitle")}</h2>
            <p className="mt-1 text-sm text-slate-500">{t("sellerDash.income.errorDesc")}</p>
            <Button className="mt-6 bg-slate-900 text-white hover:bg-slate-800" onClick={() => { setLoading(true); load().finally(() => setLoading(false)); }}>
              <RefreshCw className="mr-1.5 size-4" /> {t("common.retry")}
            </Button>
          </div>
        ) : (
          <>
            {/* ── Total KPI ─────────────────────────────────────── */}
            <section className="mt-6 rounded-2xl border border-emerald-200 bg-emerald-50/60 p-5 sm:p-6">
              <p className="text-sm text-slate-500">ยอดขายรวม ({periodLabels[period]})</p>
              <p className="mt-1 text-3xl font-bold tabular-nums tracking-tight text-emerald-700">{formatBaht(gross)}</p>
              <p className="mt-1 text-xs text-slate-400">{grossCount} คำสั่งซื้อ</p>
            </section>

            {/* ── Chart ─────────────────────────────────────────── */}
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
              <h2 className="text-base font-bold text-slate-900">กราฟแนวโน้ม {periodLabels[period]}</h2>
              {periodData.length === 0 ? (
                <div className="mt-6 flex flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50/60 px-4 py-10 text-center">
                  <PackageSearch className="size-6 text-slate-300" />
                  <p className="mt-2 text-sm text-slate-500">ยังไม่มีข้อมูลยอดขายราย{periodLabels[period]}</p>
                  <p className="mt-1 text-xs text-slate-400">ข้อมูลจะปรากฏเมื่อมีคำสั่งซื้อที่เสร็จสิ้นจริง</p>
                </div>
              ) : (
              <div className="mt-6 flex items-end gap-1.5 h-32 sm:h-40" role="img" aria-label={`${periodLabels[period]} revenue chart`}>
                {periodData.map((d, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1 h-full justify-end">
                    <span className="text-[11px] font-semibold tabular-nums text-slate-900">{formatBaht(d.value).replace("฿", "")}</span>
                    <div className="w-full rounded-t-md bg-emerald-500 transition-[width]"
                      style={{ height: `${(d.value / maxVal) * 100}%` }} />
                    <span className="text-[11px] text-slate-400 truncate w-full text-center">{d.label}</span>
                  </div>
                ))}
              </div>
              )}
            </section>

            {/* ── Transactions ──────────────────────────────────── */}
            <section className="mt-6 rounded-2xl border border-slate-200 bg-white overflow-hidden">
              <div className="p-5 border-b border-slate-100">
                <h2 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <PackageSearch className="size-4 text-emerald-500" /> รายการคำสั่งซื้อ
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">ทั้งหมด {transactions.length} รายการ</p>
              </div>
              <div className="divide-y divide-slate-100">
                {transactions.map((tx) => (
                  <div key={tx.order.id} className="p-4 sm:p-5 hover:bg-slate-50/60 transition-colors">
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div>
                        <p className="text-sm font-semibold tabular-nums text-slate-900">{shortOrderNumber(tx.order.orderNumber)}</p>
                        <p className="text-xs text-slate-400">{formatIsoDate(tx.order.createdAt)}</p>
                      </div>
                      <Badge variant="secondary" className={`text-xs ${getOrderStatusMeta(tx.order.status)?.badge ?? "bg-slate-100"}`}>
                        {getOrderStatusMeta(tx.order.status)?.label ?? tx.order.status}
                      </Badge>
                    </div>

                    {tx.items.map((item: StoreOrderItem) => (
                      <div key={`${item.id}-${item.productName}`} className="mt-3 flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-3 py-2">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-slate-700 truncate">{item.productName}</p>
                          <p className="text-xs text-slate-400">{item.quantity} × {formatBaht(item.unitPrice)}</p>
                        </div>
                        <div className="text-right shrink-0">
                          <p className="text-sm font-semibold tabular-nums text-slate-900">{formatBaht(item.quantity * item.unitPrice)}</p>
                          <p className="text-[11px] text-slate-400">ค่าธรรมเนียม -{formatBaht(Math.round(item.quantity * item.unitPrice * (report?.commissionRate ?? 3) / 100))}</p>
                        </div>
                      </div>
                    ))}

                    <div className="mt-2 flex items-center justify-between text-xs text-slate-500">
                      <span>รวม {tx.items.length} รายการ</span>
                      <span className="font-semibold text-slate-900">
                        {tx.pending ? "รอดำเนินการ" : formatBaht(tx.subtotal)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <p className="flex items-center justify-center gap-1.5 px-5 py-4 text-xs text-slate-400 border-t border-slate-100">
                <PackageCheck className="size-3.5 text-emerald-500" />
                {t("sellerDash.income.feeFootnote")}
              </p>
            </section>
          </>
        )}
      </main>
    </div>
  );
}
