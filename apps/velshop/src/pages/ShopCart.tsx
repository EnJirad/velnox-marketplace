import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { useCart, type CartLine } from "@/lib/cart";
import { useLanguage } from "@/lib/i18n";
import { Button } from "@velnox/shared/components/ui/button";
import { Checkbox } from "@velnox/shared/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@velnox/shared/components/ui/sheet";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { formatBaht } from "@velnox/shared/lib/commerce";
import {
  checkboxChecked,
  computeCartSummary,
  computeShopSummaries,
  groupLinesByShop,
  selectionState,
  toggleAll as toggleAllSelection,
  toggleLine as toggleLineSelection,
  toggleShop as toggleShopSelection,
  type SelectionState,
} from "@velnox/shared/lib/cart-selection";
import {
  ChevronUp,
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

/**
 * Identity of a cart row for the QUANTITY stepper — `setQty` addresses a line
 * by product + variant, so busy state follows the same key.
 *
 * Selection uses `line.id` instead (the cart item id): it is unique per row and
 * it is exactly the value the existing checkout flow passes as
 * `selectedCartItems`, so what the user ticks is what gets ordered.
 */
function lineKey(line: CartLine): string {
  return `${line.productId}::${line.variantId ?? ""}`;
}

/** One summary row in the bottom sheet / bar breakdown. */
function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium tabular-nums text-slate-900">{value}</span>
    </div>
  );
}

