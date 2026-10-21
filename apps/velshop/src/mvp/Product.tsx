/**
 * MVP product detail: `/products/:slug`.
 *
 * The page shows the seller's published listing — images, description, the base
 * price, every active variant with ITS price and available count, and the
 * product-level availability. When a variant is selected its price is displayed
 * because that is the price the server will charge for it; nothing is computed
 * locally.
 *
 * Adding to the cart needs a session (the cart endpoints require one), so a
 * signed-out visitor is sent to `/auth` with a return path instead of getting a
 * silent 401.
 */
import { Button } from "@velnox/shared/components/ui/button";
import { getMvpApi, type MvpVariantOption } from "@velnox/shared/mvp";
import { MvpErrorState, MvpLoading, formatMoney, toMvpError, useMvpQuery } from "@velnox/shared/mvp/ui";
import { ArrowLeft, Loader2, Minus, Plus, Store } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { ErrorLine, ProductImage } from "./components";
import { useMvpCart } from "./cart";
import { useSession } from "./session";

export default function Product() {
  const { slug = "" } = useParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const { addItem } = useMvpCart();

  const product = useMvpQuery(() => getMvpApi().catalog.product(slug), [slug]);
  const [variantId, setVariantId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [activeImage, setActiveImage] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [added, setAdded] = useState(false);

  const detail = product.data;
  const activeVariants = useMemo<MvpVariantOption[]>(
    () => (detail?.variants ?? []).filter((variant) => variant.status === "active"),
    [detail],
  );
  const selectedVariant = activeVariants.find((variant) => variant.id === variantId) ?? null;

  // The server's availability for the thing being bought right now.
  const available = selectedVariant ? selectedVariant.available : (detail?.available ?? 0);
  const unitPrice = selectedVariant ? selectedVariant.price : (detail?.price ?? null);
  const canBuy = available > 0 && (!activeVariants.length || !!selectedVariant);

  if (product.loading) return <MvpLoading label="Loading product…" />;
  if (product.error) {
    if (product.error.isNotFound) {
      return (
        <div className="mx-auto w-full max-w-lg py-16 text-center">
          <h1 className="text-xl font-bold text-slate-900">This product is not available</h1>
          <p className="mt-2 text-sm text-slate-500">
            It may be unpublished, awaiting review, or withdrawn by the seller.
          </p>
          <Button asChild className="mt-5 bg-slate-900 text-white hover:bg-slate-800">
            <Link to="/products">Browse other products</Link>
          </Button>
        </div>
      );
    }
    return (
      <div className="mx-auto w-full max-w-lg py-16">
        <MvpErrorState error={product.error} onRetry={product.reload} />
      </div>
    );
  }
  if (!detail) return null;

  const images = detail.images.length > 0 ? detail.images : [];
  const shown = images[Math.min(activeImage, Math.max(images.length - 1, 0))];

  const handleAdd = async () => {
    if (!user) {
      const returnTo = `/products/${encodeURIComponent(slug)}`;
      navigate(`/auth?returnTo=${encodeURIComponent(returnTo)}`);
      return;
    }
    setBusy(true);
    setError(null);
    setAdded(false);
    try {
      await addItem({
        productId: detail.id,
        variantId: selectedVariant?.id ?? null,
        quantity,
      });
      setAdded(true);
    } catch (err) {
      // The server is the authority on stock and lifecycle: show exactly what it
      // said (409 CONFLICT for stock, 404 for an unpublished product, …).
      setError(toMvpError(err).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6">
      <Button asChild variant="ghost" size="sm" className="w-fit gap-1 pl-0 text-slate-500">
        <Link to="/products">
          <ArrowLeft className="size-4" />
          All products
        </Link>
      </Button>

      <div className="grid gap-6 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6 lg:grid-cols-2">
        {/* Images */}
        <div className="grid gap-2">
          <ProductImage src={shown?.url ?? null} alt={shown?.alt || detail.name} className="aspect-square" />
          {images.length > 1 && (
            <div className="grid grid-cols-5 gap-2">
              {images.map((image, index) => (
                <button
                  key={`${image.url}-${index}`}
                  type="button"
                  onClick={() => setActiveImage(index)}
                  className={`overflow-hidden rounded-lg border ${
                    index === activeImage ? "border-[#10B981]" : "border-slate-200"
                  }`}
                  aria-label={`Image ${index + 1}`}
                >
                  <img src={image.url} alt={image.alt || detail.name} className="aspect-square w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Buy box */}
        <div className="grid content-start gap-4">
          <div>
            <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500">
              <Store className="size-3.5" />
              {detail.seller.storeName}
            </span>
            <h1 className="mt-1.5 text-2xl font-bold leading-tight tracking-tight text-slate-900">
              {detail.name}
            </h1>
          </div>

          <div>
            <p className="text-2xl font-black text-slate-900">{formatMoney(unitPrice, detail.currency)}</p>
            <p className="mt-0.5 text-xs text-slate-500">
              {available > 0 ? `${available} available` : "Out of stock"}
              {selectedVariant ? ` · ${selectedVariant.name}` : ""}
            </p>
          </div>

          {activeVariants.length > 0 && (
            <div className="grid gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Choose an option</p>
              <div className="flex flex-wrap gap-2">
                {activeVariants.map((variant) => {
                  const disabled = variant.available <= 0;
                  const selected = variant.id === variantId;
                  return (
                    <button
                      key={variant.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        setVariantId(variant.id);
                        setQuantity(1);
                        setAdded(false);
                      }}
                      className={`rounded-[10px] border px-3 py-2 text-left text-xs transition-colors ${
                        selected
                          ? "border-[#10B981] bg-emerald-50 text-emerald-800"
                          : disabled
                            ? "border-slate-200 bg-slate-50 text-slate-400"
                            : "border-slate-200 bg-white text-slate-700 hover:border-slate-300"
                      }`}
                    >
                      <span className="block font-semibold">{variant.name}</span>
                      <span className="block">
                        {formatMoney(variant.price, detail.currency)}
                        {disabled ? " · sold out" : ` · ${variant.available} left`}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex items-center gap-3">
            <div className="flex items-center rounded-[10px] border border-slate-200">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 rounded-r-none"
                aria-label="Decrease quantity"
                disabled={quantity <= 1}
                onClick={() => setQuantity((value) => Math.max(1, value - 1))}
              >
                <Minus className="size-4" />
              </Button>
              <span className="w-10 text-center text-sm font-semibold text-slate-900">{quantity}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 rounded-l-none"
                aria-label="Increase quantity"
                disabled={quantity >= Math.max(available, 1)}
                onClick={() => setQuantity((value) => Math.min(Math.max(available, 1), value + 1))}
              >
                <Plus className="size-4" />
              </Button>
            </div>
            <Button
              className="h-11 flex-1 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
              disabled={busy || !canBuy}
              onClick={handleAdd}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {available <= 0
                ? "Out of stock"
                : activeVariants.length && !selectedVariant
                  ? "Choose an option"
                  : "Add to cart"}
            </Button>
          </div>

          {added && (
            <div className="flex items-center justify-between gap-3 rounded-[10px] bg-emerald-50 px-3 py-2">
              <p className="text-xs font-medium text-emerald-800">Added to your cart.</p>
              <Button asChild size="sm" variant="ghost" className="h-7 text-emerald-800">
                <Link to="/cart">View cart</Link>
              </Button>
            </div>
          )}
          <ErrorLine message={error} />

          {detail.description && (
            <div className="border-t border-slate-100 pt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Description</p>
              <p className="mt-1.5 whitespace-pre-line text-sm leading-6 text-slate-600">
                {detail.description}
              </p>
            </div>
          )}

          {detail.seller.description && (
            <div className="rounded-xl bg-[#F8FAFC] p-3">
              <p className="text-xs font-semibold text-slate-700">About {detail.seller.storeName}</p>
              <p className="mt-1 text-xs leading-5 text-slate-500">{detail.seller.description}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
