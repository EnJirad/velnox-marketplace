import { Button } from "@velnox/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useLanguage } from "@/lib/i18n";
import { formatBaht, type StoreProduct } from "@velnox/shared/lib/commerce";
import { CalendarClock, CheckCircle2, ImageOff, Loader2, Package, Zap } from "lucide-react";
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
  const productImage = product.primaryImage?.url ?? product.images?.[0]?.url ?? null;

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
      <DialogContent className="w-[min(calc(100vw-24px),520px)] max-w-[calc(100vw-24px)] gap-0 overflow-hidden rounded-2xl border-slate-200 p-0">
        <div className="flex max-h-[85dvh] flex-col">
          {/* Header */}
          <div className="flex items-start gap-3 border-b border-slate-100 px-5 py-4 pr-12 sm:px-6">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#10B981]/10">
              <CalendarClock className="size-4 text-[#10B981]" />
            </span>
            <div className="min-w-0 flex-1">
              <DialogTitle className="text-left text-base font-bold tracking-tight text-slate-900">
                {t("subscription.velRepeatTitle")}
              </DialogTitle>
              <DialogDescription className="text-left text-xs leading-5 text-slate-500">
                {t("subscription.velRepeatDesc")}
              </DialogDescription>
            </div>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
            {/* Product summary */}
            <div className="flex min-w-0 items-center gap-3 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
              {productImage ? (
                <img
                  src={productImage}
                  alt={product.name}
                  className="size-14 shrink-0 rounded-lg border border-slate-100 object-cover"
                  loading="lazy"
                />
              ) : (
                <span className="flex size-14 shrink-0 items-center justify-center rounded-lg border border-slate-100 bg-white">
                  <ImageOff className="size-4 text-slate-300" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900">{product.name}</p>
                {selectedVariant?.name && (
                  <p className="mt-0.5 truncate text-xs font-medium text-[#047857]">{selectedVariant.name}</p>
                )}
                <p className="mt-1 text-sm font-bold tabular-nums text-slate-900">{formatBaht(regularPrice)}</p>
              </div>
            </div>

            {/* Frequency / package selection */}
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{t("subscription.frequencyLabel")}</p>
              <div className="mt-2 grid gap-2">
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
                      className={`flex min-w-0 items-start gap-3 rounded-xl border p-3.5 text-left transition-all ${
                        isSelected
                          ? "border-[#10B981] bg-[#F0FDF9] shadow-sm"
                          : "border-slate-200 bg-white hover:border-slate-300"
                      }`}
                      aria-pressed={isSelected}
                    >
                      <span className={`flex size-9 shrink-0 items-center justify-center rounded-[10px] ${
                        isSelected ? "bg-[#10B981] text-white" : "bg-slate-100 text-slate-500"
                      }`}>
                        {pkg.type === "weekly" ? <Package className="size-4" /> : <Zap className="size-4" />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5">
                          <span className="text-sm font-semibold text-slate-900">{t(pkg.labelKey)}</span>
                          <span className="text-xs text-slate-400">{t(pkg.descKey, { qty })}</span>
                        </span>
                        <span className="mt-1 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                          <span className="text-base font-bold tabular-nums text-slate-900">{formatBaht(unitPrice)}</span>
                          <span className="text-xs text-slate-400">× {qty} {product.unit}</span>
                          <span className="text-xs font-medium tabular-nums text-slate-500">= {formatBaht(unitPrice * qty)}</span>
                          {savings > 0 && (
                            <span className="rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[11px] font-medium text-[#047857]">
                              −{formatBaht(savings)}
                            </span>
                          )}
                        </span>
                        {unitPrice < regularPrice && (
                          <span className="mt-1 block text-[11px] text-slate-400">
                            <span className="line-through">{formatBaht(regularPrice)}</span>
                            <span className="ml-1.5 text-[#10B981]">{t("subscription.save")}</span>
                          </span>
                        )}
                      </span>
                      <span
                        className={`mt-0.5 size-4 shrink-0 rounded-full border-2 ${
                          isSelected ? "border-[#10B981] bg-[#10B981]" : "border-slate-300 bg-white"
                        }`}
                      />
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Delivery schedule preview */}
            {selectedPkg && (
              <div className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                <p className="text-xs font-semibold text-slate-500">{t("subscription.deliverySchedule")}</p>
                <div className="mt-2 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {Array.from({ length: pkgQty }).map((_, i) => (
                    <div key={i} className="flex min-w-0 items-center gap-1.5 rounded-lg bg-white px-2.5 py-1.5 text-xs text-slate-600">
                      <CheckCircle2 className="size-3 shrink-0 text-slate-300" />
                      <span className="truncate">{t("subscription.deliveryN", { n: i + 1 })}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Price estimate */}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-[#10B981]/20 bg-[#F0FDF9] px-4 py-3">
              <span className="text-sm font-medium text-slate-600">{t("subscription.estimateLabel")}</span>
              <span className="text-base font-bold tabular-nums text-slate-900">{formatBaht(totalCost)}</span>
            </div>
            {selectedPkg && (
              <p className="text-center text-[11px] leading-5 text-slate-400">
                {t("subscription.paidOnce", { total: formatBaht(totalCost) })}
              </p>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-slate-100 px-5 py-4 sm:px-6">
            <DialogFooter className="gap-2 sm:justify-between">
              <Button variant="outline" onClick={() => onOpenChange(false)} className="border-slate-200 text-slate-700">
                {t("common.cancel")}
              </Button>
              <Button
                className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
                onClick={handleConfirm}
                disabled={submitting || !selectedType}
              >
                {submitting && <Loader2 className="size-4 animate-spin" />}
                {t("subscription.createPlan")}
              </Button>
            </DialogFooter>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}