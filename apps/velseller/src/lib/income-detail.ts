/**
 * Shared income-detail helpers (velseller).
 *
 * Single source for date-bucketing real backend `grouped` rows into the
 * selected period. Only SUMS of actual per-calendar-day records — never a
 * synthetic split of a lifetime total.
 */
import type { StoreOrder, StoreOrderItem } from "@velnox/shared/lib/commerce";

export interface TransactionRow {
  order: StoreOrder; items: StoreOrderItem[]; subtotal: number; pending: boolean;
}

/** Real date-grouped bucket from the backend (per-calendar-day sums of actual rows). */
export interface GroupedDay {
  date: string; gross: number; grossCount: number;
  returns: number; returnCount: number; commission: number;
}

export interface IncomeReportWithGrouped {
  gross: number; grossCount: number; returns: number; returnCount: number;
  commission: number; commissionRate: number; returnRate: number;
  returnCoverage: number; payout: number; transactions: TransactionRow[];
  grouped?: GroupedDay[];
}

export type Period = "daily" | "weekly" | "monthly";

/** Aggregate day buckets into the requested period (sums only — no fabrication). */
export function bucketByPeriod(grouped: GroupedDay[], period: Period): GroupedDay[] {
  if (grouped.length === 0) return [];
  const out: GroupedDay[] = [];
  let acc: GroupedDay | null = null;
  let accKey: string | null = null;
  for (const day of grouped) {
    const d = new Date(day.date + "T00:00:00Z");
    let key: string;
    if (period === "daily") {
      key = day.date;
    } else if (period === "weekly") {
      const iso = new Date(d.getTime() + 4 * 86400000);
      const keyDate = new Date(Date.UTC(iso.getUTCFullYear(), 0, iso.getUTCDate() > 3 ? iso.getUTCDate() - 3 : iso.getUTCDate() + 4));
      const weekNum = Math.ceil(((keyDate.getTime() - Date.UTC(keyDate.getUTCFullYear(), 0, 1)) / 86400000 + 1) / 7);
      key = `${d.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
    } else {
      key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
    }
    if (accKey === key && acc) {
      acc.gross += day.gross; acc.grossCount += day.grossCount;
      acc.returns += day.returns; acc.returnCount += day.returnCount;
      acc.commission += day.commission;
    } else {
      if (acc) out.push(acc);
      acc = { date: key, gross: day.gross, grossCount: day.grossCount, returns: day.returns, returnCount: day.returnCount, commission: day.commission };
      accKey = key;
    }
  }
  if (acc) out.push(acc);
  return out;
}

/** Compact chart label for a bucket, dependent on period. */
export function bucketLabel(date: string, period: Period): string {
  if (period === "monthly") return date.slice(0, 7);
  if (period === "weekly") return date.slice(-2);
  return date.slice(5);
}
