/**
 * Seller product editor: `/seller/products/:productId`.
 *
 * The whole lifecycle is server-driven:
 *   draft → submitted (seller) → approved (admin) → published (seller)
 *
 * A seller may edit a draft/rejected product, add variants, and set inventory.
 * INVENTORY IS ABSOLUTE, never a delta: `PUT /seller/products/:id/inventory`
 * writes the quantity the seller typed, and the backend refuses any value below
 * the quantity already reserved by unpaid/paid orders (409). Editing a listed
 * product's material fields demotes it out of `published` server-side.
 *
 * Images are URL references only. The MVP schema stores `product_images.url`, and
 * Phase 3b did not prove that the legacy R2 presign flow is safe against the MVP
 * auth model, so no upload control is offered here (documented limitation).
 */
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { getMvpApi, type MvpSellerProduct } from "@velnox/shared/mvp";
import {
  MvpErrorState,
  MvpLoading,
  formatDate,
  formatMoney,
  toMvpError,
  useMvpQuery,
} from "@velnox/shared/mvp/ui";
import { ArrowLeft, Loader2, PackageCheck, Save, Send, Plus } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useParams } from "react-router";

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

export default function ProductEditor() {
  const { productId = "" } = useParams();
  const query = useMvpQuery(() => getMvpApi().seller.product(productId), [productId]);
  const product = query.data;

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [images, setImages] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  // Hydrate the form once per loaded product (never on every refetch, so typing
  // is not overwritten by a background reload).
  useEffect(() => {
    if (!product) return;
    setName(product.name);
    setDescription(product.description ?? "");
    setPrice(product.price);
    setImages(product.images.map((image) => image.url).join("\n"));
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (query.loading) return <MvpLoading label="Loading product…" />;
  if (query.error) {
    return (
      <div className="mx-auto w-full max-w-lg py-10">
        <MvpErrorState error={query.error} onRetry={query.reload} />
      </div>
    );
  }
  if (!product) return null;

  const run = async (key: string, action: () => Promise<unknown>, success: string) => {
    setBusy(key);
    setError(null);
    setOk(null);
    try {
      await action();
      setOk(success);
      query.reload();
    } catch (err) {
      setError(toMvpError(err).message);
    } finally {
      setBusy(null);
    }
  };

  const editable = product.status === "draft" || product.status === "rejected" || product.status === "approved";

  const save = async (event: FormEvent) => {
    event.preventDefault();
    await run(
      "save",
      () =>
        getMvpApi().seller.updateProduct(product.id, {
          name: name.trim(),
          description: description.trim(),
          price: price.trim(),
          images: images
            .split(/[\n,]+/)
            .map((url) => url.trim())
            .filter(Boolean)
            .map((url, index) => ({ url, alt: `${name.trim()} ${index + 1}` })),
        }),
      "Saved.",
    );
  };

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Button asChild variant="ghost" size="sm" className="mb-1 -ml-3 gap-1 text-slate-500">
            <Link to="/seller/products">
              <ArrowLeft className="size-4" />
              All products
            </Link>
          </Button>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">{product.name}</h1>
          <p className="mt-1 text-xs text-slate-500">
            {product.status.replace(/_/g, " ")} · updated {formatDate(product.updatedAt)}
            {product.publishedAt ? ` · published ${formatDate(product.publishedAt)}` : ""}
          </p>
          {product.rejectionReason && (
            <p className="mt-2 rounded-[10px] bg-rose-50 px-3 py-2 text-xs text-rose-700">
              Rejected: {product.rejectionReason}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {(product.status === "draft" || product.status === "rejected") && (
            <Button
              className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
              disabled={busy !== null}
              onClick={() =>
                run("submit", () => getMvpApi().seller.submit(product.id), "Submitted for review.")
              }
            >
              {busy === "submit" ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
              Submit for review
            </Button>
          )}
          {product.status === "approved" && (
            <Button
              className="gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
              disabled={busy !== null}
              onClick={() =>
                run("publish", () => getMvpApi().seller.publish(product.id), "Published.")
              }
            >
              {busy === "publish" ? <Loader2 className="size-4 animate-spin" /> : <PackageCheck className="size-4" />}
              Publish
            </Button>
          )}
        </div>
      </div>

      <Notice message={error} />
      <Notice message={ok} tone="ok" />

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <form onSubmit={save} className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <p className="text-sm font-bold text-slate-900">Listing details</p>
          <div className="grid gap-2">
            <Label htmlFor="p-name" className="text-xs font-medium text-slate-500">
              Name *
            </Label>
            <Input
              id="p-name"
              required
              minLength={2}
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={!editable || busy !== null}
              className="h-11 rounded-[10px] border-slate-200"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-price" className="text-xs font-medium text-slate-500">
              Base price (THB) *
            </Label>
            <Input
              id="p-price"
              required
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              disabled={!editable || busy !== null}
              className="h-11 rounded-[10px] border-slate-200"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-desc" className="text-xs font-medium text-slate-500">
              Description
            </Label>
            <textarea
              id="p-desc"
              rows={5}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={!editable || busy !== null}
              className="rounded-[10px] border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#10B981] focus:ring-2 focus:ring-[#10B981]/20"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="p-images" className="text-xs font-medium text-slate-500">
              Image URLs (one per line)
            </Label>
            <textarea
              id="p-images"
              rows={3}
              value={images}
              onChange={(event) => setImages(event.target.value)}
              disabled={!editable || busy !== null}
              placeholder="https://cdn.example.com/product.jpg"
              className="rounded-[10px] border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#10B981] focus:ring-2 focus:ring-[#10B981]/20"
            />
            <p className="text-[11px] leading-5 text-slate-400">
              Image upload is not wired to the MVP API yet — paste hosted URLs. SVG and other
              non-image URLs are stored as given and are NOT rendered by the storefront.
            </p>
          </div>
          <Button
            type="submit"
            className="h-11 w-fit gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
            disabled={!editable || busy !== null}
          >
            {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            Save changes
          </Button>
          {!editable && (
            <p className="text-[11px] text-slate-400">
              This listing is {product.status.replace(/_/g, " ")} and cannot be edited right now.
            </p>
          )}
        </form>

        <div className="grid gap-4">
          <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
            <p className="text-sm font-bold text-slate-900">Inventory</p>
            {product.variants.length === 0 ? (
              <StockEditor
                product={product}
                onSaved={query.reload}
                setError={setError}
                setOk={setOk}
                setBusy={setBusy}
                busy={busy}
              />
            ) : (
              <div className="mt-2 grid gap-3">
                {product.variants.map((variant) => (
                  <div key={variant.id} className="rounded-xl border border-slate-100 p-3">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold text-slate-900">{variant.name}</p>
                      <p className="text-xs text-slate-500">{formatMoney(variant.price)}</p>
                    </div>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {variant.stock.quantity} on hand · {variant.stock.reserved} reserved ·{" "}
                      {variant.stock.available} available
                    </p>
                    <StockEditor
                      product={product}
                      variantId={variant.id}
                      initial={variant.stock.quantity}
                      onSaved={query.reload}
                      setError={setError}
                      setOk={setOk}
                      setBusy={setBusy}
                      busy={busy}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          <VariantsSection product={product} onChanged={query.reload} />
        </div>
      </div>
    </div>
  );
}

/** Absolute inventory write for the base product or one variant. */
function StockEditor({
  product,
  variantId,
  initial = 0,
  onSaved,
  setError,
  setOk,
  setBusy,
  busy,
}: {
  product: MvpSellerProduct;
  variantId?: string;
  initial?: number;
  onSaved: () => void;
  setError: (value: string | null) => void;
  setOk: (value: string | null) => void;
  setBusy: (value: string | null) => void;
  busy: string | null;
}) {
  const [quantity, setQuantity] = useState(String(initial));

  useEffect(() => setQuantity(String(initial)), [initial]);

  const save = async () => {
    const key = `inv-${variantId ?? "base"}`;
    setBusy(key);
    setError(null);
    setOk(null);
    try {
      await getMvpApi().seller.setInventory(product.id, {
        variantId: variantId ?? null,
        quantity: Number(quantity) || 0,
      });
      setOk("Inventory updated.");
      onSaved();
    } catch (err) {
      // The backend refuses a quantity below the reserved amount (409) — show the
      // server's message rather than clamping silently.
      setError(toMvpError(err).message);
    } finally {
      setBusy(null);
    }
  };

  const key = `inv-${variantId ?? "base"}`;

  return (
    <div className="mt-2 flex items-end gap-2">
      <div className="grid gap-1">
        <Label className="text-[11px] font-medium text-slate-500">Quantity on hand</Label>
        <Input
          inputMode="numeric"
          value={quantity}
          onChange={(event) => setQuantity(event.target.value.replace(/[^0-9]/g, ""))}
          disabled={busy !== null}
          className="h-9 w-28 rounded-[10px] border-slate-200"
        />
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-9"
        disabled={busy !== null}
        onClick={save}
      >
        {busy === key ? <Loader2 className="size-3.5 animate-spin" /> : "Set"}
      </Button>
    </div>
  );
}

/** Add a variant (its own price + opening stock). */
function VariantsSection({ product, onChanged }: { product: MvpSellerProduct; onChanged: () => void }) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const add = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await getMvpApi().seller.addVariant(product.id, {
        name: name.trim(),
        price: price.trim(),
        stock: Number(stock) || 0,
      });
      setName("");
      setPrice("");
      setStock("0");
      onChanged();
    } catch (err) {
      setError(toMvpError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const editable = product.status === "draft" || product.status === "rejected";

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <p className="text-sm font-bold text-slate-900">Variants</p>
      <p className="mt-0.5 text-xs text-slate-500">
        Each variant has its own price and stock. A product with variants is bought per variant.
      </p>
      {product.variants.length > 0 && (
        <ul className="mt-2 grid gap-1 text-xs text-slate-600">
          {product.variants.map((variant) => (
            <li key={variant.id} className="flex justify-between gap-2">
              <span>{variant.name}</span>
              <span>
                {formatMoney(variant.price)} · {variant.stock.available} available
              </span>
            </li>
          ))}
        </ul>
      )}
      {editable ? (
        <form onSubmit={add} className="mt-3 grid gap-2 sm:grid-cols-3">
          <Input
            required
            placeholder="Variant name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            disabled={busy}
            className="h-9 rounded-[10px] border-slate-200 sm:col-span-3"
          />
          <Input
            required
            inputMode="decimal"
            placeholder="Price"
            value={price}
            onChange={(event) => setPrice(event.target.value)}
            disabled={busy}
            className="h-9 rounded-[10px] border-slate-200"
          />
          <Input
            inputMode="numeric"
            placeholder="Stock"
            value={stock}
            onChange={(event) => setStock(event.target.value.replace(/[^0-9]/g, ""))}
            disabled={busy}
            className="h-9 rounded-[10px] border-slate-200"
          />
          <Button type="submit" variant="outline" className="h-9 gap-1" disabled={busy || !name.trim()}>
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            Add
          </Button>
        </form>
      ) : (
        <p className="mt-3 text-[11px] text-slate-400">
          Variants can only be added while the product is a draft or was rejected.
        </p>
      )}
      <Notice message={error} />
    </section>
  );
}
