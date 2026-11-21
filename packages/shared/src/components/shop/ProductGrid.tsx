import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProductCard } from "@/components/shop/ProductCard";
import { SectionHeader } from "@velnox/shared/components/ui/section-header";
import { ProductGridSkeleton } from "@velnox/shared/components/ui/loading-skeleton";
import { EmptyState } from "@velnox/shared/components/ui/empty-state";
import { useLanguage } from "@/lib/i18n";
import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import { type StoreProduct, type StoreProductCategory } from "@velnox/shared/lib/commerce";
import { Search, ChevronLeft, ChevronRight, ArrowDown, Loader2, type LucideIcon } from "lucide-react";

interface ProductGridProps {
  /** Initial products (optional — if provided, skips first fetch) */
  initialProducts?: StoreProduct[];
  /** Initial pagination meta */
  initialMeta?: { total: number; hasMore: boolean; cursor?: string };
  /** Category filter */
  category?: StoreProductCategory | "all";
  /** Search query */
  query?: string;
  /** Sort option */
  sortBy?: string;
  /** Shop filter */
  shopId?: string;
  /** Price range */
  minPrice?: string;
  maxPrice?: string;
  /** In stock only */
  inStock?: boolean;
  /** Minimum star rating (e.g. 4 for "4★ & up") */
  minRating?: string;
  /** Only products with a real discount (compare_at_price > price) */
  onSale?: boolean;
  /** Section title (for SectionHeader) */
  title: string;
  /** Section description */
  description?: string;
  /** View all link */
  viewAllHref?: string;
  /** View all label */
  viewAllLabel?: string;
  /** Section icon */
  icon?: LucideIcon;
  /** Callback when product is clicked */
  onProductClick?: (product: StoreProduct) => void;
  /** Callback when Add to Cart is clicked */
  onAddToCart?: (product: StoreProduct) => void;
  /** Wishlist IDs for highlighting */
  wishlistIds?: Set<string>;
  /** Wishlist toggle handler */
  onWishlistToggle?: (product: StoreProduct) => void;
  /** Currently toggling wishlist ID */
  wishTogglingId?: string | null;
  /** Badge label (e.g., "Recommended") */
  badgeLabel?: string;
  /** CSS class for the grid container */
  gridClassName?: string;
  /** Show SectionHeader */
  showHeader?: boolean;
  /** Page size */
  pageSize?: number;
  /** When true, do not wrap in a full section container with duplicate padding */
  embedded?: boolean;
}

const DEFAULT_PAGE_SIZE = 24;

