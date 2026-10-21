/**
 * MVP checkout: `/checkout?cart=<cartId>`.
 *
 * What this page does NOT do, on purpose:
 *   • it does not compute the total — the cart subtotal and the created order's
 *     totals both come from the API;
 *   • it does not send a price — `checkout` re-reads every price and stock level
 *     inside its transaction, so a tampered request would change nothing;
 *   • it does not treat a successful POST as "paid" — a new order is
 *     `pending_payment` until the payment provider confirms it.
 *
 * ONE seller per order: the cart id identifies the seller, and the backend refuses
 * a mixed-seller cart by schema.
 *
 * IDEMPOTENCY: `requestKey` is generated once per mount and reused for every
 * retry, so a double click or a retried request returns the SAME order
 * (`checkout_requests` UNIQUE(user, key)) instead of creating a second one.
 */
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { getMvpApi, type MvpShippingAddress } from "@velnox/shared/mvp";
import { MvpEmpty, MvpLoading, formatMoney, toMvpError } from "@velnox/shared/mvp/ui";
import { Loader2, ShieldCheck } from "lucide-react";
import { useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ErrorLine, SummaryRow } from "./components";
import { useMvpCart } from "./cart";
import { useSession } from "./session";

interface AddressForm {
  recipientName: string;
  phone: string;
  line1: string;
  line2: string;
  subdistrict: string;
  district: string;
  city: string;
  state: string;
  postalCode: string;
}

const EMPTY_ADDRESS: AddressForm = {
  recipientName: "",
  phone: "",
  line1: "",
  line2: "",
  subdistrict: "",
  district: "",
  city: "",
  state: "",
  postalCode: "",
};

