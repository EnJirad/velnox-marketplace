import { Button } from "@velnox/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@velnox/shared/components/ui/select";
import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useLanguage } from "@/lib/i18n";
import { formatBaht, type StoreProduct } from "@velnox/shared/lib/commerce";
import { CalendarClock, Loader2, MapPin, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { toast } from "sonner";

interface VelRepeatPlanDialogProps {
  product: StoreProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedVariant?: { id: string; name: string; price: number; sku?: string } | null;
}

interface AddressRow {
  id: string;
  label?: string;
  recipientName?: string;
  phone?: string;
  line1?: string;
  province?: string;
  postalCode?: string;
  isDefault?: boolean;
}

type FreqUnit = "days" | "weeks" | "months";

export function VelRepeatPlanDialog({ product, open, onOpenChange, selectedVariant }: VelRepeatPlanDialogProps) {
  const { isAuthenticated } = useAuth();
  const { t } = useLanguage();
  const createPlan = useAction(api.commerce.createVelRepeatPlan);
  const myAddresses = useAction(api.customer.myAddresses);
  const navigate = useNavigate();

  const [freqUnit, setFreqUnit] = useState<FreqUnit>("days");
  const [freqValue, setFreqValue] = useState(30);
  const [quantity, setQuantity] = useState(1);
  const [shippingAddressId, setShippingAddressId] = useState<string>("");
  const [addresses, setAddresses] = useState<AddressRow[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setFreqUnit("days");
    setFreqValue(30);
    setQuantity(1);
    setShippingAddressId("");
    setAddresses(null);
    if (!isAuthenticated) return;
    myAddresses()
      .then((res) => {
        const rows = (res ?? []) as unknown as AddressRow[];
        setAddresses(rows);
        const def = rows.find((a) => a.isDefault) ?? rows[0];
        if (def) setShippingAddressId(def.id);
      })
      .catch((err) => {
        console.error("Load addresses for VelRepeat plan error:", err);
        setAddresses([]);
      });
  }, [open, isAuthenticated, myAddresses]);

  if (!product) return null;

  const unitPrice = selectedVariant?.price ?? product.price;
  const canCreate = Boolean(shippingAddressId) && freqValue > 0 && quantity > 0;

  const handleConfirm = async () => {
    if (!product || !canCreate || submitting) return;
    if (!isAuthenticated) {
      onOpenChange(false);
      navigate("/auth?returnTo=" + encodeURIComponent(`/products/${product.id}`));
      return;
    }
    setSubmitting(true);
    try {
      await createPlan({
        items: [
          {
            productId: product.id,
            variantId: selectedVariant?.id ?? null,
            quantity,
          },
        ],
        frequencyType: freqUnit,
        intervalValue: freqValue,
        shippingAddressId,
        paymentMethod: "cod",
      });
      toast.success(t("velrepeatPlan.createSuccess"));
      onOpenChange(false);
      navigate("/velrepeat");
    } catch (error) {
      console.error("Create VelRepeat plan error:", error);
      toast.error(error instanceof Error ? error.message : t("velrepeatPlan.createFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const freqLabel = (unit: FreqUnit, value: number) => {
    if (unit === "days") return t("velrepeatPlan.everyDays", { count: value });
    if (unit === "weeks") return t("velrepeatPlan.everyWeeks", { count: value });
    return t("velrepeatPlan.everyMonths", { count: value });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <RefreshCw className="size-4 text-[#10B981]" />
            {t("velrepeatPlan.title")}
          </DialogTitle>
          <DialogDescription>{t("velrepeatPlan.desc")}</DialogDescription>
        </DialogHeader>

        <div className="grid gap-4">
          {/* Product summary */}
          <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-slate-50 p-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] bg-white text-[#10B981] ring-1 ring-slate-100">
              <CalendarClock className="size-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{product.name}</p>
              <p className="text-xs text-slate-500">
                {selectedVariant?.name ?? ""}
                {selectedVariant?.name ? " · " : ""}
                <span className="font-semibold text-slate-900">{formatBaht(unitPrice)}</span>
                /{product.unit}
              </p>
            </div>
          </div>

          {/* Frequency */}
          <div>
            <label className="text-xs font-semibold text-slate-600">{t("velrepeatPlan.frequency")}</label>
            <div className="mt-1.5 flex gap-2">
              <Select value={freqUnit} onValueChange={(v) => setFreqUnit(v as FreqUnit)}>
                <SelectTrigger className="w-36 border-slate-200 bg-white">
                  <SelectValue placeholder="days" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="days">{t("velrepeatPlan.unitDay")}</SelectItem>
                  <SelectItem value="weeks">{t("velrepeatPlan.unitWeek")}</SelectItem>
                  <SelectItem value="months">{t("velrepeatPlan.unitMonth")}</SelectItem>
                </SelectContent>
              </Select>
              <input
                type="number"
                min={1}
                max={365}
                value={freqValue}
                onChange={(e) => setFreqValue(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
                className="w-24 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#10B981] focus:ring-2 focus:ring-[#10B981]/20"
                aria-label={t("velrepeatPlan.frequency")}
              />
            </div>
            <p className="mt-1.5 text-xs text-slate-500">{freqLabel(freqUnit, freqValue)}</p>
          </div>

          {/* Quantity */}
          <div>
            <label className="text-xs font-semibold text-slate-600">{t("velrepeatPlan.quantity")}</label>
            <div className="mt-1.5 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="flex size-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg text-slate-600 transition-colors hover:border-slate-300 disabled:opacity-40"
                disabled={quantity <= 1}
                aria-label="-1"
              >
                −
              </button>
              <span className="w-10 text-center text-lg font-bold tabular-nums text-slate-900">{quantity}</span>
              <button
                type="button"
                onClick={() => setQuantity((q) => Math.min(99, q + 1))}
                className="flex size-9 items-center justify-center rounded-lg border border-slate-200 bg-white text-lg text-slate-600 transition-colors hover:border-slate-300"
                aria-label="+1"
              >
                +
              </button>
              <span className="text-sm text-slate-400">
                × {formatBaht(unitPrice)} /{product.unit}
              </span>
            </div>
          </div>

          {/* Shipping address */}
          <div>
            <label className="text-xs font-semibold text-slate-600">{t("velrepeatPlan.shipping")}</label>
            <div className="mt-1.5">
              {addresses === null ? (
                <div className="flex h-10 items-center gap-2 text-sm text-slate-400">
                  <Loader2 className="size-4 animate-spin" />
                </div>
              ) : addresses.length === 0 ? (
                <div className="flex flex-col gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 p-3">
                  <p className="flex items-center gap-1.5 text-sm text-slate-500">
                    <MapPin className="size-4 text-slate-400" />
                    {t("velrepeatPlan.noAddress")}
                  </p>
                  <Button variant="outline" size="sm" className="w-fit border-slate-200 text-slate-700" asChild>
                    <a href="/profile/addresses">{t("velrepeatPlan.addAddress")}</a>
                  </Button>
                </div>
              ) : (
                <Select value={shippingAddressId} onValueChange={setShippingAddressId}>
                  <SelectTrigger className="w-full border-slate-200 bg-white">
                    <SelectValue placeholder={t("velrepeatPlan.selectShipping")} />
                  </SelectTrigger>
                  <SelectContent>
                    {addresses.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {`${a.label || "Home"} — ${a.recipientName ?? ""} ${a.line1 ?? ""} ${a.province ?? ""} ${a.postalCode ?? ""}`}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="border-slate-200 text-slate-700">
            {t("common.cancel")}
          </Button>
          <Button
            className="gap-1.5 bg-[#10B981] text-white hover:bg-emerald-600"
            onClick={handleConfirm}
            disabled={submitting || !canCreate}
          >
            {submitting && <Loader2 className="size-4 animate-spin" />}
            {submitting ? t("velrepeatPlan.creating") : t("velrepeatPlan.start")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}