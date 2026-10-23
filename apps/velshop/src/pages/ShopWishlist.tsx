import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
import { Button } from "@velnox/shared/components/ui/button";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { api } from "@velnox/shared/lib/api-routes";
import { useCart } from "@/lib/cart";
import { formatBaht } from "@velnox/shared/lib/commerce";
import { useAction } from "@velnox/shared/lib/api-routes";
import { Heart, ImageOff, Loader2, Plus, ShoppingBag, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";

/**
 * Wishlist row — the backend already joins product data into the wishlist
 * response (name, price, unit, shop, primary image, rating, sold count, live
 * stock, variant flag), so the page never loads the full product catalog.
 */
interface WishlistRow {
  id: string;
  productId: string;
  productName: string;
  price: number;
  unit: string;
  currency?: string;
  shopName?: string | null;
  productImageUrl?: string | null;
  rating?: number | null;
  reviewCount?: number | null;
  soldCount?: number | null;
  availableStock?: number | null;
  hasVariants?: boolean;
  createdAt?: number | string;
}

export default function ShopWishlist() {
  const { t } = useLanguage();
  const myWishlist = useAction(api.customer.myWishlist);
  const toggleWishlist = useAction(api.customer.toggleWishlistAction);
  const { add } = useCart();
  const navigate = useNavigate();

  const [items, setItems] = useState<WishlistRow[] | null>(null);
  const [error, setError] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Broken-image set — a failed URL is filtered out permanently (no retry loop).
  const [failedImages, setFailedImages] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setError(false);
    try {
      const wl = await myWishlist();
      setItems((wl ?? []) as WishlistRow[]);
    } catch (err) {
      console.error("Load wishlist error:", err);
      setError(true);
      setItems(null);
    }
  }, [myWishlist]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleImageError = useCallback((url: string) => {
    setFailedImages((prev) => {
      if (prev.has(url)) return prev;
      const next = new Set(prev);
      next.add(url);
      return next;
    });
  }, []);

  const handleRemove = async (row: WishlistRow) => {
    setBusyId(row.productId);
    try {
      await toggleWishlist({ productId: row.productId });
      setItems((prev) => prev?.filter((i) => i.productId !== row.productId) ?? null);
      toast.success(t("wishlist.removed"));
    } catch (err) {
      console.error("Wishlist remove error:", err);
      toast.error(t("wishlist.failed"));
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Add-to-cart:
   * - Products that require a variant choice open the existing Product Detail
   *   selection flow instead of blind-adding (never buy the wrong option).
   * - Simple products are added straight to the existing cart system.
   * - Out-of-stock products are disabled.
   */
  const handleAdd = (row: WishlistRow) => {
    if (row.hasVariants) {
      navigate(`/products/${row.productId}`);
      return;
    }
    const stock = row.availableStock ?? 0;
    if (stock <= 0) return;
    add(
      {
        id: row.productId,
        name: row.productName,
        unit: row.unit || "piece",
        price: row.price,
        stock,
        imageUrl: row.productImageUrl ?? undefined,
      },
      1,
    );
    toast.success(t("wishlist.added"));
  };

  const gridClass =
    "mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4 xl:grid-cols-5";

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <Heart className="size-4 text-[#10B981]" />
            {t("wishlist.eyebrow")}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{t("wishlist.title")}</h1>
          <p className="mt-1.5 text-sm text-slate-500">{t("wishlist.desc")}</p>
        </div>

        {items === null && !error ? (
          <div className={gridClass}>
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
                <Skeleton className="aspect-square w-full rounded-none" />
                <div className="space-y-2 p-3">
                  <Skeleton className="h-3.5 w-4/5" />
                  <Skeleton className="h-3 w-1/2" />
                  <Skeleton className="h-4 w-2/3" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
              <Loader2 className="size-7 text-slate-400" />
            </span>
            <h2 className="mt-5 text-lg font-semibold text-slate-900">{t("wishlist.errorTitle")}</h2>
            <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">{t("wishlist.errorDesc")}</p>
            <Button className="mt-6 bg-slate-900 text-white hover:bg-slate-800" onClick={() => void load()}>
              {t("wishlist.retry")}
            </Button>
          </div>
        ) : items!.length === 0 ? (
          <div className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
              <Heart className="size-7 text-slate-400" />
            </span>
            <h2 className="mt-5 text-lg font-semibold text-slate-900">{t("wishlist.emptyTitle")}</h2>
            <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">{t("wishlist.emptyDesc")}</p>
            <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" asChild>
              <Link to="/">
                <ShoppingBag className="size-4" />
                {t("wishlist.goShopping")}
              </Link>
            </Button>
          </div>
        ) : (
          <div className={gridClass}>
            {items!.map((row) => {
              const imageUrl = row.productImageUrl && !failedImages.has(row.productImageUrl)
                ? row.productImageUrl
                : null;
              const stock = row.availableStock ?? 0;
              const outOfStock = stock <= 0;
              return (
                <div
                  key={row.id}
                  className="flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white transition-all duration-200 hover:border-slate-300"
                >
                  <Link
                    to={`/products/${row.productId}`}
                    className="relative block aspect-square w-full overflow-hidden bg-slate-50"
                    aria-label={row.productName}
                  >
                    {imageUrl ? (
                      <img
                        src={imageUrl}
                        alt={row.productName}
                        className="size-full object-cover transition-transform duration-300 hover:scale-105"
                        loading="lazy"
                        onError={() => handleImageError(imageUrl)}
                      />
                    ) : (
                      <span className="flex size-full items-center justify-center">
                        <ImageOff className="size-7 text-slate-300" />
                      </span>
                    )}
                    {outOfStock && (
                      <span className="absolute inset-x-0 bottom-0 bg-slate-900/70 px-2 py-1 text-center text-[10px] font-semibold text-white backdrop-blur-sm">
                        {t("wishlist.outOfStock")}
                      </span>
                    )}
                  </Link>

                  <div className="flex flex-1 flex-col p-3">
                    <div className="flex-1">
                      <Link
                        to={`/products/${row.productId}`}
                        className="line-clamp-2 text-[13px] font-semibold leading-[1.35] text-slate-900 hover:text-[#10B981]"
                      >
                        {row.productName}
                      </Link>
                      <p className="mt-1 truncate text-[11px] text-slate-400">
                        {row.shopName || t("wishlist.defaultShop")}
                      </p>

                      {row.rating != null && row.rating > 0 && (
                        <p className="mt-1.5 flex items-center gap-1 text-[11px] text-slate-500">
                          <Star className="size-3 fill-amber-400 text-amber-400" />
                          <span className="font-semibold tabular-nums text-slate-700">
                            {Number(row.rating).toFixed(1)}
                          </span>
                          {row.soldCount != null && row.soldCount > 0 && (
                            <span className="text-slate-400">· {t("wishlist.sold", { count: row.soldCount })}</span>
                          )}
                        </p>
                      )}
                    </div>

                    <div className="mt-2 flex items-center justify-between gap-2 border-t border-slate-100 pt-2.5">
                      <p className="text-sm font-bold tabular-nums tracking-tight text-slate-900">
                        {formatBaht(row.price)}
                        {row.unit && (
                          <span className="ml-0.5 text-[10px] font-normal text-slate-400">/{row.unit}</span>
                        )}
                      </p>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-7 rounded-[8px] text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                          onClick={() => void handleRemove(row)}
                          disabled={busyId === row.productId}
                          aria-label={t("wishlist.ariaRemove", { name: row.productName })}
                        >
                          {busyId === row.productId ? (
                            <Loader2 className="size-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          size="icon"
                          className="size-7 rounded-[8px] bg-slate-900 text-white hover:bg-slate-800"
                          disabled={outOfStock}
                          onClick={() => handleAdd(row)}
                          aria-label={
                            row.hasVariants
                              ? t("wishlist.ariaChooseVariant", { name: row.productName })
                              : t("wishlist.ariaAdd", { name: row.productName })
                          }
                        >
                          {row.hasVariants ? (
                            <ShoppingBag className="size-3.5" />
                          ) : (
                            <Plus className="size-4" />
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      <ShopFooter />
    </div>
  );
}