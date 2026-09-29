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
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { ApiError, api, useAction } from "@velnox/shared/lib/api-routes";
import {
  formatBaht,
  formatIsoDateTime,
  NEXT_ORDER_STATUSES,
  orderFulfillmentPaymentGate,
  orderPaymentSummary,
  orderStatusI18nKey,
  type StoreOrder,
  type StoreOrderStatus,
} from "@velnox/shared/lib/commerce";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { SITE_URLS, joinUrl } from "@velnox/shared/lib/sites";
import {
  ArrowLeft,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  ImageOff,
  Loader2,
  Lock,
  MapPin,
  Package,
  PackageSearch,
  Phone,
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
 * A `tel:` link for a phone number that can actually be dialled, or `null`.
 *
 * Only digits (and a leading `+`) survive, and a value with too few digits is not
 * treated as a phone number — the seller gets no dial link for it rather than a
 * link that opens an empty dialler. A number stored by a legacy order that has no
 * phone at all never reaches this: the address block says the order has no
 * shipping phone instead.
 */
function phoneTelHref(phone: string | null | undefined): string | null {
  if (typeof phone !== "string") return null;
  const trimmed = phone.trim();
  if (!trimmed) return null;
  const dialable = trimmed.replace(/[^\d+]/g, "");
  const digitCount = dialable.replace(/\D/g, "").length;
  if (digitCount < 9 || digitCount > 15) return null;
  return `tel:${dialable}`;
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
 * `NEXT_ORDER_STATUSES` — the same table the backend's
 * `SELLER_ORDER_STATUS_TRANSITIONS` encodes, so the buttons can only ever propose a
 * move the API will accept (`canTransitionOrderStatus`). A terminal order
 * (`completed`, `cancelled`) gets an explanation instead of an empty control, and
 * cancelling — which restores the seller's stock server-side — asks first.
 *
 * PAYMENT vs FULFILMENT
 * ---------------------
 * Starting fulfilment (`ยืนยันคำสั่งซื้อ` / confirm) is locked until the money is
 * really there when the order was paid online: `orderFulfillmentPaymentGate()` — the
 * mirror of the backend's own rule — returns `canConfirm: false` for a CARD /
 * PROMPTPAY order whose payment has not succeeded, and the button is disabled with
 * the reason on screen. COD is the deliberate exception (the carrier collects, so a
 * `pending` payment row is normal). The seller is never offered an action that
 * marks a Stripe payment paid — that is the webhook's job, not a fulfilment action.
 *
 * ADDRESS
 * -------
 * The shipping block renders the order's OWN checkout snapshot, phone included, with
 * copy/call actions so the seller can actually fulfil from it. There is no fallback
 * to the customer's account phone: an order with no snapshot phone says so.
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
  /** Which shipping detail was just copied, for the button's own feedback. */
  const [copied, setCopied] = useState<"phone" | "address" | null>(null);

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

  const handleStatusChange = async (next: StoreOrderStatus) => {
    if (!order) return;
    setBusyStatus(next);
    try {
      await setOrderStatus({ orderId: order.id, status: next });
      toast.success(t("sellerOrders.statusUpdated"));
      setConfirmStatus(null);
      await load();
    } catch (err) {
      console.error("Update order status error:", err);
      toast.error(err instanceof Error ? err.message : t("sellerOrders.statusUpdateFailed"));
    } finally {
      setBusyStatus(null);
    }
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
  const items = order.items ?? [];
  const shipments = order.shipments ?? [];
  const payments = order.payments ?? [];
  const address = order.addressSnapshot as SellerAddressSnapshot | null | undefined;
  const nextStatuses = NEXT_ORDER_STATUSES[order.status] ?? [];
  const storeTotal = items.reduce((sum, item) => sum + item.subtotal, 0);

  /**
   * How this order is being paid — the SAME rule the backend enforces, so the
   * badge can never claim "paid" on an order the API would refuse to confirm.
   */
  const payment = orderPaymentSummary(order);
  const paymentBadge = payment.badge;
  /** May the seller start fulfilment right now? (COD always may.) */
  const paymentGate = orderFulfillmentPaymentGate(order);
  const confirmLocked = !paymentGate.canConfirm;
  /** The customer's phone exactly as the order recorded it — never the profile's. */
  const shippingPhone = address?.phone?.trim() ? address.phone.trim() : null;
  const telHref = phoneTelHref(shippingPhone);

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

  /** The whole shipping address as one copyable block (blank lines are dropped). */
  const addressCopyText = address
    ? [address.recipientName, shippingPhone, ...addressLines, addressCountry]
        .filter((line): line is string => Boolean(line && String(line).trim()))
        .join("\n")
    : "";

  /** Copy one shipping detail, with the button reporting its own success. */
  const copyToClipboard = async (what: "phone" | "address", value: string) => {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(value);
      setCopied(what);
      toast.success(t("sellerOrders.copied"));
      setTimeout(() => setCopied(null), 2000);
    } catch {
      // A browser that refuses clipboard access (insecure origin, denied
      // permission) must not look like a success — the seller can still select
      // the text by hand.
      toast.error(t("common.error"));
    }
  };

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
            {/*
              Payment lock: while an online payment has not succeeded the seller
              cannot start fulfilment. The reason is stated BEFORE the control, and
              the confirm button stays visible but disabled — so the seller learns
              WHY, instead of wondering where the button went.
            */}
            {confirmLocked && nextStatuses.includes("confirmed") && (
              <div className="mt-3 flex gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-3.5 py-3">
                <Lock className="mt-0.5 size-4 shrink-0 text-amber-600" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-amber-800">
                    {t("sellerOrders.paymentLockTitle")}
                  </p>
                  <p className="mt-0.5 text-xs leading-5 text-amber-700">
                    {t("sellerOrders.paymentLockDesc")}
                  </p>
                </div>
              </div>
            )}

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
                  /** Starting fulfilment is gated on the payment rail. */
                  const locked = next === "confirmed" && confirmLocked;
                  return (
                    <Button
                      key={next}
                      className={
                        destructive
                          ? "gap-1.5 border-rose-200 text-rose-600 hover:bg-rose-50"
                          : "gap-1.5 bg-[#10B981] text-white hover:bg-emerald-600"
                      }
                      variant={destructive ? "outline" : "default"}
                      disabled={busyStatus !== null || locked}
                      title={locked ? t("sellerOrders.paymentLockDesc") : undefined}
                      onClick={() => (destructive ? setConfirmStatus(next) : void handleStatusChange(next))}
                    >
                      {busy ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : locked ? (
                        <Lock className="size-3.5" />
                      ) : null}
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
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  {t("sellerOrders.addressTitle")}
                </p>
                {address.label && (
                  <p className="mt-1 inline-flex rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
                    {address.label}
                  </p>
                )}
                <p className="mt-1 text-sm font-semibold break-words text-slate-900">
                  {address.recipientName || t("orderDetail.recipientFallback")}
                </p>
                {/*
                  The shipping phone is the number on THIS order's snapshot. When a
                  legacy order has none the line says so — the customer's account
                  phone is deliberately never substituted for it.
                */}
                {shippingPhone ? (
                  <p className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="tabular-nums break-words text-slate-600">{shippingPhone}</span>
                    {telHref && (
                      <a
                        href={telHref}
                        className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-xs font-medium text-slate-600 transition-colors hover:border-[#10B981] hover:text-[#10B981]"
                      >
                        <Phone className="size-3" />
                        {t("sellerOrders.callPhone")}
                      </a>
                    )}
                  </p>
                ) : (
                  <p className="text-sm text-amber-600">{t("sellerOrders.phoneUnavailable")}</p>
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

                {/* Fulfilment actions: hand the carrier or the phone exactly this. */}
                <div className="mt-3 flex flex-wrap gap-2">
                  {shippingPhone && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 border-slate-200 text-slate-700"
                      onClick={() => void copyToClipboard("phone", shippingPhone)}
                    >
                      {copied === "phone" ? <Check className="size-3.5 text-[#10B981]" /> : <Copy className="size-3.5" />}
                      {t("sellerOrders.copyPhone")}
                    </Button>
                  )}
                  {addressCopyText && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="gap-1.5 border-slate-200 text-slate-700"
                      onClick={() => void copyToClipboard("address", addressCopyText)}
                    >
                      {copied === "address" ? <Check className="size-3.5 text-[#10B981]" /> : <Copy className="size-3.5" />}
                      {t("sellerOrders.copyAddress")}
                    </Button>
                  )}
                </div>
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
              {/*
                One badge that answers "how is this being paid, and has it been?":
                COD reads as COD (its `pending` row is normal), an online order reads
                as paid / awaiting / failed. The raw status is still shown beside the
                payment rows below, so nothing is hidden — it is just not the only
                word on screen.
              */}
              <span
                className={`mt-1.5 inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${paymentBadge.badge}`}
              >
                <span className={`size-1.5 rounded-full ${paymentBadge.dot}`} />
                {t(payment.i18nKey)}
              </span>
              {payment.kind === "cod" && (
                <p className="mt-1.5 text-[11px] text-slate-400">{t("sellerOrders.codNote")}</p>
              )}
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
    </div>
  );
}
