import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { SubscriptionDialog } from "@/components/shop/SubscriptionDialog";
import { ProductCard } from "@/components/shop/ProductCard";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@velnox/shared/components/ui/sheet";
import { api } from "@velnox/shared/lib/api-routes";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useCart } from "@/lib/cart";
import { useLanguage } from "@/lib/i18n";
import { useTracking } from "@velnox/shared/lib/track";
import { useCartFlyAnimation } from "@/components/shop/CartFlyAnimation";
import {
  PRODUCT_CATEGORY_META,
  formatBaht,
  formatIsoDate,
  type StoreProduct,
} from "@velnox/shared/lib/commerce";
import { setSeo } from "@/lib/seo";
import { ACTION_BUTTON_CLASSES } from "@/lib/productActions";
import { useAction } from "@velnox/shared/lib/api-routes";
import {
  ArrowLeft,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Heart,
  ImageOff,
  Loader2,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  Share2,
  ShoppingCart,
  Star,
  Store,
  Zap,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

/* ─── Types ────────────────────────────────────────────────────────────── */

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

type TabKey = "recommend" | "details" | "reviews";
type PendingAction = "cart" | "buy" | "velrepeat" | null;

/* ─── Expandable Title ─────────────────────────────────────────────────── */

function ProductTitle({ name, t }: { name: string; t: (k: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand = name.length > 60;
  return (
    <button
      type="button"
      onClick={() => setExpanded((v) => !v)}
      className="flex w-full min-w-0 items-start gap-2 text-left"
      aria-expanded={expanded}
    >
      <h1 className={`min-w-0 flex-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl ${!expanded && needsExpand ? "line-clamp-2" : ""}`}>
        {name}
      </h1>
      {needsExpand && (
        <span className="mt-1 inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[#10B981] transition-colors">
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </span>
      )}
    </button>
  );
}

/* ─── Expandable Description ───────────────────────────────────────────── */

function ExpandableDescription({ text, t }: { text: string; t: (k: string, v?: Record<string, string | number>) => string }) {
  const [expanded, setExpanded] = useState(false);
  const needsExpand = text.length > 200;
  if (!text) return <p className="text-sm text-slate-400 italic">{t("productDetail.noDetails")}</p>;
  return (
    <div>
      <div className={expanded ? "" : "max-h-32 overflow-hidden"}>
        <p className="whitespace-pre-line text-sm leading-6 text-slate-600">{text}</p>
      </div>
      {needsExpand && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-[#10B981] transition-colors hover:text-[#059669]">
          {expanded ? t("productDetail.hideDetails") : t("productDetail.seeAllDetails")}
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
        </button>
      )}
    </div>
  );
}

/* ─── Horizontal Carousel ──────────────────────────────────────────────── */

function ProductCarousel({ title, viewAllLink, products, emptyText, t }: {
  title: string; viewAllLink?: string; products: StoreProduct[];
  emptyText: string; t: (k: string, v?: Record<string, string | number>) => string;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  if (products.length === 0) return null;
  const scroll = (dir: "left" | "right") => {
    if (!scrollRef.current) return;
    scrollRef.current.scrollBy({ left: dir === "left" ? -200 : 200, behavior: "smooth" });
  };
  return (
    <section>
      <div className="flex items-center justify-between">
        <h3 className="text-base font-bold text-slate-900">{title}</h3>
        <div className="flex items-center gap-2">
          {viewAllLink && <Link to={viewAllLink} className="text-xs font-medium text-[#10B981] transition-colors hover:text-[#059669]">{t("productDetail.viewAll")}</Link>}
          <button type="button" onClick={() => scroll("left")} className="flex size-7 items-center justify-center rounded-full border border-slate-200 text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-600" aria-label="Scroll left">
            <ChevronDown className="size-3.5 -rotate-90" />
          </button>
          <button type="button" onClick={() => scroll("right")} className="flex size-7 items-center justify-center rounded-full border border-slate-200 text-slate-400 transition-colors hover:border-slate-300 hover:text-slate-600" aria-label="Scroll right">
            <ChevronDown className="size-3.5 rotate-90" />
          </button>
        </div>
      </div>
      <div ref={scrollRef} className="mt-3 flex gap-3 overflow-x-auto scroll-smooth pb-2 [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
        {products.map((p) => (
          <div key={p.id} className="w-40 shrink-0 sm:w-48">
            <ProductCard product={p} />
          </div>
        ))}
      </div>
    </section>
  );
}

/* ─── Star Rating Distribution ─────────────────────────────────────────── */

function RatingDistribution({ reviews, t }: { reviews: ReviewRow[]; t: (k: string, v?: Record<string, string | number>) => string }) {
  if (reviews.length === 0) return null;
  const avg = reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length;
  const distribution = [5, 4, 3, 2, 1].map((star) => ({ star, count: reviews.filter((r) => r.rating === star).length }));
  const maxCount = Math.max(...distribution.map((d) => d.count), 1);
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:gap-6">
      <div className="flex items-center gap-3">
        <span className="text-3xl font-bold tabular-nums text-slate-900">{avg.toFixed(1)}</span>
        <div>
          <div className="flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Star key={i} className={`size-4 ${i < Math.round(avg) ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />
            ))}
          </div>
          <p className="mt-0.5 text-xs text-slate-400">{t("productDetail.fromReviews", { count: reviews.length })}</p>
        </div>
      </div>
      <div className="flex-1 space-y-1">
        {distribution.map(({ star, count }) => (
          <div key={star} className="flex items-center gap-2 text-xs">
            <span className="w-3 text-right tabular-nums text-slate-400">{star}</span>
            <Star className="size-3 fill-amber-400 text-amber-400" />
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-amber-400 transition-all" style={{ width: `${(count / maxCount) * 100}%` }} />
            </div>
            <span className="w-6 text-right tabular-nums text-slate-400">{count}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Main Component ───────────────────────────────────────────────────── */

export default function ShopProductDetail() {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();
  const { t } = useLanguage();
  const getProduct = useAction(api.commerce.getProductDetail);
  const productReviews = useAction(api.customer.productReviews);
  const catalogProducts = useAction(api.commerce.catalogProductsAction);
  const toggleWishlist = useAction(api.customer.toggleWishlistAction);
  const myWishlist = useAction(api.customer.myWishlist);
  const { add } = useCart();
  const { track } = useTracking();
  const { fly } = useCartFlyAnimation();

  /* ── Core state ─────────────────────────────────────────────────── */
  const [product, setProduct] = useState<StoreProduct | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeIndex, setActiveIndex] = useState(0);
  const [optionOverrideIndex, setOptionOverrideIndex] = useState<number | null>(null);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [wishlisted, setWishlisted] = useState(false);
  const [wishToggling, setWishToggling] = useState(false);
  const [subOpen, setSubOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabKey>("recommend");
  const [reviewsExpanded, setReviewsExpanded] = useState(false);

  /* ── Variant state ──────────────────────────────────────────────── */
  const [optionGroups, setOptionGroups] = useState<any[]>([]);
  const [variantOptions, setVariantOptions] = useState<Record<string, any>>({});
  const [selectedOptions, setSelectedOptions] = useState<Record<string, string>>({});
  const [selectedVariant, setSelectedVariant] = useState<any>(null);

  /* ── Variant sheet state ────────────────────────────────────────── */
  const [variantSheetOpen, setVariantSheetOpen] = useState(false);
  const [sheetQty, setSheetQty] = useState(1);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [compactSheet, setCompactSheet] = useState(false);
  const addBtnRef = useRef<HTMLButtonElement>(null);

  /* ── Recommendation state ───────────────────────────────────────── */
  const [recommended, setRecommended] = useState<StoreProduct[]>([]);
  const [similar, setSimilar] = useState<StoreProduct[]>([]);

  /* ── Load product + dependent data ──────────────────────────────── */

  const load = useCallback(async () => {
    if (!productId) return;
    setLoading(true);
    try {
      const p = await getProduct({ productId });
      if (!p || p.status !== "published") { setProduct(null); return; }
      setProduct(p);
      const pAny = p as any;
      if (Array.isArray(pAny.optionGroups) && pAny.optionGroups.length > 0) {
        setOptionGroups(pAny.optionGroups);
      }
      if (pAny.variantOptions && typeof pAny.variantOptions === "object") {
        setVariantOptions(pAny.variantOptions);
      }
      // Auto-select options for featured variant so Product Detail opens with it
      if (pAny.featuredVariant && pAny.variantOptions && Array.isArray(pAny.optionGroups) && pAny.optionGroups.length > 0) {
        const fvId = pAny.featuredVariant.id;
        const fvOpts = pAny.variantOptions[fvId];
        if (fvOpts && typeof fvOpts === "object") {
          const initialSelections: Record<string, string> = {};
          for (const group of pAny.optionGroups) {
            if (fvOpts[group.id]) initialSelections[group.id] = fvOpts[group.id];
          }
          if (Object.keys(initialSelections).length > 0) setSelectedOptions(initialSelections);
        }
      }
      // For products without option groups, auto-select the first variant (or featured)
      if (Array.isArray(pAny.variants) && pAny.variants.length > 0 && (!Array.isArray(pAny.optionGroups) || pAny.optionGroups.length === 0)) {
        const autoVariant = pAny.featuredVariant ?? pAny.variants[0];
        setSelectedVariant(autoVariant);
      }
      const [revs, wl] = await Promise.all([
        productReviews({ productId }),
        isAuthenticated ? myWishlist() : Promise.resolve([]),
      ]);
      setReviews((revs ?? []) as ReviewRow[]);
      setWishlisted((wl ?? []).some((i: { productId: string }) => i.productId === productId));

      const fetches: Promise<void>[] = [];
      if (p.category) {
        fetches.push(
          catalogProducts({ category: p.category, limit: 12 })
            .then((result) => { setRecommended((result ?? []).filter((item: StoreProduct) => item.id !== p.id)); })
            .catch(() => {}),
        );
      }
      if (p.shopId) {
        fetches.push(
          catalogProducts({ shopId: p.shopId, limit: 12 })
            .then((result) => { setSimilar((result ?? []).filter((item: StoreProduct) => item.id !== p.id).slice(0, 8)); })
            .catch(() => {}),
        );
      }
      await Promise.all(fetches);
    } catch (err) {
      console.error("Load product error:", err);
      setProduct(null);
    } finally {
      setLoading(false);
    }
  }, [productId, getProduct, productReviews, isAuthenticated, myWishlist, catalogProducts]);

  useEffect(() => { void load(); }, [load]);

  /* ── Product view tracking ──────────────────────────────────────── */

  const viewedRef = useRef<string | null>(null);
  useEffect(() => {
    if (!product || viewedRef.current === product.id) return;
    viewedRef.current = product.id;
    track("PRODUCT_VIEW", { entityId: product.id, value: product.name, context: { category: product.category, price: product.price, shopId: product.shopId } });
  }, [product, track]);

  /* ── Variant resolution ─────────────────────────────────────────── */

  const resolveVariant = useCallback(() => {
    // For products without option groups, keep existing auto-selected variant (single variant or no variants)
    if (optionGroups.length === 0) return undefined;
    const pVariants = (product as any)?.variants;
    if (!Array.isArray(pVariants) || pVariants.length === 0) return null;
    const entries = Object.entries(selectedOptions);
    if (entries.length === 0) return null;
    return pVariants.find((v: any) => {
      const vOpts = variantOptions[v.id];
      if (!vOpts || typeof vOpts !== "object" || Array.isArray(vOpts)) return false;
      return entries.every(([gId, vId]) => vOpts[gId] === vId);
    }) ?? null;
  }, [optionGroups, selectedOptions, product, variantOptions]);

  useEffect(() => {
    const resolved = resolveVariant();
    // undefined = no option groups, keep existing selectedVariant (auto-set in load)
    if (resolved !== undefined) setSelectedVariant(resolved);
  }, [resolveVariant]);

  /* ── Derived values ─────────────────────────────────────────────── */

  // Gallery images: ordered as [preview/gallery] + [variant] + [detail]
  const images = useMemo(() => {
    const allRaw: Array<{ img: any; group: number }> = [];

    // Group 0: Product gallery/preview images (sorted by sortOrder)
    const previewImages = product?.images && product.images.length > 0
      ? [...product.images].sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      : product?.primaryImage ? [product.primaryImage!] : [];
    for (const img of previewImages) allRaw.push({ img, group: 0 });

    // Group 1: Variant images (from selected variant, sorted by sortOrder)
    if (selectedVariant?.images?.length > 0) {
      const vImgs = [...selectedVariant.images].sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
      for (let i = 0; i < vImgs.length; i++) {
        const img = vImgs[i];
        allRaw.push({
          img: {
            id: `vi-${(img.id as string) ?? i}`,
            productId: product?.id ?? '',
            url: img.url,
            displayUrl: img.url,
            thumbUrl: img.url,
            storageProvider: 'r2' as const,
            storageKey: (img.storageKey as string) ?? '',
            alt: (img.alt as string) || '',
            sortOrder: i,
            isPrimary: false,
            width: null,
            height: null,
            createdAt: Date.now(),
          },
          group: 1,
        });
      }
    }

    // Group 2: Product detail images (sorted by sortOrder)
    const detailImages = (product as any)?.detailImages as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(detailImages)) {
      const sorted = [...detailImages].sort((a, b) => ((a.sortOrder as number) ?? 0) - ((b.sortOrder as number) ?? 0));
      for (let i = 0; i < sorted.length; i++) {
        const img = sorted[i];
        allRaw.push({
          img: {
            id: `di-${(img.id as string) ?? i}`,
            productId: product?.id ?? '',
            url: img.url as string,
            displayUrl: (img.displayUrl as string) ?? img.url as string,
            thumbUrl: (img.thumbUrl as string) ?? img.url as string,
            storageProvider: 'r2' as const,
            storageKey: (img.storageKey as string) ?? '',
            alt: (img.alt as string) || '',
            sortOrder: (img.sortOrder as number) ?? i,
            isPrimary: false,
            width: null,
            height: null,
            createdAt: Date.now(),
          },
          group: 2,
        });
      }
    }

    return allRaw;
  }, [product, selectedVariant]);
  // Reset active index when images change (e.g. variant option selected)
  useEffect(() => {
    if (activeIndex >= images.length && images.length > 0) setActiveIndex(0);
  }, [images.length, activeIndex]);



  /* ── Option value image map (variant-based + option-value-based) ── */
  const optionValueImageMap = useMemo(() => {
    const map: Record<string, string> = {};
    // Source 1: Map from variant images (variant → option value IDs)
    const pVariants = (product as any)?.variants as Array<Record<string, any>> | undefined;
    if (Array.isArray(pVariants)) {
      for (const v of pVariants) {
        const imgs = (v as any).images as Array<{ url: string }> | undefined;
        if (!imgs || imgs.length === 0) continue;
        const imgUrl = imgs[0].url;
        if (!imgUrl) continue;
        const vMapping = variantOptions[v.id] as Record<string, string> | undefined;
        if (!vMapping) continue;
        for (const optionValueId of Object.values(vMapping)) {
          if (!map[optionValueId]) map[optionValueId] = imgUrl;
        }
      }
    }
    // Source 2: Map from option value imageUrl (option group values)
    if (Array.isArray(optionGroups)) {
      for (const group of optionGroups) {
        if (!Array.isArray(group.values)) continue;
        for (const val of group.values) {
          if (val.imageUrl && !map[val.id]) map[val.id] = val.imageUrl;
        }
      }
    }
    return map;
  }, [product, variantOptions, optionGroups]);

  /* ── Currently selected option value images (deterministic) ───────── */
  const selectedOptionImages = useMemo(() => {
    const imgs: Array<{ url: string; groupId: string; valueId: string; sortOrder: number }> = [];
    for (const group of optionGroups) {
      const valId = selectedOptions[group.id];
      if (valId && optionValueImageMap[valId]) {
        imgs.push({
          url: optionValueImageMap[valId],
          groupId: group.id,
          valueId: valId,
          sortOrder: 0,
        });
      }
    }
    return imgs;
  }, [optionGroups, selectedOptions, optionValueImageMap]);

  /* ── Unified main image: option override > gallery activeIndex ────── */
  const mainImage = useMemo(() => {
    // Option override: user selected an option with an image
    if (optionOverrideIndex !== null) {
      const imgSrc = selectedOptionImages[0];
      if (imgSrc) {
        return {
          id: `ov-${imgSrc.valueId}`,
          productId: product?.id ?? '',
          url: imgSrc.url,
          displayUrl: imgSrc.url,
          thumbUrl: imgSrc.url,
          storageProvider: 'r2' as const,
          storageKey: '',
          alt: '',
          sortOrder: 0,
          isPrimary: false,
          width: null,
          height: null,
          createdAt: Date.now(),
        };
      }
    }
    // Gallery activeIndex (thumbnail click, swipe, or initial)
    return images[activeIndex]?.img ?? images[0]?.img ?? null;
  }, [optionOverrideIndex, selectedOptionImages, images, activeIndex, product]);

  // Sync gallery index when option selection changes
  useEffect(() => {
    if (!product || optionGroups.length === 0) return;
    // Find selected option image URL
    let selectedImgUrl: string | null = null;
    for (const group of optionGroups) {
      const valId = selectedOptions[group.id];
      if (valId && optionValueImageMap[valId]) {
        selectedImgUrl = optionValueImageMap[valId];
        break;
      }
    }
    if (!selectedImgUrl) {
      // No option image — keep gallery at current position
      return;
    }
    // Find matching image in gallery by URL
    const idx = images.findIndex((entry) => entry.img.url === selectedImgUrl);
    if (idx >= 0) {
      setActiveIndex(idx);
    }
  }, [selectedOptions, optionValueImageMap, images, optionGroups, product]);

  /* ── Cart image: first IMAGE option value image, fallback to product image ── */
  const cartImageUrl = useMemo(() => {
    for (const group of optionGroups) {
      if (group.displayType !== "image") continue;
      const valId = selectedOptions[group.id];
      if (valId && optionValueImageMap[valId]) return optionValueImageMap[valId];
    }
    return product?.images?.[0]?.url ?? product?.primaryImage?.url ?? undefined;
  }, [optionGroups, selectedOptions, optionValueImageMap, product]);

  const baseAvailable = product?.inventory?.available ?? product?.inventory?.quantity ?? 0;
  const displayPrice = selectedVariant?.price ?? product?.price ?? 0;
  const displayCompareAt = selectedVariant?.compareAtPrice ?? null;
  const displayDiscountPct = selectedVariant?.discountPercent ?? null;
  const displayStock = selectedVariant?.stock ?? baseAvailable;
  const outOfStock = displayStock <= 0;
  const lowStock = !outOfStock && displayStock <= 5;
  const displayedReviews = reviewsExpanded ? reviews : reviews.slice(0, 5);
  const avgRating = reviews.length > 0 ? reviews.reduce((s, r) => s + r.rating, 0) / reviews.length : null;
  const hasOptionGroups = optionGroups.length > 0;
  const allRequiredSelected = useMemo(() => {
    if (!hasOptionGroups) return true;
    return optionGroups.every((g: any) => !g.required || selectedOptions[g.id]);
  }, [hasOptionGroups, optionGroups, selectedOptions]);
  const needsVariant = hasOptionGroups && !allRequiredSelected;
  const velrepeatAvailable = !!(
    product?.vrepeatEnabled ||
    product?.vrepeatWeeklyEnabled ||
    product?.vrepeatMonthlyEnabled
  );

  /* ── SEO ────────────────────────────────────────────────────────── */

  useEffect(() => {
    if (!product) return;
    const rating = reviews.length > 0 ? { ratingValue: (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1), ratingCount: reviews.length } : undefined;
    setSeo({
      title: `${product.name} — VelShop`,
      description: product.description ?? t("productDetail.seoDesc", { name: product.name, price: formatBaht(product.price), unit: product.unit, shop: product.shopName ?? t("productDetail.defaultShop") }),
      ogType: "product", ogImage: images[0]?.img?.displayUrl ?? undefined,
      jsonLd: {
        "@context": "https://schema.org", "@type": "Product", name: product.name, description: product.description ?? undefined, image: images[0]?.img?.displayUrl ?? undefined,
        ...(rating ? { aggregateRating: { "@type": "AggregateRating", ...rating } } : {}),
        offers: { "@type": "Offer", priceCurrency: "THB", price: product.price, availability: outOfStock ? "https://schema.org/OutOfStock" : "https://schema.org/InStock" },
      },
    });
  }, [product, reviews, images, outOfStock, t]);

  /* ── Scroll restoration for refresh + back/forward ───────────────── */
  useEffect(() => {
    if ('scrollRestoration' in history) {
      history.scrollRestoration = 'manual';
    }
    // Scroll to top on fresh navigation (new product ID)
    if (!loading && product) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
  }, [loading, product, productId]);

  /* ── Compact selector thumbnails ────────────────────────────────── */

  const compactThumbnails = useMemo(() => {
    if (optionGroups.length === 0) return [];
    const firstGroup = optionGroups[0];
    if (!firstGroup?.values) return [];
    return firstGroup.values.slice(0, 5).map((val: any) => ({
      id: val.id,
      label: val.label,
      imageUrl: val.imageUrl || optionValueImageMap[val.id] || null,
      groupId: firstGroup.id,
      selected: selectedOptions[firstGroup.id] === val.id,
    }));
  }, [optionGroups, selectedOptions, optionValueImageMap]);

  const totalOptionValues = useMemo(() => {
    return optionGroups.reduce((sum: number, g: any) => sum + (Array.isArray(g.values) ? g.values.length : 0), 0);
  }, [optionGroups]);

  /* ── Gallery thumbnails: product images + variant images ──────── */

  const productThumbnails = useMemo(() => {
    if (product?.images && product.images.length > 0) return product.images;
    if (product?.primaryImage) return [product.primaryImage];
    return [];
  }, [product]);

  const variantThumbnails = useMemo(() => {
    if (!selectedVariant) return [];
    if (selectedVariant.images && selectedVariant.images.length > 0) {
      return selectedVariant.images.map((img: any, i: number) => ({
        id: `vi-${img.id ?? i}`,
        url: img.url,
        displayUrl: img.url,
        thumbUrl: img.url,
        label: selectedVariant.name ?? '',
        isVariant: true as const,
      }));
    }
    return [];
  }, [selectedVariant]);

  const handleSelectVariantFromThumbnail = useCallback((variantId: string) => {
    const pVariants = (product as any)?.variants;
    if (!Array.isArray(pVariants)) return;
    const variant = pVariants.find((v: any) => v.id === variantId);
    if (!variant) return;
    const vOpts = variantOptions[variantId];
    if (vOpts && typeof vOpts === 'object') {
      setSelectedOptions((prev) => {
        const next = { ...prev };
        for (const [gId, vId] of Object.entries(vOpts)) {
          next[gId] = vId as string;
        }
        return next;
      });
    }
  }, [product, variantOptions]);

  const variantThumbsWithActive = useMemo(() => {
    if (variantThumbnails.length === 0) return [];
    return variantThumbnails.map((vt: any) => ({
      id: vt.id,
      url: vt.thumbUrl || vt.url,
      label: vt.label,
      onClick: () => handleSelectVariantFromThumbnail(selectedVariant?.id ?? ''),
      isActive: true,
      isVariant: true as const,
    }));
  }, [variantThumbnails, selectedVariant, handleSelectVariantFromThumbnail]);

  const selectedSummary = useMemo(() => {
    if (!hasOptionGroups || Object.keys(selectedOptions).length === 0) return null;
    const parts: string[] = [];
    for (const group of optionGroups) {
      const valId = selectedOptions[group.id];
      if (valId) {
        const val = group.values?.find((v: any) => v.id === valId);
        if (val) parts.push(val.label || val.value);
      }
    }
    return parts.length > 0 ? parts.join(" / ") : null;
  }, [hasOptionGroups, optionGroups, selectedOptions]);

  /* ── Handlers ───────────────────────────────────────────────────── */

  const openVariantSheet = useCallback((action?: PendingAction) => {
    setPendingAction(action ?? null);
    setSheetQty(1);
    setVariantSheetOpen(true);
  }, []);

  // Auto-clip qty when variant stock changes while sheet is open
  useEffect(() => {
    if (variantSheetOpen && sheetQty > displayStock && displayStock > 0) {
      setSheetQty(displayStock);
    }
  }, [variantSheetOpen, displayStock, sheetQty]);

  const handleAddToCart = useCallback(() => {
    if (!product) return;
    if (!isAuthenticated) { navigate("/auth?returnTo=" + encodeURIComponent(`/products/${product.id}`)); return; }
    if (outOfStock) return;
    openVariantSheet("cart");
  }, [product, isAuthenticated, navigate, outOfStock, openVariantSheet]);

  const handleBuyNow = useCallback(() => {
    if (!product) return;
    if (!isAuthenticated) { navigate("/auth?returnTo=" + encodeURIComponent(`/products/${product.id}`)); return; }
    if (outOfStock) return;
    openVariantSheet("buy");
  }, [product, isAuthenticated, navigate, outOfStock, openVariantSheet]);

  const handleVelRepeat = useCallback(() => {
    if (!product) return;
    if (!isAuthenticated) { navigate("/auth?returnTo=" + encodeURIComponent(`/products/${product.id}`)); return; }
    openVariantSheet("velrepeat");
  }, [product, isAuthenticated, navigate, openVariantSheet]);

  const handleSheetAction = useCallback((action: PendingAction) => {
    setPendingAction(action);
    // Trigger the same validation + execution as direct buttons
    if (!product) return;
    if (!isAuthenticated) { navigate("/auth?returnTo=" + encodeURIComponent(`/products/${product.id}`)); return; }
    if (outOfStock && action !== "velrepeat") {
      toast.error(t("productDetail.outOfStockDesc"));
      return;
    }
    // Validate required options
    const missing = optionGroups
      .filter((g: any) => g.required && !selectedOptions[g.id])
      .map((g: any) => g.name);
    if (missing.length > 0) {
      toast.error(t("productDetail.pleaseSelectOption", { options: missing.join(", ") }));
      return;
    }
    // Execute action
    if (action === "cart") {
      add({
        id: product.id, name: product.name, unit: product.unit,
        price: displayPrice, stock: displayStock,
        variantId: selectedVariant?.id ?? null,
        imageUrl: cartImageUrl,
      }, sheetQty);
      fly(addBtnRef.current);
      toast.success(t("productDetail.addedToast", { name: product.name, qty: sheetQty }));
      setVariantSheetOpen(false);
      setPendingAction(null);
    } else if (action === "buy") {
      add({
        id: product.id, name: product.name, unit: product.unit,
        price: displayPrice, stock: displayStock,
        variantId: selectedVariant?.id ?? null,
        imageUrl: cartImageUrl,
      }, sheetQty);
      setTimeout(() => {
        navigate("/checkout", {
          state: {
            buyNow: true,
            buyNowProductId: product.id,
            buyNowVariantId: selectedVariant?.id ?? null,
            buyNowQty: sheetQty,
          },
        });
      }, 300);
      setVariantSheetOpen(false);
      setPendingAction(null);
    } else if (action === "velrepeat") {
      setVariantSheetOpen(false);
      setPendingAction(null);
      setSubOpen(true);
    }
  }, [product, isAuthenticated, navigate, outOfStock, optionGroups, selectedOptions, add, displayPrice, displayStock, selectedVariant, sheetQty, fly, t]);

  const handleSheetConfirm = useCallback(() => {
    if (!product || !pendingAction) return;
    // Validate required options
    const missing = optionGroups
      .filter((g: any) => g.required && !selectedOptions[g.id])
      .map((g: any) => g.name);
    if (missing.length > 0) {
      toast.error(t("productDetail.pleaseSelectOption", { options: missing.join(", ") }));
      return;
    }
    if (pendingAction === "cart") {
      add({
        id: product.id, name: product.name, unit: product.unit,
        price: displayPrice, stock: displayStock,
        variantId: selectedVariant?.id ?? null,
        imageUrl: cartImageUrl,
      }, sheetQty);
      fly(addBtnRef.current);
      toast.success(t("productDetail.addedToast", { name: product.name, qty: sheetQty }));
    } else if (pendingAction === "buy") {
      add({
        id: product.id, name: product.name, unit: product.unit,
        price: displayPrice, stock: displayStock,
        variantId: selectedVariant?.id ?? null,
        imageUrl: cartImageUrl,
      }, sheetQty);
      setTimeout(() => {
        navigate("/checkout", {
          state: {
            buyNow: true,
            buyNowProductId: product.id,
            buyNowVariantId: selectedVariant?.id ?? null,
            buyNowQty: sheetQty,
          },
        });
      }, 300);
      setVariantSheetOpen(false);
      setPendingAction(null);
    } else if (pendingAction === "velrepeat") {
      // Close sheet, open SubscriptionDialog with variant info
      setVariantSheetOpen(false);
      setPendingAction(null);
      setSubOpen(true);
    }
  }, [product, pendingAction, optionGroups, selectedOptions, outOfStock, add, displayPrice, displayStock, selectedVariant, sheetQty, fly, navigate, t]);

  const handleOptionSelect = useCallback((groupId: string, valueText: string) => {
    setSelectedOptions((prev) => ({
      ...prev,
      [groupId]: prev[groupId] === valueText ? "" : valueText,
    }));
    setOptionOverrideIndex(0); // Show option image (sync effect will set activeIndex)
  }, []);

  const handleWishlist = async () => {
    if (!product) return;
    if (!isAuthenticated) { navigate("/auth?returnTo=" + encodeURIComponent(`/products/${product.id}`)); return; }
    setWishToggling(true);
    try {
      const res = await toggleWishlist({ productId: product.id });
      setWishlisted(res.added);
      toast.success(res.added ? t("productDetail.wishlistAdded") : t("productDetail.wishlistRemoved"));
    } catch { toast.error(t("productDetail.wishlistFailed")); }
    finally { setWishToggling(false); }
  };

  const handleShare = () => {
    if (navigator.share && product) { navigator.share({ title: product.name, url: window.location.href }); }
    else { navigator.clipboard?.writeText(window.location.href); toast.success(t("productDetail.linkCopied")); }
  };

  /* ── Loading skeleton ───────────────────────────────────────────── */

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <ShopHeader />
        <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
          <div className="grid gap-8 lg:grid-cols-2">
            <Skeleton className="aspect-square rounded-2xl" />
            <div className="space-y-4"><Skeleton className="h-8 w-2/3" /><Skeleton className="h-6 w-1/3" /><Skeleton className="h-24 w-full" /><Skeleton className="h-12 w-full" /></div>
          </div>
        </main>
      </div>
    );
  }

  /* ── Not found ──────────────────────────────────────────────────── */

  if (!product) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <ShopHeader />
        <main className="mx-auto flex w-full max-w-6xl flex-col items-center px-4 py-24 text-center sm:px-6">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100"><ImageOff className="size-7 text-slate-400" /></span>
          <h1 className="mt-5 text-xl font-bold text-slate-900">{t("productDetail.notFound")}</h1>
          <p className="mt-2 text-sm text-slate-500">{t("productDetail.notFoundDesc")}</p>
          <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" asChild><Link to="/"><ArrowLeft className="size-4" />{t("productDetail.backToShop")}</Link></Button>
        </main>
      </div>
    );
  }

  /* ── Main render ────────────────────────────────────────────────── */

  const categoryMeta = PRODUCT_CATEGORY_META[product.category];
  const tabs: { key: TabKey; label: string }[] = [
    { key: "recommend", label: t("productDetail.tabsRecommend") },
    { key: "details", label: t("productDetail.tabsDetails") },
    { key: "reviews", label: t("productDetail.tabsReviews") },
  ];

  return (
    <div className="flex min-h-screen flex-col bg-[#F8FAFC] text-slate-900">
      <ShopHeader />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {/* Back button */}
        <button type="button" onClick={() => navigate(-1)} className="flex items-center gap-1.5 py-1 text-sm text-slate-500 transition-colors hover:text-slate-900">
          <ArrowLeft className="size-4" />{t("productDetail.back")}
        </button>

        {/* ═══════════ TOP: Gallery + Info + Purchase ═══════════ */}
        <div className="mt-5 grid gap-6 lg:grid-cols-2 lg:gap-8">
          {/* Gallery */}
          <div className="min-w-0">
            <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-white" style={{ maxWidth: "100%" }}>
              {mainImage ? (
                <img src={mainImage?.displayUrl || mainImage?.url} alt={mainImage?.alt || product.name} className="size-full object-cover" />
              ) : (
                <span className="flex size-full items-center justify-center"><ImageOff className="size-12 text-slate-300" /></span>
              )}
              <button type="button" onClick={handleWishlist} disabled={wishToggling} className={`absolute right-3 top-3 flex size-9 items-center justify-center rounded-full bg-white/90 shadow-sm backdrop-blur transition-colors ${wishlisted ? "text-rose-500" : "text-slate-400 hover:text-rose-500"}`} aria-label={t("productDetail.ariaWishlist")}>
                {wishToggling ? <Loader2 className="size-4 animate-spin" /> : <Heart className={`size-4 ${wishlisted ? "fill-rose-500" : ""}`} />}
              </button>
              <button type="button" onClick={handleShare} className="absolute right-3 top-14 flex size-9 items-center justify-center rounded-full bg-white/90 text-slate-400 shadow-sm backdrop-blur transition-colors hover:text-slate-600" aria-label={t("productDetail.share")}>
                <Share2 className="size-4" />
              </button>
            </div>
            {/* Gallery thumbnails: product images + divider + variant images */}
            {(() => {
              const allThumbs: { id: string; url: string; label?: string; onClick: () => void; isActive: boolean; isVariant?: boolean; group?: number }[] = [];
              // All gallery images in group order (from the images memo)
              images.forEach((entry: any, i: number) => {
                allThumbs.push({
                  id: `gi-${entry.img.id ?? i}`,
                  url: entry.img.thumbUrl || entry.img.displayUrl || entry.img.url,
                  onClick: () => { setActiveIndex(i); setOptionOverrideIndex(null); },
                  isActive: i === activeIndex,
                  isVariant: entry.group === 1,
                  group: entry.group,
                });
              });
              if (allThumbs.length <= 1) return null;
              return (
                <div className="mt-3 flex min-w-0 gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden" style={{ scrollbarWidth: "none" }}>
                  {allThumbs.map((thumb, i) => (
                    <span key={thumb.id} className="flex items-center gap-2">
                      {i > 0 && allThumbs[i].group !== allThumbs[i - 1].group && (
                        <span className="h-8 w-px shrink-0 bg-slate-200" />
                      )}
                      <button
                        type="button"
                        onClick={thumb.onClick}
                        className={`size-16 shrink-0 overflow-hidden rounded-[10px] border-2 transition-colors ${thumb.isActive ? "border-[#10B981]" : "border-slate-200 hover:border-slate-300"}`}
                        aria-label={thumb.label || t("productDetail.imageAlt", { n: i + 1 })}
                      >
                        <img src={thumb.url} alt="" className="size-full object-cover" loading="lazy" />
                      </button>
                    </span>
                  ))}
                </div>
              );
            })()}
          </div>

          {/* Product Info */}
          <div className="flex min-w-0 flex-col">
            <div className="flex flex-wrap items-center gap-2">
              <Badge className="rounded-full bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-600/10">{categoryMeta?.label ?? product.category}</Badge>
              {product.supplier && <Badge className="rounded-full bg-[#ECFDF5] text-emerald-700 ring-1 ring-inset ring-emerald-600/15">{product.supplier}</Badge>}
            </div>
            <div className="mt-3"><ProductTitle name={product.name} t={t} /></div>

            {/* Price + Rating */}
            <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="flex items-baseline gap-2">
                    <p className="text-3xl font-bold tabular-nums tracking-tight text-slate-900">{formatBaht(displayPrice)}</p>
                    <span className="text-sm font-normal text-slate-400">/{product.unit}</span>
                  </div>
                  {(displayCompareAt && displayCompareAt > displayPrice) || (displayDiscountPct && displayDiscountPct > 0) ? (
                    <div className="mt-1 flex items-center gap-2">
                      {displayCompareAt && displayCompareAt > displayPrice && (
                        <span className="text-sm text-slate-400 line-through">{formatBaht(displayCompareAt)}</span>
                      )}
                      <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-600">
                        -{Math.round(displayDiscountPct ?? ((displayCompareAt! - displayPrice) / displayCompareAt!) * 100)}%
                      </span>
                    </div>
                  ) : null}
                  <p className={`mt-1.5 text-xs ${outOfStock ? "font-medium text-red-500" : lowStock ? "font-medium text-amber-600" : "text-slate-400"}`}>
                    {outOfStock ? t("productDetail.outOfStockDesc") : lowStock ? t("productDetail.lowStock", { count: displayStock, unit: product.unit }) : t("productDetail.inStock", { count: displayStock, unit: product.unit })}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  {product.soldCount != null && product.soldCount > 0 && <span className="hidden text-xs text-slate-400 sm:inline">{t("productDetail.sold", { count: product.soldCount })}</span>}
                  {reviews.length > 0 && (
                    <div className="flex items-center gap-1 text-sm">
                      <Star className="size-4 fill-amber-400 text-amber-400" />
                      <span className="font-semibold tabular-nums text-slate-900">{avgRating?.toFixed(1)}</span>
                      <span className="text-xs text-slate-400">({reviews.length})</span>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* ═══════════ COMPACT VARIANT SELECTOR ═══════════ */}
            {hasOptionGroups && (
              <button
                type="button"
                onClick={() => openVariantSheet(null)}
                className="mt-3 flex w-full items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-left transition-colors hover:border-slate-300"
                aria-label={t("productDetail.selectOptions")}
              >
                <span className="text-xs font-semibold text-slate-700">{t("productDetail.options")}</span>
                <div className="flex flex-1 items-center gap-1.5 overflow-hidden">
                  {compactThumbnails.map((thumb: { id: string; label: string; imageUrl: string | null; groupId: string; selected: boolean }) => (
                    <span
                      key={thumb.id}                        className={`size-10 shrink-0 overflow-hidden rounded-lg border transition-colors ${thumb.selected ? "border-[#10B981] ring-1 ring-[#10B981]/30" : "border-slate-200"}`}
                    >
                      {thumb.imageUrl ? (
                        <img src={thumb.imageUrl} alt={thumb.label} className="size-full object-cover" />
                      ) : (
                        <span className="flex size-full items-center justify-center text-[10px] font-medium text-slate-600">{thumb.label}</span>
                      )}
                    </span>
                  ))}
                  {totalOptionValues > 5 && (
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-slate-50 text-xs font-medium text-slate-500">
                      +{totalOptionValues - 5}
                    </span>
                  )}
                </div>
                <ChevronRight className="size-4 shrink-0 text-slate-300" />
              </button>
            )}

            {/* ═══════════ SELECTED VARIANT SUMMARY ═══════════ */}
            {selectedSummary && (
              <div className="mt-2 rounded-xl bg-[#ECFDF5] px-3 py-2 text-xs font-medium text-[#047857]">
                {selectedSummary}
              </div>
            )}

            {/* Shipping */}
            <div className="mt-3 rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
              <div className="flex items-center gap-2"><span className="text-slate-400">{t("productDetail.shippingFrom")}</span><span className="font-medium text-slate-900">{t("productDetail.thailand")}</span></div>
            </div>

            {/* ═══════════ STICKY BOTTOM ACTION BAR ═══════════ */}
            <div className="sticky bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-40 -mx-4 mt-4 border-t border-slate-200 bg-white/95 px-4 py-3 pb-4 backdrop-blur md:static md:mx-0 md:mt-4 md:border-0 md:bg-transparent md:p-0 md:pb-0 md:backdrop-blur-none">
              {needsVariant && (
                <p className="mb-2 text-center text-sm text-slate-400">{t("productDetail.selectOptions")}</p>
              )}
              <div className="flex gap-2">
                <Button
                  ref={addBtnRef}
                  className={`flex-1 gap-1.5 ${ACTION_BUTTON_CLASSES.buy}`}
                  onClick={handleBuyNow}
                  disabled={outOfStock && !needsVariant}
                >
                  <Zap className="size-4" />
                  {t("productDetail.buyNow")}
                </Button>
                <Button
                  className={`flex-1 gap-1.5 ${ACTION_BUTTON_CLASSES.cart}`}
                  onClick={handleAddToCart}
                  disabled={outOfStock && !needsVariant}
                >
                  <ShoppingCart className="size-4" />
                  <span className="hidden sm:inline">{t("productDetail.addToCart")}</span>
                  <span className="sm:hidden">{t("productDetail.addToCartSm")}</span>
                </Button>
              </div>
              {velrepeatAvailable && (
                <Button
                  className={`mt-2 w-full gap-1.5 ${ACTION_BUTTON_CLASSES.velrepeat}`}
                  onClick={handleVelRepeat}
                >
                  <CalendarClock className="size-4" />
                  VelRepeat
                </Button>
              )}
            </div>
          </div>
        </div>

        {/* ═══════════ TABS ═══════════ */}
        <section className="mt-8">
          <div className="flex border-b border-slate-200">
            {tabs.map((tab) => (
              <button key={tab.key} type="button" onClick={() => setActiveTab(tab.key)} className={`flex-1 px-4 py-3 text-center text-sm font-semibold transition-colors ${activeTab === tab.key ? "border-b-2 border-[#10B981] text-slate-900" : "text-slate-400 hover:text-slate-600"}`}>
                {tab.label}
                {tab.key === "reviews" && reviews.length > 0 && <span className="ml-1.5 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-slate-500">{reviews.length}</span>}
              </button>
            ))}
          </div>
          <div className="mt-6">
            {/* Tab: Recommend */}
            {activeTab === "recommend" && (
              <div className="space-y-8">
                <ProductCarousel title={t("productDetail.recommendedProducts")} products={recommended} emptyText={t("productDetail.noRecommendedProducts")} t={t} />
                <ProductCarousel title={t("productDetail.similarProducts")} products={similar} emptyText={t("productDetail.noSimilarProducts")} t={t} />
                {recommended.length === 0 && similar.length === 0 && (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center"><p className="text-sm font-medium text-slate-500">{t("productDetail.noRecommendedProducts")}</p></div>
                )}
              </div>
            )}

            {/* Tab: Details */}
            {activeTab === "details" && (
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <h3 className="mb-3 text-base font-bold text-slate-900">{t("productDetail.detailsTabTitle")}</h3>
                <ExpandableDescription text={product.description ?? ""} t={t} />
                <div className="mt-5 grid grid-cols-2 gap-3 border-t border-slate-100 pt-5 text-sm">
                  <div><span className="text-slate-400">{t("productDetail.name")}</span><p className="mt-0.5 font-medium text-slate-900">{product.name}</p></div>
                  <div><span className="text-slate-400">{t("productDetail.shippingFrom")}</span><p className="mt-0.5 font-medium text-slate-900">{t("productDetail.thailand")}</p></div>
                  <div><span className="text-slate-400">{t("productDetail.category")}</span><p className="mt-0.5 font-medium text-slate-900">{categoryMeta?.label ?? product.category}</p></div>
                  {product.supplier && <div><span className="text-slate-400">{t("productDetail.supplier")}</span><p className="mt-0.5 font-medium text-slate-900">{product.supplier}</p></div>}
                </div>
              </div>
            )}

            {/* Tab: Reviews */}
            {activeTab === "reviews" && (
              <div className="space-y-5">
                {reviews.length > 0 && <div className="rounded-2xl border border-slate-200 bg-white p-5"><RatingDistribution reviews={reviews} t={t} /></div>}
                {reviews.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-12 text-center">
                    <Star className="mx-auto size-7 text-slate-300" />
                    <p className="mt-3 text-sm font-medium text-slate-600">{t("productDetail.noReviews")}</p>
                    <p className="mt-1 text-xs text-slate-400">{t("productDetail.noReviewsDesc")}</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {displayedReviews.map((r) => (
                      <div key={r.id} className="rounded-xl border border-slate-200 bg-white p-4">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-1">
                            {Array.from({ length: 5 }).map((_, i) => (
                              <Star key={i} className={`size-3.5 ${i < r.rating ? "fill-amber-400 text-amber-400" : "text-slate-200"}`} />
                            ))}
                          </div>
                          <span className="text-[11px] text-slate-400">{formatIsoDate(r.createdAt)}</span>
                        </div>
                        {r.title && <p className="mt-2 text-sm font-semibold text-slate-900">{r.title}</p>}
                        {r.comment && <p className="mt-1 text-sm leading-6 text-slate-600">{r.comment}</p>}
                        <p className="mt-2 text-[11px] text-slate-400">{r.customerName ?? t("productDetail.customer")} · {r.orderId ? t("productDetail.verifiedPurchase") : ""}</p>
                      </div>
                    ))}
                    {reviews.length > 5 && (
                      <button type="button" onClick={() => setReviewsExpanded((v) => !v)} className="mx-auto flex items-center gap-1 text-sm font-medium text-[#10B981] transition-colors hover:text-[#059669]">
                        {reviewsExpanded ? t("productDetail.hideReviews") : t("productDetail.seeAllReviews")}
                        {reviewsExpanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>

        {/* ═══════════ SHOP SECTION ═══════════ */}
        <section className="mt-8">
          <Link to={`/shops/${product.shopId}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 transition-colors hover:border-slate-300">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold text-slate-900">{product.shopName ?? t("productDetail.defaultShop")}</p>
              <p className="mt-0.5 text-xs text-slate-400">{t("productDetail.viewShop")}</p>
            </div>
            <ArrowLeft className="size-4 rotate-180 text-slate-300" />
          </Link>
        </section>
      </main>

      {/* ═══════════ VARIANT BOTTOM SHEET ═══════════ */}
      <Sheet open={variantSheetOpen} onOpenChange={(o) => { setVariantSheetOpen(o); if (!o) setPendingAction(null); }}>
        <SheetContent side="bottom" className="max-h-[85dvh] rounded-t-2xl border-t border-slate-200 p-0" onOpenAutoFocus={(e) => e.preventDefault()}>
          <SheetTitle className="sr-only">{t("productDetail.options")}</SheetTitle>
          <SheetDescription className="sr-only">{product.name}</SheetDescription>

          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1">
            <div className="h-1 w-10 rounded-full bg-slate-300" />
          </div>

          <div className="flex-1 overflow-y-auto px-4 pb-4 sm:px-6">
            {/* Product header — larger preview */}
            <div className="flex gap-4 pt-2">
              <div className="h-[180px] w-[180px] shrink-0 overflow-hidden rounded-xl border border-slate-200 bg-slate-50 sm:h-[220px] sm:w-[220px]">
                {mainImage ? (
                  <img src={mainImage?.displayUrl || mainImage?.url} alt={mainImage?.alt || product.name} className="size-full object-contain" />
                ) : (
                  <span className="flex size-full items-center justify-center"><ImageOff className="size-8 text-slate-300" /></span>
                )}
              </div>
              <div className="min-w-0 flex-1">
                {/* Selected summary */}
                {selectedSummary && (
                  <p className="mb-1 text-xs font-medium text-[#047857]">{selectedSummary}</p>
                )}
                <div className="flex items-baseline gap-2">
                  <p className="text-2xl font-bold tabular-nums text-slate-900">{formatBaht(displayPrice)}</p>
                  <span className="text-xs font-normal text-slate-400">/{product.unit}</span>
                </div>
                {displayCompareAt && displayCompareAt > displayPrice && (
                  <div className="mt-1 flex items-center gap-2">
                    <span className="text-sm text-slate-400 line-through">{formatBaht(displayCompareAt)}</span>
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-600">-{Math.round(((displayCompareAt - displayPrice) / displayCompareAt) * 100)}%</span>
                  </div>
                )}
                {!displayCompareAt && displayDiscountPct && displayDiscountPct > 0 && (
                  <div className="mt-1">
                    <span className="rounded bg-red-50 px-1.5 py-0.5 text-xs font-semibold text-red-600">-{Math.round(displayDiscountPct)}%</span>
                  </div>
                )}
                <p className={`mt-2 text-xs ${outOfStock ? "font-medium text-red-500" : displayStock <= 5 ? "font-medium text-amber-600" : "text-slate-400"}`}>
                  {outOfStock ? t("product.outOfStock") : displayStock <= 5 ? t("product.lowStock", { count: displayStock, unit: product.unit }) : t("product.inStockShort")}
                </p>
              </div>
            </div>

            {/* Product name (expandable) */}
            <div className="mt-3 min-w-0 overflow-hidden">
              <p className="text-sm font-semibold leading-5 text-slate-900" style={{ overflowWrap: "anywhere" }}>
                {product.name}
              </p>
            </div>

            {/* Option groups with thumbnails */}
            {hasOptionGroups && (
              <div className="mt-4 space-y-4 border-t border-slate-100 pt-4">
                {optionGroups.map((group: any) => (
                  <div key={group.id}>
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-semibold text-slate-700">
                        {group.name}
                        {group.required && <span className="ml-1 text-red-400">*</span>}
                      </p>
                      {group === optionGroups[0] && (
                        <button
                          type="button"
                          onClick={() => setCompactSheet((c) => !c)}
                          className="flex size-7 items-center justify-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
                          aria-label={compactSheet ? t("productDetail.expandOptions") : t("productDetail.collapseOptions")}
                        >
                          {compactSheet ? <Maximize2 className="size-3.5" /> : <Minimize2 className="size-3.5" />}
                        </button>
                      )}
                    </div>
                    <div className={`mt-2 flex flex-wrap ${compactSheet ? "gap-2" : "gap-3"}`}>
                      {(Array.isArray(group.values) ? group.values : []).map((val: any) => {
                        const isSelected = selectedOptions[group.id] === val.id;
                        // Check in-stock availability using real variant combinations
                        const pVariants = (product as any)?.variants as Array<Record<string, any>> | undefined;
                        const vOptsMap = (product as any)?.variantOptions as Record<string, Record<string, string>> | undefined;
                        let valueInStock = true;
                        let valueStock = 0;
                        if (pVariants && vOptsMap) {
                          // Build candidate options: current selection + this candidate value
                          const candidateOptions = { ...selectedOptions, [group.id]: val.id };
                          for (const v of pVariants) {
                            const vOpts = vOptsMap[v.id];
                            if (!vOpts) continue;
                            const matches = Object.entries(candidateOptions).every(([gId, vId]) => {
                              if (!vId) return true;
                              return vOpts[gId] === vId;
                            });
                            if (matches && (v.stock ?? 0) > 0) {
                              valueStock += Number(v.stock);
                              valueInStock = true;
                            }
                          }
                        }
                        const isImageGroup = group.displayType === "image";
                        const valStockLabel = !valueInStock ? (
                          <span className={`${compactSheet ? "text-[9px]" : "text-[10px]"} text-red-400`}>{t("productDetail.stockOut")}</span>
                        ) : valueStock > 0 ? (
                          <span className={`${compactSheet ? "text-[9px]" : "text-[10px]"} ${valueStock <= 5 ? "text-amber-600" : "text-slate-400"}`}>
                            {valueStock <= 5 ? t("productDetail.stockLeft", { count: valueStock }) : t("productDetail.stockPieces", { count: valueStock })}
                          </span>
                        ) : null;

                        if (isImageGroup) {
                          // IMAGE option: image + text card layout
                          return (
                            <button
                              key={val.id}
                              type="button"
                              disabled={!valueInStock}
                              onClick={() => handleOptionSelect(group.id, val.id)}
                              className={`${compactSheet ? "w-[88px] min-h-[96px] p-1.5" : "w-[112px] min-h-[128px] p-2"} flex flex-col items-center justify-center gap-1.5 rounded-xl border transition-colors ${
                                isSelected
                                  ? "border-[#10B981] bg-[#ECFDF5] ring-1 ring-[#10B981]/30"
                                  : valueInStock
                                    ? "border-slate-200 bg-white hover:border-slate-300 active:bg-slate-50"
                                    : "border-slate-100 bg-slate-50 opacity-40"
                              }`}
                              aria-label={`${val.label || val.value}${!valueInStock ? " - หมด" : ""}`}
                            >
                              {val.imageUrl || optionValueImageMap[val.id] ? (
                                <img src={val.imageUrl || optionValueImageMap[val.id]} alt="" className={`${compactSheet ? "size-14" : "size-[72px]"} rounded-lg object-contain bg-slate-50`} loading="lazy" />
                              ) : (
                                <span className={`${compactSheet ? "size-14 text-[10px]" : "size-[72px] text-sm"} flex items-center justify-center rounded-lg bg-slate-100 font-semibold text-slate-500`}>
                                  {(val.label || val.value).slice(0, 3)}
                                </span>
                              )}
                              <span className={`max-w-full truncate ${compactSheet ? "text-[10px]" : "text-xs"} font-medium ${isSelected ? "text-[#10B981]" : valueInStock ? "text-slate-700" : "text-slate-400 line-through"}`}>
                                {val.label || val.value}
                              </span>
                              {valStockLabel}
                            </button>
                          );
                        }

                        // TEXT option: compact pill/chip — no image, no placeholder
                        return (
                          <button
                            key={val.id}
                            type="button"
                            disabled={!valueInStock}
                            onClick={() => handleOptionSelect(group.id, val.id)}
                            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 ${compactSheet ? "text-[10px]" : "text-xs"} font-medium transition-colors ${
                              isSelected
                                ? "border-[#10B981] bg-[#ECFDF5] text-[#10B981] ring-1 ring-[#10B981]/30"
                                : valueInStock
                                  ? "border-slate-200 bg-white text-slate-700 hover:border-slate-300 active:bg-slate-50"
                                  : "border-slate-100 bg-slate-50 text-slate-400 opacity-50"
                            }`}
                            aria-label={`${val.label || val.value}${!valueInStock ? " - หมด" : ""}`}
                          >
                            <span className="truncate">{val.label || val.value}</span>
                            {valStockLabel}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Quantity selector */}
            {!outOfStock && (
              <div className="mt-4 border-t border-slate-100 pt-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-700">{t("cartDrawer.quantity")}</p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setSheetQty((q) => Math.max(1, q - 1))}
                      disabled={sheetQty <= 1}
                      className="flex size-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-40"
                      aria-label={t("cartDrawer.ariaDecrease")}
                    >
                      <Minus className="size-3.5" />
                    </button>
                    <span className="w-8 text-center text-sm font-semibold tabular-nums text-slate-900">{sheetQty}</span>
                    <button
                      type="button"
                      onClick={() => setSheetQty((q) => Math.min(displayStock, q + 1))}
                      disabled={sheetQty >= displayStock}
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

          {/* Sticky confirm area — one action per entry mode; all three in “options” mode */}
          <div className="border-t border-slate-200 px-4 py-3 sm:px-6 sm:py-4">
            {outOfStock ? (
              <Button className="w-full bg-slate-100 text-slate-400" disabled>{t("product.outOfStock")}</Button>
            ) : pendingAction === null ? (
              /* ── Options mode: show all 3 action buttons ── */
              <div className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Button
                    className={`flex-1 gap-1.5 ${ACTION_BUTTON_CLASSES.buy}`}
                    onClick={() => handleSheetAction("buy")}
                  >
                    <Zap className="size-4" />
                    {t("productDetail.buyNow")}
                  </Button>
                  <Button
                    className={`flex-1 gap-1.5 ${ACTION_BUTTON_CLASSES.cart}`}
                    onClick={() => handleSheetAction("cart")}
                  >
                    <ShoppingCart className="size-4" />
                    {t("productDetail.addToCart")}
                  </Button>
                </div>
                {velrepeatAvailable && (
                  <Button
                    className={`w-full gap-1.5 ${ACTION_BUTTON_CLASSES.velrepeat}`}
                    onClick={() => handleSheetAction("velrepeat")}
                  >
                    <CalendarClock className="size-4" />
                    VelRepeat
                  </Button>
                )}
              </div>
            ) : (
              /* ── Direct mode: show single action button ── */

              <Button
                className={`w-full gap-1.5 ${ACTION_BUTTON_CLASSES[pendingAction]}`}
                onClick={() => handleSheetConfirm()}
              >
                {pendingAction === "buy" ? (
                  <><Zap className="size-4" />{t("productDetail.buyNow")} · {formatBaht(displayPrice * sheetQty)}</>
                ) : pendingAction === "velrepeat" ? (
                  <>
                    <CalendarClock className="size-4" />
                    VelRepeat · {formatBaht(displayPrice * sheetQty)}
                  </>
                ) : (
                  <>
                    <ShoppingCart className="size-4" />
                    {t("productDetail.addToCartWithTotal", { total: formatBaht(displayPrice * sheetQty) })}
                  </>
                )}
              </Button>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ShopFooter />
      <SubscriptionDialog product={product} open={subOpen} onOpenChange={setSubOpen} selectedVariant={selectedVariant ? { id: selectedVariant.id, name: selectedVariant.name, price: selectedVariant.price, sku: selectedVariant.sku } : null} />
    </div>
  );
}
