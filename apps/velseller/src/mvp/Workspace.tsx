/**
 * Seller workspace: application, review status, and own products.
 *
 * The seller's status is read from `GET /api/mvp/seller/status`, which reports
 * the caller's OWN application (`seller: null` means "authenticated, has not
 * applied"). Every state the backend can return is rendered explicitly:
 * no application → form; pending → waiting; rejected/suspended → the server's
 * reason; approved → the workspace.
 */
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { getMvpApi, type MvpSellerProduct } from "@velnox/shared/mvp";
import {
  MvpEmpty,
  MvpErrorState,
  MvpLoading,
  formatDate,
  formatMoney,
  toMvpError,
  useMvpQuery,
} from "@velnox/shared/mvp/ui";
import { ArrowRight, Loader2, Plus, Store } from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link } from "react-router";

const PRODUCT_STATUS_STYLE: Record<string, string> = {
  draft: "bg-slate-100 text-slate-600 border-slate-200",
  submitted: "bg-amber-50 text-amber-700 border-amber-200",
  approved: "bg-sky-50 text-sky-700 border-sky-200",
  published: "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected: "bg-rose-50 text-rose-700 border-rose-200",
};

function StatusPill({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
        PRODUCT_STATUS_STYLE[status] ?? "bg-slate-100 text-slate-600 border-slate-200"
      }`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );
}

/** The application form, shown only when the caller has no seller profile. */
function ApplyForm({ onApplied }: { onApplied: () => void }) {
  const [storeName, setStoreName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await getMvpApi().seller.apply({
        storeName: storeName.trim(),
        description: description.trim() || undefined,
      });
      onApplied();
    } catch (err) {
      setError(toMvpError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="mx-auto grid w-full max-w-lg gap-3 rounded-2xl border border-slate-200 bg-white p-6"
    >
      <div>
        <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-50">
          <Store className="size-5 text-[#10B981]" />
        </span>
        <h1 className="mt-3 text-xl font-bold tracking-tight text-slate-900">Open your store</h1>
        <p className="mt-1 text-sm text-slate-500">
          Apply once. An administrator reviews the application before your products can be listed.
        </p>
      </div>
      <div className="grid gap-2">
        <Label htmlFor="store-name" className="text-xs font-medium text-slate-500">
          Store name *
        </Label>
        <Input
          id="store-name"
          required
          minLength={2}
          maxLength={120}
          value={storeName}
          onChange={(event) => setStoreName(event.target.value)}
          disabled={busy}
          className="h-11 rounded-[10px] border-slate-200"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="store-desc" className="text-xs font-medium text-slate-500">
          What do you sell?
        </Label>
        <textarea
          id="store-desc"
          rows={3}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={busy}
          className="rounded-[10px] border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#10B981] focus:ring-2 focus:ring-[#10B981]/20"
        />
      </div>
      {error && (
        <p className="rounded-[10px] bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="h-11 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
        disabled={busy || storeName.trim().length < 2}
      >
        {busy && <Loader2 className="size-4 animate-spin" />}
        Submit application
      </Button>
      <p className="text-[11px] leading-5 text-slate-400">
        Approval, rejection and suspension are decided by an administrator; this page only reports
        what the server returns.
      </p>
    </form>
  );
}

/** A non-approved seller sees exactly what the backend says about them. */
function StatusCard({
  status,
  reason,
  storeName,
  onRefresh,
}: {
  status: "pending" | "rejected" | "suspended";
  reason: string | null;
  storeName: string;
  onRefresh: () => void;
}) {
  const copy = {
    pending: {
      title: "Your application is under review",
      text: "You can prepare products, but they cannot be published until an administrator approves the store.",
    },
    rejected: {
      title: "Your application was rejected",
      text: "You cannot create products or receive orders while the application is rejected.",
    },
    suspended: {
      title: "Your store is suspended",
      text: "Selling is disabled. Orders you already fulfilled remain visible to buyers.",
    },
  }[status];

  return (
    <div className="mx-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center">
      <span className="mx-auto flex size-11 items-center justify-center rounded-xl bg-amber-50">
        <Store className="size-5 text-amber-500" />
      </span>
      <h1 className="mt-3 text-lg font-bold text-slate-900">{copy.title}</h1>
      <p className="mt-1 text-sm text-slate-500">{storeName}</p>
      <p className="mt-2 text-xs leading-5 text-slate-500">{copy.text}</p>
      {reason && (
        <p className="mt-3 rounded-[10px] bg-rose-50 px-3 py-2 text-left text-xs text-rose-700">
          Reason from the marketplace team: {reason}
        </p>
      )}
      <div className="mt-4 flex justify-center gap-2">
        <Button variant="outline" onClick={onRefresh}>
          Check again
        </Button>
      </div>
    </div>
  );
}

/** Create a draft product (name, price, optional stock and category). */
function NewProductForm({ onCreated }: { onCreated: () => void }) {
  const categories = useMvpQuery(() => getMvpApi().catalog.categories(), []);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [categorySlug, setCategorySlug] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={() => setOpen(true)}>
        <Plus className="size-4" />
        New product
      </Button>
    );
  }

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      // The price is sent as the string the seller typed; the server validates and
      // stores it as NUMERIC. No local rounding or "fixing".
      await getMvpApi().seller.createProduct({
        name: name.trim(),
        price: price.trim(),
        categorySlug: categorySlug || null,
        stock: Number(stock) || 0,
      });
      setName("");
      setPrice("");
      setStock("0");
      setCategorySlug("");
      setOpen(false);
      onCreated();
    } catch (err) {
      setError(toMvpError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-2 sm:p-5"
    >
      <div className="sm:col-span-2">
        <p className="text-sm font-bold text-slate-900">New product</p>
        <p className="text-xs text-slate-500">
          Saved as a draft. Add images and variants, then submit it for review.
        </p>
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="np-name" className="text-xs font-medium text-slate-500">
          Name *
        </Label>
        <Input
          id="np-name"
          required
          minLength={2}
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={busy}
          className="h-11 rounded-[10px] border-slate-200"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="np-price" className="text-xs font-medium text-slate-500">
          Price (THB) *
        </Label>
        <Input
          id="np-price"
          required
          inputMode="decimal"
          placeholder="1290.00"
          value={price}
          onChange={(event) => setPrice(event.target.value)}
          disabled={busy}
          className="h-11 rounded-[10px] border-slate-200"
        />
      </div>
      <div className="grid gap-2">
        <Label htmlFor="np-stock" className="text-xs font-medium text-slate-500">
          Opening stock
        </Label>
        <Input
          id="np-stock"
          inputMode="numeric"
          value={stock}
          onChange={(event) => setStock(event.target.value.replace(/[^0-9]/g, ""))}
          disabled={busy}
          className="h-11 rounded-[10px] border-slate-200"
        />
      </div>
      <div className="grid gap-2 sm:col-span-2">
        <Label htmlFor="np-category" className="text-xs font-medium text-slate-500">
          Category
        </Label>
        <select
          id="np-category"
          value={categorySlug}
          onChange={(event) => setCategorySlug(event.target.value)}
          disabled={busy}
          className="h-11 rounded-[10px] border border-slate-200 bg-white px-3 text-sm text-slate-700"
        >
          <option value="">No category</option>
          {(categories.data ?? []).map((category) => (
            <option key={category.id} value={category.slug}>
              {category.name}
            </option>
          ))}
        </select>
      </div>
      {error && (
        <p className="rounded-[10px] bg-rose-50 px-3 py-2 text-xs text-rose-700 sm:col-span-2" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" className="h-11 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]" disabled={busy}>
          {busy && <Loader2 className="size-4 animate-spin" />}
          Create draft
        </Button>
        <Button type="button" variant="ghost" className="h-11" onClick={() => setOpen(false)} disabled={busy}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function ProductRow({ product }: { product: MvpSellerProduct }) {
  return (
    <Link
      to={`/seller/products/${encodeURIComponent(product.id)}`}
      className="flex items-center gap-3 border-b border-slate-100 p-4 last:border-b-0 hover:bg-slate-50"
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className="truncate text-sm font-semibold text-slate-900">{product.name}</p>
          <StatusPill status={product.status} />
        </div>
        <p className="mt-1 text-xs text-slate-500">
          {formatMoney(product.price)} ·{" "}
          {product.stock ? `${product.stock.available} available` : `${product.variants.length} variants`} ·
          updated {formatDate(product.updatedAt)}
        </p>
        {product.status === "rejected" && product.rejectionReason && (
          <p className="mt-1 text-xs text-rose-600">Rejected: {product.rejectionReason}</p>
        )}
      </div>
      <ArrowRight className="size-4 shrink-0 text-slate-300" />
    </Link>
  );
}

export default function Workspace({ tab }: { tab?: "overview" | "products" }) {
  const status = useMvpQuery(() => getMvpApi().seller.status(), []);
  const approved = status.data?.seller?.status === "approved";
  const products = useMvpQuery(
    () => (approved ? getMvpApi().seller.products() : Promise.resolve([])),
    [approved],
  );

  if (status.loading) return <MvpLoading label="Loading your store…" />;
  if (status.error) {
    return (
      <div className="mx-auto w-full max-w-lg py-10">
        <MvpErrorState error={status.error} onRetry={status.reload} />
      </div>
    );
  }

  const seller = status.data?.seller ?? null;

  if (!seller) {
    return (
      <div className="py-6">
        <ApplyForm onApplied={status.reload} />
      </div>
    );
  }

  if (seller.status !== "approved") {
    return (
      <div className="py-6">
        <StatusCard
          status={seller.status as "pending" | "rejected" | "suspended"}
          reason={seller.rejection_reason ?? seller.suspension_reason ?? null}
          storeName={seller.store_name ?? seller.storeName ?? ""}
          onRefresh={status.reload}
        />
      </div>
    );
  }

  const counts = status.data?.productCounts ?? {};

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            {seller.store_name ?? seller.storeName ?? "Your store"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Approved seller · {counts.published ?? 0} published · {counts.draft ?? 0} draft ·{" "}
            {counts.submitted ?? 0} awaiting review
          </p>
        </div>
        {tab === "products" && <NewProductForm onCreated={() => { products.reload(); status.reload(); }} />}
      </div>

      {tab !== "products" && (
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Published", value: counts.published ?? 0, to: "/seller/products" },
            { label: "Awaiting review", value: counts.submitted ?? 0, to: "/seller/products" },
            { label: "Drafts", value: counts.draft ?? 0, to: "/seller/products" },
          ].map((card) => (
            <Link
              key={card.label}
              to={card.to}
              className="rounded-2xl border border-slate-200 bg-white p-4 hover:border-slate-300"
            >
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
              <p className="mt-1 text-2xl font-black text-slate-900">{card.value}</p>
            </Link>
          ))}
        </div>
      )}

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <p className="text-sm font-bold text-slate-900">Products</p>
          <div className="flex gap-2">
            <Button asChild variant="ghost" size="sm" className="text-slate-500">
              <Link to="/seller/products">Manage</Link>
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-slate-500">
              <Link to="/seller/orders">Orders</Link>
            </Button>
          </div>
        </div>

        {products.loading ? (
          <MvpLoading label="Loading products…" />
        ) : products.error ? (
          <div className="p-4">
            <MvpErrorState error={products.error} onRetry={products.reload} />
          </div>
        ) : (products.data ?? []).length === 0 ? (
          <div className="p-4">
            <MvpEmpty
              title="No products yet"
              description="Create a draft, add images and variants, then submit it for review."
            >
              <Button asChild className="bg-slate-900 text-white hover:bg-slate-800">
                <Link to="/seller/products">Create a product</Link>
              </Button>
            </MvpEmpty>
          </div>
        ) : (
          <div>
            {(products.data ?? []).map((product) => (
              <ProductRow key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
