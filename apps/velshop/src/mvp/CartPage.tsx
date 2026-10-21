/**
 * MVP cart: `/cart`.
 *
 * The MVP backend keeps ONE CART PER SELLER (`carts_one_per_seller`), so this page
 * renders each seller's cart separately and sends the buyer to a checkout for a
 * SINGLE cart. Multi-seller checkout is deliberately not implemented — the API
 * cannot represent it, and pretending otherwise in the UI would create one order
 * per click.
 *
 * Every line shows the server's unit price / line total / availability. Quantity
 * edits go to the API and the list is re-read, so a rejected edit (stock dropped,
 * product unpublished) corrects the screen instead of being swallowed.
 *
 * A line names the selling unit it was added as (a single unit or a pack). The
 * pack's label and base quantity come from the server, and the quantity stepper
 * counts PACKS — the line's base-unit total is shown so "2 packs of 6" is never
 * read as two units.
 */
import { Button } from "@velnox/shared/components/ui/button";
import type { MvpCartItem } from "@velnox/shared/mvp";
import { MvpEmpty, MvpErrorState, MvpLoading, formatMoney, toMvpError } from "@velnox/shared/mvp/ui";
import { Loader2, Minus, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { ErrorLine, ProductImage, SummaryRow } from "./components";
import { useMvpCart } from "./cart";
import { useSession } from "./session";

function CartLine({ item }: { item: MvpCartItem }) {
  const { updateItem, removeItem } = useMvpCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(toMvpError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const unavailable = item.available <= 0;

  return (
    <div className="flex gap-3 border-b border-slate-100 py-3 last:border-b-0">
      <Link to={`/products/${encodeURIComponent(item.productSlug)}`} className="w-20 shrink-0">
        <ProductImage src={item.imageUrl} alt={item.productName} className="aspect-square" />
      </Link>
      <div className="min-w-0 flex-1">
        <Link
          to={`/products/${encodeURIComponent(item.productSlug)}`}
          className="line-clamp-2 text-sm font-medium text-slate-900 hover:text-[#059669]"
        >
          {item.productName}
        </Link>
        {item.variantName && <p className="mt-0.5 text-xs text-slate-500">{item.variantName}</p>}
        {item.sellingUnitLabel && (
          <p className="mt-0.5 text-xs font-medium text-emerald-700">
            {item.sellingUnitLabel}
            {item.sellingUnitBaseQuantity > 1 ? ` · ${item.sellingUnitBaseQuantity} units` : ""}
          </p>
        )}
        <p className="mt-0.5 text-xs text-slate-500">
          {formatMoney(item.unitPrice)} each
          {unavailable ? " · no longer available" : ` · ${item.available} available`}
          {item.baseQuantityTotal > item.quantity ? ` · ${item.baseQuantityTotal} units total` : ""}
        </p>

        <div className="mt-2 flex items-center gap-2">
          <div className="flex items-center rounded-[10px] border border-slate-200">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-r-none"
              aria-label="Decrease quantity"
              disabled={busy || item.quantity <= 1}
              onClick={() => run(() => updateItem(item.id, item.quantity - 1))}
            >
              <Minus className="size-3.5" />
            </Button>
            <span className="w-8 text-center text-xs font-semibold text-slate-900">{item.quantity}</span>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 rounded-l-none"
              aria-label="Increase quantity"
              disabled={busy || item.quantity >= item.available}
              onClick={() => run(() => updateItem(item.id, item.quantity + 1))}
            >
              <Plus className="size-3.5" />
            </Button>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-slate-400 hover:text-rose-600"
            aria-label="Remove item"
            disabled={busy}
            onClick={() => run(() => removeItem(item.id))}
          >
            {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
          </Button>
          <span className="ml-auto text-sm font-semibold text-slate-900">
            {formatMoney(item.lineTotal)}
          </span>
        </div>
        <ErrorLine message={error} />
      </div>
    </div>
  );
}

export default function CartPage() {
  const { user, loading: sessionLoading } = useSession();
  const { carts, loading, error, reload } = useMvpCart();
  const [refreshing, setRefreshing] = useState(false);

  if (sessionLoading || (user && loading)) return <MvpLoading label="Loading your cart…" />;

  if (!user) {
    return (
      <div className="mx-auto w-full max-w-lg py-16">
        <MvpEmpty
          title="Sign in to see your cart"
          description="Carts belong to an account, so your items follow you between devices."
        >
          <Button asChild className="bg-slate-900 text-white hover:bg-slate-800">
            <Link to="/auth?returnTo=/cart">Sign in</Link>
          </Button>
        </MvpEmpty>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto w-full max-w-lg py-16">
        <MvpErrorState error={error} onRetry={reload} />
      </div>
    );
  }

  if (carts.length === 0) {
    return (
      <div className="mx-auto w-full max-w-lg py-16">
        <MvpEmpty title="Your cart is empty" description="Add a product to start an order.">
          <Button asChild className="bg-[#10B981] text-white hover:bg-[#059669]">
            <Link to="/products">Browse products</Link>
          </Button>
        </MvpEmpty>
      </div>
    );
  }

  return (
    <div className="grid gap-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Your cart</h1>
          <p className="mt-1 text-sm text-slate-500">
            One order per seller. Totals are calculated by the server.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={refreshing}
          onClick={async () => {
            setRefreshing(true);
            reload();
            setRefreshing(false);
          }}
        >
          Refresh
        </Button>
      </div>

      {carts.map((cart) => (
        <section key={cart.id} className="rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div className="mb-1 flex items-baseline justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <p className="text-sm font-bold text-slate-900">{cart.seller.storeName}</p>
              <p className="text-xs text-slate-500">
                {cart.itemCount} item{cart.itemCount === 1 ? "" : "s"}
              </p>
            </div>
          </div>

          {cart.items.map((item) => (
            <CartLine key={item.id} item={item} />
          ))}

          <div className="mt-3 grid gap-2 border-t border-slate-100 pt-3">
            <SummaryRow label="Subtotal" value={formatMoney(cart.subtotal)} strong />
            <Button
              asChild
              className="h-11 w-full gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
            >
              <Link to={`/checkout?cart=${encodeURIComponent(cart.id)}`}>
                Checkout with {cart.seller.storeName}
              </Link>
            </Button>
          </div>
        </section>
      ))}

      {carts.length > 1 && (
        <p className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800">
          Your items come from {carts.length} sellers, so they become {carts.length} separate orders.
          Check out one seller at a time.
        </p>
      )}

      <Button asChild variant="ghost" className="w-fit text-slate-500">
        <Link to="/products">Continue shopping</Link>
      </Button>

    </div>
  );
}
