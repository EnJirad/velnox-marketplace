import { ProductCard } from "@/components/shop/ProductCard";
import { AnnouncementCarousel, type Announcement } from "@/components/shop/AnnouncementCarousel";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { Button } from "@velnox/shared/components/ui/button";
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
import { CUSTOMER_MEMORY_ENABLED } from "@velnox/shared/lib/features";
import {
  Armchair,
  ArrowRight,
  Baby,
  BellRing,
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
  History,
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

interface RecommendedRow {
  product: StoreProduct;
  score: number;
  reasons: string[];
  views: number;
}

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
  // PARKED (2026-10-14): the three personalised rails below are Customer Memory
  // features, so while the module is off their requests are not issued at all —
  // the empty result is exactly what these rails already render when a call
  // fails. Disabling the flag restores the original fetches unchanged.
  const recommendData = useCommerceData(
    useCallback(async () => {
      if (!CUSTOMER_MEMORY_ENABLED) return { items: [], source: "popular" };
      try { return await apiGet<any>("/api/memory/recommendations?limit=8"); }
      catch { return { items: [], source: "popular" }; }
    }, []),
  );
  const regularsData = useCommerceData(
    useCallback(async () => {
      if (!CUSTOMER_MEMORY_ENABLED) return [];
      try { return await apiGet<any[]>("/api/commerce/regulars"); }
      catch { return []; }
    }, []),
  );
  const remindersData = useCommerceData(
    useCallback(async () => {
      if (!CUSTOMER_MEMORY_ENABLED) return [];
      try { return await apiGet<any[]>("/api/memory/reminders"); }
      catch { return []; }
    }, []),
  );

  const toggleWishlist = useAction(api.customer.toggleWishlistAction);
  const myWishlist = useAction(api.customer.myWishlist);
  const categoryTree = useAction(api.customer.categoryTreeAction);
  const [wishlistIds, setWishlistIds] = useState<Set<string>>(new Set());
  const [wishTogglingId, setWishTogglingId] = useState<string | null>(null);

  // Localized category name map (slug → display_name)
  const [catNameMap, setCatNameMap] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let alive = true;
    categoryTree({ lang }).then((tree: any[]) => {
      if (!alive || !Array.isArray(tree)) return;
      const m = new Map<string, string>();
      const walk = (nodes: any[]) => {
        for (const n of nodes) {
          if (n.slug) m.set(n.slug, n.display_name ?? n.name);
          if (n.children?.length) walk(n.children);
        }
      };
      walk(tree);
      setCatNameMap(m);
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
  const recommendations = useMemo(
    () => (recommendData.data?.items ?? []) as RecommendedRow[],
    [recommendData.data],
  );
  const regulars = useMemo(() => regularsData.data ?? [], [regularsData.data]);
  const reminders = useMemo(() => remindersData.data ?? [], [remindersData.data]);

  const popularCategories = useMemo(() => {
    const counts = new globalThis.Map<string, number>();
    for (const p of products) { counts.set(p.category, (counts.get(p.category) ?? 0) + 1); }
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [products]);

  const popularProducts = useMemo(
    () => [...products].sort((a, b) => (b.soldCount ?? 0) - (a.soldCount ?? 0) || b.createdAt - a.createdAt).slice(0, 8),
    [products],
  );

  // Banner target = the category with the most published products (real count).
  const bannerCategory = popularCategories[0] ?? null;

  // "New arrivals" = newest real listings, minus anything already shown above.
  const newProducts = useMemo(() => {
    const shown = new Set(popularProducts.map((p) => p.id));
    return [...products]
      .sort((a, b) => b.createdAt - a.createdAt)
      .filter((p) => !shown.has(p.id))
      .slice(0, 8);
  }, [products, popularProducts]);

  // Announcements are derived from data the storefront already has: a neutral
  // platform welcome, the real number of listed products and the real number of
  // Velnox-verified listings. No campaign, discount or countdown claim is made,
  // because no announcement/campaign content system exists in this build.
  const announcements = useMemo<Announcement[]>(() => {
    const list: Announcement[] = [
      {
        id: "welcome",
        eyebrow: t("announce.eyebrow"),
        title: t("announce.welcomeTitle"),
        description: t("announce.welcomeDesc"),
      },
    ];
    if (products.length > 0) {
      list.push({
        id: "catalogue",
        eyebrow: t("announce.eyebrow"),
        title: t("announce.catalogueTitle"),
        description: t("announce.catalogueDesc", { count: products.length }),
        href: "/products",
      });
    }
    const verified = products.filter((p) => p.isVerifiedProduct).length;
    if (verified > 0) {
      list.push({
        id: "verified",
        eyebrow: t("announce.eyebrow"),
        title: t("announce.verifiedTitle"),
        description: t("announce.verifiedDesc", { count: verified }),
        href: "/products?verified=true",
      });
    }
    return list;
  }, [products, t]);

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

  const showReorder = reminders.length > 0;
  const showRegulars = !showReorder && regulars.length > 0;

  return (
    <div className="flex min-h-screen flex-col bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      {/* Announcement / promotion carousel — platform-level messages only.
          Content is derived from real storefront data; no campaign system exists. */}
      <section className="bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 pt-3 sm:px-6 sm:pt-4">
          <AnnouncementCarousel items={announcements} />
        </div>
      </section>

      {!productsData.loading && popularCategories.length > 0 && (
        <section className="border-b border-slate-100 bg-white">
          <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex items-end justify-between gap-3">
              <div><h2 className="text-base font-bold tracking-tight text-slate-900">{t("home.categoriesTitle")}</h2><p className="mt-0.5 text-xs text-slate-400">{t("home.categoriesDesc")}</p></div>
              <Link to="/categories" onClick={() => track("CATEGORY_VIEW", { value: "all", context: { label: "explore" } })} className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[#10B981] hover:text-emerald-700">{t("home.viewAllCategories")}<ArrowRight className="size-3.5" /></Link>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-x-2 gap-y-3 sm:grid-cols-6 sm:gap-y-4 lg:grid-cols-6">
              {popularCategories.map(([id, count]) => {
                const Icon = (CATEGORY_ICONS as Record<string, LucideIcon>)[id] ?? Package;
                const meta = (PRODUCT_CATEGORY_META as Record<string, { label: string }>)[id];
                return (
                  <Link
                    key={id}
                    to={`/products?category=${id}`}
                    onClick={() => handleCategory(id as StoreProductCategory)}
                    aria-label={`${catNameMap.get(id) ?? meta?.label ?? id} — ${t("home.categoryCount", { count })}`}
                    className="group flex min-w-0 flex-col items-center gap-1.5 rounded-xl py-1 transition-colors"
                  >
                    <span className="flex size-14 items-center justify-center rounded-full bg-[#F1F5F9] text-slate-700 ring-1 ring-slate-200 transition-colors group-hover:bg-[#ECFDF5] group-hover:text-[#10B981] group-hover:ring-[#10B981]/30 group-focus-visible:ring-2 group-focus-visible:ring-[#10B981]">
                      <Icon className="size-[22px]" />
                    </span>
                    <span className="w-full truncate text-center text-[11px] font-medium leading-4 text-slate-600 group-hover:text-slate-900">
                      {catNameMap.get(id) ?? meta?.label ?? id}
                    </span>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      {CUSTOMER_MEMORY_ENABLED && !authLoading && isAuthenticated && !remindersData.loading && showReorder && (
        <section className="border-b border-slate-100 bg-white">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
            <div className="flex items-center gap-2.5"><span className="flex size-8 items-center justify-center rounded-[10px] bg-[#ECFDF5]"><BellRing className="size-4 text-[#10B981]" /></span><div><h2 className="text-base font-bold tracking-tight text-slate-900">{t("home.reorderDueTitle")}</h2><p className="text-xs text-slate-400">{t("home.reorderDueDesc")}</p></div></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {reminders.map((r: any) => (
                <div key={r.product.id} className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-4 transition-colors hover:border-[#10B981]/40">
                  <span className="flex size-11 shrink-0 items-center justify-center rounded-[12px] bg-[#ECFDF5] text-xl">{r.emoji}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold text-slate-900">{r.product.name}</p><p className="mt-0.5 text-xs text-slate-400">{t("home.reorderDueEvery", { days: r.avgCycleDays, times: r.times })}</p><p className="mt-0.5 text-xs font-medium text-emerald-700">{r.daysLeft < 0 ? t("home.reorderDueOverdue", { days: Math.abs(r.daysLeft) }) : r.daysLeft === 0 ? t("home.reorderDueToday") : t("home.reorderDueInDays", { days: r.daysLeft })}</p></div>
                  <Button size="sm" className="shrink-0 gap-1.5 bg-[#10B981] text-white hover:bg-emerald-700" onClick={() => handleAdd(r.product)}>{t("home.reorderDueBuy")}</Button>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {CUSTOMER_MEMORY_ENABLED && !authLoading && isAuthenticated && !regularsData.loading && showRegulars && (
        <section className="border-b border-slate-100 bg-white">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
            <div className="flex items-center gap-2.5"><span className="flex size-8 items-center justify-center rounded-[10px] bg-[#ECFDF5]"><History className="size-4 text-[#10B981]" /></span><div><h2 className="text-base font-bold tracking-tight text-slate-900">{t("home.continueShoppingTitle")}</h2><p className="text-xs text-slate-400">{t("home.continueShoppingDesc")}</p></div></div>
            <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">{regulars.slice(0, 4).map(({ product }: any) => (<ProductCard key={product.id} product={product} onOpen={(p) => openProduct(p, "home-regulars")} onAdd={handleAdd} wishlisted={wishlistIds.has(product.id)} onWishlist={handleWishlist} wishToggling={wishTogglingId === product.id} />))}</div>
          </div>
        </section>
      )}

      {CUSTOMER_MEMORY_ENABLED && !authLoading && recommendations.length > 0 && (
        <section className="border-b border-slate-100 bg-white">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
            <div className="flex items-center gap-2.5"><span className="flex size-8 items-center justify-center rounded-[10px] bg-[#ECFDF5]"><Sparkles className="size-4 text-[#10B981]" /></span><div><h2 className="text-base font-bold tracking-tight text-slate-900">{recommendData.data?.source === "personal" ? t("home.recsPersonal") : t("home.recsPopular")}</h2><p className="text-xs text-slate-400">{recommendData.data?.source === "personal" ? t("home.recsPersonalDesc") : t("home.recsPopularDesc")}</p></div></div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{recommendations.slice(0, 8).map(({ product }) => (<ProductCard key={product.id} product={product} onOpen={(p) => openProduct(p, "home-recommended")} onAdd={handleAdd} badgeLabel={t("home.badgeRecommended")} wishlisted={wishlistIds.has(product.id)} onWishlist={handleWishlist} wishToggling={wishTogglingId === product.id} />))}</div>
          </div>
        </section>
      )}

      {!productsData.loading && popularProducts.length > 0 && (
        <section className="border-b border-slate-100 bg-white">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5"><span className="flex size-8 items-center justify-center rounded-[10px] bg-[#ECFDF5]"><TrendingUp className="size-4 text-[#10B981]" /></span><div><h2 className="text-base font-bold tracking-tight text-slate-900">{t("home.trendingTitle")}</h2><p className="text-xs text-slate-400">{t("home.trendingDesc")}</p></div></div>
              <Link to="/products?sort=popular" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[#10B981] hover:text-emerald-700">{t("common.viewAll")}<ArrowRight className="size-3.5" /></Link>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{popularProducts.map((product) => (<ProductCard key={product.id} product={product} onOpen={(p) => openProduct(p, "home-trending")} onAdd={handleAdd} wishlisted={wishlistIds.has(product.id)} onWishlist={handleWishlist} wishToggling={wishTogglingId === product.id} />))}</div>
          </div>
        </section>
      )}

      {!productsData.loading && newProducts.length > 0 && (
        <section className="border-b border-slate-100 bg-white">
          <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5"><span className="flex size-8 items-center justify-center rounded-[10px] bg-[#ECFDF5]"><Sparkles className="size-4 text-[#10B981]" /></span><div><h2 className="text-base font-bold tracking-tight text-slate-900">{t("home.newTitle")}</h2><p className="text-xs text-slate-400">{t("home.newDesc")}</p></div></div>
              <Link to="/products?sort=newest" className="inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[#10B981] hover:text-emerald-700">{t("common.viewAll")}<ArrowRight className="size-3.5" /></Link>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{newProducts.map((product) => (<ProductCard key={product.id} product={product} onOpen={(p) => openProduct(p, "home-new")} onAdd={handleAdd} wishlisted={wishlistIds.has(product.id)} onWishlist={handleWishlist} wishToggling={wishTogglingId === product.id} />))}</div>
          </div>
        </section>
      )}

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {productsData.loading ? (<div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => (<div key={i} className="h-64 animate-pulse rounded-xl border border-slate-200 bg-white" />))}</div>) : products.length === 0 ? (<div className="flex flex-col items-center rounded-xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center"><span className="flex size-14 items-center justify-center rounded-2xl bg-[#ECFDF5]"><ShoppingBag className="size-7 text-[#10B981]" /></span><h2 className="mt-5 text-lg font-semibold text-slate-900">{t("home.emptyTitle")}</h2><p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">{t("home.emptyDesc")}</p></div>) : null}
      </main>
      <ShopFooter />

    </div>
  );
}
