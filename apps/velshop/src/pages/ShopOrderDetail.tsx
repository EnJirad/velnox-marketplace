import { ResumePaymentButton } from "@/components/shop/ResumePaymentButton";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
import {
  OrderStatusBadge,
  orderProgressStageIcon,
} from "@velnox/shared/components/order/OrderStatusBadge";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { Textarea } from "@velnox/shared/components/ui/textarea";
import { api, ApiError } from "@velnox/shared/lib/api-routes";
import {
  formatBaht,
  formatIsoDateTime,
  formatPaymentCountdown,
  getPaymentStatusBadge,
  orderPaymentSummary,
  ORDER_PROGRESS_STAGES,
  orderCustomerCancelability,
  orderProgressStageIndex,
  orderStatusI18nKey,
  orderStripePayability,
  paymentReservationPhase,
  paymentReservationProgress,
  paymentReservationState,
  paymentReservationTone,
  type PaymentReservationTone,
} from "@velnox/shared/lib/commerce";
import { useAction } from "@velnox/shared/lib/api-routes";
import {
  ArrowLeft,
  CheckCircle2,
  Circle,
  Clock3,
  CreditCard,
  ImageOff,
  Loader2,
  MapPin,
  Package,
  RefreshCw,
  Star,
  Truck,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { toast } from "sonner";

/**
 * Order detail — the customer's single place to understand and act on an order.
 *
 * LAYOUT (one clear hierarchy, mobile first):
 *   1. the order header + STATUS, with the payment reservation countdown and the
 *      ONE pay action beside it;
 *   2. progress timeline;
 *   3. items (image, name, variant, quantity, price);
 *   4. delivery (shipping address + shipment tracking);
 *   5. payment (method + status);
 *   6. order summary (subtotal, shipping, discount, total);
 *   7. actions (back, buy again, cancel order).
 *
 * The shop/seller block that used to sit between the summary and the actions was
 * REMOVED on purpose — see the note where it was. The data is untouched.
 *
 * The countdown is PRESENTATION ONLY: `paymentExpiresAt` is computed and enforced
 * by the backend (a new Checkout Session is refused with
 * `PAYMENT_RESERVATION_EXPIRED` once it has passed), so a wrong client clock can
 * only ever mis-render a number — never change an order's state.
 */

interface OrderItemRow {
  id: string;
  productId: string;
  productName: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  variantName?: string | null;
  imageUrl?: string | null;
  shopId?: string | null;
  /** Current product status — null/absent means the product was deleted */
  productStatus?: string | null;
}

/**
 * The address SNAPSHOT stored on this order at checkout (`orders.shipping_address`).
 * Every field below is written server-side from the address row the customer
 * selected, so the page can never show the profile's current/default address.
 */
interface OrderAddressSnapshot {
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

interface TrackingEventRow {
  id: string;
  status: string;
  description: string | null;
  location: string | null;
  occurredAt: string;
}

interface ShipmentRow {
  id: string;
  carrier: string;
  trackingNumber: string | null;
  status: string;
  estimatedDeliveryDate: string | null;
  events?: TrackingEventRow[];
}

interface PaymentRow {
  id: string;
  method: string;
  status: string;
  amount: number;
}

interface OrderDetail {
  id: string;
  orderNumber: string;
  parentOrderId: string;
  status: string;
  paymentStatus: string;
  shippingStatus: string;
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  note: string | null;
  shopId?: string | null;
  shopName?: string | null;
  createdAt: number;
  /** null when the order has no stored shipping address (legacy/COD orders) */
  addressSnapshot: OrderAddressSnapshot | null;
  /** The reservation LENGTH the backend took (minutes); null when unknown. */
  reservationMinutes?: number | null;
  items?: OrderItemRow[];
  shipments?: ShipmentRow[];
  payments?: PaymentRow[];
  /**
   * Payment reservation deadline in Unix ms (Fixed 30-minute Payment
   * Reservation), or null when the order holds no window. The BACKEND computed
   * this; the countdown below only renders it.
   */
  paymentExpiresAt?: number | null;
}

const REVIEWABLE = new Set(["delivered", "completed"]);

/**
 * Urgency styling for the running countdown: GREEN → YELLOW → RED, then the dark
 * EXPIRED notice. Tokens only (design-system colours, readable on light mode);
 * colour is never the sole signal — the clock, the tier's translated note and the
 * 00:00/expired text all carry the state too.
 */
const RESERVATION_TONE_STYLES: Record<
  PaymentReservationTone,
  { panel: string; label: string; clock: string; track: string; fill: string; note: string }
> = {
  green: {
    panel: "border-emerald-100 bg-emerald-50/70",
    label: "text-emerald-700",
    clock: "text-emerald-700",
    track: "bg-emerald-100",
    fill: "bg-emerald-500",
    note: "text-emerald-800",
  },
  yellow: {
    panel: "border-amber-100 bg-amber-50/70",
    label: "text-amber-700",
    clock: "text-amber-900",
    track: "bg-amber-100",
    fill: "bg-amber-500",
    note: "text-amber-800",
  },
  red: {
    panel: "border-rose-100 bg-rose-50/70",
    label: "text-rose-700",
    clock: "text-rose-700",
    track: "bg-rose-100",
    fill: "bg-rose-500",
    note: "text-rose-800",
  },
  expired: {
    panel: "border-slate-800 bg-slate-900",
    label: "text-slate-300",
    clock: "text-white",
    track: "bg-slate-700",
    fill: "bg-slate-500",
    note: "text-slate-300",
  },
};

export default function ShopOrderDetail() {
  const { t } = useLanguage();
  const { orderId } = useParams<{ orderId: string }>();
  const orderDetail = useAction(api.customer.orderDetail);
  const reorder = useAction(api.customer.reorderAction);
  const cancelOrder = useAction(api.commerce.cancelOrderAction);
  const reviewProduct = useAction(api.customer.reviewProduct);
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  /**
   * The HTTP status behind a failed load. 401/403 means the order is not this
   * customer's (or the session ended) and retrying changes nothing; 404 means it
   * genuinely does not exist. The two get different copy — see `ApiError`.
   */
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  /** Presentation-only clock for the reservation countdown (see the header note). */
  const [now, setNow] = useState(() => Date.now());

  // cancel dialog
  const [cancelOpen, setCancelOpen] = useState(false);
  // review dialog
  const [reviewTarget, setReviewTarget] = useState<OrderItemRow | null>(null);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");

  /** Translated label for a tracking status, falling back to the raw status. */
  const trackingLabel = useCallback(
    (status: string) => {
      const key = `trackingLabels.${status.toLowerCase()}`;
      const val = t(key);
      return val === key ? status : val;
    },
    [t],
  );

  /** Translated label for a payment status, falling back to the raw status. */
  const paymentLabel = useCallback(
    (status: string) => {
      const key = `paymentLabels.${status.toLowerCase()}`;
      const val = t(key);
      return val === key ? status : val;
    },
    [t],
  );

  /** Translated label for a payment method, falling back to the raw method. */
  const paymentMethodLabel = useCallback(
    (method: string) => {
      const key = `paymentMethods.${method.toLowerCase()}`;
      const val = t(key);
      return val === key ? method : val;
    },
    [t],
  );

  const load = useCallback(async () => {
    if (!orderId) return;
    setLoading(true);
    try {
      const data = (await orderDetail({ orderId })) as unknown as OrderDetail;
      setOrder(data);
      setErrorStatus(null);
    } catch (err) {
      setErrorStatus(err instanceof ApiError ? err.status : null);
      setError(err instanceof Error ? err.message : t("orderDetail.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [orderId, orderDetail, t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** The reservation window this order currently holds (presentation only). */
  const reservation = paymentReservationState(order, now);
  const reservationPhase = paymentReservationPhase(order, now);

  // Tick the countdown once a second, and ONLY while a window is open: a settled
  // order must not keep a timer alive.
  useEffect(() => {
    if (!reservation.hasWindow || reservation.expired) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [reservation.hasWindow, reservation.expired]);

  /**
   * When the window closes, refetch ONCE. The backend may already have written
   * `expired` and released the stock; until it answers, the page shows the
   * expired notice rather than pretending a payment is still possible.
   */
  const refetchedForExpiry = useRef(false);
  useEffect(() => {
    if (!reservation.hasWindow || !reservation.expired) {
      refetchedForExpiry.current = false;
      return;
    }
    if (refetchedForExpiry.current) return;
    refetchedForExpiry.current = true;
    void load();
  }, [reservation.hasWindow, reservation.expired, load]);

  const handleCancel = async () => {
    if (!order) return;
    setBusy(true);
    try {
      await cancelOrder({ orderId: order.id });
      toast.success(t("orderDetail.cancelSuccess"));
      setCancelOpen(false);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("orderDetail.cancelFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleBuyAgain = async () => {
    if (!order) return;
    setBusy(true);
    try {
      const res = (await reorder({ orderId: order.id })) as unknown as {
        added: unknown[];
        skipped: { productName: string; reason: string }[];
      };
      if (res.added.length > 0) {
        toast.success(t("orderDetail.buyAgainAdded", { count: res.added.length }));
      }
      if (res.skipped.length > 0) {
        toast.warning(t("orderDetail.buyAgainSkipped", { count: res.skipped.length, reason: res.skipped[0].reason }), {
          description: res.skipped.map((s) => s.productName).join(", "),
        });
      }
      if (res.added.length === 0) {
        toast.error(t("orderDetail.buyAgainAllFailed"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("orderDetail.buyAgainFailed"));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitReview = async () => {
    if (!order || !reviewTarget) return;
    setBusy(true);
    try {
      await reviewProduct({
        productId: reviewTarget.productId,
        orderId: order.id,
        rating: reviewRating,
        comment: reviewComment.trim() || undefined,
      });
      toast.success(t("orderDetail.reviewSuccess"));
      setReviewTarget(null);
      setReviewComment("");
      setReviewRating(5);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("orderDetail.reviewFailed"));
    } finally {
      setBusy(false);
    }
  };

  /** A 401/403 load: the order belongs to someone else (or the session lapsed). */
  const denied = errorStatus === 401 || errorStatus === 403;

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <ShopHeader />
        <main className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-6 h-40 rounded-2xl" />
          <Skeleton className="mt-4 h-40 rounded-2xl" />
        </main>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <ShopHeader />
        <main className="mx-auto flex w-full max-w-4xl flex-col items-center px-4 py-24 text-center sm:px-6">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
            <Package className="size-7 text-slate-400" />
          </span>
          {/*
            "Not yours" (401/403) and "does not exist" (404) are different problems
            and must not share one sentence: the first is fixed by signing in again,
            the second never is. An unknown failure keeps the server's own message.
          */}
          <h1 className="mt-5 text-xl font-bold text-slate-900">
            {denied ? t("orderDetail.noAccess") : t("orderDetail.notFound")}
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            {denied ? t("orderDetail.noAccessDesc") : (error ?? t("orderDetail.notFoundDesc"))}
          </p>
          <div className="mt-6 flex flex-col gap-2 sm:flex-row">
            {!denied && (
              <Button className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={() => void load()}>
                <RefreshCw className="size-4" />
                {t("orderDetail.retry")}
              </Button>
            )}
            <Button variant="outline" className="gap-1.5 border-slate-200 text-slate-700" asChild>
              <Link to="/orders">
                <ArrowLeft className="size-4" />
                {t("tracking.backToOrders")}
              </Link>
            </Button>
          </div>
        </main>
      </div>
    );
  }

  /** Localized order-status text (the shared `meta.label` is the Thai seller fallback). */
  const statusLabel = t(orderStatusI18nKey(order.status));
  /** The PAYMENT status is a different concept from the order status — its own tokens. */
  const paymentBadge = getPaymentStatusBadge(order.paymentStatus);
  const items = order.items ?? [];
  const shipments = order.shipments ?? [];
  const payments = order.payments ?? [];
  /**
   * The progress line's current stage, or -1 for a terminal order. `payment_failed`
   * and `refunded` land here too: an order that will not progress any further must
   * never be drawn as one that will.
   */
  const stageIndex = orderProgressStageIndex(order.status);
  /** The one-line explanation a terminal order gets instead of the progress line. */
  const progressNotice: { title: string; desc?: string } | null =
    order.status === "cancelled"
      ? { title: t("orderCancel.cancelledNotice") }
      : order.status === "expired"
        ? { title: t("orderReservation.expiredTitle"), desc: t("orderReservation.expiredDesc") }
        : order.status === "payment_failed"
          ? { title: t("orderDetail.paymentFailedTitle"), desc: t("orderDetail.paymentFailedDesc") }
          : order.status === "refunded"
            ? { title: t("paymentLabels.refunded") }
            : null;

  /**
   * Still-payable order + the rail the customer actually chose.
   *
   * The rule comes from the shared contract (`orderStripePayability`), which
   * mirrors the backend's payable-status list, refuses a lapsed reservation and
   * never invents a method: the recorded rail is only PRESELECTED in the method
   * chooser, and the customer may pick the other one.
   */
  const payability = orderStripePayability(order);

  /**
   * How this order is being paid (`💵 COD` vs paid / awaiting) — the same shared
   * rule the seller sees, so the two surfaces can never describe one order
   * differently.
   */
  const payment = orderPaymentSummary(order);

  /**
   * The SAME rule the backend enforces, from the shared contract: the cancel
   * button cannot appear where `PATCH /api/customer/orders/:orderId/cancel`
   * would answer `INVALID_STATUS`/`ORDER_ALREADY_PAID`, and cannot disappear for
   * an unpaid order the customer needs a way out of.
   */
  const cancelability = orderCustomerCancelability(order);

  const address = order.addressSnapshot;
  /**
   * The order's OWN address, one line per real field — and only fields that exist.
   * A missing value is omitted rather than printed as an empty or invented line.
   */
  const addressLines: string[] = address
    ? [
        address.line1,
        address.line2,
        [address.subdistrict, address.district].filter(Boolean).join(" "),
        [address.province, address.postalCode].filter(Boolean).join(" "),
      ].filter((line): line is string => Boolean(line && String(line).trim()))
    : [];
  /** The snapshot stores an ISO country code; only the known one is translated. */
  const addressCountry = address?.country
    ? address.country.toUpperCase() === "TH"
      ? t("orderDetail.countryTH")
      : address.country
    : "";

  const payTargetOrderId = order.parentOrderId || order.id;
  const reservationOpen = reservationPhase === "active" || reservationPhase === "urgent";
  /** Which urgency tier the clock is in (green / yellow / red). */
  const reservationTone = paymentReservationTone(reservation.remainingMs);
  const toneStyle = RESERVATION_TONE_STYLES[reservationTone];
  /**
   * The bar measures against the window the BACKEND took
   * (orders.reservation_policy → order.reservationMinutes). Unknown length →
   * no bar, never a fabricated 30-minute denominator.
   */
  const reservationTotalMs = order.reservationMinutes ? order.reservationMinutes * 60_000 : null;
  const reservationProgress = paymentReservationProgress(reservation.remainingMs, reservationTotalMs);
  const reservationNote =
    reservationTone === "red"
      ? t("orderReservation.criticalNote")
      : reservationTone === "yellow"
        ? t("orderReservation.urgentNote")
        : t("orderReservation.windowNote");

  /** The countdown and the pay action, shown in ONE place (the header card). */
  const heroActions = payability.payable ? (
    <ResumePaymentButton
      orderId={payTargetOrderId}
      method={payability.method}
      returnPath={`/orders/${order.id}`}
      size="default"
    />
  ) : null;

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        {/* ── 1. Order header + status + payment reservation ─────────────── */}
        <div className="mb-4">
          <Link
            to="/orders"
            className="inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 transition-colors hover:text-[#10B981]"
          >
            <ArrowLeft className="size-4" />
            {t("tracking.backToOrders")}
          </Link>
        </div>
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white">
          {/*
            The order NUMBER is the heading — it is what the customer reads to
            support and what they quote when asking about the order, so it is set at
            heading size instead of being a small caption. The status badge sits on
            the same row (top right on a wide screen, wrapped under it on a narrow
            one) so it can never be mistaken for another block's label.
          */}
          <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-3 p-5 sm:p-6">
            <div className="min-w-0">
              <h1 className="flex items-center gap-2 text-lg font-bold tracking-tight text-slate-900 sm:text-xl">
                <Package className="size-5 shrink-0 text-[#10B981]" />
                <span className="truncate">{order.orderNumber}</span>
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                {t("orderDetail.orderedAt", { date: formatIsoDateTime(order.createdAt) })}
              </p>
            </div>
            {/*
              Order status and payment status are two different concepts, so each pill
              gets its own visible caption — the text (not the colour) is what says which
              is which, and both use the design system's semantic status tokens.
            */}
            <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  {t("orderDetail.orderStatusLabel")}
                </p>
                <OrderStatusBadge status={order.status} label={statusLabel} size="default" />
              </div>
              <div>
                <p className="mb-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  {t("orderDetail.paymentStatus")}
                </p>
                {/*
                  The LABEL comes from the shared payment summary, so a COD order reads
                  "Cash on delivery" instead of "Awaiting payment" — its payment row is
                  `pending` for the whole delivery, which is normal, not a delay. The
                  method itself is spelled out again in the Payments block below.
                */}
                <Badge
                  className={`gap-1.5 rounded-full font-semibold ring-1 ring-inset ${paymentBadge.badge}`}
                >
                  <span className={`size-1.5 rounded-full ${paymentBadge.dot}`} />
                  {t(payment.i18nKey)}
                </Badge>
              </div>
            </div>
          </div>

          {/* Reservation window open: the countdown IS the call to action. */}
          {reservationOpen && (
            <div className={`border-t px-5 py-5 sm:px-6 ${toneStyle.panel}`}>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <p
                    className={`flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide ${toneStyle.label}`}
                  >
                    <Clock3 className="size-3.5 shrink-0" />
                    {t("orderReservation.expiresIn")}
                  </p>
                  <p
                    className={`mt-1 text-4xl font-bold tabular-nums tracking-tight sm:text-5xl ${toneStyle.clock}`}
                    role="timer"
                    aria-live="off"
                  >
                    {formatPaymentCountdown(reservation.remainingMs)}
                  </p>
                  {/*
                    How much of the ORIGINAL window is left. The denominator is
                    the backend's reservation length, so a shorter/longer window
                    (or an unknown one) is drawn truthfully — an unknown length
                    simply draws no bar.
                  */}
                  {reservationProgress !== null && (
                    <div
                      className="mt-3 max-w-md"
                      role="progressbar"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={Math.round(reservationProgress * 100)}
                      aria-label={t("orderReservation.expiresIn")}
                    >
                      <div className={`h-2 overflow-hidden rounded-full ${toneStyle.track}`}>
                        <div
                          className={`h-full rounded-full transition-all duration-1000 ease-linear ${toneStyle.fill}`}
                          style={{ width: `${Math.max(1, Math.round(reservationProgress * 100))}%` }}
                        />
                      </div>
                    </div>
                  )}
                  <p className={`mt-2 max-w-md text-xs leading-5 ${toneStyle.note}`}>{reservationNote}</p>
                </div>
                {heroActions}
              </div>
            </div>
          )}

          {/* Window lapsed: the dark notice replaces the clock — never a negative. */}
          {reservationPhase === "expired" && (
            <div className="border-t border-slate-800 bg-slate-900 px-5 py-5 sm:px-6">
              <p className="flex items-center gap-2 text-sm font-semibold text-white">
                <XCircle className="size-4 shrink-0 text-slate-400" />
                {t("orderReservation.expiredTitle")}
              </p>
              <p className="mt-1.5 max-w-md text-xs leading-5 text-slate-300">
                {t("orderReservation.expiredDesc")}
              </p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3 gap-1.5 border-slate-600 bg-slate-800 text-white hover:bg-slate-700"
                asChild
              >
                <Link to="/orders">
                  <ArrowLeft className="size-3.5" />
                  {t("orderDetail.backToOrders")}
                </Link>
              </Button>
            </div>
          )}

          {/*
            The payment attempt failed inside an existing reservation: say that, keep
            the ORIGINAL deadline visible, and offer the retry. The window is never
            extended here — only the backend can create a new reservation.
          */}
          {order.status === "payment_failed" && (
            <div className="border-t border-rose-100 bg-rose-50/70 px-5 py-5 sm:px-6">
              <div className="flex flex-wrap items-end justify-between gap-4">
                {/*
                  No clock here on purpose: a failed payment means the backend
                  already released the held stock, so this reservation is void —
                  offering a deadline (or a pay button) would promise a payment the
                  server would refuse.
                */}
                <div className="min-w-0">
                  <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-700">
                    <XCircle className="size-4 shrink-0" />
                    {t("orderDetail.paymentFailedTitle")}
                  </p>
                  <p className="mt-1 max-w-md text-xs leading-5 text-rose-700/90">
                    {t("orderDetail.paymentFailedDesc")}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/*
            No window at all (COD, a legacy row, or a database that predates the
            reservation columns) but the order is still payable: the pay action
            must not vanish just because there is no countdown to show.
          */}
          {reservationPhase === "none" && payability.payable && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4 sm:px-6">
              <p className="flex items-center gap-2 text-sm text-slate-600">
                <CreditCard className="size-4 shrink-0 text-slate-300" />
                {t("orderDetail.payOnlinePending")}
              </p>
              {heroActions}
            </div>
          )}
        </section>

        {/* ── 2. Progress ────────────────────────────────────────────────── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="text-base font-bold tracking-tight text-slate-900">{t("orderDetail.progress")}</h2>
          {progressNotice || stageIndex < 0 || payability.expired ? (
            /*
              Terminal (cancelled/expired/payment_failed/refunded) or a lapsed window:
              one sentence, no progress line that would imply the order still moves.
            */
            <div className="mt-4 rounded-xl bg-slate-50 px-4 py-3">
              <p className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <XCircle
                  className={`size-4 shrink-0 ${
                    order.status === "payment_failed" ? "text-rose-400" : "text-slate-400"
                  }`}
                />
                {progressNotice?.title ?? t("orderReservation.expiredTitle")}
              </p>
              {(progressNotice ? progressNotice.desc : t("orderReservation.expiredDesc")) && (
                <p className="mt-1.5 pl-6 text-xs leading-5 text-slate-500">
                  {progressNotice ? progressNotice.desc : t("orderReservation.expiredDesc")}
                </p>
              )}
            </div>
          ) : (
            /*
              ONE line, five REAL order statuses (placed → payment → processing →
              shipped → delivered) with the current stage marked by `aria-current`
              and by shape as well as colour. Labels collapse to the current stage on
              a narrow screen — never a second bar, never nested progress.
            */
            <>
              {/*
                ONE timeline, ONE ordered list. It is HORIZONTAL from `sm` up (five markers
                across the row, efficient on the width a desktop has) and VERTICAL on
                a phone, where five labels cannot stay readable side by side. This is
                a layout switch on the same list — never a second bar, never nested
                progress — and every stage keeps its name in both layouts, so the
                narrow screen shows MORE than a collapsed "current stage only" line.
              */}
              <ol className="mt-5 flex list-none flex-col pl-0 sm:flex-row sm:items-start">
                {ORDER_PROGRESS_STAGES.map((stage, i) => {
                  const done = stageIndex > i;
                  const current = stageIndex === i;
                  const StageIcon = orderProgressStageIcon(stage);
                  const marker = done
                    ? "bg-[#10B981] text-white"
                    : current
                      ? "bg-white text-[#10B981] ring-2 ring-[#10B981]"
                      : "bg-slate-100 text-slate-400 ring-1 ring-inset ring-slate-200";
                  return (
                    <li
                      key={stage}
                      className="flex min-w-0 gap-3 sm:flex-1 sm:flex-col sm:items-center sm:gap-0"
                    >
                      <div className="flex flex-col items-center sm:w-full sm:flex-row">
                        {/* Desktop rail: the segment leading INTO this stage. */}
                        <span
                          aria-hidden="true"
                          className={`hidden h-0.5 flex-1 sm:block ${
                            i === 0 ? "bg-transparent" : stageIndex >= i ? "bg-[#10B981]" : "bg-slate-200"
                          }`}
                        />
                        {/*
                          The marker carries the state by SHAPE as well as colour:
                          done = check, current = the stage's own icon, not reached =
                          an empty outline. A colour-blind reader still sees which
                          stage the order is at.
                        */}
                        <span
                          aria-hidden="true"
                          className={`flex size-6 shrink-0 items-center justify-center rounded-full ${marker}`}
                        >
                          {done ? (
                            <CheckCircle2 className="size-3.5" />
                          ) : current ? (
                            <StageIcon className="size-3.5" />
                          ) : (
                            <Circle className="size-3" />
                          )}
                        </span>
                        {/* Desktop rail: the segment leaving this stage. */}
                        <span
                          aria-hidden="true"
                          className={`hidden h-0.5 flex-1 sm:block ${
                            i === ORDER_PROGRESS_STAGES.length - 1
                              ? "bg-transparent"
                              : stageIndex > i
                                ? "bg-[#10B981]"
                                : "bg-slate-200"
                          }`}
                        />
                        {/* Mobile rail: the vertical segment down to the next stage. */}
                        {i < ORDER_PROGRESS_STAGES.length - 1 && (
                          <span
                            aria-hidden="true"
                            className={`w-0.5 flex-1 sm:hidden ${
                              done ? "bg-[#10B981]" : "bg-slate-200"
                            }`}
                          />
                        )}
                      </div>
                      {/* The stage name always exists for assistive tech. */}
                      <span className="sr-only">{t(`orderSteps.${stage}`)}</span>
                      <span
                        aria-current={current ? "step" : undefined}
                        className={`truncate pb-4 text-xs sm:mt-2 sm:pb-0 sm:text-[11px] ${
                          current ? "font-semibold text-slate-900" : done ? "text-slate-500" : "text-slate-400"
                        }`}
                      >
                        {t(`orderSteps.${stage}`)}
                      </span>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </section>

        {/* ── 3. Items ───────────────────────────────────────────────────── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="text-base font-bold tracking-tight text-slate-900">{t("orderDetail.itemsTitle")}</h2>
          <div className="mt-4 space-y-3">
            {items.map((item) => {
              const productAvailable = item.productStatus === "published";
              return (
                <div
                  key={item.id}
                  className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 p-3"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    {item.imageUrl ? (
                      productAvailable ? (
                        <Link to={`/products/${item.productId}`} className="shrink-0">
                          <img
                            src={item.imageUrl}
                            alt={item.productName}
                            className="size-14 rounded-[10px] border border-slate-100 object-cover"
                            loading="lazy"
                          />
                        </Link>
                      ) : (
                        <img
                          src={item.imageUrl}
                          alt={item.productName}
                          className="size-14 rounded-[10px] border border-slate-100 object-cover opacity-60"
                          loading="lazy"
                        />
                      )
                    ) : (
                      <span className="flex size-14 shrink-0 items-center justify-center rounded-[10px] bg-slate-50">
                        <ImageOff className="size-4 text-slate-300" />
                      </span>
                    )}
                    <div className="min-w-0">
                      {productAvailable ? (
                        <Link
                          to={`/products/${item.productId}`}
                          className="block truncate text-sm font-semibold text-slate-900 transition-colors hover:text-[#10B981]"
                        >
                          {item.productName}
                        </Link>
                      ) : (
                        <p className="block truncate text-sm font-semibold text-slate-400">{item.productName}</p>
                      )}
                      {item.variantName && (
                        <p className="mt-0.5 truncate text-xs font-medium text-slate-500">{item.variantName}</p>
                      )}
                      {!productAvailable && (
                        <p className="mt-0.5 text-xs text-amber-600">{t("orderDetail.productUnavailable")}</p>
                      )}
                      <p className="mt-0.5 text-xs text-slate-400">
                        {formatBaht(item.unitPrice)}
                        {item.unit ? ` / ${item.unit}` : ""} × {item.quantity}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <p className="text-sm font-bold tabular-nums text-slate-900">{formatBaht(item.subtotal)}</p>
                    {REVIEWABLE.has(order.status) && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 border-slate-200 text-slate-600"
                        onClick={() => {
                          setReviewTarget(item);
                          setReviewRating(5);
                          setReviewComment("");
                        }}
                      >
                        <Star className="size-3.5" />
                        {t("orderDetail.review")}
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          {order.note && (
            <p className="mt-4 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">
              {t("orderDetail.note", { note: order.note })}
            </p>
          )}
        </section>

        {/* ── 4. Delivery ────────────────────────────────────────────────── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-base font-bold tracking-tight text-slate-900">
            <Truck className="size-4 text-[#10B981]" />
            {t("orderDetail.deliveryTitle")}
          </h2>

          {/*
            Shipping address — the SNAPSHOT taken at checkout, never the profile's
            current/default address. One line per stored field; absent fields are
            omitted instead of invented.
          */}
          {address ? (
            <div className="mt-4 flex gap-3">
              <MapPin className="mt-0.5 size-4 shrink-0 text-slate-300" />
              <div className="min-w-0">
                <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
                  {t("orderDetail.shipTo")}
                </p>
                <p className="mt-1 text-sm font-semibold break-words text-slate-900">
                  {address.recipientName || t("orderDetail.recipientFallback")}
                </p>
                {/*
                  The order's OWN phone. A legacy order whose snapshot has no phone
                  says so — the phone on the account is never substituted, because the
                  address on an order must not change when the profile does.
                */}
                {address.phone ? (
                  <p className="text-sm tabular-nums break-words text-slate-500">{address.phone}</p>
                ) : (
                  <p className="text-sm text-amber-600">{t("orderDetail.phoneUnavailable")}</p>
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
                {addressCountry && (
                  <p className="mt-1 text-sm break-words text-slate-500">{addressCountry}</p>
                )}
              </div>
            </div>
          ) : (
            <p className="mt-4 flex items-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-sm text-slate-500">
              <MapPin className="size-4 shrink-0 text-slate-300" />
              {t("orderDetail.noAddress")}
            </p>
          )}

          {/* Shipment tracking (carrier + tracking number are real columns; there
              is no shipping-method column, so none is invented) */}
          <div className="mt-5 border-t border-slate-100 pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-700">{t("orderDetail.shipmentTitle")}</h3>
              {shipments.length > 0 && (
                <Button variant="outline" size="sm" className="gap-1.5 border-slate-200 text-slate-600" asChild>
                  <Link to={`/orders/${order.id}/tracking`}>
                    <Truck className="size-3.5" />
                    {t("orderDetail.fullTimeline")}
                  </Link>
                </Button>
              )}
            </div>
            {shipments.length === 0 ? (
              <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center">
                <Truck className="size-6 text-slate-300" />
                <p className="mt-2 text-sm font-medium text-slate-600">{t("orderDetail.noShipment")}</p>
                <p className="mt-1 text-xs text-slate-400">{t("orderDetail.noShipmentDesc")}</p>
              </div>
            ) : (
              shipments.map((s) => (
                <div key={s.id} className="mt-3 rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <p className="font-semibold text-slate-900">{s.carrier}</p>
                    <p className="font-mono text-xs break-all text-slate-500">
                      {s.trackingNumber ?? t("orderDetail.noTrackingNo")}
                    </p>
                  </div>
                  <p className="mt-1 text-xs text-slate-400">
                    {t("orderDetail.status", { status: trackingLabel(s.status) })}
                    {s.estimatedDeliveryDate ? ` · ${t("orderDetail.eta", { date: s.estimatedDeliveryDate })}` : ""}
                  </p>
                  {s.events && s.events.length > 0 && (
                    <div className="mt-4 space-y-0">
                      {[...s.events].reverse().slice(0, 3).map((e, i) => (
                        <div key={e.id} className="flex gap-3">
                          <div className="flex flex-col items-center">
                            <span className={`mt-1 size-2.5 rounded-full ${i === 0 ? "bg-[#10B981]" : "bg-slate-300"}`} />
                            {i < 2 && <span className="w-px flex-1 bg-slate-200" />}
                          </div>
                          <div className="pb-4">
                            <p className="text-sm font-medium text-slate-900">{trackingLabel(e.status)}</p>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              {e.location ? `${e.location} · ` : ""}
                              {formatIsoDateTime(e.occurredAt)}
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

        {/* ── 5. Payment ─────────────────────────────────────────────────── */}
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
              {/* The design system's payment-status tokens: never white-on-white. */}
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
              {payments.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2 text-slate-600">
                    <CreditCard className="size-4 text-slate-300" />
                    {paymentMethodLabel(p.method)}
                  </span>
                  <span className="font-medium tabular-nums text-slate-900">
                    {formatBaht(p.amount)} · {paymentLabel(p.status)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* ── 6. Order summary ───────────────────────────────────────────── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="text-base font-bold tracking-tight text-slate-900">{t("orderDetail.summaryTitle")}</h2>
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
          </div>
        </section>

        {/*
          NO shop/seller block here on purpose. The customer orders FROM a store; the
          order page is about THIS order — what was bought, where it goes, how it is
          paid and where it is. The backend still carries `shopId`/`shopName` and the
          seller order page renders them, so this hides nothing from the seller and
          removes nothing from the data model — it is a customer-surface decision.
        */}

        {/* ── 7. Actions ─────────────────────────────────────────────────── */}
        <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 sm:p-6">
          <h2 className="text-base font-bold tracking-tight text-slate-900">{t("orderDetail.actionsTitle")}</h2>
          <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
            {payability.payable && (
              <ResumePaymentButton
                orderId={payTargetOrderId}
                method={payability.method}
                returnPath={`/orders/${order.id}`}
                size="default"
              />
            )}
            <Button variant="outline" className="border-slate-200 text-slate-700" asChild>
              <Link to="/orders">
                <ArrowLeft className="size-4" />
                {t("orderDetail.backToOrders")}
              </Link>
            </Button>
            {order.status !== "cancelled" && (
              <Button
                variant="outline"
                className="gap-1.5 border-slate-200 text-slate-700"
                onClick={handleBuyAgain}
                disabled={busy}
              >
                <RefreshCw className="size-4" />
                {t("orderDetail.buyAgain")}
              </Button>
            )}
            {cancelability.cancelable && (
              <Button
                variant="outline"
                className="gap-1.5 border-red-200 text-red-600 hover:bg-red-50 sm:ml-auto"
                onClick={() => setCancelOpen(true)}
                disabled={busy}
              >
                <XCircle className="size-4" />
                {t("orderDetail.cancelOrder")}
              </Button>
            )}
          </div>

          {/*
            Why there is no cancel button. The cutoff is FULFILMENT, not order
            status: once the shop has created the shipment (`orderCustomerCancelability`
            reads the same evidence the backend does) the customer cannot cancel any
            more, and saying so is better than removing the button silently.
          */}
          {!cancelability.cancelable && cancelability.reason === "shipping_started" && (
            <p className="mt-3 flex items-start gap-2 rounded-[10px] bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-500">
              <Truck className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
              {t("orderDetail.cancelBlockedShipping")}
            </p>
          )}
        </section>
      </main>

      {/* Cancel confirm */}
      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent className="bg-white">
          <AlertDialogHeader>
            <AlertDialogTitle>{t("orderDetail.cancelDialogTitle")}</AlertDialogTitle>
            <AlertDialogDescription>
              {/* An order that can still be paid gets the copy that says so: the
                  customer must know cancelling ends the chance to pay it. */}
              {payability.payable ? t("orderCancel.dialogDescUnpaid") : t("orderDetail.cancelDialogDesc")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("orderCancel.back")}</AlertDialogCancel>
            <AlertDialogAction className="bg-red-600 text-white hover:bg-red-700" onClick={handleCancel} disabled={busy}>
              {busy ? t("orderDetail.cancelling") : t("orderDetail.cancelOrder")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Review */}
      <Dialog open={reviewTarget !== null} onOpenChange={(open) => !open && setReviewTarget(null)}>
        <DialogContent className="bg-white sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="text-slate-900">{t("orderDetail.reviewTitle")}</DialogTitle>
            <DialogDescription>{reviewTarget?.productName}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-xs font-medium text-slate-500">{t("orderDetail.rating")}</label>
              <div className="mt-2 flex gap-1">
                {Array.from({ length: 5 }).map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setReviewRating(i + 1)}
                    className="transition-transform hover:scale-110"
                    aria-label={t("orderDetail.stars", { n: i + 1 })}
                  >
                    <Star
                      className={`size-6 ${i < reviewRating ? "fill-amber-400 text-amber-400" : "text-slate-200"}`}
                    />
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-500">{t("orderDetail.comment")}</label>
              <Textarea
                value={reviewComment}
                onChange={(e) => setReviewComment(e.target.value)}
                placeholder={t("orderDetail.commentPlaceholder")}
                className="mt-1.5 rounded-[10px] border-slate-200 text-sm"
                rows={3}
              />
            </div>
            <p className="rounded-[10px] bg-[#ECFDF5] px-3 py-2 text-xs text-emerald-700">
              {t("orderDetail.verifiedNote")}
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" className="border-slate-200 text-slate-600" onClick={() => setReviewTarget(null)}>
              {t("orderDetail.close")}
            </Button>
            <Button
              className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
              onClick={handleSubmitReview}
              disabled={busy}
            >
              {busy ? t("orderDetail.sending") : t("orderDetail.submitReview")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ShopFooter />
    </div>
  );
}
