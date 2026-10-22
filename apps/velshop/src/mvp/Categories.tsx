/**
 * `/categories` — the original category browser.
 *
 * The tree (parent → children) comes from `GET /api/mvp/categories`; each node
 * links into the catalogue with the server-side slug filter.
 */
import { useLanguage } from "@velnox/shared/lib/i18n";
import { getMvpApi, type MvpCategory } from "@velnox/shared/mvp";
import { MvpEmpty, MvpErrorState, MvpLoading, useMvpQuery } from "@velnox/shared/mvp/ui";
import { ChevronRight } from "lucide-react";
import { Link } from "react-router";

function nameOf(category: MvpCategory, lang: string): string {
  return category.names?.[lang] || category.name;
}

export default function Categories() {
  const { t, lang } = useLanguage();
  const categories = useMvpQuery(() => getMvpApi().catalog.categories(), []);

  return (
    <div className="grid gap-6">
      <div>
        <p className="text-sm font-medium text-slate-400">{t("nav.categories")}</p>
        <h1 className="mt-1 text-2xl font-black tracking-tight text-slate-900 sm:text-3xl">
          {t("home.shopsTitle")}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t("home.shopsDesc")}</p>
      </div>

      {categories.loading ? (
        <MvpLoading label={t("common.loading")} />
      ) : categories.error ? (
        <MvpErrorState error={categories.error} onRetry={categories.reload} />
      ) : (categories.data ?? []).length === 0 ? (
        <MvpEmpty title={t("home.emptyTitle")} description={t("home.emptyDesc")} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {(categories.data ?? []).map((category) => (
            <section key={category.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <Link
                to={`/products?category=${encodeURIComponent(category.slug)}`}
                className="flex items-center justify-between gap-2 text-base font-semibold text-slate-900 hover:text-[#059669]"
              >
                {nameOf(category, lang)}
                <ChevronRight className="size-4 text-slate-400" />
              </Link>
              {category.children.length > 0 && (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {category.children.map((child) => (
                    <li key={child.id}>
                      <Link
                        to={`/products?category=${encodeURIComponent(child.slug)}`}
                        className="inline-block rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:border-[#10B981] hover:text-[#059669]"
                      >
                        {nameOf(child, lang)}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
