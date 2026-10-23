/**
 * VelShop home — the original layout on the MVP catalogue.
 *
 * Hero → popular categories → trending products → trust section. Every value
 * (products, categories, stock, rating) comes from `/api/mvp/*`; the copy comes
 * from the original translation files.
 */
import { ProductCard } from "@/components/ProductCard";
import { Button } from "@velnox/shared/components/ui/button";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { getMvpApi, type MvpProductSummary } from "@velnox/shared/mvp";
import { MvpEmpty, MvpErrorState, MvpLoading, useMvpQuery } from "@velnox/shared/mvp/ui";
import { ArrowRight, CreditCard, PackageCheck, RefreshCw, ShieldCheck, Store, Truck } from "lucide-react";
import { toast } from "sonner";
import { Link, useNavigate } from "react-router";
import { useFavorites } from "./favorites";
import { useSession } from "./session";

const TRUST = [
  { icon: CreditCard, titleKey: "home.trustSecureTitle", descKey: "home.trustSecureDesc" },
  { icon: Truck, titleKey: "home.trustTrackTitle", descKey: "home.trustTrackDesc" },
  { icon: PackageCheck, titleKey: "home.trustReturnTitle", descKey: "home.trustReturnDesc" },
  { icon: ShieldCheck, titleKey: "home.trustSupportTitle", descKey: "home.trustSupportDesc" },
] as const;

export default function Home() {
  const { t, lang } = useLanguage();
  const { user } = useSession();
  const navigate = useNavigate();
  const { isFavorited, toggle, busyId } = useFavorites();

  const featured = useMvpQuery(() => getMvpApi().catalog.products({ limit: 8 }), []);
  const categories = useMvpQuery(() => getMvpApi().catalog.categories(), []);

  const toggleFavorite = async (product: MvpProductSummary) => {
    if (!user) {
      navigate(`/auth?returnTo=${encodeURIComponent(`/products/${product.slug}`)}`);
      return;
    }
    try {
      const nowFavorited = await toggle(product.id);
      toast.success(nowFavorited ? t("productDetail.wishlistAdded") : t("productDetail.wishlistRemoved"));
    } catch {
      toast.error(t("productDetail.wishlistFailed"));
    }
  };

  return (
    <div className="grid gap-10">
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
        <div className="grid gap-6 p-6 sm:p-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
              <Store className="size-3" />
              {t("home.eyebrow")}
            </p>
            <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight text-slate-900 sm:text-4xl">
              {t("home.heroTitle")}
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">{t("home.heroDesc")}</p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild className="h-11 gap-1.5 bg-[#10B981] px-5 text-white hover:bg-[#059669]">
                <Link to="/products">
                  {t("home.shopNow")}
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 px-5">
                <Link to={user ? "/orders" : "/auth?returnTo=/orders"}>{t("home.myOrders")}</Link>
              </Button>
            </div>
          </div>

          <div className="grid gap-3 rounded-2xl bg-[#F8FAFC] p-4">
            {TRUST.map((perk) => (
              <div key={perk.titleKey} className="flex gap-3 rounded-xl bg-white p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                  <perk.icon className="size-4 text-[#10B981]" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{t(perk.titleKey)}</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500">{t(perk.descKey)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">
              {t("home.categoriesTitle")}
            </h2>
            <p className="text-sm text-slate-500">{t("home.categoriesDesc")}</p>
          </div>
          <Button variant="ghost" size="sm" asChild className="text-[#059669] hover:text-[#047857]">
            <Link to="/categories">{t("home.viewAllCategories")}</Link>
          </Button>
        </div>
        {categories.loading ? (
          <MvpLoading label={t("common.loading")} />
        ) : categories.error ? (
          <MvpErrorState error={categories.error} onRetry={categories.reload} />
        ) : (categories.data ?? []).length === 0 ? (
          <MvpEmpty title={t("home.emptyTitle")} description={t("home.emptyDesc")} />
        ) : (
          <div className="flex flex-wrap gap-2">
            {(categories.data ?? []).map((category) => (
              <Link
                key={category.id}
                to={`/products?category=${encodeURIComponent(category.slug)}`}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-[#10B981] hover:text-[#059669]"
              >
                {category.names?.[lang] || category.name}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold tracking-tight text-slate-900">
              {t("home.trendingTitle")}
            </h2>
            <p className="text-sm text-slate-500">{t("home.trendingDesc")}</p>
          </div>
          <Button variant="ghost" size="sm" asChild className="text-[#059669] hover:text-[#047857]">
            <Link to="/products">
              {t("common.viewAll")}
              <RefreshCw className="size-3.5" />
            </Link>
          </Button>
        </div>
        {featured.loading ? (
          <MvpLoading label={t("common.loading")} />
        ) : featured.error ? (
          <MvpErrorState error={featured.error} onRetry={featured.reload} />
        ) : (featured.data?.products ?? []).length === 0 ? (
          <MvpEmpty title={t("home.emptyTitle")} description={t("home.emptyDesc")}>
            <Button asChild variant="outline">
              <Link to="/products">{t("home.shopNow")}</Link>
            </Button>
          </MvpEmpty>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {(featured.data?.products ?? []).map((product) => (
              <ProductCard
                key={product.id}
                product={product}
                favorited={isFavorited(product.id)}
                favoriteBusy={busyId === product.id}
                onToggleFavorite={(entry) => void toggleFavorite(entry)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
