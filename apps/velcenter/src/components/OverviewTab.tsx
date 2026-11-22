import React from "react";
import { AlertTriangle, Sparkles, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@velnox/shared/components/ui/card";
import { formatBaht } from "@velnox/shared/lib/shop";

export interface StatItem {
  readonly label: string;
  readonly value: string | number;
  readonly sub: string;
  readonly icon: LucideIcon;
  readonly accent: string;
}

export interface MarketKpi {
  readonly revenue: number;
  readonly completedOrders: number;
  readonly pendingOrders: number;
}

export interface OverviewTabProps {
  readonly stats: readonly StatItem[];
  readonly pendingProducts: number;
  readonly pendingSellers: number;
  readonly pendingVerifications: number;
  readonly marketKpi: MarketKpi | null;
  readonly onSelectTab: (tab: string) => void;
}

export const OverviewTab: React.FC<OverviewTabProps> = ({
  stats,
  pendingProducts,
  pendingSellers,
  pendingVerifications,
  marketKpi,
  onSelectTab,
}) => {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
            <div className="flex items-center gap-2">
              <s.icon className={`size-4 ${s.accent}`} />
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
                {s.label}
              </p>
            </div>
            <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
              {s.value}
            </p>
            <p className="mt-1 text-xs text-slate-400">{s.sub}</p>
          </div>
        ))}
      </div>

      {/* Action Required */}
      {(pendingProducts > 0 || pendingSellers > 0 || pendingVerifications > 0) && (
        <Card className="border-amber-200 bg-amber-50/50 shadow-none">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-amber-500" />
              ต้องดำเนินการ
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {pendingProducts > 0 && (
                <button
                  type="button"
                  onClick={() => onSelectTab("products")}
                  className="flex w-full items-center justify-between rounded-xl bg-white p-3 text-left transition-colors hover:border-amber-300 border border-amber-200"
                >
                  <span className="text-sm text-slate-700">สินค้ารอตรวจสอบ</span>
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                    {pendingProducts}
                  </span>
                </button>
              )}
              {pendingSellers > 0 && (
                <button
                  type="button"
                  onClick={() => onSelectTab("sellers")}
                  className="flex w-full items-center justify-between rounded-xl bg-white p-3 text-left transition-colors hover:border-amber-300 border border-amber-200"
                >
                  <span className="text-sm text-slate-700">ใบสมัครพ่อค้ารอตรวจสอบ</span>
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                    {pendingSellers}
                  </span>
                </button>
              )}
              {pendingVerifications > 0 && (
                <button
                  type="button"
                  onClick={() => onSelectTab("products")}
                  className="flex w-full items-center justify-between rounded-xl bg-white p-3 text-left transition-colors hover:border-amber-300 border border-amber-200"
                >
                  <span className="text-sm text-slate-700">การยืนยันรอตรวจสอบ</span>
                  <span className="rounded-full bg-amber-500 px-2 py-0.5 text-xs font-bold text-white">
                    {pendingVerifications}
                  </span>
                </button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Marketplace Revenue and Status Summary */}
      <Card className="border-slate-200 shadow-none">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="size-4 text-brand" />
            สรุปภาพรวมร้านค้า
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl bg-emerald-50 p-4">
              <p className="text-xs font-medium text-emerald-600">ยอดขายจาก velshop</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-700">
                {marketKpi ? formatBaht(marketKpi.revenue) : "—"}
              </p>
              <p className="mt-0.5 text-xs text-emerald-600/70">
                จากออเดอร์ที่เสร็จสิ้น {marketKpi?.completedOrders ?? 0} ออเดอร์
              </p>
            </div>
            <div className="rounded-xl bg-sky-50 p-4">
              <p className="text-xs font-medium text-sky-600">ออเดอร์รอจัดการ</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-sky-700">
                {marketKpi?.pendingOrders ?? 0} ออเดอร์
              </p>
              <p className="mt-0.5 text-xs text-sky-600/70">จัดการได้ที่แท็บ ออเดอร์</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default OverviewTab;
