import { ShopHeader } from "@/components/shop/ShopHeader";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { Button } from "@velnox/shared/components/ui/button";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { api } from "@velnox/shared/lib/api-routes";
import { useLanguage } from "@/lib/i18n";
import { setSeo } from "@/lib/seo";
import { useAction } from "@velnox/shared/lib/api-routes";
import { ArrowRight, Boxes, ImageOff, LayoutGrid, Package } from "lucide-react";
import { CategoryIcon } from "@velnox/shared/components/ui/category-icon";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";

interface CategoryNode {
  id: string;
  name: string;
  slug: string | null;
  description: string | null;
  display_name?: string;
  display_description?: string;
  icon?: string | null;
  image_url?: string | null;
  parentId: string | null;
  level: number;
  productCount: number;
  children: CategoryNode[];
}

export default function ShopCategories() {
  const categoryStats = useAction(api.customer.categoryStatsAction);
  const { t, lang } = useLanguage();
  const [tree, setTree] = useState<CategoryNode[] | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const rows = (await categoryStats({ lang: lang })) as unknown as CategoryNode[];
      setTree(rows ?? []);
    } catch (err) {
      console.error("Categories error:", err);
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, [categoryStats]);

  useEffect(() => {
    setSeo({
      title: t("categories.seoTitle"),
      description: t("categories.seoDesc"),
    });
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const countFor = (node: CategoryNode): number =>
    node.productCount + node.children.reduce((sum, c) => sum + countFor(c), 0);

  return (
    <div className="flex min-h-screen flex-col bg-background text-slate-900">
      <ShopHeader />

      <section className="border-b border-slate-100 bg-white">
        <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-10">
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <LayoutGrid className="size-4 text-brand" />
            {t("categories.eyebrow")}
          </p>
          <h1 className="mt-2 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            {t("categories.title")}
          </h1>
          <p className="mt-2 max-w-lg text-sm leading-6 text-slate-500">{t("categories.desc")}</p>
        </div>
      </section>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6 sm:py-10">
        {loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-44 rounded-2xl" />
            ))}
          </div>
        ) : !tree || tree.length === 0 ? (
          <div className="flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <Boxes className="size-8 text-slate-300" />
            <h2 className="mt-4 text-lg font-semibold text-slate-900">{t("categories.empty")}</h2>
            <p className="mt-1.5 text-sm text-slate-500">{t("categories.emptyDesc")}</p>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {tree.map((root) => {
              const total = countFor(root);
              const to = `/products?category=${encodeURIComponent(root.slug ?? root.id)}`;
              return (
                <div
                  key={root.id}
                  className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white transition-[transform,border-color,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:shadow-float"
                >
                  <Link to={to} className="block">
                    <div className="flex h-24 items-center gap-4 bg-gradient-to-r from-brand-deep via-brand to-brand-light px-5">
                      {root.icon || root.image_url ? (
                        <CategoryIcon icon={root.icon} imageUrl={root.image_url} className="size-12 rounded-lg" />
                      ) : (
                        <span className="flex size-12 items-center justify-center rounded-lg bg-white/20 backdrop-blur">
                          <Package className="size-6 text-white" />
                        </span>
                      )}
                      <div className="min-w-0">
                        <h2 className="truncate text-lg font-bold tracking-tight text-white">{root.display_name ?? root.name}</h2>
                        <p className="text-xs text-emerald-50/90">
                          {t("categories.count", { count: total })}
                          {(root.display_description ?? root.description) ? ` · ${root.display_description ?? root.description}` : ""}
                        </p>
                      </div>
                    </div>
                  </Link>

                  {root.children.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 px-5 pt-4">
                      {root.children.map((child) => (
                        <Link
                          key={child.id}
                          to={`/products?category=${encodeURIComponent(child.slug ?? child.id)}`}
                          className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-brand/40 hover:bg-accent hover:text-emerald-700"
                        >
                          {child.display_name ?? child.name} · {child.productCount}
                        </Link>
                      ))}
                    </div>
                  )}

                  <div className="mt-auto p-5 pt-4">
                    <Button
                      variant="ghost"
                      className="h-9 w-full gap-1 text-xs text-slate-500 hover:bg-accent hover:text-emerald-700"
                      asChild
                    >
                      <Link to={to}>
                        {t("categories.viewProducts")}
                        <ArrowRight className="size-3.5" />
                      </Link>
                    </Button>
                  </div>
                </div>
              );
            })}
          {/* VelShop Verified card */}
          <div className="flex flex-col overflow-hidden rounded-2xl border border-emerald-200 bg-white transition-[transform,border-color,box-shadow,background-color] duration-200 hover:-translate-y-0.5 hover:shadow-float">
            <Link to="/products?verified=true" className="block">
              <div className="flex h-24 items-center gap-4 bg-gradient-to-r from-[#065f46] via-brand-strong to-brand px-5">
                <span className="flex size-12 items-center justify-center rounded-lg bg-white/20 backdrop-blur">
                  <span className="text-lg font-extrabold text-white">V</span>
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold tracking-tight text-white">{t("verification.velshopVerified")}</h2>
                  <p className="text-xs text-emerald-50/90">{t("verification.velshopVerifiedDesc")}</p>
                </div>
              </div>
            </Link>
            <div className="mt-auto p-5 pt-4">
              <Button variant="ghost" className="h-9 w-full gap-1 text-xs text-slate-500 hover:bg-emerald-50 hover:text-emerald-700" asChild>
                <Link to="/products?verified=true">
                  {t("categories.velshopVerified")}
                  <ArrowRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          </div>
          </div>
        )}
      </main>

      <ShopFooter />
    </div>
  );
}
