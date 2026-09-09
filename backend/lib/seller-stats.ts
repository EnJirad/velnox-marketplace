/**
 * P1 #4 — shared seller statistics helpers (income math, goal validation,
 * reorder cycle computation). Pure functions so they are unit-testable
 * without a database.
 */

export const SELLER_COMMISSION_RATE = 0.03; // 3% per item
export const SELLER_RETURN_COVERAGE = 0.1; // commission covers ≤10% returns

export interface IncomeReport {
  gross: number;
  grossCount: number;
  returns: number;
  returnCount: number;
  commission: number;
  commissionRate: number;
  returnRate: number;
  returnCoverage: number;
  payout: number;
}

/** Compute the seller income report from aggregate order totals.
 *  Returns over the coverage allowance are deducted from the payout. */
export function computeIncomeReport(
  gross: number,
  grossCount: number,
  returns: number,
  returnCount: number,
): IncomeReport {
  const commissionRate = SELLER_COMMISSION_RATE;
  const commission = round2(gross * commissionRate);
  const returnCoverage = SELLER_RETURN_COVERAGE;
  const coveredReturns = gross * returnCoverage;
  // Returns beyond the policy coverage are the seller's responsibility.
  const uncoveredReturns = Math.max(0, returns - coveredReturns);
  const payout = round2(gross - commission - uncoveredReturns);
  return {
    gross: round2(gross),
    grossCount,
    returns: round2(returns),
    returnCount,
    commission,
    commissionRate,
    returnRate: gross > 0 ? returns / gross : 0,
    returnCoverage,
    payout,
  };
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// ─── Goals ─────────────────────────────────────────────────────────────────

export interface GoalInput {
  title?: unknown;
  description?: unknown;
  category?: unknown;
  unit?: unknown;
  targetValue?: unknown;
  currentValue?: unknown;
  period?: unknown;
  dueDate?: unknown;
}

export interface GoalValidation {
  error: string | null;
  title?: string;
  description?: string | null;
  category?: string;
  unit?: string;
  targetValue?: number;
  currentValue?: number;
  period?: string;
  dueDate?: number | null;
}

const GOAL_CATEGORIES = ["revenue", "orders", "customers", "other"];
const GOAL_PERIODS = ["monthly", "quarterly", "yearly"];

/** Validate seller-goal input (title, target, category, period). */
export function validateGoalInput(body: GoalInput | undefined | null): GoalValidation {
  if (!body || typeof body !== "object") {
    return { error: "Goal data is required" };
  }
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return { error: "Title is required" };
  if (title.length > 200) return { error: "Title must be at most 200 characters" };

  const description =
    typeof body.description === "string" && body.description.trim()
      ? body.description.trim().slice(0, 2000)
      : null;

  const category = typeof body.category === "string" ? body.category : "other";
  if (!GOAL_CATEGORIES.includes(category)) {
    return { error: "Category must be one of: revenue, orders, customers, other" };
  }

  const unit = typeof body.unit === "string" && body.unit.trim() ? body.unit.trim().slice(0, 20) : "ครั้ง";

  const targetValue = Number(body.targetValue);
  if (!Number.isFinite(targetValue) || targetValue <= 0) {
    return { error: "Target value must be a number greater than 0" };
  }

  const currentValueRaw = Number(body.currentValue);
  const currentValue = Number.isFinite(currentValueRaw) && currentValueRaw >= 0 ? currentValueRaw : 0;

  const period = typeof body.period === "string" ? body.period : "monthly";
  if (!GOAL_PERIODS.includes(period)) {
    return { error: "Period must be one of: monthly, quarterly, yearly" };
  }

  const dueDate =
    typeof body.dueDate === "number" && Number.isFinite(body.dueDate) && body.dueDate > 0
      ? body.dueDate
      : null;

  return { error: null, title, description, category, unit, targetValue, currentValue, period, dueDate };
}

// ─── Reorder cycles ────────────────────────────────────────────────────────

export interface PurchaseStats {
  purchaseCount: number;
  unitsSold: number;
  firstPurchaseAt: number | null;
  lastPurchaseAt: number | null;
  /** Average days between purchases (null until 2+ purchases). */
  avgCycleDays: number | null;
}

/** Compute purchase statistics from order timestamps (ms). */
export function computePurchaseStats(purchaseTimes: number[], unitsSold: number): PurchaseStats {
  if (purchaseTimes.length === 0) {
    return { purchaseCount: 0, unitsSold: 0, firstPurchaseAt: null, lastPurchaseAt: null, avgCycleDays: null };
  }
  const sorted = [...purchaseTimes].sort((a, b) => a - b);
  const first = sorted[0] ?? null;
  const last = sorted[sorted.length - 1] ?? null;
  const avgCycleDays =
    sorted.length >= 2 && last !== null && first !== null && last > first
      ? (last - first) / (sorted.length - 1) / (24 * 60 * 60 * 1000)
      : null;
  return {
    purchaseCount: sorted.length,
    unitsSold,
    firstPurchaseAt: first,
    lastPurchaseAt: last,
    avgCycleDays,
  };
}

/** Estimated next purchase timestamp (ms) — last purchase + cycle. */
export function estimatedNextPurchase(stats: Pick<PurchaseStats, "lastPurchaseAt" | "avgCycleDays">): number | null {
  if (stats.lastPurchaseAt === null || stats.avgCycleDays === null) return null;
  return stats.lastPurchaseAt + stats.avgCycleDays * 24 * 60 * 60 * 1000;
}

export type ReorderConfidence = "high" | "medium" | "low" | "not_enough_data";

/** Confidence level from purchase history volume. */
export function reorderConfidence(purchaseCount: number): ReorderConfidence {
  if (purchaseCount >= 6) return "high";
  if (purchaseCount >= 3) return "medium";
  if (purchaseCount >= 1) return "low";
  return "not_enough_data";
}