export default function ShopCart() {
  const { lines, count, setQty, remove, syncing } = useCart();
  const { isAuthenticated, isLoading } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const [busyId, setBusyId] = useState<string | null>(null);

  // ── Selection state ──────────────────────────────────────────────
  // The Set is the ONLY stored state. Shop and "select all" checkboxes are
  // derived from it every render, so they can never disagree with the items
  // behind them (ticking/unticking one item updates both automatically).
  // Pure view state: nothing here writes to the cart, the database, an order
  // or a payment.
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(() => new Set());
  const [summaryOpen, setSummaryOpen] = useState(false);

  const fallbackShopName = t("productDetail.defaultShop");

  // Grouped by shop_id — the same key `POST /api/customer/checkout` groups its
  // orders by, so what is shown here is how the order will actually be split.
  const grouped = useMemo(
    () => groupLinesByShop(lines, fallbackShopName),
    [lines, fallbackShopName],
  );

  const allState = useMemo(() => selectionState(lines, selectedKeys), [lines, selectedKeys]);

  const shopStates = useMemo(() => {
    const map = new Map<string, SelectionState>();
    for (const group of grouped) map.set(group.key, selectionState(group.lines, selectedKeys));
    return map;
  }, [grouped, selectedKeys]);

  const selectedLines = useMemo(
    () => lines.filter((l) => selectedKeys.has(l.id)),
    [lines, selectedKeys],
  );

  // Every figure below is derived from the CURRENT selection — nothing is
  // shown as a total unless it was calculated from what the user ticked.
  const summary = useMemo(
    () => computeCartSummary(lines, selectedKeys),
    [lines, selectedKeys],
  );

  const shopSummaries = useMemo(
    () => computeShopSummaries(lines, selectedKeys, fallbackShopName),
    [lines, selectedKeys, fallbackShopName],
  );

  const handleSelectItem = useCallback((id: string) => {
    setSelectedKeys((prev) => toggleLineSelection(prev, id));
  }, []);

  const handleSelectShop = useCallback((shopLines: readonly CartLine[]) => {
    setSelectedKeys((prev) => toggleShopSelection(prev, shopLines));
  }, []);

  const handleSelectAll = useCallback(() => {
    setSelectedKeys((prev) => toggleAllSelection(prev, lines));
  }, [lines]);

  // ── Redirect unauthenticated ─────────────────────────────────────
  if (!isLoading && !isAuthenticated) {
    navigate("/auth?returnTo=/cart", { replace: true });
    return null;
  }

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
      // Pass selected cart item IDs via navigation state — unchanged flow.
      const ids = selectedLines.map((l) => l.id);
      navigate("/checkout", { state: { selectedCartItems: ids } });
    } else {
      navigate("/checkout");
    }
  };

  return (
    <div className="flex min-h-screen max-w-full flex-col bg-[#F8FAFC] pb-44 text-slate-900 md:pb-32">
      <ShopHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 sm:px-6 sm:pt-10">
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
          <div className="mx-auto mt-8 w-full max-w-3xl space-y-5">
            {/* Select All bar */}
            <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white px-5 py-3">
              <Checkbox
                checked={checkboxChecked(allState)}
                onCheckedChange={handleSelectAll}
                aria-label={t("cartPage.selectAll")}
              />
              <span className="text-sm font-medium text-slate-700">
                {allState === "all" ? t("cartPage.deselectAll") : t("cartPage.selectAll")}
              </span>
              <span className="ml-auto text-xs text-slate-400">
                {t("cartPage.itemsCount", { count })}
              </span>
            </div>

            {/* Lines grouped by shop_id */}
            {grouped.map((group) => {
              const shopState = shopStates.get(group.key) ?? "none";
              const shopItemCount = group.lines.reduce((s, l) => s + l.qty, 0);
              return (
                <div
                  key={group.key}
                  className="overflow-hidden rounded-2xl border border-slate-200 bg-white"
                >
                  {/* Shop header = shop-wide checkbox */}
                  <div className="flex min-w-0 items-center gap-3 border-b border-slate-100 px-5 py-3">
                    <Checkbox
                      checked={checkboxChecked(shopState)}
                      onCheckedChange={() => handleSelectShop(group.lines)}
                      aria-label={`${t("cartPage.selectAll")} · ${group.shopName}`}
                    />
                    <Store className="size-4 shrink-0 text-[#10B981]" />
                    <p className="min-w-0 truncate text-sm font-semibold text-slate-900">
                      {group.shopName}
                    </p>
                    <span className="ml-auto shrink-0 text-xs text-slate-400">
                      {t("cartPage.itemsCount", { count: shopItemCount })}
                    </span>
                  </div>

                  <div className="divide-y divide-slate-100">
                    {group.lines.map((line) => {
                      const key = lineKey(line);
                      const isSelected = selectedKeys.has(line.id);
                      const isBusy = busyId === key;
                      return (
                        <div
                          key={line.id}
                          className={`flex min-w-0 items-start gap-3 overflow-hidden px-4 py-4 transition-colors sm:items-center sm:gap-4 sm:px-5 ${
                            isSelected ? "bg-[#F0FDF9]" : ""
                          }`}
                        >
                          {/* Checkbox */}
                          <div className="mt-1 shrink-0 sm:mt-0">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => handleSelectItem(line.id)}
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
                            {line.variantOptionLabels && (
                              <p className="mt-0.5 text-xs font-medium text-[#10B981]">
                                {line.variantOptionLabels}
                              </p>
                            )}
                            <p className="mt-0.5 text-xs text-slate-400">
                              {formatBaht(line.price)} {t("cart.perUnit", { unit: line.unit })}
                              {line.qty >= line.stock && (
                                <span className="ml-2 font-medium text-amber-600">
                                  {t("cartPage.maxStock")}
                                </span>
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
              );
            })}
          </div>
        )}
      </main>

      {/* ── Sticky summary bar — the single summary surface ────────────
          The old in-content summary box is gone. Tapping the left zone ONLY
          opens the detail sheet; order creation stays on the checkout button,
          which keeps the existing `/checkout` flow. */}
      {!syncing && lines.length > 0 && (
        <div className="fixed inset-x-0 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-30 max-w-full px-3 md:bottom-[calc(1rem+env(safe-area-inset-bottom))]">
          <div className="mx-auto flex w-full max-w-md items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/95 p-2.5 shadow-[0_10px_34px_rgba(15,23,42,0.16)] backdrop-blur sm:p-3">
            <button
              type="button"
              onClick={() => setSummaryOpen(true)}
              aria-haspopup="dialog"
              aria-label={t("cartPage.orderSummary")}
              className="min-w-0 flex-1 rounded-xl px-2 py-0.5 text-left transition-colors hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-[#10B981] focus-visible:outline-none"
            >
              <p className="truncate text-[11px] text-slate-500">
                {t("cartPage.selectedItems", { count: summary.itemCount })}
              </p>
              <p className="truncate text-lg font-bold tabular-nums tracking-tight text-slate-900">
                {formatBaht(summary.total)}
              </p>
              <p className="truncate text-[10px] text-slate-400">
                {t("cart.subtotal")} {formatBaht(summary.subtotal)} · {t("cart.discount")}{" "}
                {formatBaht(summary.discount)} · {t("cart.shipping")} {formatBaht(summary.shipping)}
              </p>
              <span className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-[#10B981]">
                {t("cartPage.orderSummary")}
                <ChevronUp className="size-3" />
              </span>
            </button>

            <Button
              className="h-12 flex-1 gap-1.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800"
              style={{ minWidth: 0, flexShrink: 1 }}
              disabled={isLoading || selectedLines.length === 0}
              onClick={() => handleCheckout(true)}
            >
              <ShoppingCart className="size-4 shrink-0" />
              <span className="min-w-0 truncate">
                {selectedLines.length > 0
                  ? t("cartPage.checkoutSelected", { count: summary.itemCount })
                  : t("cart.checkout")}
              </span>
            </Button>
          </div>
        </div>
      )}

      {/* ── Order summary bottom sheet ────────────────────────────────
          Read-only breakdown of what is currently ticked, grouped by shop. */}
      <Sheet open={summaryOpen} onOpenChange={setSummaryOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[85vh] rounded-t-2xl border-slate-200 p-0 pb-[env(safe-area-inset-bottom)]"
        >
          <SheetHeader className="border-b border-slate-100 px-5 py-4 text-left">
            <SheetTitle className="text-base font-bold tracking-tight text-slate-900">
              {t("cartPage.orderSummary")}
            </SheetTitle>
            <SheetDescription className="text-xs">
              {t("cartPage.selectedItems", { count: summary.itemCount })}
            </SheetDescription>
          </SheetHeader>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-2">
            {shopSummaries.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-400">{t("cartPage.selectAll")}</p>
            ) : (
              <div className="space-y-4">
                {shopSummaries.map((shop) => (
                  <section key={shop.key} className="overflow-hidden rounded-xl border border-slate-200">
                    <div className="flex min-w-0 items-center gap-2 border-b border-slate-100 bg-slate-50 px-4 py-2.5">
                      <Store className="size-3.5 shrink-0 text-[#10B981]" />
                      <p className="min-w-0 truncate text-xs font-semibold text-slate-700">
                        {shop.shopName}
                      </p>
                      <span className="ml-auto shrink-0 text-xs font-bold tabular-nums text-slate-900">
                        {formatBaht(shop.summary.subtotal)}
                      </span>
                    </div>
                    <ul className="divide-y divide-slate-100">
                      {shop.lines.map((line) => (
                        <li key={line.id} className="flex items-start justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-medium text-slate-900">{line.name}</p>
                            {line.variantOptionLabels && (
                              <p className="mt-0.5 truncate text-xs text-[#10B981]">
                                {line.variantOptionLabels}
                              </p>
                            )}
                            <p className="mt-0.5 text-xs tabular-nums text-slate-400">
                              {formatBaht(line.price)} × {line.qty}
                            </p>
                          </div>
                          <p className="shrink-0 text-sm font-semibold tabular-nums text-slate-900">
                            {formatBaht(line.qty * line.price)}
                          </p>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-slate-100 px-5 py-4 text-sm">
            <SummaryRow label={t("cart.subtotal")} value={formatBaht(summary.subtotal)} />
            <SummaryRow label={t("cart.discount")} value={formatBaht(summary.discount)} />
            <SummaryRow
              label={t("cart.shipping")}
              value={summary.shipping > 0 ? formatBaht(summary.shipping) : t("checkout.shippingFree")}
            />
            <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
              <span className="text-sm font-medium text-slate-500">{t("cart.total")}</span>
              <span className="text-xl font-bold tabular-nums tracking-tight text-slate-900">
                {formatBaht(summary.total)}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-2 border-t border-slate-100 px-5 py-4">
            <Button
              className="w-full gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
              disabled={isLoading || selectedLines.length === 0}
              onClick={() => handleCheckout(true)}
            >
              <ShieldCheck className="size-4" />
              {selectedLines.length > 0
                ? t("cartPage.checkoutSelected", { count: summary.itemCount })
                : t("cart.checkout")}
            </Button>
            {allState !== "all" && (
              <Button
                variant="outline"
                className="w-full border-slate-200 text-slate-700"
                disabled={isLoading || lines.length === 0}
                onClick={() => handleCheckout(false)}
              >
                {t("cartPage.checkoutAll")}
              </Button>
            )}
            <p className="flex items-center justify-center gap-1 text-center text-[11px] text-slate-400">
              <ShieldCheck className="size-3.5 text-[#10B981]" />
              {t("cartPage.checkoutNote")}
            </p>
          </div>
        </SheetContent>
      </Sheet>

      <ShopFooter />
    </div>
  );
}
