import { Button } from "@velnox/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@velnox/shared/components/ui/sheet";
import { useCart } from "@/lib/cart";
import { useLanguage } from "@/lib/i18n";
import { formatBaht, type StoreProduct } from "@velnox/shared/lib/commerce";
import { useTracking } from "@velnox/shared/lib/track";
import { useIsMobile } from "@velnox/shared/hooks/use-mobile";
import {
  ChevronDown,
  ChevronUp,
  ImageOff,
  Minus,
  Plus,
  ShoppingCart,
  Store,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

interface ProductSelectionSheetProps {
  product: StoreProduct | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional ref to the cart icon element for fly animation. */
  cartIconRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Marketplace-style product selection bottom sheet.
 *
 * Mobile: full-width bottom sheet with drag handle, rounded top corners,
 * scrollable content, and sticky add-to-cart bar at bottom.
 *
 * Desktop: centered dialog with side-by-side layout.
 */
export function ProductSelectionSheet({
  product,
  open,
  onOpenChange,
  cartIconRef,
}: ProductSelectionSheetProps) {
  const { add } = useCart();
  const { t } = useLanguage();
  const { track } = useTracking();
  const isMobile = useIsMobile();

  // ── State ─────────────────────────────────────────────────────
  const [nameExpanded, setNameExpanded] = useState(false);
  const [qty, setQty] = useState(1);
  const [optionSelections, setOptionSelections] = useState<
    Record<string, string>
  >({});
  const sheetContentRef = useRef<HTMLDivElement>(null);

  if (!product) return null;

  // ── Variant resolution ────────────────────────────────────────
  const optionGroups = (product as any).optionGroups as Array<{
    id: string;
    name: string;
    displayType: string;
    required: boolean;
    values: Array<{
      id: string;
      value: string;
      label: string;
      imageUrl?: string;
    }>;
  }> | undefined;
  const hasOptionGroups = Array.isArray(optionGroups) && optionGroups.length > 0;

  const selectedVariant = useMemo(() => {
    if (!hasOptionGroups) return null;
    const variants = (product as any).variants as Array<
      Record<string, any>
    > | undefined;
    if (!Array.isArray(variants) || variants.length === 0) return null;
    const entries = Object.entries(optionSelections);
    if (entries.length === 0) return null;
    return (
      variants.find((v) => {
        const vOpts = (product as any).variantOptions?.[v.id] as
          | Record<string, string>
          | undefined;
        if (!vOpts) return false;
        return entries.every(([gid, val]) => vOpts[gid] === val);
      }) ?? null
    );
  }, [optionSelections, hasOptionGroups, product]);

  const allRequiredSelected = useMemo(() => {
    if (!hasOptionGroups) return true;
    return optionGroups.every(
      (g) => !g.required || optionSelections[g.id],
    );
  }, [hasOptionGroups, optionGroups, optionSelections]);

  // Use pre-calculated price from backend (price = compareAtPrice * (1 - discountPercent/100))
  // Falls back to product.price for products without variants
  const resolvedPrice = selectedVariant?.price ?? product.price ?? 0;
  const resolvedCompareAt = selectedVariant?.compareAtPrice ?? null;
  const resolvedDiscountAmt = selectedVariant?.discountPercent != null ? Number(selectedVariant.discountPercent) : null;
  const baseAvailable =
    product.inventory?.available ?? product.inventory?.quantity ?? 0;
  const resolvedStock = selectedVariant?.stock ?? baseAvailable;

  // Reset state when product changes or sheet opens
  // (after variant resolution since we need resolvedStock)
  const prevProductIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (open && product) {
      if (prevProductIdRef.current !== product.id) {
        setNameExpanded(false);
        setQty(1);
        setOptionSelections({});
        prevProductIdRef.current = product.id;
      }
    }
  }, [open, product?.id]);

  // Reset qty if selected variant stock is lower
  useEffect(() => {
    if (resolvedStock > 0 && resolvedStock < qty) {
      setQty(Math.max(1, resolvedStock));
    }
  }, [resolvedStock, qty]);
  const outOfStock = resolvedStock <= 0;
  const needsVariant = hasOptionGroups && !allRequiredSelected;

  // Build a map: optionValueText → first variant image URL
  // This lets option cards show the variant image even though option values don't store images
  const optionValueImageMap = useMemo(() => {
    const map: Record<string, string> = {};
    const variants = (product as any).variants as Array<Record<string, any>> | undefined;
    const vOpts = (product as any).variantOptions as Record<string, Record<string, string>> | undefined;
    if (!Array.isArray(variants) || !vOpts) return map;
    for (const v of variants) {
      const imgs = (v as any).images as Array<{ url: string }> | undefined;
      if (!imgs || imgs.length === 0) continue;
      const imgUrl = imgs[0].url;
      if (!imgUrl) continue;
      const vMapping = vOpts[v.id];
      if (!vMapping) continue;
      // For each option value this variant maps to, store the image if not already set
      for (const textValue of Object.values(vMapping)) {
        if (!map[textValue]) map[textValue] = imgUrl;
      }
    }
    return map;
  }, [product]);

  // Compute variant-aware image: prefer selected variant's images, then option value images, then product images
  const productImages = product.images?.length
    ? product.images
    : product.primaryImage
      ? [product.primaryImage]
      : [];

  const variantImages = useMemo(() => {
    if (!selectedVariant) return [];
    if ((selectedVariant as any).images?.length > 0) {
      return (selectedVariant as any).images.map((img: any, i: number) => ({
        id: `vi-${img.id ?? i}`,
        url: img.url,
        displayUrl: img.url,
        thumbUrl: img.url,
        alt: img.alt || '',
      }));
    }
    // Fallback: check option value images
    for (const group of optionGroups ?? []) {
      const valId = optionSelections[group.id];
      if (!valId) continue;
      const val = group.values.find((v) => v.id === valId);
      if (val?.imageUrl) {
        return [{ id: `opt-${val.id}`, url: val.imageUrl, displayUrl: val.imageUrl, thumbUrl: val.imageUrl, alt: val.label }];
      }
    }
    return [];
  }, [selectedVariant, optionGroups, optionSelections]);

  const images = variantImages.length > 0 ? variantImages : productImages;
  const activeImage = images[0];

  // ── Helpers ───────────────────────────────────────────────────
  const needsExpand = product.name.length > 60;

  const handleAddToCart = useCallback(() => {
    if (needsVariant) {
      toast.error(t("productDetail.selectOptions"));
      return;
    }
    if (outOfStock) return;

    // Resolve variant option labels for cart display
    let variantLabels: Record<string, string> | undefined;
    if (selectedVariant) {
      const variantOptsMap = (product as any).variantOptions as
        | Record<string, Record<string, string>>
        | undefined;
      if (variantOptsMap?.[selectedVariant.id]) {
        variantLabels = {};
        for (const [groupId, valueId] of Object.entries(
          variantOptsMap[selectedVariant.id],
        )) {
          const group = optionGroups?.find((g) => g.id === groupId);
          const val = group?.values.find((v) => v.id === valueId);
          if (group && val) variantLabels[group.name] = val.label;
        }
      }
    }

    track("CART_ADD", {
      entityId: product.id,
      value: product.name,
      context: { qty, variant: selectedVariant?.id },
    });

    add(
      {
        id: product.id,
        name: product.name,
        unit: product.unit,
        price: resolvedPrice,
        stock: resolvedStock,
        variantId: selectedVariant?.id,
        variantOptionLabels: variantLabels,
        imageUrl: activeImage?.displayUrl,
      },
      qty,
    );

    // Capture source position BEFORE closing sheet (DOM may unmount)
    const addToCartBtn = (document.querySelector('[data-add-to-cart]') as HTMLElement)?.getBoundingClientRect();
    const sourceRect = addToCartBtn ?? { left: window.innerWidth / 2 - 12, top: window.innerHeight - 120, width: 24, height: 24, right: 0, bottom: 0, x: 0, y: 0 };
    const targetRect = cartIconRef?.current?.getBoundingClientRect();

    // Close sheet
    onOpenChange(false);

    // Fly animation
    if (targetRect) {
      const fly = document.createElement("div");
      fly.style.cssText = `
        position: fixed;
        z-index: 99999;
        width: 24px;
        height: 24px;
        border-radius: 50%;
        background: #10B981;
        pointer-events: none;
      `;
      fly.style.left = `${sourceRect.left + sourceRect.width / 2 - 12}px`;
      fly.style.top = `${sourceRect.top + sourceRect.height / 2 - 12}px`;
      document.body.appendChild(fly);

      // Animate to cart icon
      requestAnimationFrame(() => {
        fly.style.transition = "all 0.6s cubic-bezier(0.2, 1, 0.3, 1)";
        fly.style.left = `${targetRect.left + targetRect.width / 2 - 12}px`;
        fly.style.top = `${targetRect.top + targetRect.height / 2 - 12}px`;
        fly.style.opacity = "0";
        fly.style.transform = "scale(0.3)";
      });

      setTimeout(() => {
        fly.remove();
        // Pulse the cart icon
        const cartEl = cartIconRef?.current;
        if (cartEl) {
          cartEl.classList.add("scale-125");
          setTimeout(() => cartEl.classList.remove("scale-125"), 200);
        }
      }, 650);
    }

    toast.success(t("productDetail.addedToast", { name: product.name, qty }));
  }, [
    product,
    qty,
    selectedVariant,
    resolvedPrice,
    resolvedStock,
    outOfStock,
    needsVariant,
    activeImage,
    optionGroups,
    add,
    onOpenChange,
    cartIconRef,
    track,
    t,
  ]);

  const handleOptionSelect = (groupId: string, valueId: string) => {
    setOptionSelections((prev) => ({
      ...prev,
      [groupId]: prev[groupId] === valueId ? "" : valueId,
    }));
  };

  // ── Content (shared between Sheet and Dialog) ────────────────
  const sheetContent = (
    <div ref={sheetContentRef} className="flex flex-col">
      {/* Drag handle (mobile only) */}
      {isMobile && (
        <div className="flex justify-center pt-3 pb-1">
          <div className="h-1 w-10 rounded-full bg-slate-300" />
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
        {/* Product header: image + info */}
        <div className="flex gap-3 pt-2">
          {/* Thumbnail */}
          <div className="size-20 shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 sm:size-24">
            {activeImage ? (
              <img
                src={activeImage.displayUrl || activeImage.url}
                alt={activeImage.alt || product.name}
                className="size-full object-cover"
              />
            ) : (
              <span className="flex size-full items-center justify-center">
                <ImageOff className="size-6 text-slate-300" />
              </span>
            )}
          </div>

          {/* Price + info */}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2">
              <p className="text-xl font-bold tabular-nums text-slate-900">
                {formatBaht(resolvedPrice)}
              </p>
              <span className="text-xs font-normal text-slate-400">
                /{product.unit}
              </span>
            </div>
            {(() => {
              const compareAt = selectedVariant?.compareAtPrice ?? null;
              const discountPct = selectedVariant?.discountPercent ?? null;
              if ((compareAt && compareAt > resolvedPrice) || (discountPct && discountPct > 0)) {
                return (
                  <div className="mt-1 flex items-center gap-2">
                    {compareAt && compareAt > resolvedPrice && (
                      <span className="text-xs text-slate-400 line-through">{formatBaht(compareAt)}</span>
                    )}
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-[10px] font-semibold text-red-600">
                      -{Math.round(discountPct ?? ((compareAt! - resolvedPrice) / compareAt!) * 100)}%
                    </span>
                  </div>
                );
              }
              return null;
            })()}
            <p
              className={`mt-1 text-xs ${
                outOfStock
                  ? "font-medium text-red-500"
                  : resolvedStock <= 5
                    ? "font-medium text-amber-600"
                    : "text-slate-400"
              }`}
            >
              {outOfStock
                ? t("product.outOfStock")
                : resolvedStock <= 5
                  ? t("product.lowStock", {
                      count: resolvedStock,
                      unit: product.unit,
                    })
                  : t("product.inStockShort")}
            </p>

          </div>
        </div>

        {/* Expandable product name */}
        <button
          type="button"
          className="mt-3 flex w-full items-start gap-2 text-left"
          onClick={() => setNameExpanded((v) => !v)}
          aria-expanded={nameExpanded}
        >
          <p
            className={`min-w-0 flex-1 text-sm font-semibold leading-5 text-slate-900 ${
              !nameExpanded && needsExpand ? "line-clamp-2" : ""
            }`}
            style={{ overflowWrap: "anywhere" }}
          >
            {product.name}
          </p>
          {needsExpand && (
            <span className="mt-0.5 shrink-0 text-slate-400">
              {nameExpanded ? (
                <ChevronUp className="size-4" />
              ) : (
                <ChevronDown className="size-4" />
              )}
            </span>
          )}
        </button>

        {/* Short description */}
        {product.description && (
          <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-slate-500">
            {product.description}
          </p>
        )}

        {/* Variant option groups */}
        {hasOptionGroups && (
          <div className="mt-4 space-y-3 border-t border-slate-100 pt-4">
            {optionGroups.map((group) => (
              <div key={group.id}>
                <p className="text-xs font-semibold text-slate-700">
                  {group.name}
                  {group.required && (
                    <span className="ml-1 text-red-400">*</span>
                  )}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {group.values.map((val) => {
                    const selected = optionSelections[group.id] === val.id;
                    // Check if this value has any in-stock variant
                    const variants = (product as any).variants as
                      | Array<Record<string, any>>
                      | undefined;
                    const variantOpts = (product as any)
                      .variantOptions as
                      | Record<string, Record<string, string>>
                      | undefined;
                    let valueInStock = false;
                    if (variants && variantOpts) {
                      valueInStock = variants.some((v) => {
                        const vOpts = variantOpts[v.id];
                        if (!vOpts || vOpts[group.id] !== val.id) return false;
                        // Check if all other selections match
                        return Object.entries(optionSelections).every(
                          ([gId, vId]) => {
                            if (gId === group.id) return true;
                            return vOpts[gId] === vId;
                          },
                        ) && (v.stock ?? 0) > 0;
                      });
                    } else {
                      valueInStock = true; // No variant data, assume in stock
                    }

                    return (
                      <button
                        key={val.id}
                        type="button"
                        disabled={!valueInStock}
                        onClick={() => handleOptionSelect(group.id, val.id)}
                        className={`flex flex-col items-center justify-center gap-1.5 w-[80px] min-h-[88px] p-2 rounded-xl border transition-colors ${
                          selected
                            ? "border-[#10B981] bg-[#ECFDF5] ring-1 ring-[#10B981]/30"
                            : valueInStock
                              ? "border-slate-200 bg-white hover:border-slate-300 active:bg-slate-50"
                              : "border-slate-100 bg-slate-50 opacity-40"
                        }`}
                        aria-label={`${group.name}: ${val.label}${
                          !valueInStock
                            ? ` (${t("product.outOfStock")})`
                            : ""
                        }`}
                      >
                        {val.imageUrl || optionValueImageMap[val.value] ? (
                          <img src={val.imageUrl || optionValueImageMap[val.value]} alt="" className="size-14 rounded-lg object-contain bg-slate-50" loading="lazy" />
                        ) : (
                          <span className="size-14 flex items-center justify-center rounded-lg bg-slate-100 text-[10px] font-semibold text-slate-500">
                            {val.label.slice(0, 3)}
                          </span>
                        )}
                        <span className={`max-w-full truncate text-[11px] font-medium ${selected ? "text-[#10B981]" : valueInStock ? "text-slate-700" : "text-slate-400"}`}>
                          {val.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Shop info (below quantity) */}
        {product.shopName && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-700">
                {t("product.shopVisit", { name: "" }).trim().replace(/\s+/, " ").split(" ")[0] || t("shopDetail.title")}
              </p>
              <span className="flex items-center gap-1.5 text-xs text-slate-500">
                <Store className="size-3.5 shrink-0" />
                <span className="truncate max-w-[160px]">{product.shopName}</span>
              </span>
            </div>
          </div>
        )}

        {/* Quantity selector */}
        {!outOfStock && (
          <div className="mt-4 border-t border-slate-100 pt-4">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-700">
                {t("cartDrawer.quantity")}
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQty((q) => Math.max(1, q - 1))}
                  disabled={qty <= 1}
                  className="flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
                  aria-label={t("cartDrawer.ariaDecrease")}
                >
                  <Minus className="size-3.5" />
                </button>
                <span className="w-8 text-center text-sm font-semibold tabular-nums text-slate-900">
                  {qty}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setQty((q) => Math.min(resolvedStock, q + 1))
                  }
                  disabled={qty >= resolvedStock}
                  className="flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
                  aria-label={t("cartDrawer.ariaIncrease")}
                >
                  <Plus className="size-3.5" />
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Sticky add-to-cart bar */}
      <div className="border-t border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
        {needsVariant ? (
          <Button
            className="w-full gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
            disabled
          >
            <ShoppingCart className="size-4" />
            {t("productDetail.selectOptions")}
          </Button>
        ) : outOfStock ? (
          <Button
            className="w-full gap-1.5 bg-slate-100 text-slate-400"
            disabled
          >
            {t("product.outOfStock")}
          </Button>
        ) : (
          <Button
            data-add-to-cart
            className="w-full gap-1.5 bg-[#10B981] text-white hover:bg-emerald-600"
            onClick={handleAddToCart}
          >
            <ShoppingCart className="size-4" />
            {t("productDetail.addToCartWithTotal", {
              total: formatBaht(resolvedPrice * qty),
            })}
          </Button>
        )}
      </div>
    </div>
  );

  // ── Desktop: Dialog ───────────────────────────────────────────
  if (!isMobile) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-lg p-0">
          <DialogTitle className="sr-only">{product.name}</DialogTitle>
          <DialogDescription className="sr-only">
            {t("productDetail.seoDesc", {
              name: product.name,
              price: formatBaht(product.price),
              unit: product.unit,
              shop: product.shopName ?? t("productDetail.defaultShop"),
            })}
          </DialogDescription>
          {sheetContent}
        </DialogContent>
      </Dialog>
    );
  }

  // ── Mobile: Bottom Sheet ──────────────────────────────────────
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="max-h-[85dvh] rounded-t-2xl border-t border-slate-200 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetTitle className="sr-only">{product.name}</SheetTitle>
        <SheetDescription className="sr-only">
          {t("productDetail.seoDesc", {
            name: product.name,
            price: formatBaht(product.price),
            unit: product.unit,
            shop: product.shopName ?? t("productDetail.defaultShop"),
          })}
        </SheetDescription>
        {sheetContent}
      </SheetContent>
    </Sheet>
  );
}
