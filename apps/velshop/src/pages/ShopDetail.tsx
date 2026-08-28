import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { ProductCard } from "@/components/shop/ProductCard";
import { useLanguage } from "@/lib/i18n";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { api } from "@velnox/shared/lib/api-routes";
import { useCart } from "@/lib/cart";
import { formatBaht, type StoreProduct } from "@velnox/shared/lib/commerce";
import { useTracking } from "@velnox/shared/lib/track";
import { setSeo } from "@/lib/seo";
import { useAction } from "@velnox/shared/lib/api-routes";
import { ArrowLeft, ChevronDown, ChevronUp, Package, ShieldCheck, Star, Store } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { toast } from "sonner";

interface ShopRow {
  id: string;
  sellerId: string;
  name: string;
  slug: string | null;
  description: string | null;
  logo: string | null;
  cover: string | null;
  imageUrl: string | null;
  announcement: string | null;
  status: string;
  currency: string;
  createdAt: number;
  productCount: number;
  orderCount: number;
  rating: number | null;
  reviewCount: number;
}

export default function ShopDetail() {
  const { t } = useLanguage();
  const { shopId } = useParams<{ shopId: string }>();
  const shopDetail = useAction(api.customer.shopDetail);
  const { add } = useCart();
  const { track } = useTracking();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const toggleWishlist = useAction(api.customer.toggleWishlistAction);
  const myWishlist = useAction(api.customer.myWishlist);
  const [shop, setShop] = useState<ShopRow | null>(null);
  const [products, setProducts] = useState<StoreProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  const [wishTogglingId, setWishTogglingId] = useState<string | null>(null);
  const [descExpanded, setDescExpanded] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortBy, setSortBy] = useState<string>("newest");

  // Load wishlist if authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    let alive = true;
    myWishlist()
      .then((wl: any[]) => { if (alive) setWishlistIds(new Set((wl ?? []).map((i: any) => i.productId))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [isAuthenticated, myWishlist]);

  const handleWishlist = async (product: StoreProduct) => {
    if (!isAuthenticated) {
      navigate("/auth?returnTo=" + encodeURIComponent(`/shops/${shopId}`));
      return;
    }
    setWishTogglingId(product.id);
    try {
      const res = await toggleWishlist({ productId: product.id });
      setWishlistIds((prev) => {
        const next = new Set(prev);
        if (res.added) next.add(product.id); else next.delete(product.id);
        return next;
      });
      toast.success(res.added ? t("productDetail.wishlistAdded") : t("productDetail.wishlistRemoved"));
    } catch (err) {
      console.error("Wishlist error:", err);
      toast.error(t("productDetail.wishlistFailed"));
    } finally {
      setWishTogglingId(null);
    }
  };

  const load = useCallback(async () => {
    if (!shopId) return;
    setLoading(true);
    try {
      const res = await shopDetail({ shopId });
      setShop(res.shop as ShopRow);
      setProducts((res.products ?? []) as StoreProduct[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("shopDetail.notFound"));
    } finally {
      setLoading(false);
    }
  }, [shopId, shopDetail, t]);

  useEffect(() => {
    if (!shop) return;
    setSeo({
      title: `${shop.name} — VelShop`,
      description: shop.description ?? t("shopDetail.notFoundDesc"),
      ogType: "website",
    });
  }, [shop, t]);

  useEffect(() => {
    void load();
  }, [load]);

  // Track shop visit
  useEffect(() => {
    if (!shop) return;
    track("SHOP_VIEW", { entityId: shop.id, value: shop.name });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shop?.id]);

  const handleAdd = (product: StoreProduct) => {
    add(
      { id: product.id, name: product.name, unit: product.unit, price: product.price, stock: product.inventory?.available ?? product.inventory?.quantity ?? 0 },
      1,
    );
    toast.success(t("shopDetail.added", { name: product.name }));
  };

  // Filter + sort products
  const filteredProducts = products
    .filter((p) => {
      if (!searchQuery) return true;
      return p.name.toLowerCase().includes(searchQuery.toLowerCase());
    })
    .sort((a, b) => {
      if (sortBy === "price_asc") return a.price - b.price;
      if (sortBy === "price_desc") return b.price - a.price;
      if (sortBy === "popular") return (b.soldCount ?? 0) - (a.soldCount ?? 0);
      if (sortBy === "rating") return (b.rating ?? 0) - (a.rating ?? 0);
      return b.createdAt - a.createdAt; // newest
    });

  // ── Loading state ──
  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <ShopHeader />
        <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          {/* Cover skeleton */}
          <Skeleton className="h-40 rounded-2xl sm:h-56" />
          {/* Logo + info skeleton */}
          <div className="relative -mt-10 flex flex-col gap-4 px-4 sm:px-6">
            <Skeleton className="size-20 shrink-0 rounded-2xl border-4 border-white sm:size-24" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-4 w-64" />
            </div>
          </div>
          {/* Product skeletons */}
          <div className="mt-6 grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5">
            {Array.from({ length: 9 }).map((_, i) => (
              <Skeleton key={i} className="aspect-square rounded-lg" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  // ── Error state ──
  if (error || !shop) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <ShopHeader />
        <main className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-24 text-center sm:px-6">
          <Store className="size-10 text-slate-300" />
          <h1 className="mt-4 text-xl font-bold text-slate-900">{t("shopDetail.notFound")}</h1>
          <p className="mt-2 text-sm text-slate-500">{error ?? t("shopDetail.notFoundDesc")}</p>
          <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" asChild>
            <Link to="/">
              <ArrowLeft className="size-4" />
              {t("shopDetail.backHome")}
            </Link>
          </Button>
        </main>
      </div>
    );
  }

  const coverUrl = shop.cover || shop.imageUrl;
  const logoUrl = shop.logo || shop.imageUrl;
  const descriptionLong = (shop.description ?? "").length > 120;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <main className="mx-auto w-full max-w-[1280px] px-3 py-4 sm:px-6 sm:py-6">
        {/* Back navigation */}
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-slate-500 transition-colors hover:text-slate-900">
          <ArrowLeft className="size-4" />
          {t("shopDetail.back")}
        </Link>

        {/* ── Shop Header (compact) ── */}
        <section className="mt-3 overflow-hidden rounded-xl border border-slate-200 bg-white">
          {/* Cover image — smaller on mobile */}
          <div className="relative h-28 w-full overflow-hidden sm:h-44">
            {coverUrl ? (
              <img src={coverUrl} alt="" className="size-full object-cover" />
            ) : (
              <div className="size-full bg-gradient-to-r from-[#0f766e] via-[#10B981] to-[#34d399]" />
            )}
          </div>

          {/* Logo + Info */}
          <div className="relative flex flex-col gap-2 px-3 pb-4 sm:flex-row sm:items-end sm:px-6 sm:pb-5">
            {/* Logo — smaller on mobile */}
            <span className="-mt-8 flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border-3 border-white bg-[#ECFDF5] shadow-sm sm:-mt-11 sm:size-20">
              {logoUrl ? (
                <img src={logoUrl} alt={shop.name} className="size-full object-cover" />
              ) : (
                <Store className="size-6 text-[#10B981] sm:size-7" />
              )}
            </span>

            {/* Name + Stats */}
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <h1 className="text-lg font-bold tracking-tight text-slate-900 sm:text-xl">{shop.name}</h1>
                <Badge className="gap-1 rounded-full bg-[#ECFDF5] text-emerald-700 ring-1 ring-inset ring-emerald-600/15 hover:bg-[#ECFDF5]">
                  <ShieldCheck className="size-3" />
                  {t("shopDetail.verified")}
                </Badge>
              </div>

              {/* Stats row */}
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-400 sm:mt-1.5 sm:text-xs">
                {shop.rating != null && (
                  <span className="flex items-center gap-1">
                    <Star className="size-3 fill-amber-400 text-amber-400" />
                    <span className="font-semibold text-slate-900">{shop.rating.toFixed(1)}</span>
                    <span>{t("shopDetail.reviews", { count: shop.reviewCount })}</span>
                  </span>
                )}
                <span className="flex items-center gap-1">
                  <Package className="size-3" />
                  {t("shopDetail.productCount", { count: shop.productCount })}
                </span>
                {shop.orderCount > 0 && (
                  <span className="text-slate-300">·</span>
                )}
                {shop.orderCount > 0 && (
                  <span>{t("shopDetail.soldOrders", { count: shop.orderCount })}</span>
                )}
              </div>

              {/* Description — max 2 lines */}
              {shop.description && (
                <div className="mt-2">
                  <p
                    className={`max-w-2xl text-xs leading-5 text-slate-500 sm:text-sm sm:leading-6 ${!descExpanded && descriptionLong ? "line-clamp-2" : ""}`}
                  >
                    {shop.description}
                  </p>
                  {descriptionLong && (
                    <button
                      type="button"
                      onClick={() => setDescExpanded(!descExpanded)}
                      className="mt-0.5 flex items-center gap-0.5 text-[11px] font-medium text-[#10B981] hover:text-emerald-700"
                    >
                      {descExpanded ? t("shopDetail.showLess") : t("shopDetail.showMore")}
                      {descExpanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
                    </button>
                  )}
                </div>
              )}

              {/* Announcement — compact */}
              {shop.announcement && (
                <p className="mt-1.5 inline-flex rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-medium text-amber-700 sm:text-xs">
                  {shop.announcement}
                </p>
              )}
            </div>
          </div>
        </section>

        {/* ── Products Section ── */}
        <section className="mt-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="text-base font-bold tracking-tight text-slate-900 sm:text-lg">
              {t("shopDetail.productsTitle")}
              <span className="ml-1.5 text-xs font-normal text-slate-400">({filteredProducts.length})</span>
            </h2>
            {products.length > 0 && (
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("shopDetail.searchProducts")}
                  className="h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-[#10B981] focus:outline-none focus:ring-1 focus:ring-[#10B981]/30 sm:w-48"
                />
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 focus:border-[#10B981] focus:outline-none"
                >
                  <option value="newest">{t("shopDetail.sortNewest")}</option>
                  <option value="popular">{t("shopDetail.sortPopular")}</option>
                  <option value="price_asc">{t("shopDetail.sortPriceLow")}</option>
                  <option value="price_desc">{t("shopDetail.sortPriceHigh")}</option>
                  <option value="rating">{t("shopDetail.sortRating")}</option>
                </select>
              </div>
            )}
          </div>

          {filteredProducts.length === 0 ? (
            <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-10 text-center">
              <Package className="size-6 text-slate-300" />
              <p className="mt-2 text-sm font-medium text-slate-600">
                {searchQuery ? t("shopDetail.noSearchResults") : t("shopDetail.noProducts")}
              </p>
              {searchQuery && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="mt-1.5 text-[#10B981]"
                  onClick={() => setSearchQuery("")}
                >
                  {t("shopDetail.clearSearch")}
                </Button>
              )}
            </div>
          ) : (
            <div className="mt-3 grid grid-cols-3 gap-1.5 sm:grid-cols-4 lg:grid-cols-5">
              {filteredProducts.map((product) => (
                <ProductCard
                  key={product.id}
                  product={product}
                  onOpen={() => navigate(`/products/${product.id}`)}
                  onAdd={handleAdd}
                  wishlisted={wishlistIds.has(product.id)}
                  onWishlist={handleWishlist}
                  wishToggling={wishTogglingId === product.id}
                  compact
                  showShop={false}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      <ShopFooter />
    </div>
  );
}
