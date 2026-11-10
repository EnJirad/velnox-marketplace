import {
  formatNumber,
  formatShortThaiDate,
  goalPercent,
  isAchieved,
  isAtRisk,
  type Goal,
  type GoalCategory,
  type GoalPeriod,
} from "@velnox/shared/lib/goals";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Card } from "@velnox/shared/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@velnox/shared/components/ui/dropdown-menu";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  CalendarClock,
  CheckCircle2,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
  TrendingUp,
  ShoppingBag,
  Users,
  Target,
  type LucideIcon,
} from "lucide-react";

interface GoalCardProps {
  goal: Goal;
  onEdit: (goal: Goal) => void;
  onDelete: (goal: Goal) => void;
  onRecordProgress: (goal: Goal) => void;
}

/**
 * Category + period presentation.
 *
 * Labels live in the i18n dictionary (`sellerDash.goals.*`, patched in
 * `locales/index.ts`) so this card carries no literal Thai copy — it is used by
 * the seller dashboard only.
 */
const CATEGORY_ICON: Record<GoalCategory, { icon: LucideIcon; chip: string; iconClass: string }> = {
  revenue: {
    icon: TrendingUp,
    chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/10",
    iconClass: "text-emerald-600",
  },
  orders: {
    icon: ShoppingBag,
    chip: "bg-sky-50 text-sky-700 ring-sky-600/10",
    iconClass: "text-sky-600",
  },
  customers: {
    icon: Users,
    chip: "bg-amber-50 text-amber-700 ring-amber-600/10",
    iconClass: "text-amber-600",
  },
  other: {
    icon: Target,
    chip: "bg-slate-100 text-slate-700 ring-slate-600/10",
    iconClass: "text-slate-600",
  },
};

const CATEGORY_KEY: Record<GoalCategory, string> = {
  revenue: "sellerDash.goals.categoryRevenue",
  orders: "sellerDash.goals.categoryOrders",
  customers: "sellerDash.goals.categoryCustomers",
  other: "sellerDash.goals.categoryOther",
};

const PERIOD_KEY: Record<GoalPeriod, string> = {
  monthly: "sellerDash.goals.periodMonthly",
  quarterly: "sellerDash.goals.periodQuarterly",
  yearly: "sellerDash.goals.periodYearly",
};

export function GoalCard({ goal, onEdit, onDelete, onRecordProgress }: GoalCardProps) {
  const { t } = useLanguage();

  const category = (goal.category ?? "other") as GoalCategory;
  const period = (goal.period ?? "monthly") as GoalPeriod;
  const meta = CATEGORY_ICON[category] ?? CATEGORY_ICON.other;
  const percent = goalPercent(goal);
  const achieved = isAchieved(goal);
  const atRisk = isAtRisk(goal);
  const Icon = meta.icon;

  return (
    <Card className="group flex flex-col gap-4 rounded-xl border-slate-200 bg-white p-5 shadow-none transition-shadow duration-200 hover:shadow-float">
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex size-9 shrink-0 items-center justify-center rounded-md ring-1 ring-inset ${meta.chip}`}
          >
            <Icon className={`size-4 ${meta.iconClass}`} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-900">{goal.title}</p>
            <p className="mt-0.5 flex items-center gap-1.5 text-xs text-slate-500">
              <span>{t(CATEGORY_KEY[category] ?? CATEGORY_KEY.other)}</span>
              <span aria-hidden="true" className="text-slate-300">
                ·
              </span>
              <span>{t(PERIOD_KEY[period] ?? PERIOD_KEY.monthly)}</span>
            </p>
          </div>
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("sellerDash.goals.optionsAria")}
              className="size-11 shrink-0 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            >
              <MoreHorizontal className="size-4" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem
              className="min-h-11 cursor-pointer"
              onClick={() => onRecordProgress(goal)}
            >
              <Plus className="size-4" aria-hidden="true" />
              {t("sellerDash.goals.recordProgress")}
            </DropdownMenuItem>
            <DropdownMenuItem className="min-h-11 cursor-pointer" onClick={() => onEdit(goal)}>
              <Pencil className="size-4" aria-hidden="true" />
              {t("sellerDash.goals.editGoal")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="min-h-11 cursor-pointer text-red-600 focus:bg-red-50 focus:text-red-600"
              onClick={() => onDelete(goal)}
            >
              <Trash2 className="size-4" aria-hidden="true" />
              {t("sellerDash.goals.deleteAction")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {goal.description ? (
        <p className="-mt-1 line-clamp-2 text-sm leading-5 text-slate-500">{goal.description}</p>
      ) : null}

      {/* Progress */}
      <div className="flex flex-col gap-2">
        <div className="flex items-end justify-between gap-2">
          <p className="text-sm text-slate-500">
            <span className="font-semibold text-slate-900">{formatNumber(goal.currentValue)}</span>
            <span aria-hidden="true"> / </span>
            <span className="sr-only">of</span>
            {formatNumber(goal.targetValue)} {goal.unit}
          </p>
          <p
            className={`text-lg font-bold tabular-nums tracking-tight ${
              achieved ? "text-emerald-600" : "text-slate-900"
            }`}
          >
            {percent}%
          </p>
        </div>
        <div
          className="h-2 w-full overflow-hidden rounded-full bg-slate-100"
          role="progressbar"
          aria-valuenow={percent}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={goal.title}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              achieved ? "bg-emerald-500" : "bg-brand"
            }`}
            style={{ width: `${percent}%` }}
          />
        </div>
      </div>

      {/* Status */}
      <div className="flex flex-wrap items-center gap-2">
        {achieved ? (
          <Badge className="gap-1 rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15 hover:bg-emerald-50">
            <CheckCircle2 className="size-3.5" aria-hidden="true" />
            {t("sellerDash.goals.kpiAchieved")}
          </Badge>
        ) : atRisk ? (
          <Badge className="gap-1 rounded-full bg-amber-50 text-amber-800 ring-1 ring-inset ring-amber-600/20 hover:bg-amber-50">
            <CalendarClock className="size-3.5" aria-hidden="true" />
            {t("sellerDash.goals.atRisk")}
          </Badge>
        ) : (
          <Badge className="gap-1 rounded-full bg-slate-100 text-slate-700 ring-1 ring-inset ring-slate-600/10 hover:bg-slate-100">
            {t("sellerDash.goals.onTrack")}
          </Badge>
        )}
        {goal.dueDate !== undefined && !achieved ? (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <CalendarClock className="size-3.5" aria-hidden="true" />
            {t("sellerDash.goals.dueOn", { date: formatShortThaiDate(goal.dueDate) })}
          </span>
        ) : null}
      </div>

      {/* Actions */}
      <div className="mt-auto">
        <Button
          variant="outline"
          className="h-11 w-full gap-1.5 border-slate-200 bg-white text-slate-700 hover:border-brand hover:bg-[#ECFDF5] hover:text-emerald-700"
          onClick={() => onRecordProgress(goal)}
        >
          <Plus className="size-4" aria-hidden="true" />
          {t("sellerDash.goals.recordProgress")}
        </Button>
      </div>
    </Card>
  );
}