export function ProductGrid({
  initialProducts = [],
  initialMeta = { total: 0, hasMore: false },
  category = "all",
  query = "",
  sortBy = "newest",
  shopId = "",
  minPrice = "",
  maxPrice = "",
  inStock = false,
  minRating = "",
  onSale = false,
  title,
  description,
  viewAllHref,
  viewAllLabel,
  icon,
  onProductClick,
  onAddToCart,
  wishlistIds = new Set(),
  onWishlistToggle,
  wishTogglingId,
  badgeLabel,
  gridClassName,
  showHeader = true,
  pageSize = DEFAULT_PAGE_SIZE,
  embedded = false,
}: ProductGridProps) {
  const { t } = useLanguage();
  const catalog = useAction(api.commerce.catalogProductsAction);

  const [products, setProducts] = useState<StoreProduct[]>(initialProducts);
  const [loading, setLoading] = useState(initialProducts.length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState({ total: initialMeta.total, hasMore: initialMeta.hasMore, cursor: initialMeta.cursor });
  const offsetRef = useRef(initialProducts.length > 0 ? initialProducts.length : 0);
  const isFirstMount = useRef(true);

  const buildParams = useCallback(() => {
    const params: Record<string, string> = {
      status: "published",
      limit: String(pageSize),
      offset: String(offsetRef.current),
      sort: sortBy,
    };
    if (category !== "all") params.category = category;
    if (query) params.q = query;
    if (shopId) params.shop = shopId;
    if (minPrice) params.min = minPrice;
    if (maxPrice) params.max = maxPrice;
    if (inStock) params.inStock = "1";
    if (minRating) params.minRating = minRating;
    if (onSale) params.onSale = "true";
    return params;
  }, [category, query, sortBy, shopId, minPrice, maxPrice, inStock, minRating, onSale, pageSize]);

  const load = useCallback(async (reset = false) => {
    if (reset) {
      setLoading(true);
      offsetRef.current = 0;
    } else {
      setLoadingMore(true);
    }
    setError(null);

    try {
      const params = buildParams();
      const raw = await catalog(params);
      const resultItems = Array.isArray(raw) ? raw : (raw as { items: StoreProduct[] }).items;
      
      if (reset) {
        setProducts(resultItems);
      } else {
        setProducts((prev) => [...prev, ...resultItems]);
      }
      
      const hasMore = resultItems.length >= pageSize;
      offsetRef.current += pageSize;
      
      setMeta({
        total: meta.total + resultItems.length,
        hasMore,
        cursor: "",
      });
    } catch (err) {
      console.error("ProductGrid load error:", err);
      setError(err instanceof Error ? err.message : "Failed to load products");
      if (reset) setProducts([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [catalog, buildParams]);

  // Load on mount and when filters change
  useEffect(() => {
    if (isFirstMount.current) {
      isFirstMount.current = false;
      if (initialProducts.length > 0) return;
    }
    load(true);
  }, [load]);

  const handleLoadMore = useCallback(() => {
    if (!meta.hasMore || loadingMore) return;
    load(false);
  }, [load, meta.hasMore, loadingMore]);

  const renderProduct = useCallback((product: StoreProduct) => (
    <ProductCard
      key={product.id}
      product={product}
      onOpen={onProductClick}
      onAdd={onAddToCart}
      wishlisted={wishlistIds.has(product.id)}
      onWishlist={onWishlistToggle}
      wishToggling={wishTogglingId === product.id}
      badgeLabel={badgeLabel}
    />
  ), [onProductClick, onAddToCart, wishlistIds, onWishlistToggle, wishTogglingId, badgeLabel]);

  const content = (
    <>
      {showHeader && (
        <SectionHeader
          icon={icon}
          title={title}
          description={description}
          viewAllHref={viewAllHref}
          viewAllLabel={viewAllLabel}
        />
      )}
      {loading ? (
        <ProductGridSkeleton count={8} />
      ) : error ? (
        <EmptyState
          icon={Search}
          title={t("products.errorTitle") ?? "Failed to load products"}
          description={error}
          action={{
            label: t("common.retry") ?? "Retry",
            onClick: () => load(true),
            variant: "outline",
          }}
          size="lg"
        />
      ) : products.length === 0 ? (
        <EmptyState
          icon={Search}
          title={t("products.noResultsTitle") ?? "No products found"}
          description={t("products.noResultsDesc") ?? "Try adjusting your filters or search terms"}
          size="lg"
        />
      ) : (
        <>
          <div className={gridClassName ?? "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"}>
            {products.map(renderProduct)}
          </div>
          {meta.hasMore && (
            <div className="mt-8 text-center">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="inline-flex items-center gap-2 rounded-squircle border border-slate-200 bg-white px-6 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-colors hover:border-slate-300 hover:bg-slate-50 disabled:opacity-50"
              >
                {loadingMore ? (
                  <>
                    <Loader2 className="size-4 animate-spin text-brand" />
                    <span>{t("common.loading") ?? "Loading..."}</span>
                  </>
                ) : (
                  <>
                    <span>{t("common.loadMore") ?? "Load more"}</span>
                    <ArrowDown className="size-4 text-slate-400" />
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </>
  );

  if (embedded) {
    return <div className="w-full">{content}</div>;
  }

  return (
    <section className="border-b border-slate-100 bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        {content}
      </div>
    </section>
  );
}
