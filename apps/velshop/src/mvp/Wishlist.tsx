/**
 * `/wishlist` — the original wishlist grid.
 *
 * Rows come from `GET /api/mvp/favorites` (already joined with the published
 * product and its seller); removing one is the same idempotent DELETE the heart
 * uses, so the grid and the card hearts can never disagree.
 */
import { ProductCard } from "@/components/ProductCard";
import { Button } from "@velnox/shared/components/ui/button";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { getMvpApi, type MvpFavorite } from "@velnox/shared/mvp";
import { MvpErrorState, useMvpQuery } from "@velnox/shared/mvp/ui";
import { Heart, ShoppingBag } from "lucide-react";
import { Link } from "react-router";
import { toast } from "sonner";
import { useFavorites } from "./favorites";
import { useMvpCart } from "./cart";

export default function Wishlist() {
  const { t } = useLanguage();
  const favorites = useMvpQuery(() => getMvpApi().favorites.list(), []);
  const { toggle, busyId, reload: reloadFavorites } = useFavorites();
  const { addItem } = useMvpCart();

  const gridClass = "mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4";

  const remove = async (productId: string) => {
    try {
      await toggle(productId);
      favorites.reload();
      reloadFavorites();
      toast.success(t("wishlist.removed"));
    } catch {
      toast.error(t("wishlist.failed"));
    }
  };

  /** Simple products can be added straight from here; variants need the page. */
  const add = async (row: MvpFavorite) => {
    if (row.product.available <= 0) return;
    try {
      await addItem({ productId: row.productId, quantity: 1 });
      toast.success(t("wishlist.added"));
    } catch {
      toast.error(t("wishlist.failed"));
    }
  };

  const rows = favorites.data ?? [];

  return (
    <div>
      <div>
        <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
          <Heart className="size-4 text-[#10B981]" />
          {t("wishlist.eyebrow")}
        </p>
        <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
          {t("wishlist.title")}
        </h1>
        <p className="mt-1.5 text-sm text-slate-500">{t("wishlist.desc")}</p>
      </div>

      {favorites.loading ? (
        <div className={gridClass}>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              <Skeleton className="aspect-square w-full rounded-none" />
              <div className="space-y-2 p-3">
                <Skeleton className="h-3.5 w-4/5" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : favorites.error ? (
        <div className="mt-6">
          <MvpErrorState error={favorites.error} onRetry={favorites.reload} />
        </div>
      ) : rows.length === 0 ? (
        <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
            <Heart className="size-7 text-slate-400" />
          </span>
          <h2 className="mt-5 text-lg font-semibold text-slate-900">{t("wishlist.emptyTitle")}</h2>
          <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">
            {t("wishlist.emptyDesc")}
          </p>
          <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" asChild>
            <Link to="/products">
              <ShoppingBag className="size-4" />
              {t("wishlist.goShopping")}
            </Link>
          </Button>
        </div>
      ) : (
        <div className={gridClass}>
          {rows.map((row) => (
            <div key={row.id} className="relative">
              <ProductCard
                product={row.product}
                favorited
                favoriteBusy={busyId === row.productId}
                onToggleFavorite={() => void remove(row.productId)}
              />
              <Button
                size="sm"
                className="mt-1 h-8 w-full bg-slate-900 text-xs text-white hover:bg-slate-800"
                disabled={row.product.available <= 0}
                onClick={() => void add(row)}
              >
                {row.product.available <= 0 ? t("wishlist.outOfStock") : t("product.addToCart")}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
