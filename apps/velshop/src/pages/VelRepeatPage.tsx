import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { api } from "@velnox/shared/lib/api-routes";
import { formatBaht } from "@velnox/shared/lib/commerce";
import { useAction } from "@velnox/shared/lib/api-routes";
import {
  CalendarClock,
  ImageOff,
  Pause,
  Play,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

interface VelRepeatPackage {
  id: string;
  productId: string;
  productName: string;
  productUnit: string;
  variantId: string | null;
  shopId: string;
  shopName: string;
  packageType: string;
  quantityTotal: number;
  quantityDelivered: number;
  unitPrice: number;
  regularUnitPrice: number;
  discountAmount: number;
  totalAmount: number;
  currency: string;
  status: string;
  intervalDays: number;
  startedAt: string | null;
  completedAt: string | null;
  productImageUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

const STATUS_META: Record<string, { badge: string; dot: string }> = {
  pending_payment: {
    badge: "bg-slate-100 text-slate-500 ring-slate-600/10 hover:bg-slate-100",
    dot: "bg-slate-400",
  },
  paid: {
    badge: "bg-blue-50 text-blue-700 ring-blue-600/15 hover:bg-blue-50",
    dot: "bg-blue-500",
  },
  active: {
    badge: "bg-[#ECFDF5] text-emerald-700 ring-emerald-600/15 hover:bg-[#ECFDF5]",
    dot: "bg-[#10B981]",
  },
  paused: {
    badge: "bg-amber-50 text-amber-700 ring-amber-600/15 hover:bg-amber-50",
    dot: "bg-amber-500",
  },
  completed: {
    badge: "bg-[#ECFDF5] text-emerald-700 ring-emerald-600/15 hover:bg-[#ECFDF5]",
    dot: "bg-[#10B981]",
  },
  cancelled: {
    badge: "bg-slate-100 text-slate-500 ring-slate-600/10 hover:bg-slate-100",
    dot: "bg-slate-400",
  },
  refunded: {
    badge: "bg-red-50 text-red-700 ring-red-600/15 hover:bg-red-50",
    dot: "bg-red-500",
  },
};

const STATUS_LABEL_KEY: Record<string, string> = {
  pending_payment: "velrepeat.statusPending",
  paid: "velrepeat.statusPaid",
  active: "velrepeat.statusActive",
  paused: "velrepeat.statusPaused",
  completed: "velrepeat.statusCompleted",
  cancelled: "velrepeat.statusCancelled",
  refunded: "velrepeat.statusRefunded",
};

export default function VelRepeatPage() {
  const { t } = useLanguage();
  const myPackages = useAction(api.commerce.myVelRepeatPackages);
  const updatePackage = useAction(api.commerce.updateVelRepeatPackage);

  const [packages, setPackages] = useState<VelRepeatPackage[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const rows = (await myPackages()) as unknown as VelRepeatPackage[];
      setPackages(rows ?? []);
    } catch (err) {
      console.error("VelRepeat packages error:", err);
      setPackages([]);
    }
  }, [myPackages]);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (pkg: VelRepeatPackage, action: "pause" | "resume" | "cancel") => {
    setBusyId(pkg.id);
    try {
      await updatePackage({ packageId: pkg.id, action });
      const label =
        action === "resume"
          ? t("velrepeat.resumed")
          : action === "pause"
            ? t("velrepeat.pausedMsg")
            : t("velrepeat.cancelledMsg");
      toast.success(label);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("velrepeat.failed"));
    } finally {
      setBusyId(null);
    }
  };

  const packageTypeLabel = (type: string) => {
    switch (type) {
      case "weekly": return t("velrepeat.weekly");
      case "monthly": return t("velrepeat.monthly");
      default: return type;
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <section className="border-b border-slate-100 bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <RefreshCw className="size-4 text-[#10B981]" />
            {t("velrepeat.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            {t("velrepeat.title")}
          </h1>
          <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">{t("velrepeat.desc")}</p>
        </div>
      </section>

      <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        {packages === null ? (
          <div className="space-y-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-28 rounded-2xl" />
            ))}
          </div>
        ) : packages.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-[#ECFDF5]">
              <CalendarClock className="size-7 text-[#10B981]" />
            </span>
            <h2 className="mt-5 text-lg font-semibold text-slate-900">{t("velrepeat.emptyTitle")}</h2>
            <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">{t("velrepeat.emptyDesc")}</p>
            <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" asChild>
              <Link to="/">{t("velrepeat.pickProducts")}</Link>
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {packages.map((pkg) => {
              const meta = STATUS_META[pkg.status] ?? STATUS_META.pending_payment;
              const labelKey = STATUS_LABEL_KEY[pkg.status] ?? "velrepeat.statusPending";
              const editable = ["active", "paused"].includes(pkg.status);
              const progress = pkg.quantityTotal > 0 ? (pkg.quantityDelivered / pkg.quantityTotal) * 100 : 0;
              const isExpanded = expandedId === pkg.id;
              return (
                <div
                  key={pkg.id}
                  className="rounded-2xl border border-slate-200 bg-white p-5"
                >
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
                    <Link to={`/products/${pkg.productId}`} className="shrink-0">
                      {pkg.productImageUrl ? (
                        <img
                          src={pkg.productImageUrl}
                          alt={pkg.productName}
                          className="size-16 rounded-[12px] border border-slate-100 object-cover"
                          loading="lazy"
                        />
                      ) : (
                        <span className="flex size-16 items-center justify-center rounded-[12px] bg-slate-50">
                          <ImageOff className="size-6 text-slate-300" />
                        </span>
                      )}
                    </Link>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          to={`/products/${pkg.productId}`}
                          className="truncate text-sm font-semibold text-slate-900 hover:text-[#10B981]"
                        >
                          {pkg.productName}
                        </Link>
                        <Badge className={`gap-1 rounded-full ring-1 ring-inset ${meta.badge}`}>
                          <span className={`size-1.5 rounded-full ${meta.dot}`} />
                          {t(labelKey) || pkg.status}
                        </Badge>
                        <Badge className="rounded-full bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-600/10 hover:bg-slate-100">
                          {packageTypeLabel(pkg.packageType)}
                        </Badge>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>
                          {pkg.quantityDelivered}/{pkg.quantityTotal} {pkg.productUnit}
                        </span>
                        <span>
                          {t("velrepeat.price")} <span className="font-semibold tabular-nums text-slate-900">{formatBaht(pkg.unitPrice)}</span>
                        </span>
                        <span className="font-semibold tabular-nums text-slate-900">
                          {formatBaht(pkg.totalAmount)}
                        </span>
                      </div>
                      {/* Progress bar */}
                      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                        <div className="h-full rounded-full bg-[#10B981] transition-all" style={{ width: `${progress}%` }} />
                      </div>
                      <p className="mt-1 text-[11px] text-slate-400">
                        {pkg.status === "completed"
                          ? t("velrepeat.completedHint")
                          : pkg.status === "active"
                            ? `${pkg.quantityDelivered}/${pkg.quantityTotal} delivered`
                            : t("velrepeat.pausedHint")}
                      </p>
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                      {pkg.status === "active" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 border-slate-200 text-slate-600"
                          disabled={busyId === pkg.id}
                          onClick={() => changeStatus(pkg, "pause")}
                        >
                          <Pause className="size-3.5" />
                          {t("velrepeat.pause")}
                        </Button>
                      )}
                      {pkg.status === "paused" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="gap-1.5 border-emerald-200 bg-[#ECFDF5] text-emerald-700 hover:bg-[#D1FAE5]"
                          disabled={busyId === pkg.id}
                          onClick={() => changeStatus(pkg, "resume")}
                        >
                          <Play className="size-3.5" />
                          {t("velrepeat.resume")}
                        </Button>
                      )}
                      {editable && (
                        <>
                          <Button
                            variant="outline"
                            size="sm"
                            className="gap-1.5 border-slate-200 text-slate-600"
                            onClick={() => setExpandedId(isExpanded ? null : pkg.id)}
                          >
                            {t("velrepeat.viewSchedule")}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="gap-1.5 text-red-600 hover:bg-red-50"
                            disabled={busyId === pkg.id}
                            onClick={() => changeStatus(pkg, "cancel")}
                          >
                            <Trash2 className="size-3.5" />
                            {t("velrepeat.cancel")}
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>



      <ShopFooter />
    </div>
  );
}
