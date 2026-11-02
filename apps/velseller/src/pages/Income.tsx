import { AppHeader } from "@velnox/shared/components/AppHeader";
import { Badge } from "@velnox/shared/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@velnox/shared/components/ui/table";
import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import {
  formatBaht,
  formatIsoDate,
  getOrderStatusMeta,
  shortOrderNumber,
  type StoreOrder,
  type StoreOrderItem,
} from "@velnox/shared/lib/commerce";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  AlertTriangle,
  BadgePercent,
  Landmark,
  Loader2,
  PackageCheck,
  Receipt,
  ShieldCheck,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const pct = (value: number) =>
  `${(value * 100).toLocaleString("th-TH", { maximumFractionDigits: 1 })}%`;

interface TransactionRow {
  order: StoreOrder;
  items: StoreOrderItem[];
  subtotal: number;
  pending: boolean;
}

interface IncomeReport {
  gross: number;
  grossCount: number;
  returns: number;
  returnCount: number;
  commission: number;
  commissionRate: number;
  returnRate: number;
  returnCoverage: number;
  payout: number;
  transactions: TransactionRow[];
}

export default function Income() {
  const sellerIncome = useAction(api.commerce.sellerIncomeReport);
  const { t } = useLanguage();
  const [report, setReport] = useState<IncomeReport | null>(null);
  const [loading, setLoading] = useState(true);
  // A failed report is an ERROR — it used to leave `report = null`, which
  // rendered a spinner forever with no way to recover.
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await sellerIncome();
      setReport(r as IncomeReport);
      setError(false);
    } catch (err) {
      console.error("Load income error:", err);
      setError(true);
    }
  }, [sellerIncome]);

  useEffect(() => {
    let alive = true;
    void load().finally(() => {
      if (alive) setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [load]);

  const retry = useCallback(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <AppHeader />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <Wallet className="size-4 text-[#10B981]" />
            {t("sellerDash.income.eyebrow")}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("sellerDash.income.title")}
          </h1>
          <p className="mt-1.5 max-w-lg text-sm leading-6 text-slate-500">
            {t("sellerDash.income.subtitle")}
          </p>
        </div>

        {loading && report === null ? (
          <div className="mt-10 flex items-center justify-center">
            <Loader2 className="size-6 animate-spin text-slate-300" />
          </div>
        ) : error && report === null ? (
          <div className="mt-8 flex flex-col items-center rounded-2xl border border-slate-200 bg-white px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-amber-50">
              <AlertTriangle className="size-7 text-amber-600" />
            </span>
            <h2 className="mt-5 text-lg font-semibold text-slate-900">{t("sellerDash.income.errorTitle")}</h2>
            <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">
              {t("sellerDash.income.errorDesc")}
            </p>
            <button
              type="button"
              onClick={retry}
              className="mt-6 inline-flex min-h-11 items-center gap-1.5 rounded-[10px] bg-[#10B981] px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-[#059669]"
            >
              {t("sellerDash.income.retry")}
            </button>
          </div>
        ) : report ? (
          <>
            {/* KPI row */}
            <div className="mt-7 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex items-center gap-2 text-emerald-600">
                  <TrendingUp className="size-4" />
                  <p className="text-xs font-medium uppercase tracking-wide">{t("sellerDash.income.kpiGross")}</p>
                </div>
                <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
                  {formatBaht(report.gross)}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {t("sellerDash.income.kpiGrossSub", { count: report.grossCount.toLocaleString("th-TH") })}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex items-center gap-2 text-rose-500">
                  <AlertTriangle className="size-4" />
                  <p className="text-xs font-medium uppercase tracking-wide">{t("sellerDash.income.kpiReturns")}</p>
                </div>
                <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
                  {formatBaht(report.returns)}
                </p>
                <p className="mt-1 text-xs text-slate-400">
                  {t("sellerDash.income.kpiReturnsSub", {
                    rate: pct(report.returnRate),
                    count: report.returnCount.toLocaleString("th-TH"),
                  })}
                </p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex items-center gap-2 text-slate-700">
                  <BadgePercent className="size-4" />
                  <p className="text-xs font-medium uppercase tracking-wide">{t("sellerDash.income.kpiFee")}</p>
                </div>
                <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
                  -{formatBaht(report.commission)}
                </p>
                <p className="mt-1 text-xs text-slate-400">{t("sellerDash.income.kpiFeeSub")}</p>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
                <div className="flex items-center gap-2 text-[#10B981]">
                  <Landmark className="size-4" />
                  <p className="text-xs font-medium uppercase tracking-wide">{t("sellerDash.income.kpiPayout")}</p>
                </div>
                <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
                  {formatBaht(report.payout)}
                </p>
                <p className="mt-1 text-xs text-slate-400">{t("sellerDash.income.kpiPayoutSub")}</p>
              </div>
            </div>

            {/* Policy card */}
            <div className="mt-6 flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-[#ECFDF5]">
                  <ShieldCheck className="size-5 text-[#10B981]" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{t("sellerDash.income.policyTitle")}</p>
                  <ul className="mt-2 space-y-1.5 text-xs leading-5 text-slate-500">
                    <li>
                      {t("sellerDash.income.policyFeePre")} <span className="font-semibold text-slate-700">{t("sellerDash.income.policyFeeBold")}</span> {t("sellerDash.income.policyFeePost")}
                    </li>
                    <li>
                      {t("sellerDash.income.policyReturnPre")} <span className="font-semibold text-slate-700">{t("sellerDash.income.policyReturnBold")}</span> {t("sellerDash.income.policyReturnPost")}
                    </li>
                  </ul>
                </div>
              </div>
              {report.returnRate > 0.1 && (
                <Badge className="shrink-0 gap-1 rounded-full bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/15">
                  <AlertTriangle className="size-3" />
                  {t("sellerDash.income.overRateBadge")}
                </Badge>
              )}
            </div>

            {/* Transactions */}
            <div className="mt-8">
              <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-slate-900">{t("sellerDash.income.recentTitle")}</h2>
                <span className="text-xs text-slate-400">{t("sellerDash.income.txCount", { count: report.transactions.length })}</span>
              </div>

              {report.transactions.length === 0 ? (
                <div className="mt-3 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
                  <span className="flex size-12 items-center justify-center rounded-2xl bg-slate-100">
                    <Receipt className="size-6 text-slate-400" />
                  </span>
                  <h3 className="mt-4 text-base font-semibold text-slate-900">{t("sellerDash.income.emptyTitle")}</h3>
                  <p className="mt-1.5 max-w-sm text-sm text-slate-500">
                    {t("sellerDash.income.emptyDesc")}
                  </p>
                </div>
              ) : (
                <>
                {/* Desktop: table */}
                <div className="mt-3 hidden overflow-x-auto rounded-xl border border-slate-200 bg-white md:block">
                  <Table className="min-w-[720px]">
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead className="pl-5 text-slate-400">{t("sellerDash.income.colOrder")}</TableHead>
                        <TableHead className="text-slate-400">{t("sellerDash.income.colDate")}</TableHead>
                        <TableHead className="text-slate-400">{t("sellerDash.income.colItems")}</TableHead>
                        <TableHead className="text-right text-slate-400">{t("sellerDash.income.colSubtotal")}</TableHead>
                        <TableHead className="text-right text-slate-400">{t("sellerDash.income.colFee")}</TableHead>
                        <TableHead className="pr-5 text-right text-slate-400">{t("sellerDash.income.colStatus")}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {report.transactions.map(({ order, items, subtotal, pending }) => {
                        const meta = getOrderStatusMeta(order.status);
                        const fee = Math.round(subtotal * 0.03 * 100) / 100;
                        return (
                          <TableRow key={order.id} className="hover:bg-slate-50/60">
                            <TableCell className="pl-5">
                              <p className="font-medium text-slate-900">{shortOrderNumber(order.orderNumber)}</p>
                              <p className="text-xs text-slate-400">{order.customerName || t("sellerDash.income.customerFallback")}</p>
                            </TableCell>
                            <TableCell>
                              <p className="text-sm text-slate-600">{formatIsoDate(order.createdAt)}</p>
                            </TableCell>
                            <TableCell>
                              <div className="max-w-52 space-y-0.5">
                                {items.slice(0, 2).map((item) => (
                                  <p key={item.id} className="truncate text-sm text-slate-600">
                                    {item.productName} × {item.quantity} {item.unit}
                                  </p>
                                ))}
                                {items.length > 2 && (
                                  <p className="text-xs text-slate-400">{t("sellerDash.income.moreItems", { count: items.length - 2 })}</p>
                                )}
                              </div>
                            </TableCell>
                            <TableCell className="text-right">
                              <p className="font-medium tabular-nums text-slate-900">{formatBaht(subtotal)}</p>
                            </TableCell>
                            <TableCell className="text-right">
                              <p className="tabular-nums text-slate-500">
                                {pending || order.status === "cancelled" ? "—" : `-${formatBaht(fee)}`}
                              </p>
                            </TableCell>
                            <TableCell className="pr-5 text-right">
                              <Badge className={`gap-1.5 rounded-full ring-1 ring-inset ${meta.badge}`}>
                                <span className={`size-1.5 rounded-full ${meta.dot}`} />
                                {meta.label}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </div>

                {/* Mobile: app-like transaction cards */}
                <div className="mt-3 space-y-3 md:hidden">
                  {report.transactions.map(({ order, items, subtotal, pending }) => {
                    const meta = getOrderStatusMeta(order.status);
                    const fee = Math.round(subtotal * 0.03 * 100) / 100;
                    return (
                      <div
                        key={order.id}
                        className="rounded-xl border border-slate-200 bg-white p-4 transition-all duration-200 active:scale-[0.99]"
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-900">
                              {shortOrderNumber(order.orderNumber)}
                            </p>
                            <p className="mt-0.5 truncate text-xs text-slate-400">
                              {formatIsoDate(order.createdAt)} · {order.customerName || t("sellerDash.income.customerFallback")}
                            </p>
                          </div>
                          <Badge className={`shrink-0 gap-1.5 rounded-full ring-1 ring-inset ${meta.badge}`}>
                            <span className={`size-1.5 rounded-full ${meta.dot}`} />
                            {meta.label}
                          </Badge>
                        </div>

                        <div className="mt-3 rounded-[10px] bg-slate-50 px-3 py-2.5">
                          {items.slice(0, 2).map((item) => (
                            <p key={item.id} className="truncate text-sm text-slate-600">
                              {item.productName}{" "}
                              <span className="text-slate-400">× {item.quantity} {item.unit}</span>
                            </p>
                          ))}
                          {items.length > 2 && (
                            <p className="text-xs text-slate-400">{t("sellerDash.income.moreItems", { count: items.length - 2 })}</p>
                          )}
                        </div>

                        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                          <div>
                            <p className="text-slate-400">{t("sellerDash.income.mobileSubtotal")}</p>
                            <p className="mt-0.5 font-bold tabular-nums text-slate-900">{formatBaht(subtotal)}</p>
                          </div>
                          <div className="text-right">
                            <p className="text-slate-400">{t("sellerDash.income.mobileFee")}</p>
                            <p className="mt-0.5 font-medium tabular-nums text-slate-500">
                              {pending || order.status === "cancelled" ? "—" : `-${formatBaht(fee)}`}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                </>
              )}
              <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
                <PackageCheck className="size-3.5 text-[#10B981]" />
                {t("sellerDash.income.feeFootnote")}
              </p>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}
