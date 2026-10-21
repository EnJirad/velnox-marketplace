/**
 * Seller orders: `/seller/orders`.
 *
 * The list is scoped to the caller's own seller profile by the backend query, and
 * the ONLY transitions offered are the three a seller may perform
 * (`processing → shipped → delivered`). Payment settlement and cancellation are
 * not seller actions: marking an order paid requires a signed payment webhook, so
 * no button here can do it.
 */
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { getMvpApi, type MvpSellerOrderRow } from "@velnox/shared/mvp";
import {
  MvpEmpty,
  MvpErrorState,
  MvpLoading,
  formatDate,
  formatMoney,
  toMvpError,
  useMvpQuery,
} from "@velnox/shared/mvp/ui";
import { Loader2 } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";

const TONE: Record<string, string> = {
  pending_payment: "bg-amber-50 text-amber-700 border-amber-200",
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  processing: "bg-sky-50 text-sky-700 border-sky-200",
  shipped: "bg-indigo-50 text-indigo-700 border-indigo-200",
  delivered: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-slate-100 text-slate-600 border-slate-200",
};

/** Which fulfilment action (if any) the server will accept right now. */
function nextAction(status: string): "processing" | "shipped" | "delivered" | null {
  if (status === "paid") return "processing";
  if (status === "processing") return "shipped";
  if (status === "shipped") return "delivered";
  return null;
}

function OrderCard({ order, onUpdated }: { order: MvpSellerOrderRow; onUpdated: () => void }) {
  const [carrier, setCarrier] = useState("");
  const [tracking, setTracking] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const next = nextAction(order.status);

  const advance = async () => {
    if (!next) return;
    setBusy(true);
    setError(null);
    try {
      await getMvpApi().seller.updateOrderStatus(order.id, {
        status: next,
        carrier: carrier.trim() || undefined,
        trackingNumber: tracking.trim() || undefined,
      });
      onUpdated();
    } catch (err) {
      setError(toMvpError(err).message);
    } finally {
      setBusy(false);
    }
  };

  const address = order.shipping_address;

  return (
    <div className="border-b border-slate-100 p-4 last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-bold text-slate-900">{order.order_number}</p>
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
            TONE[order.status] ?? "bg-slate-100 text-slate-600 border-slate-200"
          }`}
        >
          {order.status.replace(/_/g, " ")}
        </span>
        <span className="text-xs text-slate-500">
          {order.item_count} item{order.item_count === 1 ? "" : "s"} · {formatDate(order.created_at)}
        </span>
        <span className="ml-auto text-sm font-bold text-slate-900">
          {formatMoney(order.total_amount, order.currency)}
        </span>
      </div>

      <p className="mt-1 text-xs text-slate-600">
        Buyer: {order.buyer_name}
        {order.payment_status ? ` · payment ${order.payment_status}` : ""}
      </p>

      {address && (
        <p className="mt-1 text-[11px] leading-5 text-slate-500">
          Ship to {address.recipientName}, {address.phone} —{" "}
          {[address.line1, address.line2, address.city, address.state, address.postalCode]
            .filter(Boolean)
            .join(", ")}
        </p>
      )}
      {order.notes && <p className="mt-1 text-[11px] text-slate-500">Note: {order.notes}</p>}

      {next === "shipped" && (
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          <div className="grid gap-1">
            <Label className="text-[11px] font-medium text-slate-500">Carrier</Label>
            <Input
              value={carrier}
              onChange={(event) => setCarrier(event.target.value)}
              disabled={busy}
              className="h-9 rounded-[10px] border-slate-200"
              placeholder="Kerry / Flash / Thailand Post"
            />
          </div>
          <div className="grid gap-1">
            <Label className="text-[11px] font-medium text-slate-500">Tracking number</Label>
            <Input
              value={tracking}
              onChange={(event) => setTracking(event.target.value)}
              disabled={busy}
              className="h-9 rounded-[10px] border-slate-200"
            />
          </div>
        </div>
      )}

      {error && (
        <p className="mt-2 rounded-[10px] bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
          {error}
        </p>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-2">
        {next ? (
          <Button size="sm" className="h-9 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" disabled={busy} onClick={advance}>
            {busy && <Loader2 className="size-3.5 animate-spin" />}
            {next === "processing"
              ? "Start processing"
              : next === "shipped"
                ? "Mark shipped"
                : "Mark delivered"}
          </Button>
        ) : (
          <span className="text-[11px] text-slate-400">
            {order.status === "pending_payment"
              ? "Waiting for the buyer's payment — the order becomes paid only when the payment webhook confirms it."
              : "No further fulfilment action is available for this order."}
          </span>
        )}
        <Button asChild variant="ghost" size="sm" className="text-slate-500">
          <Link to="/seller">Back to overview</Link>
        </Button>
      </div>
    </div>
  );
}

export default function OrdersPanel() {
  const orders = useMvpQuery(() => getMvpApi().seller.orders(), []);

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">Orders</h1>
        <p className="mt-1 text-sm text-slate-500">
          Only orders placed with your store. Payment is confirmed by the payment provider, never by
          this page.
        </p>
      </div>

      {orders.loading ? (
        <MvpLoading label="Loading orders…" />
      ) : orders.error ? (
        <MvpErrorState error={orders.error} onRetry={orders.reload} />
      ) : (orders.data ?? []).length === 0 ? (
        <MvpEmpty title="No orders yet" description="Paid orders from your published products appear here." />
      ) : (
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {(orders.data ?? []).map((order) => (
            <OrderCard key={order.id} order={order} onUpdated={orders.reload} />
          ))}
        </div>
      )}
    </div>
  );
}
