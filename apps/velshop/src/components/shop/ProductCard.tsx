import { useLanguage } from "@/lib/i18n";
import { formatBaht, type StoreProduct } from "@velnox/shared/lib/commerce";
import { Heart, ImageOff, Loader2, Star } from "lucide-react";
import { Link } from "react-router";

interface ProductCardProps {
  product: StoreProduct;
  /** @deprecated — navigation is now via Link. Kept for backward compat. */
  onOpen?: (product: StoreProduct) => void;
  /** @deprecated — ATC moved to Product Detail only. Kept for backward compat. */
  onAdd?: (product: StoreProduct) => void;
  badgeLabel?: string;
  wishlisted?: boolean;
  onWishlist?: (product: StoreProduct) => void;
  wishToggling?: boolean;
  compact?: boolean;
  showShop?: boolean;
}

function fmtSold(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, "")}K`;
  return String(n);
}

/**
 * VelShop product card — image → name → price → rating+sold.
 * Tap card navigates to Product Detail (no selection sheet, no ATC on card).
 */
export function ProductCard({ product, onOpen: _onOpen, onAdd: _onAdd, badgeLabel, wishlisted, onWishlist, wishToggling, compact = false }: ProductCardProps) {
  const { t } = useLanguage();
  const available = product.inventory?.available ?? product.inventory?.quantity ?? 0;
  const outOfStock = available <= 0;
  const hasReviews = (product.reviewCount ?? 0) > 0 && product.rating != null;
  const sold = product.soldCount ?? 0;

  // Use featured variant pricing if available
  const fv = (product as any).featuredVariant;
  const displayPrice = fv?.price ?? product.price;
  const displayCompareAtPrice = fv?.compareAtPrice ?? null;
  const displayDiscountPercent = fv?.discountPercent ?? null;
  const detailUrl = `/products/${product.id}`;

  return (
    <div className={`flex flex-col overflow-hidden border border-slate-200 bg-white transition-colors hover:border-slate-300 ${compact ? "rounded-lg" : "rounded-xl"}`}>
      {/* ── Image (navigates to Product Detail) ── */}
      <Link
        to={detailUrl}
        className={`relative block aspect-square w-full overflow-hidden bg-slate-50 ${compact ? "" : ""}`}
        aria-label={t("product.ariaViewDetail", { name: product.name })}
      >
        {(() => {
          // Use featured variant image if available, otherwise product primary
          const fvImg = fv?.images?.length > 0 ? fv.images[0] : null;
          const img = fvImg ?? product.primaryImage;
          return img ? (
            <img
              src={img.displayUrl ?? img.url}
              alt={img.alt || product.name}
              className="size-full object-cover"
              loading="lazy"
            />
          ) : (
            <span className="flex size-full items-center justify-center">
              <ImageOff className="size-8 text-slate-300" />
            </span>
          );
        })()}
        {outOfStock && (
          <span className="absolute left-1 top-1 rounded bg-slate-900/70 px-1.5 py-0.5 text-[9px] font-semibold text-white">
            {t("product.outOfStock")}
          </span>
        )}
        {badgeLabel && !outOfStock && (
          <span className="absolute left-1 top-1 rounded bg-[#10B981] px-1.5 py-0.5 text-[9px] font-semibold text-white">
            {badgeLabel}
          </span>
        )}
        {onWishlist && (
          <button
            type="button"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onWishlist(product); }}
            disabled={wishToggling}
            className={`absolute right-1 top-1 flex items-center justify-center rounded-full bg-white/80 backdrop-blur-sm transition-colors hover:bg-white ${compact ? "size-7" : "right-2 top-2 size-8"}`}
            aria-label={t("product.ariaWishlist")}
          >
            {wishToggling ? (
              <Loader2 className="animate-spin text-slate-400" style={{ width: compact ? 12 : 16, height: compact ? 12 : 16 }} />
            ) : (
              <Heart className={wishlisted ? "fill-rose-500 text-rose-500" : "text-slate-500"} style={{ width: compact ? 12 : 16, height: compact ? 12 : 16 }} />
            )}
          </button>
        )}
      </Link>

      {/* ── Info ── */}
      <div className={`flex flex-1 flex-col ${compact ? "gap-0.5 p-1.5" : "p-3 sm:p-3.5"}`}>
        {/* Product name (navigates to Product Detail) */}
        <Link
          to={detailUrl}
          className={`line-clamp-2 font-medium leading-snug text-slate-900 hover:text-[#10B981] ${compact ? "text-[12px]" : "text-sm font-semibold leading-5"}`}
        >
          {product.name}
        </Link>

        {/* Price */}
        <div className={`flex items-baseline gap-1.5 ${compact ? "mt-0.5" : "mt-1.5"}`}>
          <p className={`font-bold tabular-nums tracking-tight text-slate-900 ${compact ? "text-[13px]" : "text-base"}`}>
            {formatBaht(displayPrice)}
          </p>
          {displayCompareAtPrice && displayCompareAtPrice > displayPrice && (
            <span className={`tabular-nums text-slate-400 line-through ${compact ? "text-[10px]" : "text-xs"}`}>{formatBaht(displayCompareAtPrice)}</span>
          )}
          {displayDiscountPercent != null && displayDiscountPercent > 0 && (
            <span className={`rounded bg-red-50 px-1 py-0.5 font-semibold text-red-600 ${compact ? "text-[9px]" : "text-[10px]"}`}>-{Math.round(displayDiscountPercent)}%</span>
          )}
        </div>

        {/* Rating + Sold */}
        {(hasReviews || sold > 0) && (
          <p className={`mt-0.5 flex flex-wrap items-center gap-x-1 gap-y-0 text-slate-400 ${compact ? "text-[10px]" : "text-[11px]"}`}>
            {hasReviews && (
              <span className="inline-flex items-center gap-0.5 text-slate-700">
                <Star className="fill-amber-400 text-amber-400" style={{ width: compact ? 9 : 11, height: compact ? 9 : 11 }} />
                <span className="font-semibold tabular-nums">{Number(product.rating).toFixed(1)}</span>
                <span className="text-slate-400">({product.reviewCount})</span>
              </span>
            )}
            {hasReviews && sold > 0 && <span>·</span>}
            {sold > 0 && (
              <span className="text-slate-400">{t("product.soldShort", { count: sold })}</span>
            )}
          </p>
        )}

        {/* Stock warning (non-compact only, when no reviews/sold) */}
        {!compact && !hasReviews && sold === 0 && (
          <p className={`mt-0.5 text-[11px] ${outOfStock ? "font-medium text-red-500" : available <= 5 ? "font-medium text-amber-600" : "text-slate-400"}`}>
            {outOfStock ? t("product.outOfStock") : available <= 5 ? t("product.lowStock", { count: available, unit: product.unit }) : t("product.inStockShort")}
          </p>
        )}
      </div>
    </div>
  );
}
