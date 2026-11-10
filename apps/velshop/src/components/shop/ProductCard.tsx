import { useLanguage } from "@/lib/i18n";
import { formatBaht, type StoreProduct } from "@velnox/shared/lib/commerce";

import { Heart, ImageOff, Loader2, Star, Share2, Bookmark, MessageCircle } from "lucide-react";
import { Link } from "react-router";

interface ProductCardProps {
  product: StoreProduct;
  /** @deprecated — navigation is now via Link. Kept for backward compat. */
  onOpen?: (product: StoreProduct) => void;
  /** @deprecated — ATC moved to Product Detail only. Kept for backward compat. */
  onAdd?: (product: StoreProduct) => void;
  /** @deprecated — top-left badge removed per design decision (2026-11-05). No-op. */
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

  // Social counts (from product data)
  const likeCount = (product as any).likeCount ?? 0;
  const saveCount = (product as any).saveCount ?? 0;
  const shareCount = (product as any).shareCount ?? 0;

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
        {/* V Badge removed per design decision — product cards no longer show the seller verification badge */}
        {/* The discount lives ON the image, not in the price row: three numbers
            side by side (price, struck-through price, -30%) made the price the
            noisiest part of the card. Here it reads at a glance and the price row
            keeps just two items. */}
        {displayDiscountPercent != null && displayDiscountPercent > 0 && (
          <span
            className={`absolute left-1.5 top-1.5 rounded-md bg-red-600/95 px-1.5 py-0.5 font-semibold tabular-nums text-white backdrop-blur-sm ${compact ? "text-2xs" : "text-2xs"}`}
          >
            -{Math.round(displayDiscountPercent)}%
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
          className={`line-clamp-2 min-w-0 flex-1 font-medium leading-snug text-slate-900 hover:text-brand ${compact ? "text-[12px]" : "text-sm font-semibold leading-5"}`}
        >
          {product.name}
        </Link>

        {/* Price — two numbers, never three (the badge moved to the image). */}
        <div className={`flex items-baseline gap-1.5 ${compact ? "mt-0.5" : "mt-1"}`}>
          <p className={`font-bold tabular-nums tracking-tight text-slate-900 ${compact ? "text-[13px]" : "text-[15px] sm:text-base"}`}>
            {formatBaht(displayPrice)}
          </p>
          {displayCompareAtPrice && displayCompareAtPrice > displayPrice && (
            <span className={`tabular-nums text-slate-400 line-through ${compact ? "text-2xs" : "text-2xs sm:text-xs"}`}>{formatBaht(displayCompareAtPrice)}</span>
          )}
        </div>

        {/* Rating + Sold */}
        {(hasReviews || sold > 0) && (
          <p className={`flex flex-wrap items-center gap-x-1 text-2xs leading-4 text-slate-400 ${compact ? "mt-0.5" : "mt-1"}`}>
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

        {/* Engagement stats — read-only, and only when there is a number to read.
            These used to be three <button>s with no handler showing 0 · 0 · 0 on
            every card: dead controls that looked interactive. Nothing likes, saves
            or shares server-side yet, so nothing here pretends to be clickable. */}
        {!compact && (likeCount > 0 || saveCount > 0 || shareCount > 0) && (
          <div className="mt-2 flex items-center gap-1.5 border-t border-slate-100 pt-2 text-2xs text-slate-400">
            {likeCount > 0 && (
              <span className="flex items-center gap-1 px-1 py-1" title={t("product.like")}>
                <Heart className="size-3.5" />
                <span className="font-medium tabular-nums">{likeCount > 999 ? "999+" : likeCount}</span>
              </span>
            )}
            {saveCount > 0 && (
              <span className="flex items-center gap-1 px-1 py-1" title={t("product.save")}>
                <Bookmark className="size-3.5" />
                <span className="font-medium tabular-nums">{saveCount > 999 ? "999+" : saveCount}</span>
              </span>
            )}
            {shareCount > 0 && (
              <span className="flex items-center gap-1 px-1 py-1" title={t("product.share")}>
                <Share2 className="size-3.5" />
                <span className="font-medium tabular-nums">{shareCount > 999 ? "999+" : shareCount}</span>
              </span>
            )}
          </div>
        )}

        {/* Stock warning (non-compact only, when no reviews/sold) */}
        {!compact && !hasReviews && sold === 0 && (
          <p className={`mt-0.5 text-2xs ${outOfStock ? "font-medium text-red-500" : available <= 5 ? "font-medium text-amber-600" : "text-slate-400"}`}>
            {outOfStock ? t("product.outOfStock") : available <= 5 ? t("product.lowStock", { count: available, unit: product.unit }) : t("product.inStockShort")}
          </p>
        )}
      </div>
    </div>
  );
}
