import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { SubscriptionDialog } from "@/components/shop/SubscriptionDialog";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { api } from "@velnox/shared/lib/api-routes";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useCart } from "@/lib/cart";
import { useLanguage } from "@/lib/i18n";
import { useTracking } from "@velnox/shared/lib/track";
import {
  PRODUCT_CATEGORY_META,
  formatBaht,
  formatIsoDate,
  type StoreProduct,
} from "@velnox/shared/lib/commerce";
import { setSeo } from "@/lib/seo";
import { useAction } from "@velnox/shared/lib/api-routes";
import {
  ArrowLeft,
  CalendarClock,
  Heart,
  ImageOff,
  Loader2,
  Minus,
  Plus,
  ShoppingCart,
  Star,
  Store,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

interface ReviewRow {
  id: string;
  productId: string;
  shopId: string;
  userId: string;
  orderId: string | null;
  rating: number;
  title: string | null;
  comment: string | null;
  images: string[];
  status: string;
  createdAt: number;
  customerName?: string;
}

export default function ShopProductDetail() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { t } = useLanguage();
  const getProduct = useAction(api.commerce.getProductDetail);
  const productReviews = useAction(api.customer.productReviews);
  const toggleWishlist = useAction(api.customer.toggleWishlistAction);
  const myWishlist = useAction(api.customer.myWishlist);
  const { add } = useCart();
  const { track } = useTracking();

  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [qty, setQty] = useState(1);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [wishlisted, setWishlisted] = useState(false);
  const [wishToggling, setWishToggling] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [titleExpanded, setTitleExpanded] = useState(false);
  const [selectedVariant, setSelectedVariant] = useState<string | null>(null);
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    try {
      console.log("[ProductDetail] loading productId:", productId);
      const p = await getProduct({ productId });
      console.log("[ProductDetail] API response:", p);
      if (!p || p.status !== "published") {
        console.log("[ProductDetail] product rejected: status=", p?.status, "exists=", !!p);
        setProduct(null);
        return;
      }
      console.log("[ProductDetail] product loaded:", p.name, "status:", p.status);
      setProduct(p);
      setLoading(false);
      // Load optional data (reviews + wishlist) separately — failures must NOT clear the product
      try {
        const [revs, wl] = await Promise.allSettled([
          productReviews({ productId }),
          isAuthenticated ? myWishlist() : Promise.resolve([]),
        ]);
        if (revs.status === "fulfilled") setReviews((revs.value ?? []) as ReviewRow[]);
        if (wl.status === "fulfilled") setWishlisted((wl.value ?? []).some((i: { productId: string }) => i.productId === productId));
      } catch {
        // Wishlist/reviews failed — product still loads fine
        console.warn("[ProductDetail] Optional data load failed (non-fatal)");
      }
      return; // product loaded successfully — do NOT fall into catch
    } catch (err: any) {
      console.error("[ProductDetail] Load product error:", err);
      const msg = err?.message ?? String(err);
      if (msg.includes("404") || msg.includes("NOT_FOUND")) {
        setLoadError(null); // 404 = genuinely not found
      } else {
        setLoadError(msg); // network, 500, etc.
      }
      setProduct(null);
    } finally {
      setLoading(false);
    }
  }, [productId, getProduct, productReviews, isAuthenticated, myWishlist]);

  useEffect(() => {
    void load();
  }, [load]);

  // CPNS: opening a product page = PRODUCT_VIEW (once per product per visit).
  const viewedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!product || viewedRef.current === product.id) return;
    viewedRef.current = product.id;
    track("PRODUCT_VIEW", {
      entityId: product.id,
      value: product.name,
      context: { category: product.category, price: product.price, shopId: product.shopId },
    });
  }, [product, track]);

  const images = Array.isArray(product?.images) && product.images.length > 0 ? product.images : product?.primaryImage ? [product.primaryImage] : [];
  const variants = Array.isArray((product as any)?.variants) ? (product as any).variants : [];
  const active = images[activeIndex] ?? images[0];
  const available = product?.inventory?.available ?? product?.inventory?.quantity ?? 0;
  const outOfStock = available <= 0;
  const lowStock = !outOfStock && available <= 5;

  // SEO (spec §44) — product page gets Product structured data
  useEffect(() => {
    if (!product) return;
    const rating =
      reviews.length > 0
        ? { ratingValue: (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1), ratingCount: reviews.length }
        : undefined;
    setSeo({
      title: `${product.name} — VelShop`,
      description:
        product.description ??
        t("productDetail.seoDesc", {
          name: product.name,
          price: formatBaht(product.price),
          unit: product.unit,
          shop: product.shopName ?? t("productDetail.defaultShop"),
        }),
      ogType: "product",
      ogImage: images[0]?.displayUrl ?? undefined,
      jsonLd: {
        "@context": "https://schema.org",
        "@type": "Product",
        name: product.name,
        description: product.description ?? undefined,
        image: images[0]?.displayUrl ?? undefined,
        ...(rating ? { aggregateRating: { "@type": "AggregateRating", ...rating } } : {}),
        offers: {
          "@type": "Offer",
          priceCurrency: "THB",
          price: product.price,
          availability: outOfStock ? "https://schema.org/OutOfStock" : "https://schema.org/InStock",
        },
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product, reviews, images, outOfStock, t]);

  const handleAdd = () => {
    if (!product) return;
    if (!isAuthenticated) {
      navigate("/auth?returnTo=" + encodeURIComponent(`/products/${product.id}`));
      return;
    }
    add(
      { id: product.id, name: product.name, unit: product.unit, price: product.price, stock: available },
      qty,
    );
    toast.success(t("productDetail.addedToast", { name: product.name, qty }));
  };

  const handleBuyNow = () => {
    if (!product) return;
    if (!isAuthenticated) {
      navigate("/auth?returnTo=" + encodeURIComponent(`/products/${product.id}`));
      return;
    }
    add(
      { id: product.id, name: product.name, unit: product.unit, price: product.price, stock: available },
      qty,
    );
    navigate("/checkout");
  };

  const handleWishlist = async () => {
    if (!product) return;
    if (!isAuthenticated) {
      navigate("/auth?returnTo=" + encodeURIComponent(`/products/${product.id}`));
      return;
    }
    setWishToggling(true);
    try {
      const res = await toggleWishlist({ productId: product.id });
      setWishlisted(res.added);
      toast.success(res.added ? t("productDetail.wishlistAdded") : t("productDetail.wishlistRemoved"));
    } catch (err) {
      console.error("Wishlist error:", err);
      toast.error(t("productDetail.wishlistFailed"));
    } finally {
      setWishToggling(false);
    }
  };

  // Variant resolution: find the best matching variant based on selected options
  const resolvedVariant = selectedVariant && product
    ? variants.find((v: any) => v.id === selectedVariant)
    : null;

  // Determine display price/stock from variant or product
  const displayPrice = resolvedVariant?.price ?? product?.price ?? 0;
  const displayStock = resolvedVariant?.stock ?? available;
  const displayOutOfStock = displayStock <= 0;
  const displayLowStock = !displayOutOfStock && displayStock <= 5;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <ShopHeader />
        <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-2">
            <Skeleton className="aspect-square rounded-2xl" />
            <div className="space-y-4">
              <Skeleton className="h-8 w-2/3" />
              <Skeleton className="h-6 w-1/3" />
              <Skeleton className="h-24 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!product) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <ShopHeader />
        <main className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-24 text-center sm:px-6">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
            <ImageOff className="size-7 text-slate-400" />
          </span>
          <h1 className="mt-5 text-xl font-bold text-slate-900">
            {loadError ? t("productDetail.loadError") : t("productDetail.notFound")}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {loadError || t("productDetail.notFoundDesc")}
          </p>
          {loadError && (
            <Button className="mt-4 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={() => void load()}>
              {t("productDetail.retry")}
            </Button>
          )}
          <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" asChild>
            <Link to="/">
              <ArrowLeft className="size-4" />
              {t("productDetail.backToShop")}
            </Link>
          </Button>
        </main>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="flex items-center gap-1.5 py-1 text-sm text-slate-500 transition-colors hover:text-slate-900"
        >
          <ArrowLeft className="size-4" />
          {t("productDetail.back")}
        </button>

        <div className="mt-5 grid gap-8 lg:grid-cols-2">
          {/* Gallery */}
          <div>
            <div className="flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white">
              {active ? (
                <img
                  src={active.displayUrl || active.url}
                  alt={active.alt || product.name}
                  className="size-full object-cover"
                />
              ) : (
                <span className="flex size-full items-center justify-center">
                  <ImageOff className="size-12 text-slate-300" />
                </span>
              )}
            </div>
            {images.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                {images.map((img, i) => (
                  <button
                    key={img.id}
                    type="button"
                    onClick={() => setActiveIndex(i)}
                    className={`size-16 shrink-0 overflow-hidden rounded-[10px] border-2 transition-colors ${
                      i === activeIndex ? "border-[#10B981]" : "border-slate-200 hover:border-slate-300"
                    }`}
                    aria-label={t("productDetail.imageAlt", { n: i + 1 })}
                  >
                    <img src={img.thumbUrl || img.url} alt="" className="size-full object-cover" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex flex-col">
            <div className="flex items-start justify-between gap-2">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge className="rounded-full bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-600/10 hover:bg-slate-100">
                    {PRODUCT_CATEGORY_META[product.category].label}
                  </Badge>
                  {product.supplier && (
                    <Badge className="rounded-full bg-[#ECFDF5] text-emerald-700 ring-1 ring-inset ring-emerald-600/15 hover:bg-[#ECFDF5]">
                      {product.supplier}
                    </Badge>
                  )}
                </div>
                <h1 className={`mt-3 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl ${!titleExpanded ? 'line-clamp-2' : ''}`}>
                  {product.name}
                </h1>
                {product.name.length > 60 && (
                  <button
                    type="button"
                    onClick={() => setTitleExpanded((v) => !v)}
                    className="mt-1 text-xs font-medium text-[#10B981] hover:underline"
                    aria-expanded={titleExpanded}
                  >
                    {titleExpanded ? 'ย่อ ▲' : 'ดูเพิ่มเติม ▼'}
                  </button>
                )}
                <Link
                  to={`/shops/${product.shopId}`}
                  className="mt-2 inline-flex items-center gap-1.5 py-1 text-sm text-slate-500 transition-colors hover:text-[#10B981]"
                >
                  <Store className="size-4" />
                  {product.shopName ?? t("productDetail.defaultShop")}
                </Link>
              </div>
              <Button
                variant="outline"
                size="icon"
                className={`size-10 shrink-0 border-slate-200 ${
                  wishlisted ? "bg-rose-50 text-rose-500 hover:bg-rose-50" : "text-slate-500 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-500"
                }`}
                onClick={handleWishlist}
                disabled={wishToggling}
                aria-label={t("productDetail.ariaWishlist")}
              >
                {wishToggling ? <Loader2 className="size-4 animate-spin" /> : <Heart className={`size-4 ${wishlisted ? "fill-rose-500" : ""}`} />}
              </Button>
            </div>              {/* Variant selector (dynamic options) */}
              {variants.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-semibold text-slate-500">ตัวเลือกสินค้า</p>
                  <div className="flex flex-wrap gap-1.5">
                    {variants.map((v: any) => (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => setSelectedVariant(v.id === selectedVariant ? null : v.id)}
                        className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                          selectedVariant === v.id
                            ? "border-[#10B981] bg-[#F0FDF9] text-[#047857]"
                            : "border-slate-200 bg-white text-slate-600 hover:border-slate-300"
                        } ${v.stock <= 0 ? 'opacity-40 cursor-not-allowed' : ''}`}
                        disabled={v.stock <= 0}
                        aria-label={v.name}
                      >
                        {v.name}
                        {v.sku ? ` (${v.sku})` : ''}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-5">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <p className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">
                    {formatBaht(displayPrice)}
                    <span className="ml-1 text-sm font-normal text-slate-400">
                      {t("cart.perUnit", { unit: product.unit })}
                    </span>
                  </p>
                  {resolvedVariant?.price && resolvedVariant.price < product.price && (
                    <p className="mt-1 text-sm text-slate-400 line-through">
                      {formatBaht(product.price)}
                    </p>
                  )}
                  <p
                    className={`mt-1.5 text-xs ${
                      displayOutOfStock
                        ? "font-medium text-red-500"
                        : displayLowStock
                          ? "font-medium text-amber-600"
                          : "text-slate-400"
                    }`}
                  >
                    {displayOutOfStock
                      ? t("productDetail.outOfStockDesc")
                      : displayLowStock
                        ? t("product.lowStock", { count: displayStock, unit: product.unit })
                        : t("product.inStock", { count: displayStock, unit: product.unit })}
                  </p>
                </div>
                {reviews.length > 0 && (
                  <div className="flex items-center gap-1 text-sm">
                    <Star className="size-4 fill-amber-400 text-amber-400" />
                    <span className="font-semibold tabular-nums text-slate-900">
                      {(reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1)}
                    </span>
                    <span className="text-xs text-slate-400">
                      {t("productDetail.reviewCountShort", { count: reviews.length })}
                    </span>
                  </div>
                )}
              </div>

              {product.description && (
                <p className="mt-4 whitespace-pre-line border-t border-slate-100 pt-4 text-sm leading-6 text-slate-600">
                  {product.description}
                </p>
              )}
            </div>

            {/* CTA: quantity + Buy Once + VelRepeat — compact, equal button prominence */}
            <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 -mx-4 mt-5 space-y-2.5 border-t border-slate-200 bg-white/95 px-4 py-3 pb-4 backdrop-blur md:static md:mx-0 md:mt-5 md:border-0 md:bg-transparent md:p-0 md:pb-0 md:backdrop-blur-none">
              {displayOutOfStock ? (
                <Button className="w-full gap-1.5 bg-slate-100 text-slate-400 hover:bg-slate-100" disabled>
                  {t("product.outOfStock")}
                </Button>
              ) : (
                <>
                  {/* Row 1: Quantity + Add to Cart */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-1 rounded-[10px] border border-slate-200 bg-white px-1.5 py-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-slate-600"
                        onClick={() => setQty((q) => Math.max(1, q - 1))}
                        aria-label={t("cartDrawer.ariaDecrease")}
                      >
                        <Minus className="size-3.5" />
                      </Button>
                      <span className="w-8 text-center text-sm font-semibold tabular-nums text-slate-900">{qty}</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 text-slate-600"
                        onClick={() => setQty((q) => Math.min(displayStock, q + 1))}
                        disabled={qty >= displayStock}
                        aria-label={t("cartDrawer.ariaIncrease")}
                      >
                        <Plus className="size-3.5" />
                      </Button>
                    </div>
                    <Button
                      className="flex-1 gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
                      onClick={handleAdd}
                      disabled={product.price <= 0}
                    >
                      <ShoppingCart className="size-4" />
                      {t("product.addToCartSm")}
                    </Button>
                  </div>

                  {/* Row 2: Buy Now + VelRepeat — equal height and weight */}
                  <div className="grid grid-cols-2 gap-2">
                    <Button
                      variant="outline"
                      className="h-10 gap-1.5 border-slate-900 text-sm font-semibold text-slate-900 hover:bg-slate-900 hover:text-white"
                      onClick={handleBuyNow}
                      disabled={displayPrice <= 0}
                    >
                      <Zap className="size-4" />
                      {t("productDetail.buyNow")}
                    </Button>
                    <Button
                      variant="outline"
                      className="h-10 gap-1.5 border-[#10B981]/40 bg-[#F0FDF9] text-sm font-semibold text-[#047857] hover:border-[#10B981] hover:bg-[#ECFDF5]"
                      onClick={() => setSubOpen(true)}
                    >
                      <CalendarClock className="size-4" />
                      VelRepeat
                    </Button>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Reviews */}
        <section className="mt-12">
          <div className="flex items-center gap-2">
            <Star className="size-4 text-amber-400" />
            <h2 className="text-lg font-bold tracking-tight text-slate-900">{t("productDetail.reviews")}</h2>
            {reviews.length > 0 && (
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">
                {t("productDetail.reviewsCount", { count: reviews.length })}
              </span>
            )}
          </div>

          {reviews.length === 0 ? (
            <div className="mt-4 rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
              <Star className="mx-auto size-7 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">{t("productDetail.noReviews")}</p>
              <p className="mt-1 text-xs text-slate-400">{t("productDetail.noReviewsDesc")}</p>
            </div>
          ) : (
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {reviews.map((r) => (
                <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      {Array.from({ length: 5 }).map((_, i) => (
                        <Star
                          key={i}
                          className={`size-3.5 ${i < r.rating ? "fill-amber-400 text-amber-400" : "text-slate-200"}`}
                        />
                      ))}
                    </div>
                    <span className="text-[11px] text-slate-400">{formatIsoDate(r.createdAt)}</span>
                  </div>
                  {r.title && <p className="mt-2 text-sm font-semibold text-slate-900">{r.title}</p>}
                  {r.comment && <p className="mt-1 text-sm leading-6 text-slate-600">{r.comment}</p>}
                  <p className="mt-2 text-[11px] text-slate-400">
                    {r.customerName ?? t("productDetail.customer")} · {r.orderId ? t("productDetail.verifiedPurchase") : ""}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>

      <ShopFooter />

      <SubscriptionDialog
        product={product}
        open={subOpen}
        onOpenChange={setSubOpen}
        selectedVariant={selectedVariant ? variants.find((v: any) => v.id === selectedVariant) : null}
      />
    </div>
  );
}