function newRequestKey(): string {
  const uuid = globalThis.crypto?.randomUUID?.();
  // The backend requires 8–128 characters; this fallback keeps the client usable
  // on an insecure origin (where `crypto.randomUUID` is unavailable).
  return uuid ?? `mvp-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}

export default function CheckoutPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useSession();
  const { carts, loading, error, reload } = useMvpCart();

  const requestedCartId = params.get("cart");
  const cart = useMemo(() => {
    if (requestedCartId) return carts.find((entry) => entry.id === requestedCartId) ?? null;
    return carts.length === 1 ? carts[0]! : null;
  }, [carts, requestedCartId]);

  const requestKey = useRef(newRequestKey());
  const [address, setAddress] = useState<AddressForm>(() => ({
    ...EMPTY_ADDRESS,
    recipientName: user?.name ?? "",
  }));
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error_, setError] = useState<string | null>(null);

  if (loading) return <MvpLoading label="Preparing checkout…" />;

  if (error) {
    return (
      <div className="mx-auto w-full max-w-lg py-16">
        <MvpEmpty title="We could not load your cart" description={error.message}>
          <Button onClick={reload} className="bg-slate-900 text-white hover:bg-slate-800">
            Try again
          </Button>
        </MvpEmpty>
      </div>
    );
  }

  if (!cart) {
    return (
      <div className="mx-auto w-full max-w-lg py-16">
        <MvpEmpty
          title="Choose a cart to check out"
          description={
            carts.length === 0
              ? "Your cart is empty."
              : "Each seller is a separate order. Pick one from your cart."
          }
        >
          <Button asChild className="bg-slate-900 text-white hover:bg-slate-800">
            <Link to="/cart">{carts.length === 0 ? "Browse products" : "Back to cart"}</Link>
          </Button>
        </MvpEmpty>
      </div>
    );
  }

  const field = (key: keyof AddressForm) => ({
    value: address[key],
    onChange: (event: ChangeEvent<HTMLInputElement>) =>
      setAddress((current) => ({ ...current, [key]: event.target.value })),
    disabled: busy,
    className: "h-11 rounded-[10px] border-slate-200",
  });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const payload: MvpShippingAddress = {
        label: "Home",
        recipientName: address.recipientName.trim(),
        phone: address.phone.trim(),
        line1: address.line1.trim(),
        line2: address.line2.trim() || null,
        subdistrict: address.subdistrict.trim() || null,
        district: address.district.trim() || null,
        city: address.city.trim(),
        state: address.state.trim(),
        postalCode: address.postalCode.trim(),
        country: "TH",
      };
      const result = await getMvpApi().checkout.create({
        cartId: cart.id,
        sellerId: cart.seller.id,
        requestKey: requestKey.current,
        address: payload,
        notes: notes.trim() || null,
      });
      // The order id comes from the server; the payment state on the next page is
      // read from the server too (never inferred from this redirect).
      navigate(`/orders/${encodeURIComponent(result.order.id)}?placed=1`, { replace: true });
    } catch (err) {
      setError(toMvpError(err).message);
      // A failed checkout can still have changed stock; refresh the cart so the
      // summary the buyer is looking at matches reality.
      reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr] lg:items-start">
      <form onSubmit={submit} className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-6">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Checkout</h1>
          <p className="mt-1 text-sm text-slate-500">
            Order from {cart.seller.storeName} · {cart.itemCount} item
            {cart.itemCount === 1 ? "" : "s"}
          </p>
        </div>

        <div className="grid gap-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Delivery address</p>

          <div className="grid gap-2">
            <Label htmlFor="recipient" className="text-xs font-medium text-slate-500">
              Recipient name *
            </Label>
            <Input id="recipient" required {...field("recipientName")} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="phone" className="text-xs font-medium text-slate-500">
                Phone *
              </Label>
              <Input id="phone" type="tel" required {...field("phone")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="postal" className="text-xs font-medium text-slate-500">
                Postal code *
              </Label>
              <Input id="postal" required {...field("postalCode")} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="line1" className="text-xs font-medium text-slate-500">
              Address line 1 *
            </Label>
            <Input id="line1" required {...field("line1")} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="line2" className="text-xs font-medium text-slate-500">
              Address line 2
            </Label>
            <Input id="line2" {...field("line2")} />
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="subdistrict" className="text-xs font-medium text-slate-500">
                Subdistrict
              </Label>
              <Input id="subdistrict" {...field("subdistrict")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="district" className="text-xs font-medium text-slate-500">
                District
              </Label>
              <Input id="district" {...field("district")} />
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2">
            <div className="grid gap-2">
              <Label htmlFor="city" className="text-xs font-medium text-slate-500">
                City / Province *
              </Label>
              <Input id="city" required {...field("city")} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="state" className="text-xs font-medium text-slate-500">
                State *
              </Label>
              <Input id="state" required {...field("state")} />
            </div>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="notes" className="text-xs font-medium text-slate-500">
              Delivery note
            </Label>
            <textarea
              id="notes"
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              disabled={busy}
              className="rounded-[10px] border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#10B981] focus:ring-2 focus:ring-[#10B981]/20"
            />
          </div>
        </div>

        <ErrorLine message={error_} />

        <p className="flex items-start gap-1.5 rounded-[10px] bg-[#F8FAFC] px-3 py-2 text-[11px] leading-5 text-slate-500">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[#10B981]" />
          Prices, stock and the final total are re-checked by the server when you place this order.
          It is not paid until the payment provider confirms it.
        </p>

        <Button
          type="submit"
          className="h-11 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
          disabled={busy}
        >
          {busy && <Loader2 className="size-4 animate-spin" />}
          Place order
        </Button>
      </form>

      <aside className="grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
        <p className="text-sm font-bold text-slate-900">Order summary</p>
        {cart.items.map((item) => (
          <div key={item.id} className="flex justify-between gap-3 text-xs">
            <span className="min-w-0 text-slate-600">
              <span className="line-clamp-2">{item.productName}</span>
              {item.variantName && <span className="block text-slate-400">{item.variantName}</span>}
              {item.sellingUnitLabel && (
                <span className="block text-slate-400">
                  {item.sellingUnitLabel}
                  {item.sellingUnitBaseQuantity > 1
                    ? ` · ${item.sellingUnitBaseQuantity} units each`
                    : ""}
                </span>
              )}
              <span className="text-slate-400">× {item.quantity}</span>
            </span>
            <span className="shrink-0 font-medium text-slate-900">{formatMoney(item.lineTotal)}</span>
          </div>
        ))}
        <div className="mt-1 grid gap-2 border-t border-slate-100 pt-3">
          <SummaryRow label="Subtotal" value={formatMoney(cart.subtotal)} strong />
          {/* No client-side total: the order's own `totalAmount` is what the
              server charges, and it is shown on the confirmation page. */}
          <p className="text-[11px] leading-5 text-slate-400">
            The final total, including shipping, is confirmed by the server when the order is
            placed.
          </p>
        </div>
        <Button asChild variant="ghost" size="sm" className="text-slate-500">
          <Link to="/cart">Edit cart</Link>
        </Button>
      </aside>
    </div>
  );
}
