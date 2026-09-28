/**
 * Frontend-facing types for the Neon Commerce Core.
 *
 * The frontend NEVER writes business data directly — it calls the commerce
 * actions which run the backend services against
 * Neon. These types mirror the backend's API shapes (src/backend/types.ts).
 */

// ---------------------------------------------------------------------------
// products & images
// ---------------------------------------------------------------------------
export interface StoreImage {
  id: string;
  productId: string;
  url: string;
  displayUrl: string;
  thumbUrl: string;
  storageProvider: string;
  storageKey: string | null;
  alt: string | null;
  sortOrder: number;
  imageType?: string;
  variantId?: string | null;
  isPrimary: boolean;
  width: number | null;
  height: number | null;
  /** Unix ms */
  createdAt: number;
}

export interface StoreInventory {
  id: string;
  productId: string;
  shopId: string;
  quantity: number;
  reservedQuantity: number;
  reorderLevel: number;
  warehouse: string;
  available: number;
}

export type StoreProductStatus = "draft" | "pending_review" | "published" | "rejected" | "suspended" | "archived";
export type StoreProductCategory = "general" | "food" | "daily" | "beauty" | "packaging" | "other"
  // Extended categories (UUID-backed, mapped from categories table)
  | "food-beverage" | "grocery-household" | "beauty-personal-care" | "health-wellness"
  | "fashion" | "shoes-bags" | "jewelry-accessories" | "electronics"
  | "phones-accessories" | "computers-accessories" | "home-appliances" | "home-living"
  | "furniture" | "garden-outdoor" | "baby-kids" | "toys-games"
  | "pets" | "sports-outdoors" | "automotive" | "tools-hardware"
  | "stationery-office" | "business-equipment" | "books-media"
  | "hobbies-collectibles" | "agriculture" | "local-products" | "services";

export type VerificationStatus = "unverified" | "pending" | "verified" | "rejected" | "suspended";

export interface StoreProduct {
  id: string;
  shopId: string;
  sellerId: string;
  name: string;
  description: string | null;
  category: StoreProductCategory;
  /** Canonical slug resolved from the categories table (null for legacy rows) */
  categorySlug?: string | null;
  unit: string;
  price: number;
  compareAtPrice?: number | null;
  currency: string;
  status: StoreProductStatus;
  rejectionReason: string | null;
  supplier: string | null;
  /** Unix ms */
  createdAt: number;
  updatedAt: number;
  images?: StoreImage[];
  primaryImage?: StoreImage | null;
  inventory?: StoreInventory;
  shopName?: string;
  shopSlug?: string;
  sellerName?: string;
  /** Seller/shop verification status */
  sellerVerificationStatus?: VerificationStatus;
  /** real storefront stats (from the backend — never invented) */
  soldCount?: number;
  /** average published review rating (0–5), null = no reviews yet */
  rating?: number | null;
  reviewCount?: number;
  /** Product verification status (server-side enforced) */
  verificationStatus?: VerificationStatus;
  /** Whether this product qualifies for V badge (seller verified AND product verified) */
  isVerifiedProduct?: boolean;
  // VelRepeat configuration
  vrepeatEnabled?: boolean;
  vrepeatWeeklyEnabled?: boolean;
  vrepeatMonthlyEnabled?: boolean;
  vrepeatWeeklyPrice?: number | null;
  vrepeatMonthlyPrice?: number | null;
  vrepeatWeeklyQty?: number | null;
  vrepeatMonthlyQty?: number | null;

  /** Dynamic option groups loaded from product_option_groups */
  optionGroups?: ProductOptionGroup[];
  /** Variant objects loaded from product_variants */
  variants?: ProductVariant[];
  /** Map of variantId → { groupId → optionValueId } */
  variantOptions?: Record<string, Record<string, string>>;
}

export interface ProductOptionGroup {
  id: string;
  name: string;
  displayType: string;
  required: boolean;
  sortOrder: number;
  values: ProductOptionValue[];
}

export interface ProductOptionValue {
  id: string;
  value: string;
  label: string;
  imageUrl: string | null;
  sortOrder: number;
}

export interface ProductVariant {
  id: string;
  productId: string;
  name: string;
  sku: string | null;
  price: number;
  compareAtPrice?: number | null;
  discountPercent?: number | null;
  stock: number;
  status: string;
  options?: Record<string, any>;
  sortOrder: number;
  images?: { id: string; url: string; alt?: string; sortOrder?: number }[];
}

export interface StoreShop {
  id: string;
  sellerId: string;
  name: string;
  slug: string | null;
  description: string | null;
  imageUrl: string | null;
  phone: string | null;
  address: string | null;
  announcement: string | null;
  status: "active" | "suspended" | "closed";
  commissionRate: number;
  currency: string;
  /** Seller/shop verification status */
  verificationStatus?: VerificationStatus;
  /** Unix ms */
  createdAt: number;
}

