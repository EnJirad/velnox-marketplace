import { ProductCard } from "@/components/shop/ProductCard";
import { AnnouncementCarousel, type Announcement } from "@/components/shop/AnnouncementCarousel";
import { CategoryStrip } from "@/components/shop/CategoryStrip";
import { TopBanner } from "@/components/shop/TopBanner";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useCart } from "@/lib/cart";
import { useLanguage } from "@/lib/i18n";
import {
  PRODUCT_CATEGORY_META,
  type StoreProduct,
  type StoreProductCategory,
} from "@velnox/shared/lib/commerce";
import { setSeo } from "@/lib/seo";
import { useTracking } from "@velnox/shared/lib/track";
import {
  Armchair,
  Baby,
  BookOpen,
  Briefcase,
  Car,
  Cpu,
  Dumbbell,
  Fish,
  Flower2,
  Footprints,
  Gamepad2,
  Gem,
  Headphones,
  Heart,
  Home,
  Laptop,
  Map as MapIcon,
  Shirt,
  Wrench,
  MapPin,
  Monitor,
  Package,
  PackageOpen,
  PawPrint,
  PenTool,
  RefreshCw,
  ShoppingBag,
  ShoppingBasket,
  Smartphone,
  Sparkles,
  Stamp,
  Sprout,
  Star,
  TrendingUp,
  Truck,
  UtensilsCrossed,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import { toast } from "sonner";
import { apiBaseUrl as API_BASE } from "@velnox/shared/lib/sites";
import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import { ProductGridSkeleton } from "@velnox/shared/components/ui/loading-skeleton";
import { EmptyState } from "@velnox/shared/components/ui/empty-state";
import { HorizontalRail, RailCard } from "@/components/shop/HorizontalRail";
import { ProductGrid } from "@velnox/shared/components/shop/ProductGrid";

const CATEGORY_ICONS: Partial<Record<StoreProductCategory, LucideIcon>> = {
  general: Package,
  food: UtensilsCrossed,
  "food-beverage": UtensilsCrossed,
  daily: ShoppingBasket,
  "grocery-household": ShoppingBasket,
  beauty: Sparkles,
  "beauty-personal-care": Sparkles,
  "health-wellness": Heart,
  fashion: Shirt,
  "shoes-bags": Footprints,
  "jewelry-accessories": Gem,
  electronics: Cpu,
  "phones-accessories": Smartphone,
  "computers-accessories": Monitor,
  "home-appliances": Home,
  "home-living": Home,
  furniture: Armchair,
  "garden-outdoor": Flower2,
  "baby-kids": Baby,
  "toys-games": Gamepad2,
  pets: PawPrint,
  "sports-outdoors": Dumbbell,
  automotive: Car,
  "tools-hardware": Wrench,
  "stationery-office": PenTool,
  "business-equipment": Briefcase,
  packaging: PackageOpen,
  "books-media": BookOpen,
  "hobbies-collectibles": Stamp,
  agriculture: Sprout,
  "local-products": MapPin,
  services: Headphones,
  other: Package,
};

/** Local fetch helper that unwraps the {success, data} envelope. */
async function apiGet<T>(path: string): Promise<T> {
  const p = path.startsWith("/api") ? path.slice(4) : path;
  const res = await fetch(`${API_BASE}${p}`, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  return (json.data !== undefined ? json.data : json) as T;
}

function useCommerceData<T>(load: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [version, setVersion] = useState(0);
  const loadRef = useRef(load);
  loadRef.current = load;
  useEffect(() => {
    let alive = true;
    loadRef.current()
      .then((d) => alive && setData(d))
      .catch(() => alive && setData(null))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [version]);
  const reload = useCallback(() => { setLoading(true); setVersion((v) => v + 1); }, []);
  return { data, loading, reload };
}

export default function ShopHome() {
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { t, lang } = useLanguage();
  const { track } = useTracking();
  const navigate = useNavigate();
  const { add } = useCart();

  const productsData = useCommerceData(
    useCallback(() => apiGet<any[]>("/api/products/catalog?status=published&limit=100"), []),
  );

  const toggleWishlist = useAction(api.customer.toggleWishlistAction);
  const myWishlist = useAction(api.customer.myWishlist);
  const categoryTree = useAction(api.customer.categoryTreeAction);
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  const [wishTogglingId, setWishTogglingId] = useState<string | null>(null);

  // Localized category name map (slug → display_name)
  const [catNameMap, setCatNameMap] = useState<Map<string, string>>(new Map());
  // Real category icons set via VelCenter: either an uploaded image URL
  // (categories.icon = R2 URL) or a Lucide icon name. Keep the raw value so the
  // shared CategoryIcon can resolve URLs vs names consistently.
  const [catIconMap, setCatIconMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    categoryTree({ lang }).then((tree: any[]) => {
      if (!alive || !Array.isArray(tree)) return;
      const m = new Map<string, string>();
      const im = new Map<string, string>();
      const walk = (nodes: any[]) => {
        for (const n of nodes) {
          if (n.slug) m.set(n.slug, n.display_name ?? n.name);
          if (n.slug && typeof n.icon === "string" && n.icon.trim()) {
            im.set(n.slug, n.icon.trim());
          }
          if (n.slug && typeof n.image_url === "string" && n.image_url.trim()) {
            im.set(n.slug, n.image_url.trim());
          }
          if (n.children?.length) walk(n.children);
        }
      };
      walk(tree);
      setCatNameMap(m);
      setCatIconMap(im);
    }).catch(() => {});
    return () => { alive = false; };
  }, [categoryTree, lang]);

  // Load wishlist on mount if authenticated
  useEffect(() => {
    if (!isAuthenticated) return;
    let alive = true;
    myWishlist()
      .then((wl: any[]) => { if (alive) setWishlistIds(new Set((wl ?? []).map((i: any) => i.productId))); })
      .catch(() => {});
    return () => { alive = false; };
  }, [isAuthenticated, myWishlist]);

  const products = useMemo(() => productsData.data ?? [], [productsData.data]);

  const popularCategories = useMemo(() => {
    const counts = new globalThis.Map<string, number>();
    for (const p of products) { counts.set(p.category, (counts.get(p.category) ?? 0) + 1); }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [products]);

  const popularProducts = useMemo(
    () => [...products].sort((a, b) => (b.soldCount ?? 0) - (a.soldCount ?? 0) || b.createdAt - a.createdAt).slice(0, 8),
    [products],
  );

  // Owner-managed banners (VelCenter → Marketing) come from
  // GET /api/announcements. With none published, the storefront falls back to
  // honest platform facts it already has — never a fabricated campaign.
  const announcementsData = useCommerceData(
    useCallback(async () => {
      try {
        return await apiGet<any[]>("/api/announcements");
      } catch {
        return [];
      }
    }, []),
  );

  const announcements = useMemo<Announcement[]>(() => {
    const remote = (announcementsData.data ?? []) as any[];
    const published: Announcement[] = remote
      // home_hero placement (the v1 default) drives the carousel
      .filter((row) => row && (row.placement ?? "home_hero") === "home_hero")
      .map((row): Announcement | null => {
        const title = typeof row.title === "string" ? row.title.trim() : "";
        const subtitle = typeof row.subtitle === "string" ? row.subtitle.trim() : "";
        const imageUrl = typeof row.imageUrl === "string" && row.imageUrl ? row.imageUrl : null;
        // An empty banner never renders — the backend also rejects it on save.
        if (!title && !subtitle && !imageUrl) return null;
        const typeKey =
          row.type === "promotion" ? "marketing.typePromotion" : row.type === "ad" ? "marketing.typeAd" : "marketing.typeAnnouncement";
        return {
          id: String(row.id ?? title ?? imageUrl),
          // The type eyebrow only sits above text — an image-only slide stays clean.
          eyebrow: title || subtitle ? t(typeKey) : "",
          title,
          subtitle,
          href: typeof row.ctaUrl === "string" && row.ctaUrl ? row.ctaUrl : undefined,
          ctaLabel: typeof row.ctaLabel === "string" && row.ctaLabel ? row.ctaLabel : null,
          imageUrl,
        };
      })
      .filter((item): item is Announcement => item !== null);
    if (published.length > 0) return published;

    const fallback: Announcement[] = [
      {
        id: "welcome",
        eyebrow: t("announce.eyebrow"),
        title: t("announce.welcomeTitle"),
        subtitle: t("announce.welcomeDesc"),
      },
    ];
    if (products.length > 0) {
      fallback.push({
        id: "catalogue",
        eyebrow: t("announce.eyebrow"),
        title: t("announce.catalogueTitle"),
        subtitle: t("announce.catalogueDesc", { count: products.length }),
        href: "/products",
      });
    }
    return fallback;
  }, [announcementsData.data, products, t]);

  const handleCategory = (id: StoreProductCategory) => {
    track("CATEGORY_VIEW", { entityId: id, value: id, context: { label: catNameMap.get(id) ?? PRODUCT_CATEGORY_META[id]?.label ?? id } });
  };

  const handleAdd = (product: StoreProduct, qty = 1) => {
    add({ id: product.id, name: product.name, unit: product.unit, price: product.price, stock: product.inventory?.available ?? product.inventory?.quantity ?? 0 }, qty);
  };

  const openProduct = (product: StoreProduct, source: string) => {
    track("PRODUCT_CLICK", { entityId: product.id, value: product.name, context: { category: product.category, source } });
    navigate(`/products/${product.id}`);
  };

  const handleWishlist = async (product: StoreProduct) => {
    if (!isAuthenticated) {
      navigate("/auth?returnTo=" + encodeURIComponent("/"));
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

  useEffect(() => { setSeo({ title: t("home.seoTitle", { shop: "VelShop" }), description: t("home.seoDesc", { tagline: "ซื้อขายของจริง ปลีกและส่ง ในที่เดียว" }) }); }, [t]);

  return (
    <div className="flex min-h-screen flex-col bg-background text-slate-900">
      <ShopHeader />

      {/* Hero — Announcement Carousel (single slot, platform-level messages only) */}
      <section className="bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 pt-2.5 sm:px-6 sm:pt-3">
          <AnnouncementCarousel items={announcements} />
        </div>
      </section>

      {/* Top Seller CTA Banner — rounded emerald card, session-dismissible */}
      <TopBanner />

      {/* Category Strip — horizontal scrollable pills, max 6 categories */}
      {!productsData.loading && popularCategories.length > 0 && (
        <CategoryStrip
          categories={popularCategories.map(([id, count]) => {
            const raw = catIconMap.get(id) ?? "";
            const isUrl = raw.startsWith("http") || raw.startsWith("data:");
            return {
              id: id as StoreProductCategory,
              label: catNameMap.get(id) ?? (PRODUCT_CATEGORY_META as Record<string, { label: string }>)[id]?.label ?? id,
              imageUrl: isUrl ? raw : undefined,
              iconName: !isUrl && raw ? raw : undefined,
              icon: (CATEGORY_ICONS as Record<string, LucideIcon>)[id] ?? Package,
              count,
            };
          })}
          activeCategory="all"
          onCategoryChange={(id) => {
            if (id === "all") {
              handleCategory("all" as StoreProductCategory);
              navigate("/products");
            } else {
              handleCategory(id as StoreProductCategory);
              navigate(`/products?category=${id}`);
            }
          }}
          allLabel={t("thaimartUi.categoryStrip.all")}
        />
      )}

      {/* Single Featured Rail — Popular products (best sellers) */}
      {!productsData.loading && popularProducts.length > 0 && (
        <HorizontalRail
          icon={TrendingUp}
          title={t("home.trendingTitle")}
          description={t("home.trendingDesc")}
          viewAllHref="/products?sort=popular"
          viewAllLabel={t("common.viewAll")}
        >
          {popularProducts.slice(0, 10).map((product) => (
            <RailCard key={product.id}>
              <ProductCard product={product} onOpen={(p) => openProduct(p, "home-trending")} onAdd={handleAdd} wishlisted={wishlistIds.has(product.id)} onWishlist={handleWishlist} wishToggling={wishTogglingId === product.id} />
            </RailCard>
          ))}
        </HorizontalRail>
      )}

      {/* Product Grid — Server-paginated via ProductGrid component */}
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-8">
        <ProductGrid
          initialProducts={products.slice(0, 8)}
          initialMeta={{ total: products.length, hasMore: products.length > 8 }}
          title={t("home.allProductsTitle") ?? "All products"}
          description={t("home.allProductsDesc") ?? "Browse all available products"}
          icon={ShoppingBag}
          viewAllHref="/products"
          viewAllLabel={t("common.viewAll")}
          onProductClick={(product) => {
            track("PRODUCT_CLICK", {
              entityId: product.id,
              value: product.name,
              context: { category: product.category, source: "home-grid" },
            });
            openProduct(product, "home-all");
          }}
          onAddToCart={handleAdd}
          wishlistIds={wishlistIds}
          onWishlistToggle={handleWishlist}
          wishTogglingId={wishTogglingId}
        />
      </main>

    </div>
  );
}
