import { AppHeader } from "@velnox/shared/components/AppHeader";
import { GoalCard } from "@velnox/shared/components/goals/GoalCard";
import { GoalFormDialog } from "@velnox/shared/components/goals/GoalFormDialog";
import { ProgressDialog } from "@velnox/shared/components/goals/ProgressDialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@velnox/shared/components/ui/alert-dialog";
import { Button } from "@velnox/shared/components/ui/button";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { formatBaht, formatIsoDate } from "@velnox/shared/lib/commerce";
import {
  formatNumber,
  goalPercent,
  isAchieved,
  type Goal,
} from "@velnox/shared/lib/goals";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  AlertTriangle,
  Gauge,
  Loader2,
  PackageCheck,
  Plus,
  RefreshCw,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";

/**
 * Seller Goals / Performance — Phase 1 (P1-A).
 *
 * DATA AUTHORITY
 * --------------
 * Every number on this page comes from an existing authenticated seller endpoint:
 *
 *   GET /api/seller/goals   (`api.goals.list`)             → the goal records
 *   GET /api/seller/income  (`api.commerce.sellerIncomeReport`) → gross / units /
 *                                                           returns / net payout
 *
 * Nothing is hard-coded and nothing is estimated in the browser. Goal progress
 * itself is still the value the seller recorded through
 * `POST /api/seller/goals/:id/progress`; computing progress from order data
 * server-side is Phase 2, so the page states that fact instead of implying it.
 *
 * ERROR HONESTY
 * -------------
 * `useQuery` swallows failures and returns `undefined`, which would render a
 * fake "0". This page loads through `useAction` with explicit loading/error
 * state, so a failed request shows a retry affordance — never a zero.
 */

interface IncomeSnapshot {
  gross: number;
  grossCount: number;
  returns: number;
  payout: number;
}

