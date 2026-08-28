import { useLanguage } from "@/lib/i18n";
import { Button } from "@velnox/shared/components/ui/button";
import { formatBaht, type StoreProduct } from "@velnox/shared/lib/commerce";
import { Heart, ImageOff, Loader2, Plus, Star, Store } from "lucide-react";
import { Link } from "react-router";

interface ProductCardProps {
  product: StoreProduct;
  /** Open the product (detail page or quick-view modal). */
  onOpen: (product: StoreProduct) => void;
  onAdd: (product: StoreProduct) => void;
  /** Optional small overlay label (e.g. "แนะนำ"). */
  badgeLabel?: string;
  /** Whether this product is currently wishlisted. */
  wishlisted?: boolean;
  /** Toggle favorite — called on heart click. Pass undefined to hide the heart. */
  onWishlist?: (product: StoreProduct) => void;
  /** Loading state for the wishlist toggle. */
  wishToggling?: boolean;
  /** Compact mode — smaller card for dense grids (e.g. shop detail). */
  compact?: boolean;
  /** Whether to show the shop name row. Defaults to true. */
  showShop?: boolean;
}

/**
 * VelShop product card — the single card used on Home and the catalog.
 * Hierarchy: image → name → rating → price → stock → shop → add-to-cart.
 * Shop name is a clickable link to the shop detail page.
 */
export function ProductCard({ product, onOpen, onAdd, badgeLabel, wishlisted, onWishlist, wishToggling, compact = false, showShop = true }: ProductCardProps) {
  const { t } = useLanguage();
  const available = product.inventory?.available ?? product.inventory?.quantity ?? 0;
  const outOfStock = available <= 0;
  const lowStock = !outOfStock && available <= 5;
  const hasReviews = (product.reviewCount ?? 0) > 0 && product.rating != null;

  return (
    <div className={`flex flex-col overflow-hidden border border-slate-200 bg-white transition-colors hover:border-slate-300 ${compact ? "rounded-lg" : "rounded-xl"}`}>
      <Link
        to={`/products/${product.id}`}
        className="relative block aspect-square w-full overflow-hidden bg-slate-50"
        aria-label={t("product.ariaViewDetail", { name: product.name })}
      >
        {product.primaryImage ? (
          <img
            src={product.primaryImage.displayUrl}
            alt={product.primaryImage.alt || product.name}
            className="size-full object-cover"
            loading="lazy"
          />
        ) : (
          <span className="flex size-full items-center justify-center">
            <ImageOff className="size-8 text-slate-300" />
          </span>
        )}
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
            onClick={(e) => { e.stopPropagation(); onWishlist(product); }}
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

      <div className={`flex flex-1 flex-col ${compact ? "gap-0.5 p-1.5" : "p-3 sm:p-3.5"}`}>
        <Link
          to={`/products/${product.id}`}
          className={`line-clamp-2 font-medium leading-snug text-slate-900 hover:text-[#10B981] ${compact ? "text-[12px]" : "text-sm font-semibold leading-5"}`}
          onClick={(e) => e.stopPropagation()}
        >
          {product.name}
        </Link>

        {/* Rating — show in compact mode as inline, in normal mode as separate line */}
        {hasReviews && (
          <p className="flex items-center gap-1 text-slate-400">
            <Star className="fill-amber-400 text-amber-400" style={{ width: compact ? 10 : 12, height: compact ? 10 : 12 }} />
            <span className={`font-semibold tabular-nums text-slate-700 ${compact ? "text-[10px]" : "text-xs"}`}>
              {Number(product.rating).toFixed(1)}
            </span>
          </p>
        )}

        <p className={`font-bold tabular-nums tracking-tight text-slate-900 ${compact ? "text-[13px]" : "mt-2 text-base"}`}>
          {formatBaht(product.price)}
        </p>

        {!compact && (
          <p
            className={`mt-0.5 text-[11px] ${
              outOfStock
                ? "font-medium text-red-500"
                : lowStock
                  ? "font-medium text-amber-600"
                  : "text-slate-400"
            }`}
          >
            {outOfStock
              ? t("product.outOfStock")
              : lowStock
                ? t("product.lowStock", { count: available, unit: product.unit })
                : product.soldCount != null && product.soldCount > 0
                  ? t("product.soldShort", { count: product.soldCount })
                  : t("product.inStockShort")}
          </p>
        )}

        {/* Sold count — compact mode shows this instead of stock text */}
        {compact && (product.soldCount ?? 0) > 0 && (
          <p className="text-[10px] text-slate-400">{t("product.soldShort", { count: product.soldCount ?? 0 })}</p>
        )}

        {/* Shop name — clickable link to shop detail (hidden when showShop=false) */}
        {showShop && product.shopName && (
          <Link
            to={product.shopSlug ? `/shops/${product.shopSlug}` : product.shopId ? `/shops/${product.shopId}` : "#"}
            className="mt-1 flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#10B981] transition-colors"
            onClick={(e) => e.stopPropagation()}
            aria-label={t("product.shopVisit", { name: product.shopName })}
          >
            <Store className="size-3 shrink-0" />
            <span className="truncate">{product.shopName}</span>
          </Link>
        )}

        {/* Add to Cart — hidden in compact mode */}
        {!compact && (
          <>
            <div className="flex-1" />
            <Button
              className="mt-3 h-9 w-full gap-1.5 bg-slate-900 text-white hover:bg-slate-800 disabled:bg-slate-100 disabled:text-slate-400"
              disabled={outOfStock || product.price <= 0}
              onClick={() => onAdd(product)}
            >
              <Plus className="size-4" />
              <span className="sm:hidden">{t("product.addToCartSm")}</span>
              <span className="hidden sm:inline">{t("product.addToCart")}</span>
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
