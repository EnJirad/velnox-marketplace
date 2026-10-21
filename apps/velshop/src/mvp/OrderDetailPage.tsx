/**
 * MVP order detail and confirmation: `/orders/:orderId` (`?placed=1` after
 * checkout).
 *
 * THE PAYMENT RULE THIS PAGE ENFORCES
 * -----------------------------------
 * Returning from the hosted checkout does NOT mean the order is paid. The browser
 * refetches `GET /api/mvp/orders/:id` and `GET /api/mvp/orders/:id/payment-status`
 * and renders whatever the server says; Stripe's `?session_id=…` query parameter
 * is never trusted. The order is marked paid only by the signed webhook.
 *
 * Cancelling is allowed only while the order is `pending_payment`; the backend
 * enforces the transition, so the button is an affordance, not the rule.
 */
import { Button } from "@velnox/shared/components/ui/button";
import { getMvpApi, type MvpPaymentStatus } from "@velnox/shared/mvp";
import {
  MvpErrorState,
  MvpLoading,
  formatDate,
  formatMoney,
  toMvpError,
  useMvpQuery,
} from "@velnox/shared/mvp/ui";
import { CheckCircle2, CreditCard, Loader2, RefreshCw, Truck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { ErrorLine, OrderStatusBadge, ProductImage, SummaryRow } from "./components";

export default function OrderDetailPage() {
  const { orderId = "" } = useParams();
  const [params] = useSearchParams();
  const justPlaced = params.get("placed") === "1";

  const order = useMvpQuery(() => getMvpApi().orders.get(orderId), [orderId]);
  const [payment, setPayment] = useState<MvpPaymentStatus | null>(null);
  const [busy, setBusy] = useState<"pay" | "cancel" | "refresh" | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Refs, not deps: `order` is a fresh object on every render, so depending on it
  // would rebuild this callback forever and re-run the effect below non-stop.
  const reloadRef = useRef(order.reload);
  reloadRef.current = order.reload;
  const statusRef = useRef(order.data?.status);
  statusRef.current = order.data?.status;

  const refreshPaymentStatus = useCallback(async () => {
    try {
      const status = await getMvpApi().orders.paymentStatus(orderId);
      setPayment(status);
      // The order row carries the authoritative status; refetch it when the
      // payment state says something changed (e.g. the webhook just landed).
      if (status.settled || status.orderStatus !== statusRef.current) reloadRef.current();
    } catch {
      // A 401/404 here is not worth an error banner: the page still renders the
      // server's order state, which is the authority.
      setPayment(null);
    }
  }, [orderId]);

  useEffect(() => {
    if (order.loading) return;
    void refreshPaymentStatus();
    // Re-check when the buyer comes back from the hosted checkout tab.
    const onFocus = () => void refreshPaymentStatus();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [order.loading, refreshPaymentStatus]);

  if (order.loading) return <MvpLoading label="Loading order…" />;
  if (order.error) {
    return (
      <div className="mx-auto w-full max-w-lg py-16">
        <MvpErrorState error={order.error} onRetry={order.reload} />
      </div>
    );
  }
  const detail = order.data;
  if (!detail) return null;

  const isPending = detail.status === "pending_payment";
  const paid =
    Boolean(detail.paidAt) || (detail.status !== "pending_payment" && detail.status !== "cancelled");

  const pay = async () => {
    setBusy("pay");
    setError(null);
    try {
      const session = await getMvpApi().orders.createPaymentSession(detail.id, "CARD");
      if (session.url) {
        // Hosted checkout (Stripe TEST mode). The order stays pending_payment
        // until the signed webhook confirms it.
        window.location.assign(session.url);
        return;
      }
      setError("The payment provider did not return a checkout URL.");
    } catch (err) {
      setError(toMvpError(err).message);
    } finally {
      setBusy(null);
    }
  };

  const cancel = async () => {
    setBusy("cancel");
    setError(null);
    try {
      await getMvpApi().orders.cancel(detail.id);
      order.reload();
      void refreshPaymentStatus();
    } catch (err) {
      setError(toMvpError(err).message);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="grid gap-5">
      {justPlaced && (
        <div className="flex items-start gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
          <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-emerald-600" />
          <div>
            <p className="text-sm font-bold text-emerald-900">Order placed</p>
            <p className="mt-0.5 text-xs leading-5 text-emerald-800">
              We reserved your items. Complete payment to confirm the order — the status below always
              reflects what the server has confirmed.
            </p>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">{detail.orderNumber}</h1>
          <p className="mt-1 text-xs text-slate-500">Placed {formatDate(detail.createdAt)}</p>
        </div>
        <OrderStatusBadge status={detail.status} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr] lg:items-start">
        <section className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Items</p>
            <div className="mt-2 grid gap-3">
              {detail.items.map((item) => (
                <div key={item.id} className="flex gap-3">
                  <div className="w-14 shrink-0">
                    <ProductImage src={item.image_url} alt={item.product_name} className="aspect-square" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm font-medium text-slate-900">{item.product_name}</p>
                    {item.variant_name && <p className="text-xs text-slate-500">{item.variant_name}</p>}
                    <p className="text-xs text-slate-500">
                      {formatMoney(item.unit_price, detail.currency)} × {item.quantity}
                    </p>
                  </div>
                  <p className="shrink-0 text-sm font-semibold text-slate-900">
                    {formatMoney(item.subtotal, detail.currency)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="grid gap-2 border-t border-slate-100 pt-3">
            <SummaryRow label="Subtotal" value={formatMoney(detail.subtotal, detail.currency)} />
            <SummaryRow label="Shipping" value={formatMoney(detail.shippingFee, detail.currency)} />
            <SummaryRow label="Total" value={formatMoney(detail.totalAmount, detail.currency)} strong />
          </div>

          {detail.shippingAddress && (
            <div className="border-t border-slate-100 pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deliver to</p>
              <p className="mt-1 text-sm text-slate-800">{detail.shippingAddress.recipientName}</p>
              <p className="text-xs leading-5 text-slate-500">
                {[
                  detail.shippingAddress.line1,
                  detail.shippingAddress.line2,
                  detail.shippingAddress.subdistrict,
                  detail.shippingAddress.district,
                  detail.shippingAddress.city,
                  detail.shippingAddress.state,
                  detail.shippingAddress.postalCode,
                ]
                  .filter(Boolean)
                  .join(", ")}
              </p>
              <p className="text-xs text-slate-500">{detail.shippingAddress.phone}</p>
            </div>
          )}

          {detail.shipment && (
            <div className="flex items-start gap-2 rounded-xl bg-[#F8FAFC] p-3">
              <Truck className="mt-0.5 size-4 text-slate-500" />
              <div className="text-xs leading-5 text-slate-600">
                <p className="font-semibold text-slate-800">Shipment</p>
                <p>
                  {detail.shipment.carrier ?? "Carrier pending"}
                  {detail.shipment.tracking_number ? ` · ${detail.shipment.tracking_number}` : ""}
                </p>
                {detail.shipment.shipped_at && <p>Shipped {formatDate(detail.shipment.shipped_at)}</p>}
                {detail.shipment.delivered_at && <p>Delivered {formatDate(detail.shipment.delivered_at)}</p>}
              </div>
            </div>
          )}
        </section>

        <aside className="grid gap-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Payment</p>
            <p className="mt-1 text-sm font-semibold text-slate-900">
              {payment?.settled || paid ? "Confirmed by the server" : "Awaiting payment"}
            </p>
            {payment?.paidAt && (
              <p className="text-xs text-slate-500">Paid {formatDate(payment.paidAt)}</p>
            )}
            {isPending && detail.paymentExpiresAt && (
              <p className="mt-1 text-xs text-amber-700">
                Pay before {formatDate(detail.paymentExpiresAt)} or the order is cancelled and the stock
                released.
              </p>
            )}
            {detail.payments.length > 0 && (
              <ul className="mt-2 grid gap-1 text-xs text-slate-600">
                {detail.payments.map((row) => (
                  <li key={row.id} className="flex justify-between gap-2">
                    <span>
                      {row.method} · {row.status}
                    </span>
                    <span>{formatMoney(row.amount, row.currency)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {isPending && (
            <Button
              className="h-11 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
              disabled={busy !== null}
              onClick={pay}
            >
              {busy === "pay" ? <Loader2 className="size-4 animate-spin" /> : <CreditCard className="size-4" />}
              Pay now
            </Button>
          )}

          <Button
            variant="outline"
            className="h-10 gap-1.5"
            disabled={busy !== null}
            onClick={async () => {
              setBusy("refresh");
              await refreshPaymentStatus();
              order.reload();
              setBusy(null);
            }}
          >
            {busy === "refresh" ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />}
            Refresh status
          </Button>

          {isPending && (
            <Button
              variant="ghost"
              className="h-10 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
              disabled={busy !== null}
              onClick={cancel}
            >
              {busy === "cancel" ? <Loader2 className="size-4 animate-spin" /> : null}
              Cancel order
            </Button>
          )}

          <ErrorLine message={error} />

          <div className="border-t border-slate-100 pt-3 text-xs text-slate-500">
            <p className="font-semibold text-slate-700">{detail.seller.storeName}</p>
            <p>Sold and shipped by this store.</p>
          </div>

          <Button asChild variant="ghost" className="text-slate-500">
            <Link to="/orders">All orders</Link>
          </Button>
        </aside>
      </div>
    </div>
  );
}
