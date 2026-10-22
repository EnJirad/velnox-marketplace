/**
 * Cart drawer — the original quick-cart sheet.
 *
 * The cart is ONE per seller in the MVP schema, so the sheet lists a group per
 * store instead of flattening lines (a mixed-seller checkout is unrepresentable).
 * Every mutation goes to `/api/mvp/cart` and the provider re-reads the server
 * cart afterwards, so a refused quantity never lingers on screen.
 */
import { Button } from "@velnox/shared/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@velnox/shared/components/ui/sheet";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { formatMoney } from "@velnox/shared/mvp/ui";
import { Loader2, Minus, Plus, ShoppingBag, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { useMvpCart } from "@/mvp/cart";

export function CartDrawer({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useLanguage();
  const { carts, itemCount, updateItem, removeItem } = useMvpCart();
  const [busy, setBusy] = useState<string | null>(null);

  const run = async (id: string, action: () => Promise<void>) => {
    setBusy(id);
    try {
      await action();
    } finally {
      setBusy(null);
    }
  };

  const total = carts.reduce((sum, cart) => sum + Number(cart.subtotal), 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full max-w-md flex-col p-0">
        <SheetHeader className="border-b border-slate-200 px-5 py-4">
          <SheetTitle className="flex items-center gap-2 text-base font-bold text-slate-900">
            <ShoppingBag className="size-4 text-[#10B981]" />
            {t("cart.title")}
            <span className="text-sm font-normal text-slate-400">({itemCount})</span>
          </SheetTitle>
        </SheetHeader>

        {carts.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
              <ShoppingBag className="size-6 text-slate-400" />
            </span>
            <p className="text-sm font-medium text-slate-700">{t("cart.empty")}</p>
            <Button
              asChild
              className="mt-1 bg-[#10B981] text-white hover:bg-[#059669]"
              onClick={() => onOpenChange(false)}
            >
              <Link to="/products">{t("cart.emptyCta")}</Link>
            </Button>
          </div>
        ) : (
          <>
            <div className="flex-1 overflow-y-auto px-4 py-3">
              {carts.map((cart) => (
                <section key={cart.id} className="mb-4 rounded-xl border border-slate-200">
                  <p className="border-b border-slate-100 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                    {cart.seller.storeName}
                  </p>
                  <ul className="divide-y divide-slate-100">
                    {cart.items.map((item) => {
                      const rowBusy = busy === item.id;
                      return (
                        <li key={item.id} className="flex gap-3 p-3">
                          <Link
                            to={`/products/${encodeURIComponent(item.productSlug)}`}
                            onClick={() => onOpenChange(false)}
                            className="size-16 shrink-0 overflow-hidden rounded-lg bg-slate-100"
                          >
                            {item.imageUrl && (
                              <img
                                src={item.imageUrl}
                                alt={item.productName}
                                className="size-full object-cover"
                                loading="lazy"
                              />
                            )}
                          </Link>
                          <div className="min-w-0 flex-1">
                            <p className="line-clamp-2 text-[13px] font-medium leading-snug text-slate-900">
                              {item.productName}
                            </p>
                            {item.variantName && (
                              <p className="text-[11px] text-slate-400">{item.variantName}</p>
                            )}
                            <p className="text-[11px] text-slate-400">
                              {formatMoney(item.unitPrice)}
                              {item.sellingUnitLabel ? ` · ${item.sellingUnitLabel}` : ""}
                            </p>
                            <div className="mt-1.5 flex items-center justify-between gap-2">
                              <div className="flex items-center rounded-lg border border-slate-200">
                                <button
                                  type="button"
                                  className="flex size-7 items-center justify-center text-slate-500 disabled:opacity-40"
                                  disabled={rowBusy || item.quantity <= 1}
                                  aria-label={`${t("cart.quantity")} −`}
                                  onClick={() =>
                                    void run(item.id, () =>
                                      updateItem(item.id, Math.max(1, item.quantity - 1)),
                                    )
                                  }
                                >
                                  <Minus className="size-3" />
                                </button>
                                <span className="min-w-6 text-center text-xs font-semibold tabular-nums">
                                  {rowBusy ? (
                                    <Loader2 className="mx-auto size-3 animate-spin text-slate-400" />
                                  ) : (
                                    item.quantity
                                  )}
                                </span>
                                <button
                                  type="button"
                                  className="flex size-7 items-center justify-center text-slate-500 disabled:opacity-40"
                                  disabled={rowBusy || item.quantity >= item.available}
                                  aria-label={`${t("cart.quantity")} +`}
                                  onClick={() =>
                                    void run(item.id, () => updateItem(item.id, item.quantity + 1))
                                  }
                                >
                                  <Plus className="size-3" />
                                </button>
                              </div>
                              <button
                                type="button"
                                className="flex size-7 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                                disabled={rowBusy}
                                aria-label={t("common.remove")}
                                onClick={() => void run(item.id, () => removeItem(item.id))}
                              >
                                <Trash2 className="size-3.5" />
                              </button>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
            </div>

            <div className="border-t border-slate-200 p-4">
              <div className="flex items-center justify-between text-sm">
                <span className="text-slate-500">{t("cart.subtotal")}</span>
                <span className="text-base font-bold tabular-nums text-slate-900">
                  {formatMoney(total.toFixed(2))}
                </span>
              </div>
              <div className="mt-3 grid gap-2">
                <Button
                  asChild
                  className="h-11 bg-[#10B981] text-white hover:bg-[#059669]"
                  onClick={() => onOpenChange(false)}
                >
                  <Link to="/cart">{t("nav.cart")}</Link>
                </Button>
                <Button
                  asChild
                  variant="outline"
                  className="h-11"
                  onClick={() => onOpenChange(false)}
                >
                  <Link to="/products">{t("cart.continueShopping")}</Link>
                </Button>
              </div>
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}
