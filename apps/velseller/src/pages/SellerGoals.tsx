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
import { Card } from "@velnox/shared/components/ui/card";
import { api } from "@velnox/shared/lib/api-routes";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import {
  formatNumber,
  formatThaiDate,
  goalPercent,
  isAchieved,
  type Goal,
} from "@velnox/shared/lib/goals";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { useMutation, useQuery } from "@velnox/shared/lib/api-routes";
import { CheckCircle2, Gauge, Plus, Target, Timer, TrendingUp, Users, ShoppingBag, ArrowUpRight } from "lucide-react";
import { useMemo, useState } from "react";
import { toast } from "sonner";

export default function SellerGoals() {
  const { user } = useAuth();
  const { t } = useLanguage();
  const goals = useQuery(api.goals.list);
  const removeGoal = useMutation(api.goals.remove);

  const [formOpen, setFormOpen] = useState(false);
  const [editingGoal, setEditingGoal] = useState<Goal | null>(null);
  const [progressGoal, setProgressGoal] = useState<Goal | null>(null);
  const [deleteGoal, setDeleteGoal] = useState<Goal | null>(null);
  const [deleting, setDeleting] = useState(false);

  const stats = useMemo(() => {
    const list = goals ?? [];
    const achieved = list.filter(isAchieved).length;
    const totalRevenue = list
      .filter((g) => g.category === "revenue")
      .reduce((sum, g) => sum + g.targetValue, 0);
    const totalOrders = list
      .filter((g) => g.category === "orders")
      .reduce((sum, g) => sum + g.targetValue, 0);
    const totalCustomers = list
      .filter((g) => g.category === "customers")
      .reduce((sum, g) => sum + g.targetValue, 0);
    const avg =
      list.length > 0
        ? Math.round(list.reduce((sum, g) => sum + goalPercent(g), 0) / list.length)
        : 0;
    return {
      total: list.length,
      active: list.length - achieved,
      achieved,
      avg,
      totalRevenue,
      totalOrders,
      totalCustomers,
    };
  }, [goals]);

  const handleDelete = async () => {
    if (!deleteGoal) return;
    setDeleting(true);
    try {
      await removeGoal({ goalId: deleteGoal._id });
      toast.success(t("sellerDash.goals.toastDeleted"));
      setDeleteGoal(null);
    } catch (error) {
      console.error("Goal delete error:", error);
      toast.error(t("sellerDash.goals.toastDeleteFailed"));
    } finally {
      setDeleting(false);
    }
  };

  const firstName = user?.name?.split(/\s+/)[0] || t("sellerDash.goals.fallbackName");

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <AppHeader />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        {/* Page header */}
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-slate-400">
              {formatThaiDate(Date.now())}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
              {t("sellerDash.goals.greeting", { name: firstName })}
            </h1>
            <p className="mt-1.5 text-sm text-slate-500">
              {t("sellerDash.goals.subtitle")}
            </p>
          </div>
          <Button
            className="gap-1.5 h-11 bg-[#10B981] text-white hover:bg-[#059669]"
            onClick={() => {
              setEditingGoal(null);
              setFormOpen(true);
            }}
          >
            <Plus className="size-4" />
            {t("sellerDash.goals.ctaCreate")}
          </Button>
        </div>

        {/* KPI Dashboard — 5 cards: Revenue, Orders, Customers, Units, Avg Progress */}
        <div className="mt-7 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
          <KpiCard
            icon={TrendingUp}
            iconClass="text-emerald-600"
            bgClass="bg-emerald-50 text-emerald-600 ring-emerald-600/10"
            label={t("sellerDash.goals.kpiRevenue")}
            value={formatNumber(stats.totalRevenue)}
            subtitle={t("sellerDash.goals.kpiRevenueSub")}
          />
          <KpiCard
            icon={ShoppingBag}
            iconClass="text-sky-600"
            bgClass="bg-sky-50 text-sky-600 ring-sky-600/10"
            label={t("sellerDash.goals.kpiOrders")}
            value={formatNumber(stats.totalOrders)}
            subtitle={t("sellerDash.goals.kpiOrdersSub")}
          />
          <KpiCard
            icon={Users}
            iconClass="text-amber-600"
            bgClass="bg-amber-50 text-amber-600 ring-amber-600/10"
            label={t("sellerDash.goals.kpiCustomers")}
            value={formatNumber(stats.totalCustomers)}
            subtitle={t("sellerDash.goals.kpiCustomersSub")}
          />
          <KpiCard
            icon={Target}
            iconClass="text-amber-600"
            bgClass="bg-amber-50 text-amber-600 ring-amber-600/10"
            label={t("sellerDash.goals.kpiUnits")}
            value={formatNumber(stats.totalUnits)}
            subtitle={t("sellerDash.goals.kpiUnitsSub")}
          />
          <KpiCard
            icon={Gauge}
            iconClass="text-slate-600"
            bgClass="bg-slate-50 text-slate-600 ring-slate-600/10"
            label={t("sellerDash.goals.kpiAvg")}
            value={`${stats.avg}%`}
            subtitle={t("sellerDash.goals.kpiAvgSub")}
            progress={stats.avg}
          />
        </div>

        {/* Goals grid */}
        {goals === undefined ? (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <div
                key={i}
                className="h-56 animate-pulse rounded-xl border border-slate-200 bg-white"
              />
            ))}
          </div>
        ) : goals.length === 0 ? (
          <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-[#ECFDF5]">
              <Target className="size-7 text-[#10B981]" />
            </span>
            <h2 className="mt-5 text-lg font-semibold text-slate-900">
              {t("sellerDash.goals.emptyTitle")}
            </h2>
            <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">
              {t("sellerDash.goals.emptyDesc")}
            </p>
            <Button
              className="mt-6 gap-1.5 h-11 bg-[#10B981] text-white hover:bg-[#059669]"
              onClick={() => {
                setEditingGoal(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              {t("sellerDash.goals.ctaCreateFirst")}
            </Button>
          </div>
        ) : (
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {goals.map((goal: any) => (
              <GoalCard
                key={goal._id}
                goal={goal}
                onEdit={(g) => {
                  setEditingGoal(g);
                  setFormOpen(true);
                }}
                onDelete={(g) => setDeleteGoal(g)}
                onRecordProgress={(g) => setProgressGoal(g)}
              />
            ))}
          </div>
        )}

        {/* Summary strip */}
        {goals && goals.length > 0 && (
          <div className="mt-8 flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-[10px] bg-slate-100">
                <Target className="size-4 text-slate-600" />
              </span>
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {t("sellerDash.goals.summaryTotal", {
                    total: formatNumber(
                      goals.reduce((sum: any, g: any) => sum + g.targetValue, 0),
                    ),
                  })}
                </p>
                <p className="text-xs text-slate-400">
                  {t("sellerDash.goals.summaryNote")}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              className="shrink-0 gap-1.5 border-slate-200 bg-white text-slate-700 hover:border-[#10B981] hover:bg-[#ECFDF5] hover:text-emerald-700"
              onClick={() => {
                setEditingGoal(null);
                setFormOpen(true);
              }}
            >
              <Plus className="size-4" />
              {t("sellerDash.goals.ctaAdd")}
            </Button>
          </div>
        )}

      </main>

      {/* Dialogs */}
      <GoalFormDialog open={formOpen} onOpenChange={setFormOpen} goal={editingGoal} />
      <ProgressDialog
        goal={progressGoal}
        open={progressGoal !== null}
        onOpenChange={(open) => {
          if (!open) setProgressGoal(null);
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
            <AlertDialogCancel disabled={deleting}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? t("sellerDash.goals.deleting") : t("sellerDash.goals.deleteAction")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ── KPI Card Component ───
interface KpiCardProps {
  icon: React.ReactNode;
  iconClass: string;
  bgClass: string;
  label: string;
  value: string | number;
  subtitle: string;
  progress?: number;
}

function KpiCard({ icon, iconClass, bgClass, label, value, subtitle, progress }: KpiCardProps) {
  return (
    <div className={`rounded-xl border border-slate-200 bg-white p-4 sm:p-5 ${bgClass}`}>
      <div className="flex items-center gap-2">
        <span className={`flex size-4 items-center justify-center rounded-[10px] ${iconClass}`}>
          {icon}
        </span>
        <p className="text-xs font-medium uppercase tracking-wide">{label}</p>
      </div>
      <p className="mt-2 text-2xl font-bold tabular-nums tracking-tight text-slate-900 sm:text-3xl">
        {value}
      </p>
      <p className="mt-1 text-xs text-slate-400">{subtitle}</p>
      {progress !== undefined && (
        <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-[#10B981] transition-all duration-500"
            style={{ width: `${Math.min(progress, 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
