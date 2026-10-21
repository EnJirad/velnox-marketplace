/**
 * MVP catalogue: `/products?category=&q=&page=`.
 *
 * The URL is the state (shareable, back-button friendly) and every filter
 * parameter is sent to the server — filtering in the browser would silently show
 * a different result set from the one the API authorised.
 */
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { getMvpApi } from "@velnox/shared/mvp";
import { MvpEmpty, MvpErrorState, MvpLoading, useMvpQuery } from "@velnox/shared/mvp/ui";
import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { useSearchParams } from "react-router";
import { ProductTile } from "./components";

const PAGE_SIZE = 20;

export default function Catalog() {
  const [params, setParams] = useSearchParams();
  const category = params.get("category") ?? "";
  const q = params.get("q") ?? "";
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const [search, setSearch] = useState(q);

  // Keep the box in sync when the user navigates back/forward.
  useEffect(() => setSearch(q), [q]);

  const categories = useMvpQuery(() => getMvpApi().catalog.categories(), []);
  const products = useMvpQuery(
    () =>
      getMvpApi().catalog.products({
        page,
        limit: PAGE_SIZE,
        category: category || undefined,
        q: q || undefined,
      }),
    [page, category, q],
  );

  const update = (next: Record<string, string | null>) => {
    const merged = new URLSearchParams(params);
    for (const [key, value] of Object.entries(next)) {
      if (value === null || value === "") merged.delete(key);
      else merged.set(key, value);
    }
    setParams(merged, { replace: false });
  };

  const pagination = products.data?.pagination;
  const totalPages = pagination?.totalPages ?? (pagination ? Math.ceil(pagination.total / PAGE_SIZE) : 1);

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Products</h1>
        <p className="mt-1 text-sm text-slate-500">
          {pagination ? `${pagination.total} published product${pagination.total === 1 ? "" : "s"}` : "Published listings from approved sellers"}
        </p>
      </div>

      <form
        className="flex flex-col gap-2 sm:flex-row"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: search.trim() || null, page: null });
        }}
      >
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search products"
            aria-label="Search products"
            className="h-11 rounded-[10px] border-slate-200 pl-9"
          />
        </div>
        <div className="flex gap-2">
          <select
            value={category}
            onChange={(event) => update({ category: event.target.value || null, page: null })}
            aria-label="Category"
            className="h-11 rounded-[10px] border border-slate-200 bg-white px-3 text-sm text-slate-700"
          >
            <option value="">All categories</option>
            {(categories.data ?? []).map((entry) => (
              <option key={entry.id} value={entry.slug}>
                {entry.name}
              </option>
            ))}
          </select>
          <Button type="submit" className="h-11 bg-slate-900 px-5 text-white hover:bg-slate-800">
            Search
          </Button>
        </div>
      </form>

      {products.loading ? (
        <MvpLoading label="Loading products…" />
      ) : products.error ? (
        <MvpErrorState error={products.error} onRetry={products.reload} />
      ) : (products.data?.products ?? []).length === 0 ? (
        <MvpEmpty
          title="Nothing matched"
          description={
            q || category
              ? "Try a different search or category."
              : "No products are published yet."
          }
        >
          {(q || category) && (
            <Button
              variant="outline"
              onClick={() => setParams(new URLSearchParams(), { replace: false })}
            >
              Clear filters
            </Button>
          )}
        </MvpEmpty>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {(products.data?.products ?? []).map((product) => (
              <ProductTile key={product.id} product={product} />
            ))}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-center gap-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) })}
              >
                Previous
              </Button>
              <span className="text-xs text-slate-500">
                Page {page} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => update({ page: String(page + 1) })}
              >
                Next
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
