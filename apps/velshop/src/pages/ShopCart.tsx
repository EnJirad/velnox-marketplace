import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { Checkbox } from "@velnox/shared/components/ui/checkbox";
import { Button } from "@velnox/shared/components/ui/button";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useCart, type CartLine } from "@/lib/cart";
import { useLanguage } from "@/lib/i18n";
import { formatBaht } from "@velnox/shared/lib/commerce";
import {
  ImageOff,
  Loader2,
  Minus,
  Plus,
  ShieldCheck,
  ShoppingBag,
  ShoppingCart,
  Store,
  Trash2,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";

/** Identity key for a cart line — same key = same variant of the same product. */
function lineKey(line: CartLine): string {
  return `${line.productId}::${line.variantId ?? ""}`;
}

export default function ShopCart() {
  const { lines, count, total, setQty, remove, syncing } = useCart();
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Selection state ──────────────────────────────────────────────
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());

  const allKeys = useMemo(() => lines.map(lineKey), [lines]);
  const allSelected = allKeys.length > 0 && allKeys.every((k) => selectedKeys.has(k));
  const someSelected = allKeys.some((k) => selectedKeys.has(k)) && !allSelected;

  const toggleAll = useCallback(() => {
    setSelectedKeys((prev) => {
      if (allSelected) return new Set();
      return new Set(allKeys);
    });
  }, [allSelected, allKeys]);

  const toggleLine = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // Derived totals
  const selectedLines = useMemo(
    () => lines.filter((l) => selectedKeys.has(lineKey(l))),
    [lines, selectedKeys],
  );
  const selectedCount = selectedLines.reduce((s, l) => s + l.qty, 0);
  const selectedTotal = selectedLines.reduce((s, l) => s + l.qty * l.price, 0);

  // ── Redirect unauthenticated ─────────────────────────────────────
  if (!isLoading && !isAuthenticated) {
    navigate("/auth?returnTo=/cart", { replace: true });
    return null;
  }

  // ── Group lines by shop ──────────────────────────────────────────
  const grouped = useMemo(() => {
    const map = new Map<string, CartLine[]>();
    for (const line of lines) {
      const key = line.shopName ?? t("productDetail.defaultShop");
      const list = map.get(key) ?? [];
      list.push(line);
      map.set(key, list);
    }
    return Array.from(map.entries());
  }, [lines, t]);

  const handleSetQty = async (line: CartLine, qty: number) => {
    setBusyId(lineKey(line));
    setQty(line.productId, qty, line.variantId);
    setBusyId(null);
  };

  const handleCheckout = (checkoutSelectedOnly = false) => {
    if (!isAuthenticated) {
      navigate("/auth?returnTo=/checkout");
      return;
    }
    if (checkoutSelectedOnly && selectedLines.length > 0) {
      // Pass selected cart item IDs via navigation state
      const ids = selectedLines.map((l) => l.id);
      navigate("/checkout", { state: { selectedCartItems: ids } });
    } else {
      navigate("/checkout");
    }
  };

  return (
    <div className="flex min-h-screen max-w-full flex-col overflow-x-hidden bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 overflow-hidden px-4 py-8 pb-28 sm:px-6 sm:py-10 lg:pb-10">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("cart.title")}</h1>
          <p className="mt-0.5 text-sm text-slate-500">
            {syncing
              ? t("cartPage.loading")
              : count > 0
                ? t("cartPage.summary", { count, shops: grouped.length })
                : t("cartPage.allHere")}
          </p>
        </div>

        {syncing ? (
          <div className="mt-10 flex items-center justify-center gap-2 text-sm text-slate-400">
            <Loader2 className="size-4 animate-spin" />
            {t("cartPage.loading")}
          </div>
        ) : lines.length === 0 ? (
          <div className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
              <ShoppingBag className="size-7 text-slate-400" />
            </span>
            <h2 className="mt-5 text-lg font-semibold text-slate-900">{t("cartPage.emptyTitle")}</h2>
            <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">{t("cartDrawer.emptyDesc")}</p>
            <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" asChild>
              <Link to="/">
                <ShoppingBag className="size-4" />
                {t("cartPage.goShopping")}
              </Link>
            </Button>
          </div>
        ) : (
          <div className="mt-8 grid min-w-0 gap-6 lg:grid-cols-5">
            {/* Lines grouped by shop */}
            <div className="min-w-0 space-y-5 lg:col-span-3">
              {/* Select All bar */}
              <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3">
                <Checkbox
                  checked={allSelected}
                  ref={(el) => {
                    if (el) {
                      // Indeterminate state for Radix Checkbox
                      const ref = el as unknown as { indeterminate?: boolean };
                      ref.indeterminate = someSelected;
                    }
                  }}
                  onCheckedChange={toggleAll}
                  aria-label={t("cartPage.selectAll")}
                />
                <span className="text-sm font-medium text-slate-700">
                  {allSelected
                    ? t("cartPage.deselectAll")
                    : t("cartPage.selectAll")}
                </span>
                <span className="ml-auto text-xs text-slate-400">
                  {t("cartPage.itemsCount", { count })}
                </span>
              </div>

              {grouped.map(([shopName, shopLines]) => (
                <div key={shopName} className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
                  <div className="flex min-w-0 items-center gap-2 border-b border-slate-100 px-5 py-3">
                    <Store className="size-4 text-[#10B981]" />
                    <p className="min-w-0 truncate text-sm font-semibold text-slate-900">{shopName}</p>
                  </div>
                  <div className="divide-y divide-slate-100">
                    {shopLines.map((line) => {
                      const key = lineKey(line);
                      const isSelected = selectedKeys.has(key);
                      const isBusy = busyId === key;
                      return (
                        <div
                          key={key}
                          className={`flex min-w-0 items-start gap-3 overflow-hidden px-4 py-4 transition-colors sm:items-center sm:gap-4 sm:px-5 ${
                            isSelected ? "bg-[#F0FDF9]" : ""
                          }`}
                        >
                          {/* Checkbox */}
                          <div className="mt-1 shrink-0 sm:mt-0">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleLine(key)}
                              aria-label={line.name}
                            />
                          </div>

                          {/* Image */}
                          {line.imageUrl ? (
                            <img
                              src={line.imageUrl}
                              alt={line.name}
                              className="size-16 shrink-0 rounded-[10px] border border-slate-100 object-cover"
                              loading="lazy"
                            />
                          ) : (
                            <span className="flex size-16 shrink-0 items-center justify-center rounded-[10px] bg-slate-50">
                              <ImageOff className="size-5 text-slate-300" />
                            </span>
                          )}

                          {/* Info */}
                          <div className="min-w-0 flex-1">
                            <Link
                              to={`/products/${line.productId}`}
                              className="block min-w-0 max-w-full truncate text-sm font-semibold text-slate-900 hover:text-[#10B981]"
                              title={line.name}
                              style={{ overflowWrap: "anywhere" }}
                            >
                              {line.name}
                            </Link>
                            {/* Variant info */}
                            {line.variantOptionLabels && (
                              <p className="mt-0.5 text-xs font-medium text-[#10B981]">
                                {line.variantOptionLabels}
                              </p>
                            )}
                            <p className="mt-0.5 text-xs text-slate-400">
                              {formatBaht(line.price)} {t("cart.perUnit", { unit: line.unit })}
                              {line.qty >= line.stock && (
                                <span className="ml-2 font-medium text-amber-600">{t("cartPage.maxStock")}</span>
                              )}
                            </p>
                            <div className="mt-2 flex items-center gap-1">
                              <Button
                                variant="outline"
                                size="icon"
                                className="size-8 border-slate-200 text-slate-600"
                                onClick={() => void handleSetQty(line, line.qty - 1)}
                                disabled={isBusy}
                                aria-label={t("cartDrawer.ariaDecrease")}
                              >
                                <Minus className="size-3" />
                              </Button>
                              <span className="w-8 text-center text-sm font-semibold tabular-nums text-slate-900">
                                {line.qty}
                              </span>
                              <Button
                                variant="outline"
                                size="icon"
                                className="size-8 border-slate-200 text-slate-600"
                                onClick={() => void handleSetQty(line, line.qty + 1)}
                                disabled={isBusy || line.qty >= line.stock}
                                aria-label={t("cartDrawer.ariaIncrease")}
                              >
                                <Plus className="size-3" />
                              </Button>
                            </div>
                          </div>

                          {/* Price + remove */}
                          <div className="flex shrink-0 flex-col items-end gap-2">
                            <p className="text-sm font-bold tabular-nums text-slate-900">
                              {formatBaht(line.qty * line.price)}
                            </p>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 text-slate-400 hover:text-red-600"
                              onClick={() => remove(line.productId, line.variantId)}
                              aria-label={t("cartDrawer.ariaRemove", { name: line.name })}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

            {/* Summary sidebar */}
            <div className="lg:col-span-2">
              <div className="sticky top-20 overflow-hidden rounded-2xl border border-slate-200 bg-white p-6">
                <h2 className="text-base font-bold tracking-tight text-slate-900">{t("cartPage.orderSummary")}</h2>
                <div className="mt-4 space-y-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">{t("cartPage.itemsCount", { count })}</span>
                    <span className="font-medium tabular-nums text-slate-900">{formatBaht(total)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-500">{t("cart.shipping")}</span>
                    <span className="text-slate-400">{t("cartPage.shippingCalc")}</span>
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
                  <span className="text-sm font-medium text-slate-500">{t("cartDrawer.totalLabel")}</span>
                  <span className="text-2xl font-bold tabular-nums tracking-tight text-slate-900">
                    {formatBaht(total)}
                  </span>
                </div>

                {/* Selected items summary */}
                {someSelected || allSelected ? (
                  <div className="mt-4 rounded-xl border border-[#10B981] bg-[#F0FDF9] p-3">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#047857]">
                        {t("cartPage.selectedItems", { count: selectedCount })}
                      </span>
                      <span className="font-bold tabular-nums text-[#047857]">
                        {formatBaht(selectedTotal)}
                      </span>
                    </div>
                  </div>
                ) : null}

                {/* Checkout selected button */}
                <Button
                  className="mt-4 w-full gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
                  disabled={isLoading || selectedLines.length === 0}
                  onClick={() => handleCheckout(true)}
                >
                  <ShieldCheck className="size-4" />
                  {selectedLines.length > 0
                    ? t("cartPage.checkoutSelected", { count: selectedCount })
                    : t("cart.checkout")}
                </Button>

                {/* Checkout all button */}
                {someSelected && (
                  <Button
                    className="mt-2 w-full gap-1.5 border-slate-200 text-slate-700"
                    variant="outline"
                    disabled={isLoading || count === 0}
                    onClick={() => handleCheckout(false)}
                  >
                    {t("cartPage.checkoutAll")}
                  </Button>
                )}

                <p className="mt-3 flex items-center justify-center gap-1 text-center text-[11px] text-slate-400">
                  <ShieldCheck className="size-3.5 text-[#10B981]" />
                  {t("cartPage.checkoutNote")}
                </p>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Mobile sticky checkout bar */}
      {!syncing && lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 max-w-full px-3 lg:hidden">
          <div className="mx-auto flex w-full max-w-md items-center justify-between gap-3 rounded-2xl border border-slate-200/80 bg-white/95 p-3 shadow-[0_10px_34px_rgba(15,23,42,0.16)] backdrop-blur">
            <div className="min-w-0">
              {selectedLines.length > 0 ? (
                <>
                  <p className="text-[11px] text-[#047857]">
                    {t("cartPage.selectedItems", { count: selectedCount })}
                  </p>
                  <p className="text-lg font-bold tabular-nums tracking-tight text-[#047857]">
                    {formatBaht(selectedTotal)}
                  </p>
                </>
              ) : (
                <>
                  <p className="text-[11px] text-slate-400">{t("cartDrawer.totalLabel")}</p>
                  <p className="text-lg font-bold tabular-nums tracking-tight text-slate-900">
                    {formatBaht(total)}
                  </p>
                </>
              )}
            </div>
            <Button
              className="h-12 flex-1 gap-1.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800"
              disabled={isLoading || selectedLines.length === 0}
              onClick={() => handleCheckout(true)}
            >
              <ShoppingCart className="size-4" />
              {selectedLines.length > 0
                ? t("cartPage.checkoutSelected", { count: selectedCount })
                : t("cart.checkout")}
            </Button>
          </div>
        </div>
      )}

      <ShopFooter />
    </div>
  );
}
