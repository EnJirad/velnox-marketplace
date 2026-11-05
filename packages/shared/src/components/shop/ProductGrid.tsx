import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ProductCard } from "@/components/shop/ProductCard";
import { SectionHeader } from "@velnox/shared/components/ui/section-header";
import { ProductGridSkeleton } from "@velnox/shared/components/ui/loading-skeleton";
import { EmptyState } from "@velnox/shared/components/ui/empty-state";
import { useLanguage } from "@/lib/i18n";
import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import { type StoreProduct, type StoreProductCategory } from "@velnox/shared/lib/commerce";
import { Search, ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";

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
  /** Verified sellers only */
  verifiedOnly?: boolean;
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
  verifiedOnly = false,
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
}: ProductGridProps) {
  const { t } = useLanguage();
  const catalog = useAction(api.commerce.catalogProductsAction);

  const [products, setProducts] = useState<StoreProduct[]>(initialProducts);
  const [loading, setLoading] = useState(initialProducts.length === 0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [meta, setMeta] = useState({ total: initialMeta.total, hasMore: initialMeta.hasMore, cursor: initialMeta.cursor });
  const offsetRef = useRef(0);

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
    if (verifiedOnly) params.verified = "true";
    return params;
  }, [category, query, sortBy, shopId, minPrice, maxPrice, inStock, verifiedOnly, pageSize]);

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

  return (
    <section className="border-b border-slate-100 bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
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
              <div className="mt-6 text-center">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={loadingMore}
                  className="inline-flex items-center gap-2 px-6 py-3 text-sm font-medium text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 disabled:opacity-50 transition-colors"
                >
                  {loadingMore ? (
                    <>
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" /></svg>
                      {t("common.loading") ?? "Loading..."}
                    </>
                  ) : (
                    <>
                      {t("common.loadMore") ?? "Load more"}
                      <ChevronRight className="size-4" />
                    </>
                  )}
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