export default function SellerGoals() {
  const { user } = useAuth();
  const { t } = useLanguage();

  const fetchGoals = useAction(api.goals.list);
  const fetchIncome = useAction(api.commerce.sellerIncomeReport);
  const removeGoal = useAction(api.goals.remove);

  const [goals, setGoals] = useState<Goal[] | null>(null);
  const [income, setIncome] = useState<IncomeSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const [formOpen, setFormOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [progressGoal, setProgressGoal] = useState<Goal | null>(null);
  const [deleteGoal, setDeleteGoal] = useState<Goal | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [goalRows, incomeReport] = await Promise.all([
        fetchGoals(),
        fetchIncome(),
      ]);
      setGoals(Array.isArray(goalRows) ? (goalRows as Goal[]) : []);

      if (incomeReport && typeof incomeReport === "object") {
        const report = incomeReport as Record<string, unknown>;
        setIncome({
          gross: Number(report.gross ?? 0),
          grossCount: Number(report.grossCount ?? 0),
          returns: Number(report.returns ?? 0),
          payout: Number(report.payout ?? 0),
        });
      } else {
        setIncome(null);
      }
    } catch (error) {
      console.error("Seller performance load failed:", error);
      setFailed(true);
      setGoals(null);
      setIncome(null);
    } finally {
      setLoading(false);
    }
  }, [fetchGoals, fetchIncome]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const list = goals ?? [];
    const achieved = list.filter(isAchieved).length;
    const average =
      list.length > 0
        ? Math.round(list.reduce((sum, goal) => sum + goalPercent(goal), 0) / list.length)
        : 0;
    const targeted = list.reduce((sum, goal) => sum + Number(goal.targetValue ?? 0), 0);
    return {
      total: list.length,
      active: list.length - achieved,
      achieved,
      average,
      targeted,
    };
  }, [goals]);

  const handleDelete = async () => {
    if (!deleteGoal) return;
    setDeleting(true);
    try {
      await removeGoal({ goalId: deleteGoal._id });
      toast.success(t("sellerDash.goals.toastDeleted"));
      setDeleteGoal(null);
      await load();
    } catch (error) {
      console.error("Goal delete error:", error);
      toast.error(t("sellerDash.goals.toastDeleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const firstName = user?.name?.split(/\s+/)[0] || t("sellerDash.goals.fallbackName");

  return (
    <div className="min-h-screen bg-background text-slate-900">
      <AppHeader />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Page header */}
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {formatIsoDate(Date.now())}
            </p>
            <h1 className="mt-1 truncate text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {t("sellerDash.goals.greeting", { name: firstName })}
            </h1>
            <p className="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500">
              {t("sellerDash.goals.subtitle")}
            </p>
          </div>
          <Button
            className="h-11 shrink-0 gap-1.5 bg-brand text-white hover:bg-brand-strong"
            onClick={() => {
              setEditingGoal(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            {t("sellerDash.goals.ctaCreate")}
          </Button>
        </header>

        {/* Failure state — never a fake zero */}
        {failed ? (
          <section
            role="alert"
            className="mt-7 flex flex-col gap-4 rounded-xl border border-rose-200 bg-rose-50/60 p-5 sm:flex-row sm:items-center sm:justify-between"
          >
            <div className="flex items-start gap-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-white text-rose-600 ring-1 ring-inset ring-rose-200">
                <AlertTriangle className="size-4" aria-hidden="true" />
              </span>
              <div>
                <p className="text-sm font-semibold text-rose-900">{t("sellerPerf.loadFailed")}</p>
                <p className="mt-0.5 text-sm text-rose-700">{t("sellerPerf.loadFailedDesc")}</p>
              </div>
            </div>
            <Button
              variant="outline"
              className="h-11 shrink-0 gap-1.5 border-rose-200 bg-white text-rose-700 hover:bg-rose-50"
              onClick={() => void load()}
            >
              <RefreshCw className="size-4" aria-hidden="true" />
              {t("sellerDash.income.retry")}
            </Button>
          </section>
        ) : null}

        {!failed ? (
          <>
            {/* Goals summary */}
            <section className="mt-6 rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
                  {t("sellerDash.goals.kpiTotal")}
                </h2>
                <p className="text-xs text-slate-500">{t("sellerPerf.progressNote")}</p>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <SummaryStat label={t("sellerDash.goals.kpiTotal")} value={String(stats.total)} />
                <SummaryStat label={t("sellerDash.goals.kpiActive")} value={String(stats.active)} />
                <SummaryStat
                  label={t("sellerDash.goals.kpiAchieved")}
                  value={String(stats.achieved)}
                />
                <SummaryStat
                  label={t("sellerDash.goals.kpiAvg")}
                  value={`${stats.average}%`}
                  progress={stats.average}
                />
              </dl>
            </section>

            {/* Goals grid */}
            <section className="mt-8">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-base font-semibold tracking-tight text-slate-900">
                  {t("sellerPerf.goalsTitle")}
                </h2>
                {stats.total > 0 ? (
                  <span className="text-xs text-slate-500">
                    {t("sellerDash.goals.summaryTotal", {
                      total: formatNumber(stats.targeted),
                    })}
                  </span>
                ) : null}
              </div>

              {loading && goals === null ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 3 }).map((_, index) => (
                    <div
                      key={index}
                      className="h-56 animate-pulse rounded-xl border border-slate-200 bg-white"
                    />
                  ))}
                </div>
              ) : goals && goals.length > 0 ? (
                <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {goals.map((goal) => (
                    <GoalCard
                      key={goal._id}
                      goal={goal}
                      onEdit={(target) => {
                        setEditingGoal(target);
                        setFormOpen(true);
                      }}
                      onDelete={(target) => setDeleteGoal(target)}
                      onRecordProgress={(target) => setProgressGoal(target)}
                    />
                  ))}
                </div>
              ) : (
                <div className="mt-4 flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
                  <span className="flex size-14 items-center justify-center rounded-2xl bg-accent">
                    <Target className="size-7 text-brand" aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold text-slate-900">
                    {t("sellerDash.goals.emptyTitle")}
                  </h3>
                  <p className="mt-1.5 max-w-md text-sm leading-6 text-slate-500">
                    {t("sellerDash.goals.emptyDesc")}
                  </p>
                  <Button
                    className="mt-6 h-11 gap-1.5 bg-brand text-white hover:bg-brand-strong"
                    onClick={() => {
                      setEditingGoal(null);
                      setFormOpen(true);
                    }}
                  >
                    <Plus className="size-4" aria-hidden="true" />
                    {t("sellerDash.goals.ctaCreateFirst")}
                  </Button>
                </div>
              )}
            </section>
          </>
        ) : (
          <div className="mt-6 h-40 animate-pulse rounded-xl border border-slate-200 bg-white" />
        )}
      </main>

      <GoalFormDialog
        open={formOpen}
        onOpenChange={(open) => {
          setFormOpen(open);
          if (!open) void load();
        }}
        goal={editingGoal}
      />
      <ProgressDialog
        goal={progressGoal}
        open={progressGoal !== null}
        onOpenChange={(open) => {
          if (!open) {
            setProgressGoal(null);
            void load();
          }
        }}
      />

      <AlertDialog open={deleteGoal !== null} onOpenChange={(open) => !open && setDeleteGoal(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("sellerDash.goals.deleteTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {t("sellerDash.goals.deleteDesc", { title: deleteGoal?.title ?? "" })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="h-11" disabled={deleting}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              className="h-11 bg-red-600 text-white hover:bg-red-700"
              onClick={(event) => {
                event.preventDefault();
                void handleDelete();
              }}
              disabled={deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                  {t("sellerDash.goals.deleting")}
                </>
              ) : (
                t("sellerDash.goals.deleteAction")
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/** Units sold — the income report names this field `grossCount`. */
function statsUnits(income: IncomeSnapshot): number {
  return Number.isFinite(income.grossCount) ? income.grossCount : 0;
}

interface MetricCardProps {
  icon: typeof Gauge;
  label: string;
  value: string | null;
  caption: string;
  loading: boolean;
  iconTone?: string;
  chipClass?: string;
  tone?: "emerald";
}

/**
 * One KPI tile. `value === null` renders an explicit em dash ("not available")
 * instead of a fabricated zero, which is what an unreported metric means.
 */
function MetricCard({
  icon: Icon,
  label,
  value,
  caption,
  loading,
  iconTone = "text-emerald-600",
  chipClass = "bg-emerald-50 ring-emerald-600/10",
}: MetricCardProps) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex items-center gap-2">
        <span
          className={`flex size-7 items-center justify-center rounded-[9px] ring-1 ring-inset ${chipClass}`}
        >
          <Icon className={`size-4 ${iconTone}`} aria-hidden="true" />
        </span>
        <p className="truncate text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
      </div>
      {loading ? (
        <div className="mt-3 h-8 w-24 animate-pulse rounded bg-slate-100" />
      ) : (
        <p className="mt-2 truncate text-xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-2xl">
          {value ?? "—"}
        </p>
      )}
      <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{caption}</p>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  progress,
}: {
  label: string;
  value: string;
  progress?: number;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 text-xl font-bold tabular-nums tracking-tight text-slate-900">{value}</dd>
      {progress !== undefined ? (
        <div
          className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuenow={progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={label}
        >
          <div
            className="h-full rounded-full bg-brand transition-[width] duration-500"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}
