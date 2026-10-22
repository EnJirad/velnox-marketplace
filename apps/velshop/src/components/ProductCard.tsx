/**
 * VelShop product card — the original one, on MVP catalogue rows.
 *
 * image → name → price → rating/reviews. Tapping the card opens the product
 * page (never an inline add-to-cart: options are chosen on the detail page, the
 * way the original flow worked). The heart is the only card-level action.
 */
import { VBadge } from "@velnox/shared/components/VBadge";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { formatMoney } from "@velnox/shared/mvp/ui";
import type { MvpProductSummary } from "@velnox/shared/mvp";
import { Heart, ImageOff, Loader2, Star } from "lucide-react";
import { Link } from "react-router";

export function ProductCard({
  product,
  favorited = false,
  onToggleFavorite,
  favoriteBusy = false,
}: {
  product: MvpProductSummary;
  favorited?: boolean;
  onToggleFavorite?: (product: MvpProductSummary) => void;
  favoriteBusy?: boolean;
}) {
  const { t } = useLanguage();
  const outOfStock = product.available <= 0;
  const reviewCount = product.reviewCount ?? 0;
  const rating = product.rating ?? null;

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-colors hover:border-slate-300">
      <Link
        to={`/products/${encodeURIComponent(product.slug)}`}
        className="relative block aspect-square w-full overflow-hidden bg-slate-50"
        aria-label={t("product.ariaViewDetail", { name: product.name })}
      >
        {product.imageUrl ? (
          <img
            src={product.imageUrl}
            alt={product.name}
            className="size-full object-cover transition-transform duration-300 hover:scale-105"
            loading="lazy"
          />
        ) : (
          <span className="flex size-full items-center justify-center">
            <ImageOff className="size-8 text-slate-300" />
          </span>
        )}

        {/* Every published product belongs to an approved (verified) seller. */}
        <VBadge verified />

        {outOfStock && (
          <span className="absolute inset-x-0 bottom-0 bg-slate-900/70 px-2 py-1 text-center text-[10px] font-semibold text-white backdrop-blur-sm">
            {t("product.outOfStock")}
          </span>
        )}

        {onToggleFavorite && (
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onToggleFavorite(product);
            }}
            disabled={favoriteBusy}
            className="absolute right-2 top-2 flex size-8 items-center justify-center rounded-full bg-white/80 backdrop-blur-sm transition-colors hover:bg-white"
            aria-label={t("product.ariaWishlist")}
            aria-pressed={favorited}
          >
            {favoriteBusy ? (
              <Loader2 className="size-4 animate-spin text-slate-400" />
            ) : (
              <Heart className={favorited ? "size-4 fill-rose-500 text-rose-500" : "size-4 text-slate-500"} />
            )}
          </button>
        )}
      </Link>

      <div className="flex flex-1 flex-col p-3 sm:p-3.5">
        <Link
          to={`/products/${encodeURIComponent(product.slug)}`}
          className="line-clamp-2 min-w-0 flex-1 text-sm font-semibold leading-5 text-slate-900 hover:text-[#10B981]"
        >
          {product.name}
        </Link>

        <p className="mt-1.5 text-base font-bold tabular-nums tracking-tight text-slate-900">
          {formatMoney(product.price)}
        </p>

        <p className="mt-0.5 flex flex-wrap items-center gap-x-1 text-[11px] text-slate-400">
          {reviewCount > 0 && rating != null ? (
            <span className="inline-flex items-center gap-0.5 text-slate-700">
              <Star className="size-3 fill-amber-400 text-amber-400" />
              <span className="font-semibold tabular-nums">{rating.toFixed(1)}</span>
              <span className="text-slate-400">({reviewCount})</span>
            </span>
          ) : (
            <span className="truncate">{product.seller.storeName}</span>
          )}
        </p>
      </div>
    </div>
  );
}
