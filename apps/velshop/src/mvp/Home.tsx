/**
 * MVP storefront home: published catalogue, categories, and a clear way in.
 *
 * Only `GET /api/mvp/products` and `GET /api/mvp/categories` are used, so the
 * page shows exactly what the MVP API considers public (published products of
 * approved sellers) and nothing else.
 */
import { Button } from "@velnox/shared/components/ui/button";
import { getMvpApi } from "@velnox/shared/mvp";
import { MvpEmpty, MvpErrorState, MvpLoading, useMvpQuery } from "@velnox/shared/mvp/ui";
import { ArrowRight, ShieldCheck, Store, Truck } from "lucide-react";
import { Link } from "react-router";
import { ProductTile, SectionHeader, ViewAllLink } from "./components";

const PERKS = [
  { icon: Store, title: "Verified sellers", text: "Every store is reviewed before its first listing goes live." },
  { icon: ShieldCheck, title: "Server-confirmed payments", text: "An order is only marked paid when the payment provider confirms it." },
  { icon: Truck, title: "Tracked delivery", text: "Follow each order from processing to delivered." },
];

export default function Home() {
  const featured = useMvpQuery(() => getMvpApi().catalog.products({ limit: 8 }), []);
  const categories = useMvpQuery(() => getMvpApi().catalog.categories(), []);

  return (
    <div className="grid gap-10">
      {/* Hero */}
      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
        <div className="grid gap-6 p-6 sm:p-10 lg:grid-cols-[1.15fr_0.85fr] lg:items-center">
          <div>
            <p className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-emerald-700">
              Velnox marketplace
            </p>
            <h1 className="mt-4 text-3xl font-black leading-tight tracking-tight text-slate-900 sm:text-4xl">
              Buy from local sellers,
              <br />
              with prices you can trust.
            </h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
              Browse published listings from approved stores. Stock, price and order status are
              always read from the marketplace itself — never guessed by your browser.
            </p>
            <div className="mt-6 flex flex-wrap gap-2">
              <Button asChild className="h-11 gap-1.5 bg-[#10B981] px-5 text-white hover:bg-[#059669]">
                <Link to="/products">
                  Browse products
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button asChild variant="outline" className="h-11 px-5">
                <Link to="/orders">My orders</Link>
              </Button>
            </div>
          </div>
          <div className="grid gap-3 rounded-2xl bg-[#F8FAFC] p-4">
            {PERKS.map((perk) => (
              <div key={perk.title} className="flex gap-3 rounded-xl bg-white p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                  <perk.icon className="size-4 text-[#10B981]" />
                </span>
                <div>
                  <p className="text-sm font-semibold text-slate-900">{perk.title}</p>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500">{perk.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Categories */}
      <section>
        <SectionHeader title="Shop by category" />
        {categories.loading ? (
          <MvpLoading label="Loading categories…" />
        ) : categories.error ? (
          <MvpErrorState error={categories.error} onRetry={categories.reload} />
        ) : (categories.data ?? []).length === 0 ? (
          <MvpEmpty title="No categories yet" description="An administrator has not created any categories." />
        ) : (
          <div className="flex flex-wrap gap-2">
            {(categories.data ?? []).map((category) => (
              <Link
                key={category.id}
                to={`/products?category=${encodeURIComponent(category.slug)}`}
                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:border-[#10B981] hover:text-[#059669]"
              >
                {category.name}
              </Link>
            ))}
          </div>
        )}
      </section>

      {/* Featured */}
      <section>
        <SectionHeader title="New in the marketplace" action={<ViewAllLink to="/products" />} />
        {featured.loading ? (
          <MvpLoading label="Loading products…" />
        ) : featured.error ? (
          <MvpErrorState error={featured.error} onRetry={featured.reload} />
        ) : (featured.data?.products ?? []).length === 0 ? (
          <MvpEmpty
            title="No published products yet"
            description="Products appear here once a seller submits them and an administrator approves them."
          >
            <Button asChild variant="outline">
              <Link to="/products">Check again</Link>
            </Button>
          </MvpEmpty>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {(featured.data?.products ?? []).map((product) => (
              <ProductTile key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