export interface SellerProfile {
  seller: {
    id: string;
    ownerUserId?: string;
    name?: string;
    taxId?: string | null;
    status: "pending" | "approved" | "rejected" | "suspended";
    verificationStatus?: VerificationStatus;
    verifiedAt?: number | string | null;
    rejectionReason: string | null;
    refundPolicyLimit?: number;
    /** Unix ms */
    createdAt: number;
    updatedAt?: number;
  };
  shops: StoreShop[];
  settings?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// orders
// ---------------------------------------------------------------------------
/**
 * Canonical order lifecycle. It is a SUPERSET of two state machines that both
 * write `orders.status`:
 *
 *  • fulfilment — `pending` → `confirmed` → `shipped` → `delivered` →
 *    `completed`, plus terminal `cancelled`. Enforced by
 *    `backend/routes/seller-orders.ts` (SELLER_ORDER_STATUSES) and
 *    `backend/routes/center.ts` (ORDER_NEXT_STATUS).
 *  • payment — `pending_payment` → `paid` | `payment_failed`, plus terminal
 *    `refunded`. Written by `backend/routes/stripe.ts`: `pending_payment` when a
 *    Checkout Session is created, `paid` on the confirming webhook,
 *    `payment_failed` on a failed charge, `refunded` after a full refund.
 *
 * `orders.status` is free text with no CHECK constraint, so a row can carry
 * either family — and a future backend release may add another value this build
 * has never seen. Never index ORDER_STATUS_META directly with an API value; go
 * through `getOrderStatusMeta()`, which falls back to a neutral "unknown" badge
 * instead of returning undefined.
 */
export type StoreOrderStatus =
  | "pending"
  | "pending_payment"
  | "paid"
  | "confirmed"
  | "shipped"
  | "delivered"
  | "completed"
  | "payment_failed"
  | "refunded"
  | "cancelled"
  /**
   * The payment reservation window lapsed before the order was paid
   * (written by the expiry sweep, `backend/jobs/payment-reservation-scheduler.ts`).
   * Terminal for payment, and its reserved stock has been returned to the shelf.
   */
  | "expired";
export type StorePaymentStatus =
  | "unpaid"
  | "pending"
  | "paid"
  | "partially_refunded"
  | "refunded"
  | "failed";

export interface StoreAddressSnapshot {
  recipientName: string;
  phone: string;
  line1: string;
  line2?: string;
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface StoreOrderItem {
  id: string;
  orderId: string;
  productId: string;
  shopId: string;
  sellerId: string;
  productName: string;
  unit: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
  commissionRate: number;
  /** Purchased variant snapshot / resolved label (e.g. "Black / AI") */
  variantName?: string | null;
  variantId?: string | null;
  /** Purchased snapshot image or current variant/product image */
  imageUrl?: string | null;
  productStatus?: string | null;
}

export interface StoreOrder {
  id: string;
  orderNumber: string;
  parentOrderId?: string;
  customerUserId: string;
  status: StoreOrderStatus;
  paymentStatus: StorePaymentStatus;
  /**
   * The latest payment row's method (`CARD` / `PROMPTPAY` / `cod` / …), when
   * the endpoint that returned this order supplies one. The resume-payment
   * button reads it to re-open the SAME rail the customer chose.
   */
  paymentMethod?: string | null;
  shippingStatus: string;
  shippingMethod: string | null;
  trackingNumber: string | null;
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  currency: string;
  addressSnapshot: StoreAddressSnapshot;
  note: string | null;
  /** Unix ms */
  createdAt: number;
  updatedAt: number;
  items?: StoreOrderItem[];
  shipments?: Array<{
    id: string;
    carrier: string;
    trackingNumber: string | null;
    status: string;
    estimatedDeliveryDate: string | null;
    events?: Array<{
      id: string;
      status: string;
      description: string | null;
      location: string | null;
      occurredAt: string;
    }>;
  }>;
  payments?: Array<{ id: string; method: string; status: string; amount: number }>;
  /**
   * The payment reservation deadline in Unix ms (Dynamic Payment Reservation
   * V1), or null/absent when the order holds no window (COD, legacy rows).
   * The backend is the source of truth; the order page only counts down to it.
   */
  paymentExpiresAt?: number | null;
  /**
   * The length of the reservation the BACKEND took, in minutes (from
   * `orders.reservation_policy.reservationMinutes`), or null when the order has
   * no window or the schema predates it. The progress bar divides the remaining
   * time by THIS, so it can never assume 30 minutes when the backend says
   * otherwise (a stored v1 row, for instance).
   */
  reservationMinutes?: number | null;
  shopId?: string | null;
  shopName?: string | null;
  shopSlug?: string | null;
  customerName?: string;
  customerPhone?: string;
  itemCount?: number;
}

export interface OrderStatusMeta {
  label: string;
  badge: string;
  dot: string;
}

export const ORDER_STATUS_META: Record<StoreOrderStatus, OrderStatusMeta> = {
  pending: {
    label: "รอตรวจสอบ",
    badge: "bg-amber-50 text-amber-700 ring-amber-600/15 hover:bg-amber-50",
    dot: "bg-amber-500",
  },
  confirmed: {
    label: "ยืนยันแล้ว",
    badge: "bg-sky-50 text-sky-700 ring-sky-600/15 hover:bg-sky-50",
    dot: "bg-sky-500",
  },
  shipped: {
    label: "กำลังจัดส่ง",
    badge: "bg-indigo-50 text-indigo-700 ring-indigo-600/15 hover:bg-indigo-50",
    dot: "bg-indigo-500",
  },
  delivered: {
    label: "จัดส่งแล้ว",
    badge: "bg-teal-50 text-teal-700 ring-teal-600/15 hover:bg-teal-50",
    dot: "bg-teal-500",
  },
  completed: {
    label: "เสร็จสิ้น",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 hover:bg-emerald-50",
    dot: "bg-emerald-500",
  },
  cancelled: {
    label: "ยกเลิก",
    badge: "bg-slate-100 text-slate-500 ring-slate-600/10 hover:bg-slate-100",
    dot: "bg-slate-400",
  },
  // Payment-lifecycle statuses (written by the Stripe routes).
  pending_payment: {
    label: "รอชำระเงิน",
    badge: "bg-orange-50 text-orange-700 ring-orange-600/15 hover:bg-orange-50",
    dot: "bg-orange-500",
  },
  paid: {
    label: "ชำระเงินแล้ว",
    badge: "bg-cyan-50 text-cyan-700 ring-cyan-600/15 hover:bg-cyan-50",
    dot: "bg-cyan-500",
  },
  payment_failed: {
    label: "ชำระเงินไม่สำเร็จ",
    badge: "bg-rose-50 text-rose-700 ring-rose-600/15 hover:bg-rose-50",
    dot: "bg-rose-500",
  },
  refunded: {
    label: "คืนเงินแล้ว",
    badge: "bg-violet-50 text-violet-700 ring-violet-600/15 hover:bg-violet-50",
    dot: "bg-violet-500",
  },
  expired: {
    label: "หมดเวลาชำระเงิน",
    badge: "bg-slate-100 text-slate-500 ring-slate-600/10 hover:bg-slate-100",
    dot: "bg-slate-400",
  },
};

/**
 * Neutral metadata for a status this build does not recognise: a grey badge that
 * says so, rather than a crash (`meta.badge` on `undefined`) or a silent lie
 * (showing an unknown order as "pending").
 */
export const UNKNOWN_ORDER_STATUS_META: OrderStatusMeta = {
  label: "ไม่ทราบสถานะ",
  badge: "bg-slate-100 text-slate-500 ring-slate-600/10 hover:bg-slate-100",
  dot: "bg-slate-400",
};

/**
 * Resolve display metadata for any status the API may return — a known status,
 * a value added by a newer backend, or null/undefined. Always returns a complete
 * `{ label, badge, dot }`, so callers can render `meta.badge` unconditionally.
 *
 * This is presentation only: it never rewrites `order.status` and cannot change
 * any business state (the backend remains the authority).
 */
export function getOrderStatusMeta(status: unknown): OrderStatusMeta {
  if (
    typeof status === "string" &&
    Object.prototype.hasOwnProperty.call(ORDER_STATUS_META, status)
  ) {
    return ORDER_STATUS_META[status as StoreOrderStatus];
  }
  return UNKNOWN_ORDER_STATUS_META;
}

/**
 * The i18n key that names an order status.
 *
 * `ORDER_STATUS_META.label` is the seller-side Thai fallback; the customer apps
 * must render the status in the shopper's language, so the badge text comes from
 * `orderStatus.*` and this function is the single place that maps
 * `orders.status` → key. An unrecognised status resolves to `orderStatus.unknown`
 * rather than a missing key.
 */
export function orderStatusI18nKey(status: unknown): string {
  return typeof status === "string" && Object.prototype.hasOwnProperty.call(ORDER_STATUS_META, status)
    ? `orderStatus.${status}`
    : "orderStatus.unknown";
}

/**
 * Allowed next statuses per the order state machine (backend enforces too).
 *
 * The payment-lifecycle keys mirror `normalizeSellerOrderStatus()`
 * (`backend/routes/seller-orders.ts`), which judges such an order by its
 * fulfilment meaning: `pending_payment`/`paid` count as `pending`,
 * `payment_failed` and `refunded` as terminal. Keep the two in step.
 */
export const NEXT_ORDER_STATUSES: Record<StoreOrderStatus, StoreOrderStatus[]> = {
  pending: ["confirmed", "cancelled"],
  pending_payment: ["confirmed", "cancelled"],
  paid: ["confirmed", "cancelled"],
  confirmed: ["shipped", "cancelled"],
  shipped: ["delivered"],
  delivered: ["completed"],
  completed: [],
  payment_failed: [],
  refunded: [],
  cancelled: [],
  expired: [],
};

// ---------------------------------------------------------------------------
// payment resume contract (Stripe Checkout)
// ---------------------------------------------------------------------------
/**
 * The order statuses `POST /api/stripe/checkout` accepts a Checkout Session
 * for. A payment-lifecycle status OUTSIDE this set (`payment_failed`,
 * `cancelled`, `paid`, …) is terminal for payment: `payment_failed`/`cancelled`
 * already released their reserved stock, so the backend refuses to re-open a
 * session for them and the storefront must not offer one either.
 *
 * `backend/tests/checkout-payment-flow.test.ts` pins this list against the
 * literal status list in `backend/routes/stripe.ts`, so the storefront cannot
 * drift away from what the server accepts.
 */
export const PAYABLE_ORDER_STATUSES = ["pending", "pending_payment"] as const;
export type PayableOrderStatus = (typeof PAYABLE_ORDER_STATUSES)[number];

/**
 * Payment rails the resume-payment flow can open a Stripe Checkout Session for.
 * `paymentMethods.*` copy for these ids already exists in every locale.
 */
export type StripeResumableMethod = "CARD" | "PROMPTPAY";

/** Is this an order status the backend will still accept a payment for? */
export function isOrderPayable(status: unknown): boolean {
  return typeof status === "string" && (PAYABLE_ORDER_STATUSES as readonly string[]).includes(status);
}

/**
 * Resolve a stored `payments.method` to the Stripe rail it belongs to.
 *
 * `online` is the pre-foundation value for "pay with Stripe" (see
 * `METHOD_ALIASES` in `backend/lib/payment-config.ts`) and still maps to CARD so
 * an order created by an older client can be resumed instead of stranded.
 * Returning `null` means "not a Stripe rail" — and for a method we merely do
 * not recognise it means the storefront must ASK, never guess.
 */
export function stripeMethodForPaymentMethod(method: unknown): StripeResumableMethod | null {
  if (typeof method !== "string") return null;
  const normalised = method.trim().toLowerCase().replace(/[\s-]+/g, "_");
  if (normalised === "card" || normalised === "online" || normalised === "credit_card" || normalised === "debit_card") {
    return "CARD";
  }
  if (normalised === "promptpay" || normalised === "qr") return "PROMPTPAY";
  return null;
}

/**
 * Payment methods that deliberately do NOT belong to the Stripe rail.
 * COD is settled by a carrier, so re-opening a Stripe session for a COD order
 * would charge the customer for an order they chose to pay on delivery.
 */
const NON_STRIPE_PAYMENT_METHODS = new Set(["cod", "cash_on_delivery"]);

// ---------------------------------------------------------------------------
// payment-status tokens — the sibling of ORDER_STATUS_META
// ---------------------------------------------------------------------------
/**
 * Badge treatment per PAYMENT status.
 *
 * STYLING ONLY, on purpose: the LABEL always comes from `paymentLabels.*` in the
 * dictionaries, so no Thai copy is duplicated here (the order-status meta
 * predates that split and keeps its labels for the seller/center apps). One
 * palette per meaning, using the same tailwind steps + ring the design system
 * documents for badges (`VELNOX_DESIGN_THEME.md` §16, and every value below is a
 * palette step that is already in use in this file):
 *
 *   amber  = waiting on the customer (pending / requires_action)
 *   sky    = the provider is working (processing)
 *   emerald= settled (paid)
 *   violet = money went back (refunded / partially_refunded)
 *   rose   = it failed (failed)
 *   slate  = neutral / nothing will happen (unpaid, cancelled)
 *
 * WHY THIS EXISTS — the order page used to render the payment status as a plain
 * white pill with a faint ring, which on a white card is invisible: the status
 * "blended into the background". A status must never be communicated by colour
 * alone either, so the caller always renders the translated LABEL inside it.
 */
export const PAYMENT_STATUS_BADGE: Record<string, { badge: string; dot: string }> = {
  unpaid: {
    badge: "bg-slate-100 text-slate-600 ring-slate-600/15 hover:bg-slate-100",
    dot: "bg-slate-400",
  },
  pending: {
    badge: "bg-amber-50 text-amber-700 ring-amber-600/15 hover:bg-amber-50",
    dot: "bg-amber-500",
  },
  requires_action: {
    badge: "bg-amber-50 text-amber-700 ring-amber-600/15 hover:bg-amber-50",
    dot: "bg-amber-500",
  },
  processing: {
    badge: "bg-sky-50 text-sky-700 ring-sky-600/15 hover:bg-sky-50",
    dot: "bg-sky-500",
  },
  paid: {
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-600/15 hover:bg-emerald-50",
    dot: "bg-emerald-500",
  },
  partially_refunded: {
    badge: "bg-violet-50 text-violet-700 ring-violet-600/15 hover:bg-violet-50",
    dot: "bg-violet-500",
  },
  refunded: {
    badge: "bg-violet-50 text-violet-700 ring-violet-600/15 hover:bg-violet-50",
    dot: "bg-violet-500",
  },
  failed: {
    badge: "bg-rose-50 text-rose-700 ring-rose-600/15 hover:bg-rose-50",
    dot: "bg-rose-500",
  },
  cancelled: {
    badge: "bg-slate-100 text-slate-500 ring-slate-600/10 hover:bg-slate-100",
    dot: "bg-slate-400",
  },
};

/**
 * A payment status this build does not know (or a missing one): neutral slate,
 * exactly like `UNKNOWN_ORDER_STATUS_META`. Returned by value, so callers can
 * render `badge` unconditionally and can never hit `undefined.badge`.
 */
export const UNKNOWN_PAYMENT_STATUS_BADGE = {
  badge: "bg-slate-100 text-slate-500 ring-slate-600/10 hover:bg-slate-100",
  dot: "bg-slate-400",
};

/** Resolve the badge tokens for any payment status the API may return. */
export function getPaymentStatusBadge(status: unknown): { badge: string; dot: string } {
  if (
    typeof status === "string" &&
    Object.prototype.hasOwnProperty.call(PAYMENT_STATUS_BADGE, status)
  ) {
    return PAYMENT_STATUS_BADGE[status];
  }
  return UNKNOWN_PAYMENT_STATUS_BADGE;
}

// ---------------------------------------------------------------------------
// customer-facing order progress
// ---------------------------------------------------------------------------
/**
 * The five stages the customer-facing progress line shows, in order.
 *
 * A PRESENTATION grouping of the real `orders.status` values — it invents no
 * state and renames nothing in the backend (`orders.status` stays free text, and
 * the fulfilled/payment lifecycles stay separate):
 *
 *   placed     ← `pending`            the order exists, payment not started
 *   payment    ← `pending_payment`    waiting at Stripe / the webhook
 *   processing ← `confirmed`          the store accepted and is preparing it
 *   shipped    ← `shipped`
 *   delivered  ← `delivered` | `completed`
 *
 * An order that is paid sits at `processing` (payment done, waiting for the
 * store); a terminal order (`cancelled`, `expired`, `payment_failed`, `refunded`)
 * has NO stage — the page replaces the line with the notice that explains it.
 */
export const ORDER_PROGRESS_STAGES = ["placed", "payment", "processing", "shipped", "delivered"] as const;

export type OrderProgressStage = (typeof ORDER_PROGRESS_STAGES)[number];

/**
 * Index of the CURRENT stage in `ORDER_PROGRESS_STAGES`, or `-1` when the order
 * is terminal and must not be drawn as a progress line at all.
 */
export function orderProgressStageIndex(status: unknown): number {
  switch (typeof status === "string" ? status : "") {
    case "pending":
    case "pending_payment":
      return 1;
    case "paid":
    case "confirmed":
      return 2;
    case "shipped":
      return 3;
    case "delivered":
    case "completed":
      return 4;
    default:
      return -1;
  }
}

/** The smallest order shape the payability decision needs. */
export interface OrderPayabilityInput {
  status: unknown;
  /** `orders` list / detail expose the latest payment status. */
  paymentStatus?: unknown;
  /** `orders` list exposes the latest payment method. */
  paymentMethod?: unknown;
  /** `orders` detail exposes every payment, newest first. */
  payments?: Array<{ method?: unknown }> | null;
  /**
   * The payment reservation deadline in Unix ms, when the endpoint supplies it.
   * A past deadline means the backend will refuse a new Checkout Session
   * (`PAYMENT_RESERVATION_EXPIRED`), so no pay button may be offered.
   */
  paymentExpiresAt?: unknown;
}

export interface OrderStripePayability {
  /** The backend would accept a Checkout Session for this order right now. */
  payable: boolean;
  /**
   * The rail the customer originally chose, or `null` when it is not recorded
   * (an order whose session creation failed) or not a Stripe rail. A `null`
   * method on a payable order means: ask the customer, never default to card.
   */
  method: StripeResumableMethod | null;
  /**
   * True when the payment reservation window has lapsed. The order is (or is
   * about to be) `expired` and its stock released — the page shows the expired
   * notice instead of a pay button.
   */
  expired: boolean;
}

/**
 * Decide whether a customer may still pay this order through Stripe, and with
 * which method.
 *
 * This is the ONE rule both VelShop surfaces (`MyOrders`, `ShopOrderDetail`)
 * and the Stripe-return pages read, so the button can never appear where the
 * backend would answer `INVALID_STATUS`, and can never disappear where the
 * backend would accept the payment.
 */
export function orderStripePayability(order: OrderPayabilityInput | null | undefined): OrderStripePayability {
  if (!order || !isOrderPayable(order.status)) {
    return { payable: false, method: null, expired: false };
  }
  // Belt and braces: a paid payment must never present a pay-again button even
  // if the order row lags one transition behind the payment row.
  if (typeof order.paymentStatus === "string" && order.paymentStatus.toLowerCase() === "paid") {
    return { payable: false, method: null, expired: false };
  }

  // The reservation deadline is enforced by the backend
  // (`POST /api/stripe/checkout` answers 400 PAYMENT_RESERVATION_EXPIRED once it
  // has passed), so the button must disappear at the same instant — even before
  // the expiry sweep has written `expired` onto the order row.
  if (paymentReservationState(order).expired) {
    return { payable: false, method: null, expired: true };
  }

  const latestMethod = order.paymentMethod ?? order.payments?.[0]?.method ?? null;
  if (typeof latestMethod === "string" && NON_STRIPE_PAYMENT_METHODS.has(latestMethod.trim().toLowerCase())) {
    return { payable: false, method: null, expired: false };
  }

  return { payable: true, method: stripeMethodForPaymentMethod(latestMethod), expired: false };
}

// ---------------------------------------------------------------------------
// payment reservation window (Dynamic Payment Reservation V1)
// ---------------------------------------------------------------------------
/** The smallest order shape the reservation countdown needs. */
export interface OrderReservationInput {
  status?: unknown;
  paymentExpiresAt?: unknown;
}

export interface PaymentReservationState {
  /** The order carries a deadline (so a countdown is meaningful). */
  hasWindow: boolean;
  /** Unix ms, or null when there is no window. */
  expiresAt: number | null;
  /** The deadline has passed (or the order is already terminal for payment). */
  expired: boolean;
  /** Milliseconds left; 0 once expired. Never negative. */
  remainingMs: number;
}

/**
 * Read the reservation window off an order. PRESENTATION ONLY — the backend
 * deadline and the backend's own guarded writes remain the source of truth; a
 * client clock can be wrong in either direction, which is exactly why nothing
 * here may ever move an order's state.
 *
 * A window is only reported for an order that is still waiting to be paid: one
 * that is paid, cancelled, refunded or expired has no countdown to show, and
 * showing one would suggest a payment is still possible.
 */
export function paymentReservationState(
  order: OrderReservationInput | null | undefined,
  now: number = Date.now(),
): PaymentReservationState {
  const none: PaymentReservationState = { hasWindow: false, expiresAt: null, expired: false, remainingMs: 0 };
  if (!order) return none;

  const raw = order.paymentExpiresAt;
  const expiresAt =
    typeof raw === "number" && Number.isFinite(raw)
      ? raw
      : typeof raw === "string" && Number.isFinite(Date.parse(raw))
        ? Date.parse(raw)
        : null;
  if (expiresAt === null) return none;

  const remainingMs = Math.max(0, expiresAt - now);
  const windowOpen = order.status === undefined || isOrderPayable(order.status);
  if (!windowOpen) {
    // A decided order keeps its stored deadline for audit, but it is not a
    // countdown and it is not payable.
    return { hasWindow: false, expiresAt, expired: true, remainingMs: 0 };
  }
  return { hasWindow: true, expiresAt, expired: remainingMs <= 0, remainingMs };
}

/**
 * Format a countdown as `MM:SS` (under an hour) or `H:MM:SS`, clock style so it
 * never reflows as digits change. `0` / negative / non-finite renders `00:00`.
 */
export function formatPaymentCountdown(remainingMs: number): string {
  const totalSeconds =
    typeof remainingMs === "number" && Number.isFinite(remainingMs) && remainingMs > 0
      ? Math.floor(remainingMs / 1000)
      : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

/**
 * A reservation inside this much of its deadline is "almost over": the UI
 * emphasises it (warmer colour, an explicit "hurry" note) without any animation.
 *
 * Three minutes: the last tenth of the 30-minute window. It is what makes a
 * countdown like `02:13` render as the urgent state rather than an ordinary one.
 */
export const PAYMENT_RESERVATION_URGENT_MS = 3 * 60_000;

/**
 * The urgency tiers the storefront colours a running countdown with.
 *
 *   GREEN   more than `PAYMENT_RESERVATION_YELLOW_MS` left — an ordinary window
 *   YELLOW  15:00 … 5:01 — the window is closing, make the clock noticeable
 *   RED      5:00 … 0:01 — pay now (the last three minutes stay "urgent" too,
 *            which is what turns the hurry note on)
 *   EXPIRED 0 or less — the clock reads 00:00 and the dark notice takes over
 *
 * Boundaries are inclusive of the tier they name, matching the spec's
 * 15:00 → YELLOW, 05:00 → RED, 00:01 → RED, 00:00 → EXPIRED.
 * Colour is never the only signal: the clock and the translated note carry it.
 */
export const PAYMENT_RESERVATION_YELLOW_MS = 15 * 60_000;
export const PAYMENT_RESERVATION_RED_MS = 5 * 60_000;

export type PaymentReservationTone = "green" | "yellow" | "red" | "expired";

/**
 * Which urgency tier a remaining time belongs to. PRESENTATION ONLY — it reads
 * a number the backend deadline produced and decides nothing about the order.
 */
export function paymentReservationTone(remainingMs: number): PaymentReservationTone {
  if (typeof remainingMs !== "number" || !Number.isFinite(remainingMs) || remainingMs <= 0) {
    return "expired";
  }
  if (remainingMs <= PAYMENT_RESERVATION_RED_MS) return "red";
  if (remainingMs <= PAYMENT_RESERVATION_YELLOW_MS) return "yellow";
  return "green";
}

/**
 * How much of the ORIGINAL reservation window is left, as 0…1, for the progress
 * bar. `totalMs` is the window the backend actually took (orders.reservation_policy
 * → API → order.reservationMinutes), never a number invented by the page: when it
 * is unknown the bar simply does not draw, while the clock keeps running off the
 * backend deadline.
 */
export function paymentReservationProgress(
  remainingMs: number,
  totalMs: number | null | undefined,
): number | null {
  if (
    typeof totalMs !== "number" ||
    !Number.isFinite(totalMs) ||
    totalMs <= 0 ||
    typeof remainingMs !== "number" ||
    !Number.isFinite(remainingMs)
  ) {
    return null;
  }
  return Math.min(1, Math.max(0, remainingMs / totalMs));
}

/** How the reservation must be presented for one order. */
export type PaymentReservationPhase = "none" | "active" | "urgent" | "expired";

/**
 * The ONE presentation phase both order surfaces (list + detail) read, so the
 * same order can never look "active" in one place and "expired" in the other.
 *
 *   `active`   — a window is open, comfortably more than the urgent threshold left
 *   `urgent`   — a window is open but nearly over (`PAYMENT_RESERVATION_URGENT_MS`)
 *   `expired`  — the deadline has passed, or the expiry sweep already moved the
 *                order to `expired`
 *   `none`     — no countdown belongs here: a COD or legacy order with no stored
 *                deadline, or an order that was paid/cancelled/shipped
 *
 * PRESENTATION ONLY. The backend deadline is the source of truth and the backend
 * enforces it; a wrong client clock can mis-render a number, never change state.
 */
export function paymentReservationPhase(
  order: OrderReservationInput | null | undefined,
  now: number = Date.now(),
): PaymentReservationPhase {
  const state = paymentReservationState(order, now);
  if (state.hasWindow) {
    if (state.expired) return "expired";
    return state.remainingMs <= PAYMENT_RESERVATION_URGENT_MS ? "urgent" : "active";
  }
  // No countdown for an order that is no longer waiting to be paid. The ONE
  // exception is an order the sweep already ended: its window really did lapse,
  // so the storefront says so instead of rendering nothing. A paid or cancelled
  // order shows nothing — a countdown there would suggest a payment is possible.
  return order?.status === "expired" ? "expired" : "none";
}

// ---------------------------------------------------------------------------
// customer cancellation contract
// ---------------------------------------------------------------------------
/**
 * The order statuses a customer may cancel through
 * `PATCH /api/customer/orders/:orderId/cancel`.
 *
 * `pending` is an order that was created but never taken to Stripe;
 * `pending_payment` is one that HAS a (possibly abandoned) Checkout Session —
 * the state a customer lands in after leaving Stripe, and the one that used to
 * offer only "continue payment"; `confirmed` is accepted by the seller and not
 * yet shipped. Everything else is either paid/shipped (the seller now owns the
 * decision) or already terminal.
 *
 * `backend/tests/customer-order-cancel.test.ts` pins this list against the
 * literal list in `backend/routes/cart.ts`, so the storefront can never offer a
 * cancel the server would refuse (or hide one it would accept).
 */
export const CUSTOMER_CANCELABLE_ORDER_STATUSES = ["pending", "pending_payment", "confirmed"] as const;
export type CustomerCancelableOrderStatus = (typeof CUSTOMER_CANCELABLE_ORDER_STATUSES)[number];

/** Is this a status the customer may still cancel from? */
export function isOrderCancelableByCustomer(status: unknown): boolean {
  return typeof status === "string" && (CUSTOMER_CANCELABLE_ORDER_STATUSES as readonly string[]).includes(status);
}

/**
 * Payment statuses that make cancellation unsafe.
 *
 * `paid` means money moved, so cancelling here would need a refund, not a
 * cancellation — the backend refuses it. `processing` means a charge is in
 * flight (a card being authorised), where cancelling could leave a captured
 * payment attached to a dead order.
 */
const PAYMENT_BLOCKS_CANCELLATION = new Set(["paid", "processing"]);

/** The smallest order shape the cancellation decision needs. */
export interface OrderCancelabilityInput {
  status: unknown;
  /** `orders` list / detail expose the latest payment status. */
  paymentStatus?: unknown;
  /** `orders` detail exposes every payment, newest first. */
  payments?: Array<{ status?: unknown }> | null;
}

export interface OrderCustomerCancelability {
  /** The backend would cancel this order right now. */
  cancelable: boolean;
  /**
   * Why not — `"payment_in_progress"` when money is paid or being authorized,
   * `"not_cancelable"` when the order status is outside the cancelable set
   * (paid, shipped, or already terminal). Callers show a reason instead of a
   * button that would be refused.
   */
  reason: "payment_in_progress" | "not_cancelable" | null;
}

/**
 * Decide whether the customer may cancel this order, mirroring the backend rule
 * in `PATCH /api/customer/orders/:orderId/cancel`.
 *
 * This is the ONE rule the order page's cancel button reads, so it can never
 * appear where the backend answers `INVALID_STATUS`/`ORDER_ALREADY_PAID`, and
 * never disappear where the backend would accept the cancellation. The payment
 * half is checked FIRST: a `pending_payment` order whose payment already says
 * `paid` (an order row lagging one transition behind) must not offer cancel.
 */
export function orderCustomerCancelability(
  order: OrderCancelabilityInput | null | undefined,
): OrderCustomerCancelability {
  if (!order) return { cancelable: false, reason: "not_cancelable" };

  const statuses = [
    order.paymentStatus,
    ...(order.payments ?? []).map((p) => p?.status),
  ].filter((s): s is string => typeof s === "string");
  if (statuses.some((s) => PAYMENT_BLOCKS_CANCELLATION.has(s.trim().toLowerCase()))) {
    return { cancelable: false, reason: "payment_in_progress" };
  }

  return isOrderCancelableByCustomer(order.status)
    ? { cancelable: true, reason: null }
    : { cancelable: false, reason: "not_cancelable" };
}

// ---------------------------------------------------------------------------
// subscriptions (VelRepeat)
// ---------------------------------------------------------------------------
export interface StoreSubscription {
  id: string;
  customerUserId: string;
  productId: string;
  shopId: string;
  sellerId: string;
  quantity: number;
  unitPriceSnapshot: number;
  frequency: "daily" | "weekly" | "monthly" | "custom";
  intervalDays: number;
  nextOrderDate: string; // YYYY-MM-DD
  status: "active" | "paused" | "cancelled";
  /** Unix ms */
  createdAt: number;
  updatedAt: number;
  productName?: string;
  productImageUrl?: string;
  /** joined for the seller VelRepeat panel */
  customerName?: string;
  customerEmail?: string;
}

// ---------------------------------------------------------------------------
// formatters — accept both ISO strings (backend-derived values) and Unix ms
// numbers (Neon timestamptz serialized to ms).
// ---------------------------------------------------------------------------
export function formatBaht(value: number): string {
  return `฿${value.toLocaleString("th-TH", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`;
}

export function formatIsoDate(iso: string | number): string {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(iso));
}

export function formatIsoDateTime(iso: string | number): string {
  return new Intl.DateTimeFormat("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

// ---------------------------------------------------------------------------
// locale-aware date formatters (velshop uses the active UI language)
// ---------------------------------------------------------------------------

/** Map the app's language codes to Intl locale tags. */
export const DATE_LOCALE_MAP: Record<string, string> = {
  th: "th-TH",
  en: "en-US",
  my: "my-MM",
};

/**
 * Format a date for the active UI language.
 * Accepts Unix-ms numbers, ISO strings or Date objects (backend sends both
 * epoch ms and timestamptz strings). Timestamps render in the visitor's local
 * timezone — correct for user-facing "next order" dates. Returns "—" for
 * null/undefined/invalid so callers never show a raw placeholder.
 */
export function formatLocaleDate(
  value: string | number | Date | null | undefined,
  lang: string,
): string {
  if (value == null || value === "") return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(DATE_LOCALE_MAP[lang] ?? "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}

/** Same as formatLocaleDate but with time (hour:minute). */
export function formatLocaleDateTime(
  value: string | number | Date | null | undefined,
  lang: string,
): string {
  if (value == null || value === "") return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat(DATE_LOCALE_MAP[lang] ?? "en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

/**
 * Relative-time formatter for reviews / chat, localized via i18n.
 * Uses these keys (must exist at parity in th/en/my):
 *   common.justNow, common.minutesAgo ({count}), common.today,
 *   common.yesterday, common.daysAgo ({count})
 * Falls back to formatLocaleDate (absolute) for anything older than 7 days.
 */
export function formatRelativeTime(
  value: string | number | Date | null | undefined,
  lang: string,
  t: (k: string, v?: Record<string, string | number>) => string,
): string {
  if (value == null || value === "") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const now = Date.now();
  const ts = d.getTime();
  const diffMs = now - ts;
  const minute = 60_000;
  if (diffMs < minute) return t("common.justNow");
  if (diffMs < 60 * minute) return t("common.minutesAgo", { count: Math.max(1, Math.floor(diffMs / minute)) });

  const startOfDay = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const todayStart = startOfDay(new Date());
  const dayStart = startOfDay(d);
  if (dayStart === todayStart) return t("common.today");
  if (dayStart === todayStart - 24 * 60 * minute) return t("common.yesterday");

  const days = Math.floor((todayStart - dayStart) / (24 * 60 * minute));
  if (days > 0 && days <= 7) return t("common.daysAgo", { count: days });
  return formatLocaleDate(value, lang);
}

/** Clock time (hour:minute) localized to the active UI language. */
export function formatLocaleTime(
  value: string | number | Date | null | undefined,
  lang: string,
): string {
  if (value == null || value === "") return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat(DATE_LOCALE_MAP[lang] ?? "en-US", {
    hour: "numeric",
    minute: "2-digit",
  }).format(d);
}

export function shortOrderId(id: string): string {
  return `#${id.slice(0, 8).toUpperCase()}`;
}

export function shortOrderNumber(orderNumber: string): string {
  return orderNumber.replace(/^ORD-/, "");
}

// ---------------------------------------------------------------------------
// product category labels (mirror of legacy lib/reorder)
// ---------------------------------------------------------------------------
export const PRODUCT_CATEGORY_META: Record<StoreProductCategory, { label: string }> = {
  general: { label: "ทั่วไป" },
  food: { label: "อาหาร" },
  daily: { label: "ของใช้ประจำวัน" },
  beauty: { label: "ความงาม" },
  packaging: { label: "บรรจุภัณฑ์" },
  other: { label: "อื่น ๆ" },
  "food-beverage": { label: "อาหารและเครื่องดื่ม" },
  "grocery-household": { label: "ของชำและของใช้ในครัวเรือน" },
  "beauty-personal-care": { label: "ความงามและการดูแลส่วนบุคคล" },
  "health-wellness": { label: "สุขภาพและความเป็นอยู่ที่ดี" },
  fashion: { label: "แฟชั่น" },
  "shoes-bags": { label: "รองเท้าและกระเป๋า" },
  "jewelry-accessories": { label: "เครื่องประดับและแอคเซสเซอรี่" },
  electronics: { label: "อิเล็กทรอนิกส์" },
  "phones-accessories": { label: "โทรศัพท์มือถือและอุปกรณ์เสริม" },
  "computers-accessories": { label: "คอมพิวเตอร์และอุปกรณ์เสริม" },
  "home-appliances": { label: "เครื่องใช้ไฟฟ้าภายในบ้าน" },
  "home-living": { label: "บ้านและไลฟ์สไตล์" },
  furniture: { label: "เฟอร์นิเจอร์" },
  "garden-outdoor": { label: "สวนและกลางแจ้ง" },
  "baby-kids": { label: "ทารกและเด็ก" },
  "toys-games": { label: "ของเล่นและเกม" },
  pets: { label: "สัตว์เลี้ยง" },
  "sports-outdoors": { label: "กีฬาและกลางแจ้ง" },
  automotive: { label: "ยานยนต์" },
  "tools-hardware": { label: "เครื่องมือและฮาร์ดแวร์" },
  "stationery-office": { label: "เครื่องเขียนและสำนักงาน" },
  "business-equipment": { label: "อุปกรณ์ธุรกิจ" },
  "books-media": { label: "หนังสือและสื่อ" },
  "hobbies-collectibles": { label: "งานอดิเรกและของสะสม" },
  agriculture: { label: "เกษตรกรรม" },
  "local-products": { label: "สินค้าท้องถิ่น" },
  services: { label: "บริการ" },
};
