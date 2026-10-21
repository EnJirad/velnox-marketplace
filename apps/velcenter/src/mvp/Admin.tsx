/**
 * VelCenter MVP admin panels: metrics, seller review, product review, categories.
 *
 * Everything shown is a server value. Approvals, rejections and suspensions post
 * to `/api/mvp/admin/*`, which re-checks that the caller is an admin/owner — a
 * customer who reaches this page sees 403 responses, not a filtered UI.
 *
 * The pending-order sweep is an explicit, admin-only action here. It is the same
 * idempotent endpoint the Phase 3 report says must be scheduled at cutover; no
 * second scheduler is introduced in this task.
 */
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { getMvpApi, type MvpAdminCategoryRow, type MvpAdminProductRow, type MvpAdminSellerRow } from "@velnox/shared/mvp";
import {
  MvpEmpty,
  MvpErrorState,
  MvpLoading,
  formatDate,
  formatMoney,
  toMvpError,
  useMvpQuery,
} from "@velnox/shared/mvp/ui";
import { Loader2, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";

type Tab = "overview" | "sellers" | "products" | "categories";

const CARD = "rounded-2xl border border-slate-200 bg-white p-4 sm:p-5";

function Notice({ message, tone = "error" }: { message: string | null; tone?: "error" | "ok" }) {
  if (!message) return null;
  return (
    <p
      role={tone === "error" ? "alert" : undefined}
      className={`rounded-[10px] px-3 py-2 text-xs ${
        tone === "error" ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-800"
      }`}
    >
      {message}
    </p>
  );
}

/** Run one admin action with a busy flag and the server's own error message. */
function useAction() {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const run = async (key: string, action: () => Promise<unknown>, success: string, after: () => void) => {
    setBusy(key);
    setError(null);
    setOk(null);
    try {
      await action();
      setOk(success);
      after();
    } catch (err) {
      setError(toMvpError(err).message);
    } finally {
      setBusy(null);
    }
  };

  return { busy, error, ok, run };
}

// ─── Overview ───────────────────────────────────────────────────────────────

function Overview() {
  const metrics = useMvpQuery(() => getMvpApi().admin.metrics(), []);
  const { busy, error, ok, run } = useAction();

  const cards: Array<{ label: string; value: string | number | undefined }> = [
    { label: "Pending sellers", value: metrics.data?.pending_sellers },
    { label: "Approved sellers", value: metrics.data?.approved_sellers },
    { label: "Suspended sellers", value: metrics.data?.suspended_sellers },
    { label: "Products awaiting review", value: metrics.data?.products_awaiting_review },
    { label: "Published products", value: metrics.data?.published_products },
    { label: "Orders", value: metrics.data?.orders_total },
    { label: "Awaiting payment", value: metrics.data?.orders_pending_payment },
    { label: "Delivered", value: metrics.data?.orders_delivered },
  ];

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Marketplace overview</h1>
        <p className="mt-1 text-sm text-slate-500">Live counts from the MVP database.</p>
      </div>

      {metrics.loading ? (
        <MvpLoading label="Loading metrics…" />
      ) : metrics.error ? (
        <MvpErrorState error={metrics.error} onRetry={metrics.reload} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {cards.map((card) => (
              <div key={card.label} className={CARD}>
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{card.label}</p>
                <p className="mt-1 text-2xl font-black text-slate-900">{card.value ?? "—"}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className={CARD}>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Settled payments
              </p>
              <p className="mt-1 text-2xl font-black text-slate-900">{metrics.data?.paid_payments ?? "—"}</p>
            </div>
            <div className={CARD}>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
                Gross settled amount
              </p>
              <p className="mt-1 text-2xl font-black text-slate-900">
                {formatMoney(metrics.data?.gross_settled_amount ?? null)}
              </p>
            </div>
            <div className={CARD}>
              <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">Active users</p>
              <p className="mt-1 text-2xl font-black text-slate-900">{metrics.data?.active_users ?? "—"}</p>
            </div>
          </div>
        </>
      )}

      <section className={`${CARD} grid gap-2`}>
        <p className="text-sm font-bold text-slate-900">Pending-order expiry</p>
        <p className="text-xs leading-5 text-slate-500">
          Releases stock held by unpaid orders past their payment window. Idempotent — running it twice
          expires nothing the second time. At cutover this must be scheduled; until then it is manual
          and admin-only.
        </p>
        <Notice message={error} />
        <Notice message={ok} tone="ok" />
        <Button
          className="h-10 w-fit gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
          disabled={busy !== null}
          onClick={() =>
            run(
              "expire",
              () => getMvpApi().admin.expireOrders(),
              "Expiry sweep finished.",
              () => metrics.reload(),
            )
          }
        >
          {busy === "expire" && <Loader2 className="size-4 animate-spin" />}
          Run expiry sweep
        </Button>
      </section>
    </div>
  );
}

// ─── Sellers ────────────────────────────────────────────────────────────────

function SellerRow({ seller, onChanged }: { seller: MvpAdminSellerRow; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const { busy, error, run } = useAction();
  const pending = seller.status === "pending";

  return (
    <div className="border-b border-slate-100 p-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-slate-900">{seller.store_name}</p>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {seller.status}
        </span>
        <span className="text-xs text-slate-500">
          {seller.email} · applied {formatDate(seller.created_at)}
        </span>
      </div>
      {seller.rejection_reason && (
        <p className="mt-1 text-xs text-rose-600">Rejected: {seller.rejection_reason}</p>
      )}
      {seller.suspension_reason && (
        <p className="mt-1 text-xs text-amber-700">Suspended: {seller.suspension_reason}</p>
      )}

      <div className="mt-2 flex flex-wrap items-end gap-2">
        {pending && (
          <Button
            size="sm"
            className="h-9 bg-[#10B981] text-white hover:bg-[#059669]"
            disabled={busy !== null}
            onClick={() =>
              run("approve", () => getMvpApi().admin.approveSeller(seller.id), "Seller approved.", onChanged)
            }
          >
            {busy === "approve" && <Loader2 className="size-3.5 animate-spin" />}
            Approve
          </Button>
        )}
        {(pending || seller.status === "approved") && (
          <>
            <div className="grid gap-1">
              <Label className="text-[11px] font-medium text-slate-500">
                {pending ? "Rejection reason" : "Suspension reason"}
              </Label>
              <Input
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                disabled={busy !== null}
                className="h-9 w-64 rounded-[10px] border-slate-200"
                placeholder="Shown to the seller"
              />
            </div>
            <Button
              size="sm"
              variant="outline"
              className="h-9 text-rose-600 hover:bg-rose-50"
              disabled={busy !== null || reason.trim().length < 3}
              onClick={() =>
                pending
                  ? run(
                      "reject",
                      () => getMvpApi().admin.rejectSeller(seller.id, reason.trim()),
                      "Seller rejected.",
                      onChanged,
                    )
                  : run(
                      "suspend",
                      () => getMvpApi().admin.suspendSeller(seller.id, reason.trim()),
                      "Seller suspended.",
                      onChanged,
                    )
              }
            >
              {busy === "reject" || busy === "suspend" ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : null}
              {pending ? "Reject" : "Suspend"}
            </Button>
          </>
        )}
      </div>
      <Notice message={error} />
    </div>
  );
}

function SellersPanel() {
  const [status, setStatus] = useState("pending");
  const sellers = useMvpQuery(
    () => getMvpApi().admin.sellers({ status: status || undefined, page: 1, limit: 50 }),
    [status],
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Seller applications</h1>
          <p className="mt-1 text-sm text-slate-500">Approve, reject or suspend a store.</p>
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Seller status"
          className="h-10 rounded-[10px] border border-slate-200 bg-white px-3 text-sm text-slate-700"
        >
          {["pending", "approved", "rejected", "suspended", ""].map((value) => (
            <option key={value || "all"} value={value}>
              {value || "All statuses"}
            </option>
          ))}
        </select>
      </div>

      {sellers.loading ? (
        <MvpLoading label="Loading sellers…" />
      ) : sellers.error ? (
        <MvpErrorState error={sellers.error} onRetry={sellers.reload} />
      ) : (sellers.data?.sellers ?? []).length === 0 ? (
        <MvpEmpty title="Nothing to review" description="No seller applications match this filter." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {(sellers.data?.sellers ?? []).map((seller) => (
            <SellerRow key={seller.id} seller={seller} onChanged={sellers.reload} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Products ───────────────────────────────────────────────────────────────

function ProductRow({ product, onChanged }: { product: MvpAdminProductRow; onChanged: () => void }) {
  const [reason, setReason] = useState("");
  const { busy, error, run } = useAction();
  const awaiting = product.status === "submitted";

  return (
    <div className="border-b border-slate-100 p-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-slate-900">{product.name}</p>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {product.status}
        </span>
        <span className="text-xs text-slate-500">
          {product.store_name} · {formatMoney(product.price)}
          {product.submitted_at ? ` · submitted ${formatDate(product.submitted_at)}` : ""}
        </span>
      </div>

      {awaiting && (
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <Button
            size="sm"
            className="h-9 bg-[#10B981] text-white hover:bg-[#059669]"
            disabled={busy !== null}
            onClick={() =>
              run("approve", () => getMvpApi().admin.approveProduct(product.id), "Product approved.", onChanged)
            }
          >
            {busy === "approve" && <Loader2 className="size-3.5 animate-spin" />}
            Approve
          </Button>
          <div className="grid gap-1">
            <Label className="text-[11px] font-medium text-slate-500">Rejection reason</Label>
            <Input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              disabled={busy !== null}
              className="h-9 w-64 rounded-[10px] border-slate-200"
              placeholder="Shown to the seller"
            />
          </div>
          <Button
            size="sm"
            variant="outline"
            className="h-9 text-rose-600 hover:bg-rose-50"
            disabled={busy !== null || reason.trim().length < 3}
            onClick={() =>
              run(
                "reject",
                () => getMvpApi().admin.rejectProduct(product.id, reason.trim()),
                "Product rejected.",
                onChanged,
              )
            }
          >
            {busy === "reject" && <Loader2 className="size-3.5 animate-spin" />}
            Reject
          </Button>
        </div>
      )}
      <Notice message={error} />
    </div>
  );
}

function ProductsPanel() {
  const [status, setStatus] = useState("submitted");
  const products = useMvpQuery(
    () => getMvpApi().admin.products({ status: status || undefined, page: 1, limit: 50 }),
    [status],
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Product review</h1>
          <p className="mt-1 text-sm text-slate-500">
            Only an approved product can be published by its seller.
          </p>
        </div>
        <select
          value={status}
          onChange={(event) => setStatus(event.target.value)}
          aria-label="Product status"
          className="h-10 rounded-[10px] border border-slate-200 bg-white px-3 text-sm text-slate-700"
        >
          {["submitted", "draft", "approved", "published", "rejected", ""].map((value) => (
            <option key={value || "all"} value={value}>
              {value || "All statuses"}
            </option>
          ))}
        </select>
      </div>

      {products.loading ? (
        <MvpLoading label="Loading products…" />
      ) : products.error ? (
        <MvpErrorState error={products.error} onRetry={products.reload} />
      ) : (products.data?.products ?? []).length === 0 ? (
        <MvpEmpty title="Nothing to review" description="No products match this filter." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {(products.data?.products ?? []).map((product) => (
            <ProductRow key={product.id} product={product} onChanged={products.reload} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Categories ─────────────────────────────────────────────────────────────

function CategoryRow({ category, onChanged }: { category: MvpAdminCategoryRow; onChanged: () => void }) {
  const [name, setName] = useState(category.name);
  const { busy, error, run } = useAction();

  return (
    <div className="flex flex-wrap items-end gap-2 border-b border-slate-100 p-4 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-900">
          {category.name} <span className="font-mono text-[11px] text-slate-400">/{category.slug}</span>
        </p>
        <p className="text-xs text-slate-500">
          {category.product_count} product{category.product_count === 1 ? "" : "s"} ·{" "}
          {category.is_active ? "active" : "inactive"} · order {category.sort_order}
        </p>
        <Notice message={error} />
      </div>
      <Input
        value={name}
        onChange={(event) => setName(event.target.value)}
        disabled={busy !== null}
        aria-label={`Name of ${category.slug}`}
        className="h-9 w-48 rounded-[10px] border-slate-200"
      />
      <Button
        size="sm"
        variant="outline"
        className="h-9"
        disabled={busy !== null || !name.trim() || name.trim() === category.name}
        onClick={() =>
          run("rename", () => getMvpApi().admin.updateCategory(category.id, { name: name.trim() }), "Saved.", onChanged)
        }
      >
        {busy === "rename" && <Loader2 className="size-3.5 animate-spin" />}
        Rename
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="h-9"
        disabled={busy !== null}
        onClick={() =>
          run(
            "toggle",
            () => getMvpApi().admin.updateCategory(category.id, { isActive: !category.is_active }),
            "Saved.",
            onChanged,
          )
        }
      >
        {busy === "toggle" && <Loader2 className="size-3.5 animate-spin" />}
        {category.is_active ? "Deactivate" : "Activate"}
      </Button>
    </div>
  );
}

function CategoriesPanel() {
  const categories = useMvpQuery(() => getMvpApi().admin.categories(), []);
  const [slug, setSlug] = useState("");
  const [name, setName] = useState("");
  const { busy, error, ok, run } = useAction();

  const create = async (event: FormEvent) => {
    event.preventDefault();
    await run(
      "create",
      () => getMvpApi().admin.createCategory({ slug: slug.trim(), name: name.trim() }),
      "Category created.",
      () => {
        setSlug("");
        setName("");
        categories.reload();
      },
    );
  };

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Categories</h1>
        <p className="mt-1 text-sm text-slate-500">
          Public catalogue navigation. A category cannot be deleted while products reference it.
        </p>
      </div>

      {categories.loading ? (
        <MvpLoading label="Loading categories…" />
      ) : categories.error ? (
        <MvpErrorState error={categories.error} onRetry={categories.reload} />
      ) : (categories.data ?? []).length === 0 ? (
        <MvpEmpty title="No categories yet" description="Create the first one below." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {(categories.data ?? []).map((category) => (
            <CategoryRow key={category.id} category={category} onChanged={categories.reload} />
          ))}
        </div>
      )}

      <form onSubmit={create} className="grid gap-2 rounded-2xl border border-slate-200 bg-white p-4 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="cat-name" className="text-[11px] font-medium text-slate-500">
            Name
          </Label>
          <Input
            id="cat-name"
            required
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy !== null}
            className="h-9 rounded-[10px] border-slate-200"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="cat-slug" className="text-[11px] font-medium text-slate-500">
            Slug
          </Label>
          <Input
            id="cat-slug"
            required
            value={slug}
            onChange={(event) => setSlug(event.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))}
            disabled={busy !== null}
            className="h-9 rounded-[10px] border-slate-200"
          />
        </div>
        <div className="flex items-end">
          <Button
            type="submit"
            variant="outline"
            className="h-9 w-full gap-1"
            disabled={busy !== null || !name.trim() || !slug.trim()}
          >
            {busy === "create" ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Create category
          </Button>
        </div>
        <div className="sm:col-span-3">
          <Notice message={error} />
          <Notice message={ok} tone="ok" />
        </div>
      </form>
    </div>
  );
}

export default function Admin({ tab }: { tab: Tab }) {
  if (tab === "sellers") return <SellersPanel />;
  if (tab === "products") return <ProductsPanel />;
  if (tab === "categories") return <CategoriesPanel />;
  return <Overview />;
}
