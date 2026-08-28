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
}

/**
 * VelShop product card — the single card used on Home and the catalog.
 * Hierarchy: image → name → rating → price → stock → shop → add-to-cart.
 * Shop name is a clickable link to the shop detail page.
 */
export function ProductCard({ product, onOpen, onAdd, badgeLabel, wishlisted, onWishlist, wishToggling }: ProductCardProps) {
  const { t } = useLanguage();
  const available = product.inventory?.available ?? product.inventory?.quantity ?? 0;
  const outOfStock = available <= 0;
  const lowStock = !outOfStock && available <= 5;
  const hasReviews = (product.reviewCount ?? 0) > 0 && product.rating != null;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-colors hover:border-slate-300">
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
          <span className="absolute left-2 top-2 rounded-full bg-slate-900/70 px-2 py-0.5 text-[10px] font-semibold text-white">
            {t("product.outOfStock")}
          </span>
        )}
        {badgeLabel && !outOfStock && (
          <span className="absolute left-2 top-2 rounded-full bg-[#10B981] px-2 py-0.5 text-[10px] font-semibold text-white">
            {badgeLabel}
          </span>
        )}
        {onWishlist && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onWishlist(product); }}
            disabled={wishToggling}
            className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm transition-colors hover:bg-white"
            aria-label={t("product.ariaWishlist")}
          >
            {wishToggling ? (
              <Loader2 className="size-4 animate-spin text-slate-400" />
            ) : (
              <Heart className={`size-4 ${wishlisted ? "fill-rose-500 text-rose-500" : "text-slate-500"}`} />
            )}
          </button>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-3 sm:p-3.5">
        <Link
          to={`/products/${product.id}`}
          className="line-clamp-2 text-sm font-semibold leading-5 text-slate-900 hover:text-[#10B981]"
          onClick={(e) => e.stopPropagation()}
        >
          {product.name}
        </Link>

        {hasReviews && (
          <p className="mt-1 flex items-center gap-1 text-xs text-slate-400">
            <Star className="size-3 fill-amber-400 text-amber-400" />
            <span className="font-semibold tabular-nums text-slate-700">
              {Number(product.rating).toFixed(1)}
            </span>
            <span>({product.reviewCount})</span>
          </p>
        )}

        <p className="mt-2 text-base font-bold tabular-nums tracking-tight text-slate-900">
          {formatBaht(product.price)}
          <span className="ml-1 text-[11px] font-normal text-slate-400">
            {t("cart.perUnit", { unit: product.unit })}
          </span>
        </p>

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

        {/* Shop name — clickable link to shop detail */}
        {product.shopName && (
          <Link
            to={product.shopSlug ? `/shops/${product.shopSlug}` : product.shopId ? `/shops/${product.shopId}` : "#"}
            className="mt-2 flex items-center gap-1.5 text-xs text-slate-400 hover:text-[#10B981] transition-colors"
            onClick={(e) => e.stopPropagation()}
            aria-label={t("product.shopVisit", { name: product.shopName })}
          >
            <Store className="size-3 shrink-0" />
            <span className="truncate">{product.shopName}</span>
          </Link>
        )}

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
      </div>
    </div>
  );
}
