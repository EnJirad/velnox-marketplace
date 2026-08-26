import { Button } from "@velnox/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useLanguage } from "@/lib/i18n";
import { formatBaht, type StoreProduct } from "@velnox/shared/lib/commerce";
import { CalendarClock, CheckCircle2, Loader2, Package, Zap } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner"

interface SubscriptionDialogProps {
  product: StoreProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedVariant?: { id: string; name: string; price: number; sku?: string } | null;
}

type PackageType = "weekly" | "monthly";

interface PackageOption {
  type: PackageType;
  enabled: boolean;
  price: number | null;
  qty: number | null;
  intervalDays: number;
  labelKey: string;
  descKey: string;
}

export function SubscriptionDialog({ product, open, onOpenChange, selectedVariant }: SubscriptionDialogProps) {
  const { isAuthenticated } = useAuth();
  const { t } = useLanguage();
  const createPackage = useAction(api.commerce.createVelRepeatPackage);
  const navigate = useNavigate();
  const [selectedType, setSelectedType] = useState<PackageType | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!product) return null;

  const stock = (product.inventory?.available ?? product.inventory?.quantity) ?? 0;
  const regularPrice = selectedVariant?.price ?? product.price;

  // Build available package options from product config
  // Products may not have vrepeat fields yet, so default to showing options
  // based on available data
  const packages: PackageOption[] = [
    {
      type: "weekly",
      enabled: true,
      price: (product as any).vrepeatWeeklyPrice ?? null,
      qty: (product as any).vrepeatWeeklyQty ?? null,
      intervalDays: 7,
      labelKey: "subscription.weekly",
      descKey: "subscription.weeklyDesc",
    },
    {
      type: "monthly",
      enabled: true,
      price: (product as any).vrepeatMonthlyPrice ?? null,
      qty: (product as any).vrepeatMonthlyQty ?? null,
      intervalDays: 30,
      labelKey: "subscription.monthly",
      descKey: "subscription.monthlyDesc",
    },
  ];

  const selectedPkg = packages.find((p) => p.type === selectedType);
  const pkgQty = selectedPkg?.qty ?? 4;
  const pkgUnitPrice = selectedPkg?.price ?? Math.round(regularPrice * 0.95 * 100) / 100;
  const totalCost = pkgUnitPrice * pkgQty;
  const totalSavings = (regularPrice - pkgUnitPrice) * pkgQty;

  const handleConfirm = async () => {
    if (!product || !selectedType) return;
    if (!isAuthenticated) {
      onOpenChange(false);
      navigate("/auth?returnTo=/products/" + product.id);
      return;
    }
    setSubmitting(true);
    try {
      await createPackage({
        productId: product.id,
        packageType: selectedType,
        quantity: pkgQty,
        unitPrice: pkgUnitPrice,
      });
      toast.success(t("subscription.success", { name: product.name, days: selectedPkg?.intervalDays ?? 30 }));
      onOpenChange(false);
      navigate("/velrepeat");
    } catch (error) {
      console.error("Create velrepeat package error:", error);
      toast.error(error instanceof Error ? error.message : t("subscription.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CalendarClock className="size-4 text-[#10B981]" />
            {t("subscription.velRepeatTitle")}
          </DialogTitle>
          <DialogDescription>
            {t("subscription.velRepeatDesc")}
          </DialogDescription>
        </DialogHeader>

        {/* Package Selection */}
        <div className="grid gap-3">
          {packages.filter((p) => p.enabled).map((pkg) => {
            const unitPrice = pkg.price ?? Math.round(regularPrice * 0.95 * 100) / 100;
            const qty = pkg.qty ?? 4;
            const isSelected = selectedType === pkg.type;
            const savings = (regularPrice - unitPrice) * qty;
            return (
              <button
                key={pkg.type}
                type="button"
                onClick={() => setSelectedType(pkg.type)}
                className={`flex items-start gap-3 rounded-xl border-2 p-4 text-left transition-colors ${
                  isSelected
                    ? "border-[#10B981] bg-[#F0FDF9]"
                    : "border-slate-200 bg-white hover:border-slate-300"
                }`}
                aria-pressed={isSelected}
              >
                <span className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${
                  isSelected ? "bg-[#10B981] text-white" : "bg-slate-100 text-slate-500"
                }`}>
                  {pkg.type === "weekly" ? <Package className="size-4" /> : <Zap className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold text-slate-900">{t(pkg.labelKey)}</span>
                    {savings > 0 && (
                      <span className="rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[11px] font-medium text-emerald-700">
                        -{formatBaht(savings)}
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">{t(pkg.descKey, { qty })}</p>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span className="text-base font-bold text-slate-900">{formatBaht(unitPrice)}</span>
                    <span className="text-xs text-slate-400">× {qty} {product.unit}</span>
                    <span className="text-xs text-slate-400">= {formatBaht(unitPrice * qty)}</span>
                  </div>
                  {unitPrice < regularPrice && (
                    <p className="mt-1 text-[11px] text-slate-400">
                      <span className="line-through">{formatBaht(regularPrice)}</span>
                      <span className="ml-1 text-[#10B981]">{t("subscription.save")}</span>
                    </p>
                  )}
                </div>
                <span
                  className={`mt-1 size-4 shrink-0 rounded-full border-2 ${
                    isSelected ? "border-[#10B981] bg-[#10B981]" : "border-slate-300 bg-white"
                  }`}
                />
              </button>
            );
          })}
        </div>

        {/* Delivery schedule preview */}
        {selectedPkg && (
          <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
            <p className="text-xs font-semibold text-slate-500">{t("subscription.deliverySchedule")}</p>
            <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
              {Array.from({ length: pkgQty }).map((_, i) => (
                <div key={i} className="flex items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs text-slate-600">
                  <CheckCircle2 className="size-3 text-slate-300" />
                  <span>{t("subscription.deliveryN", { n: i + 1 })}</span>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              {t("subscription.paidOnce", { total: formatBaht(totalCost) })}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-slate-200 text-slate-700">
            {t("common.cancel")}
          </Button>
          <Button
            className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
            onClick={handleConfirm}
            disabled={submitting || !selectedType}
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {selectedType ? t("subscription.confirmPackage", { total: formatBaht(totalCost) }) : t("subscription.selectPackage")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
