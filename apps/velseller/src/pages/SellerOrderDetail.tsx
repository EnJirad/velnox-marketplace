import { OrderStatusBadge } from "@velnox/shared/components/order/OrderStatusBadge";
import { AppHeader } from "@velnox/shared/components/AppHeader";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@velnox/shared/components/ui/alert-dialog";
import { Button } from "@velnox/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { ApiError, api, useAction } from "@velnox/shared/lib/api-routes";
import {
  formatBaht,
  formatIsoDateTime,
  getPaymentStatusBadge,
  NEXT_ORDER_STATUSES,
  orderStatusI18nKey,
  type StoreOrder,
  type StoreOrderStatus,
} from "@velnox/shared/lib/commerce";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { SITE_URLS, joinUrl } from "@velnox/shared/lib/sites";
import {
  ArrowLeft,
  CreditCard,
  ExternalLink,
  ImageOff,
  Loader2,
  MapPin,
  Package,
  PackageSearch,
  RefreshCw,
  Truck,
  User,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

/**
 * The address SNAPSHOT stored on the order at checkout (`orders.shipping_address`).
 * Declared here because the snapshot is written server-side
 * (`orderAddressSnapshot()` in `backend/routes/cart.ts`) with the Thai address
 * parts, which the generic `StoreAddressSnapshot` does not spell out. Only fields
 * that actually exist are rendered — a missing one is omitted, never invented.
 */
interface SellerAddressSnapshot {
  label?: string;
  recipientName?: string;
  phone?: string;
  line1?: string;
  line2?: string;
  subdistrict?: string;
  district?: string;
  province?: string;
  postalCode?: string;
  country?: string;
}

/**
 * Seller order detail — the seller's ONE place to inspect an order and move it on.
 *
 * WHAT IT READS
 * -------------
 * `GET /api/seller/orders/:id` only. That route resolves the seller from the
 * SESSION (never from the client), verifies ownership against `shops.seller_id`
 * inside the query, and returns just this seller's items — so one seller can never
 * see another seller's portion of a shared order (no IDOR, and `?sellerId=` is not
 * a thing). This page passes nothing but the order id and renders what comes back.
 *
 * WHICH TRANSITIONS IT OFFERS
 * ---------------------------
 * `NEXT_ORDER_STATUSES` — the same table the backend's fulfilment state machine
 * (`backend/lib/order-fulfillment.ts`) encodes, so the buttons can only ever
 * propose a move the API will accept. A terminal order (`completed`, `cancelled`)
 * gets an explanation instead of an empty control, and cancelling — which restores
 * the seller's stock server-side — asks first.
 *
 * The two moves that carry a SERVER-SIDE precondition are handled here too:
 *
 *   • `packing` — the point of no return. `confirmed` → `packing` is offered and
 *     `packing` offers only `shipped`, so the seller cannot cancel after it.
 *   • `shipped` — the backend refuses it without a real shipment, so the button
 *     opens a dialog that collects the carrier and tracking number and sends them
 *     WITH the transition (ONE request, one transaction). A refusal comes back as
 *     `SHIPMENT_REQUIRED` / `PAYMENT_NOT_CONFIRMED` and is shown in the seller's
 *     own language.
 *   • `cancelled` — the backend refuses it once the order is PAID (or its payment
 *     is in flight) with `ORDER_ALREADY_PAID` / `PAYMENT_IN_PROGRESS`, because a
 *     paid order is an operator refund, not a cancellation. The button is still
 *     offered (the status table cannot know about money), so that refusal is
 *     translated here too rather than surfacing a raw 409.
 */
export default function SellerOrderDetail() {
  const { t } = useLanguage();
  const { orderId } = useParams<{ orderId: string }>();
  const orderDetail = useAction(api.commerce.sellerOrderDetail);
  const setOrderStatus = useAction(api.commerce.setOrderStatus);

  const [order, setOrder] = useState<StoreOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyStatus, setBusyStatus] = useState<StoreOrderStatus | null>(null);
  /** The status awaiting confirmation in the dialog (cancelling restores stock). */
  const [confirmStatus, setConfirmStatus] = useState<StoreOrderStatus | null>(null);
  /**
   * The ship dialog. `shipped` needs a carrier + tracking number, so it is
   * collected BEFORE the request — the server refuses the move without them.
   */
  const [shipDialogOpen, setShipDialogOpen] = useState(false);
  const [shipCarrier, setShipCarrier] = useState("");
  const [shipTracking, setShipTracking] = useState("");

  /**
   * The refusal codes the fulfilment state machine answers with, said in the
   * seller's language. Any other failure keeps the server's own message.
   */
  const fulfillmentErrorMessage = useCallback(
    (err: unknown, fallback: string): string => {
      if (err instanceof ApiError) {
        if (err.code === "PAYMENT_NOT_CONFIRMED") return t("orderFulfillment.paymentNotConfirmed");
        if (err.code === "SHIPMENT_REQUIRED") return t("orderFulfillment.shipRequired");
        // Money outranks a cancellation: the backend refuses to cancel a PAID
        // order (the same codes the customer's own cancel answers with) because a
        // refund is an operator flow. Say so instead of showing a raw 409.
        if (err.code === "ORDER_ALREADY_PAID") return t("orderFulfillment.cancelPaidOrder");
        if (err.code === "PAYMENT_IN_PROGRESS") return t("orderFulfillment.cancelPaymentInProgress");
      }
      return err instanceof Error ? err.message : fallback;
    },
    [t],
  );

  /** Translated label for a payment status, falling back to the raw value. */
  const paymentLabel = useCallback(
    (status: string) => {
      const key = `paymentLabels.${status.toLowerCase()}`;
      const value = t(key);
      return value === key ? status : value;
    },
    [t],
  );

  /** Translated label for a shipment status, falling back to the raw value. */
  const trackingLabel = useCallback(
    (status: string) => {
      const key = `trackingLabels.${status.toLowerCase()}`;
      const value = t(key);
      return value === key ? status : value;
    },
    [t],
  );

  /** Translated label for a payment method, falling back to the raw value. */
  const paymentMethodLabel = useCallback(
    (method: string) => {
      const key = `paymentMethods.${method.toLowerCase()}`;
      const value = t(key);
      return value === key ? method : value;
    },
    [t],
  );

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const data = (await orderDetail({ orderId })) as unknown as StoreOrder;
      setOrder(data);
      setError(null);
    } catch (err) {
      setError(
        // 404 is deliberately the same answer for "unknown" and "not yours", so
        // the copy must not claim which of the two it was.
        err instanceof ApiError && err.status === 404
          ? t("orderDetail.notFoundDesc")
          : err instanceof Error
            ? err.message
            : t("orderDetail.loadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [orderId, orderDetail, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleStatusChange = async (
    next: StoreOrderStatus,
    shipment?: { carrier: string; trackingNumber: string },
  ) => {
    if (!order) return;
    setBusyStatus(next);
    try {
      // The shipment details ride along with the transition: the backend writes
      // the `shipments` row in the SAME transaction that moves the order, so a
      // refused move can never leave a half-created shipment behind.
      await setOrderStatus({
        orderId: order.id,
        status: next,
        ...(shipment ? { carrier: shipment.carrier, trackingNumber: shipment.trackingNumber } : {}),
      });
      toast.success(t("sellerOrders.statusUpdated"));
      setConfirmStatus(null);
      setShipDialogOpen(false);
      setShipCarrier("");
      setShipTracking("");
      await load();
    } catch (err) {
      console.error("Update order status error:", err);
      toast.error(fulfillmentErrorMessage(err, t("sellerOrders.statusUpdateFailed")));
    } finally {
      setBusyStatus(null);
    }
  };

  /** `shipped` gets the shipment dialog; every other move goes straight out. */
  const handleTransition = (next: StoreOrderStatus) => {
    if (next === "cancelled") {
      setConfirmStatus(next);
      return;
    }
    if (next === "shipped") {
      setShipDialogOpen(true);
      return;
    }
    void handleStatusChange(next);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <AppHeader />
        <main className="mx-auto w-full max-w-5xl px-4 py-10 sm:px-6">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-6 h-36 rounded-2xl" />
          <Skeleton className="mt-4 h-36 rounded-2xl" />
        </main>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <AppHeader />
        <main className="mx-auto flex w-full max-w-5xl flex-col items-center px-4 py-24 text-center sm:px-6">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
            <PackageSearch className="size-7 text-slate-400" />
          </span>
          <h1 className="mt-5 text-xl font-bold text-slate-900">{t("orderDetail.notFound")}</h1>
          <p className="mt-2 max-w-md text-sm text-slate-500">
            {error ?? t("orderDetail.notFoundDesc")}
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            <Button className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={() => void load()}>
              <RefreshCw className="size-4" />
              {t("orderDetail.retry")}
            </Button>
            <Button variant="outline" className="gap-1.5 border-slate-200 text-slate-700" asChild>
              <Link to="/seller/orders">
                <ArrowLeft className="size-4" />
                {t("orderDetail.backToOrders")}
              </Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  const statusLabel = t(orderStatusI18nKey(order.status));
  const paymentBadge = getPaymentStatusBadge(order.paymentStatus);
  const items = order.items ?? [];
  const shipments = order.shipments ?? [];
  const payments = order.payments ?? [];
  const address = order.addressSnapshot as SellerAddressSnapshot | null | undefined;
  const nextStatuses = NEXT_ORDER_STATUSES[order.status] ?? [];
  const storeTotal = items.reduce((sum, item) => sum + item.subtotal, 0);

  /** One line per real address field; absent fields are omitted, never invented. */
  const addressLines: string[] = address
    ? [
        address.line1,
        address.line2,
        [address.subdistrict, address.district].filter(Boolean).join(" "),
        [address.province, address.postalCode].filter(Boolean).join(" "),
      ].filter((line): line is string => Boolean(line && String(line).trim()))
    : [];
  const addressCountry = address?.country
    ? address.country.toUpperCase() === "TH"
      ? t("orderDetail.countryTH")
      : address.country
    : "";

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <AppHeader />

      <main className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
        <Link
          to="/seller/orders"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-[#10B981]"
        >
          <ArrowLeft className="size-4" />
          {t("orderDetail.backToOrders")}
        </Link>

        {/* ── 1. Header: order number + current status ─────────────────────── */}
        <section className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white">
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 p-5 sm:p-6">
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                <Package className="size-5 shrink-0 text-[#10B981]" />
                <span className="truncate tabular-nums">{order.orderNumber}</span>
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {t("orderDetail.orderedAt", { date: formatIsoDateTime(order.createdAt) })}
              </p>
            </div>
            <div className="text-right">
              <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                {t("sellerOrders.currentStatus")}
              </p>
              <OrderStatusBadge status={order.status} label={statusLabel} size="default" />
            </div>
          </div>

          {/* ── 2. Status actions — only the transitions the backend allows ── */}
          <div className="border-t border-slate-100 px-5 py-4 sm:px-6">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">
              {t("sellerOrders.statusChange")}
            </p>
            {nextStatuses.length === 0 ? (
              <p className="mt-2 flex items-center gap-2 text-sm text-slate-500">
                <XCircle className="size-4 shrink-0 text-slate-300" />
                {t("sellerOrders.statusTerminal")}
              </p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-2">
                {nextStatuses.map((next) => {
                  const destructive = next === "cancelled";
                  const busy = busyStatus === next;
                  return (
                    <Button
                      key={next}
                      className={
                        destructive
                          ? "gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50"
                          : "gap-1.5 bg-[#10B981] text-white hover:bg-emerald-600"
                      }
                      variant={destructive ? "outline" : "default"}
                      disabled={busyStatus !== null}
                      onClick={() => handleTransition(next)}
                    >
                      {busy && <Loader2 className="size-4 animate-spin" />}
                      {t(orderStatusI18nKey(next))}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* ── 3. Customer ──────────────────────────────────────────────────── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-slate-900">
            <User className="size-4 text-[#10B981]" />
            {t("sellerOrders.customerTitle")}
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-100 p-3">
              <p className="text-xs text-slate-400">{t("sellerOrders.customerTitle")}</p>
              <p className="mt-1 text-sm font-medium text-slate-900">{order.customerName || "—"}</p>
            </div>
            <div className="rounded-xl border border-slate-100 p-3">
              <p className="text-xs text-slate-400">{t("sellerOrders.phone")}</p>
              <p className="mt-1 text-sm font-medium tabular-nums text-slate-900">
                {order.customerPhone || "—"}
              </p>
            </div>
          </div>
          {order.note && (
            <p className="mt-3 rounded-[10px] bg-amber-50 px-3 py-2 text-xs text-amber-700">
              {t("orderDetail.note", { note: order.note })}
            </p>
          )}
        </section>

        {/* ── 4. Items — this seller's portion only ────────────────────────── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="text-base font-bold tracking-tight text-slate-900">
            {t("orderDetail.itemsTitle")}
          </h2>
          <div className="mt-4 space-y-3">
            {items.map((item) => {
              const available = item.productStatus === "published";
              /**
               * There is no seller-side product detail route; the product page the
               * storefront serves is the existing one, and it shows the seller exactly
               * what the customer is looking at. It opens in a new tab so the half-done
               * order stays on screen behind it.
               */
              const productUrl = joinUrl(SITE_URLS.velshop, `/products/${item.productId}`);
              const media = (
                <>
                  {item.imageUrl ? (
                    <img
                      src={item.imageUrl}
                      alt=""
                      className="size-14 shrink-0 rounded-[10px] border border-slate-100 object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <span className="flex size-14 shrink-0 items-center justify-center rounded-[10px] bg-slate-50">
                      <ImageOff className="size-4 text-slate-300" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="flex items-center gap-1 text-sm font-semibold text-slate-900">
                      <span className="truncate">{item.productName}</span>
                      <ExternalLink className="size-3 shrink-0 text-slate-300" />
                    </span>
                    {item.variantName && (
                      <span className="mt-0.5 block truncate text-xs text-slate-500">
                        {t("sellerOrders.variant")}: {item.variantName}
                      </span>
                    )}
                    {!available && (
                      <span className="mt-0.5 block text-xs text-amber-600">
                        {t("orderDetail.productUnavailable")}
                      </span>
                    )}
                    <span className="mt-0.5 block text-xs text-slate-400">
                      {formatBaht(item.unitPrice)}
                      {item.unit ? ` / ${item.unit}` : ""} × {item.quantity}
                    </span>
                  </span>
                </>
              );
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"
                >
                  <a
                    href={productUrl}
                    target="_blank"
                    rel="noreferrer noopener"
                    aria-label={`${t("sellerOrders.viewProduct")}: ${item.productName}`}
                    className="flex min-w-0 items-center gap-3 transition-opacity hover:opacity-80"
                  >
                    {media}
                  </a>
                  <p className="shrink-0 text-sm font-bold tabular-nums text-slate-900">
                    {formatBaht(item.subtotal)}
                  </p>
                </div>
              );
            })}
          </div>
          <div className="mt-4 flex items-center justify-between border-t border-slate-100 pt-4">
            <span className="text-sm text-slate-500">{t("sellerOrders.storeTotal")}</span>
            <span className="text-lg font-bold tabular-nums tracking-tight text-slate-900">
              {formatBaht(storeTotal)}
            </span>
          </div>
        </section>

        {/* ── 5. Shipping: the order's OWN address snapshot + real tracking ── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-slate-900">
            <Truck className="size-4 text-[#10B981]" />
            {t("orderDetail.deliveryTitle")}
          </h2>

          {address ? (
            <div className="mt-4 flex gap-3">
              <MapPin className="mt-0.5 size-4 shrink-0 text-slate-300" />
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  {t("orderDetail.shipTo")}
                </p>
                {address.label && (
                  <p className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {address.label}
                  </p>
                )}
                <p className="mt-1 text-sm font-semibold break-words text-slate-900">
                  {address.recipientName || t("orderDetail.recipientFallback")}
                </p>
                {address.phone && (
                  <p className="text-sm tabular-nums break-words text-slate-500">{address.phone}</p>
                )}
                {addressLines.length > 0 && (
                  <p className="mt-2 text-sm leading-6 break-words text-slate-600">
                    {addressLines.map((line) => (
                      <span key={line} className="block">
                        {line}
                      </span>
                    ))}
                  </p>
                )}
                {addressCountry && <p className="mt-1 text-sm break-words text-slate-500">{addressCountry}</p>}
              </div>
            </div>
          ) : (
            <p className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              <MapPin className="size-4 shrink-0 text-slate-300" />
              {t("orderDetail.noAddress")}
            </p>
          )}

          <div className="mt-5 border-t border-slate-100 pt-4">
            <h3 className="text-sm font-semibold text-slate-700">{t("orderDetail.shipmentTitle")}</h3>
            {shipments.length === 0 ? (
              <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
                <Truck className="size-6 text-slate-300" />
                <p className="mt-2 text-sm font-medium text-slate-600">{t("orderDetail.noShipment")}</p>
                <p className="mt-1 text-xs text-slate-400">{t("orderDetail.noShipmentDesc")}</p>
              </div>
            ) : (
              shipments.map((shipment) => (
                <div key={shipment.id} className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <p className="font-semibold text-slate-900">{shipment.carrier}</p>
                    <p className="font-mono text-xs break-all text-slate-500">
                      {shipment.trackingNumber ?? t("orderDetail.noTrackingNo")}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {t("orderDetail.status", { status: trackingLabel(shipment.status) })}
                    {shipment.estimatedDeliveryDate
                      ? ` · ${t("orderDetail.eta", { date: shipment.estimatedDeliveryDate })}`
                      : ""}
                  </p>
                  {shipment.events && shipment.events.length > 0 && (
                    /* Newest first: the latest movement is what the seller needs. */
                    <div className="mt-4">
                      {[...shipment.events].reverse().map((event, index, all) => (
                        <div key={event.id} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <span
                              className={`mt-1 size-2.5 shrink-0 rounded-full ${
                                index === 0 ? "bg-[#10B981]" : "bg-slate-300"
                              }`}
                            />
                            {index < all.length - 1 && <span className="w-px flex-1 bg-slate-200" />}
                          </div>
                          <div className="pb-4">
                            <p className="text-sm font-medium text-slate-900">
                              {trackingLabel(event.status)}
                            </p>
                            {event.description && (
                              <p className="mt-0.5 text-xs text-slate-500">{event.description}</p>
                            )}
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              {event.location ? `${event.location} · ` : ""}
                              {formatIsoDateTime(event.occurredAt)}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </section>

        {/* ── 6. Payment ───────────────────────────────────────────────────── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-slate-900">
            <CreditCard className="size-4 text-[#10B981]" />
            {t("orderDetail.paymentTitle")}
          </h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div className="rounded-xl border border-slate-100 p-3">
              <p className="text-xs text-slate-400">{t("orderDetail.paymentMethod")}</p>
              <p className="mt-1 text-sm font-medium text-slate-900">
                {payments[0]?.method ? paymentMethodLabel(payments[0].method) : "—"}
              </p>
            </div>
            <div className="rounded-xl border border-slate-100 p-3">
              <p className="text-xs text-slate-400">{t("orderDetail.paymentStatus")}</p>
              <span
                className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${paymentBadge.badge}`}
              >
                <span className={`size-1.5 rounded-full ${paymentBadge.dot}`} />
                {paymentLabel(order.paymentStatus)}
              </span>
            </div>
          </div>
          {payments.length > 0 && (
            <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
              {payments.map((payment) => (
                <div key={payment.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2 text-slate-600">
                    <CreditCard className="size-4 text-slate-300" />
                    {paymentMethodLabel(payment.method)}
                  </span>
                  <span className="font-medium tabular-nums text-slate-900">
                    {formatBaht(payment.amount)} · {paymentLabel(payment.status)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── 7. Order summary ─────────────────────────────────────────────── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="text-base font-bold tracking-tight text-slate-900">
            {t("orderDetail.summaryTitle")}
          </h2>
          <div className="mt-4 space-y-2 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-500">{t("orderDetail.subtotal")}</span>
              <span className="tabular-nums text-slate-900">{formatBaht(order.subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-slate-500">{t("orderDetail.shipping")}</span>
              <span className="tabular-nums text-slate-900">{formatBaht(order.shippingFee)}</span>
            </div>
            {order.discount > 0 && (
              <div className="flex items-center justify-between gap-4">
                <span className="text-slate-500">{t("orderDetail.discount")}</span>
                <span className="tabular-nums text-emerald-600">−{formatBaht(order.discount)}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-4 border-t border-slate-100 pt-3">
              <span className="font-medium text-slate-500">{t("orderDetail.total")}</span>
              <span className="text-xl font-bold tabular-nums tracking-tight text-slate-900">
                {formatBaht(order.total)}
              </span>
            </div>
            <p className="pt-1 text-xs text-slate-400">{t("sellerOrders.storeTotal")}</p>
          </div>
        </section>
      </main>

      {/* Cancelling restores the seller's stock server-side — ask before doing it. */}
      <AlertDialog open={confirmStatus !== null} onOpenChange={(open) => !open && setConfirmStatus(null)}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("orderDetail.cancelDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("orderDetail.cancelDialogDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyStatus !== null}>{t("orderCancel.back")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-rose-600 text-white hover:bg-rose-700"
              disabled={busyStatus !== null}
              onClick={() => confirmStatus && void handleStatusChange(confirmStatus)}
            >
              {busyStatus !== null && <Loader2 className="mr-1.5 size-4 animate-spin" />}
              {confirmStatus ? t(orderStatusI18nKey(confirmStatus)) : ""}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/*
        Marking an order as shipped requires a REAL shipment: the backend refuses
        `packing → shipped` without a carrier and a tracking number, because
        "shipped" is what tells the customer their parcel is on its way. The two
        values are sent with the transition, so the status change and the shipment
        row are written in one transaction.
      */}
      <Dialog
        open={shipDialogOpen}
        onOpenChange={(open) => {
          if (open) return;
          setShipDialogOpen(false);
          setShipCarrier("");
          setShipTracking("");
        }}
      >
        <DialogContent className="bg-white sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("orderFulfillment.shipTitle")}</DialogTitle>
            <DialogDescription>{t("orderFulfillment.shipDesc")}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="ship-carrier">{t("orderFulfillment.carrier")}</Label>
              <Input
                id="ship-carrier"
                value={shipCarrier}
                onChange={(e) => setShipCarrier(e.target.value)}
                placeholder={t("orderFulfillment.carrierPlaceholder")}
                disabled={busyStatus !== null}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="ship-tracking">{t("orderFulfillment.trackingField")}</Label>
              <Input
                id="ship-tracking"
                value={shipTracking}
                onChange={(e) => setShipTracking(e.target.value)}
                placeholder={t("orderFulfillment.trackingPlaceholder")}
                disabled={busyStatus !== null}
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              className="border-slate-200 text-slate-700"
              onClick={() => setShipDialogOpen(false)}
              disabled={busyStatus !== null}
            >
              {t("orderCancel.back")}
            </Button>
            <Button
              className="gap-1.5 bg-[#10B981] text-white hover:bg-emerald-600"
              disabled={busyStatus !== null || !shipCarrier.trim() || !shipTracking.trim()}
              onClick={() =>
                void handleStatusChange("shipped", {
                  carrier: shipCarrier.trim(),
                  trackingNumber: shipTracking.trim(),
                })
              }
            >
              {busyStatus === "shipped" && <Loader2 className="size-4 animate-spin" />}
              {t("orderFulfillment.shipConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
