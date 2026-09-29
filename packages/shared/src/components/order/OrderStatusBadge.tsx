import { Badge } from "../ui/badge";
import {
  getOrderStatusMeta,
  type OrderProgressStage,
  type StoreOrderStatus,
} from "../../lib/commerce";
import {
  CheckCircle2,
  CircleDashed,
  ClipboardList,
  Clock3,
  CreditCard,
  Package,
  PackageCheck,
  RotateCcw,
  Truck,
  XCircle,
  type LucideIcon,
} from "lucide-react";

/**
 * The ONE order-status badge both order surfaces render (VelShop's Orders list and
 * Order Detail, VelSeller's Orders list and Seller Order Detail).
 *
 * WHY IT EXISTS
 * -------------
 * The status of an order is the first thing a customer and a seller look at, and
 * it was being re-implemented per page with three recurring defects: a hard-coded
 * Thai label, a badge whose text colour matched its background (the status
 * "blended into the card"), and no shape or icon — so the meaning rested on
 * colour alone. This component is the single place that decides the icon and the
 * palette step, and the caller always passes a TRANSLATED label, so the same
 * status can never read differently on two screens.
 *
 * RELATION TO `shop.ts`
 * --------------------
 * `ORDER_STATUS_ICONS` in `lib/shop.ts` is velcenter's SIX-status fulfilment view
 * (its `shipped` label means "delivered to customer"). The customer/seller order
 * contract additionally carries the payment-lifecycle statuses stripe.ts writes
 * (`pending_payment`, `paid`, `payment_failed`, `refunded`) plus `expired`, which
 * that map does not know. Widening velcenter's map would change its meaning, so
 * this map is scoped to the order contract and stays in sync with
 * `ORDER_STATUS_META` by construction (its keys are `StoreOrderStatus`).
 *
 * PRESENTATION ONLY: it renames nothing and never touches `orders.status`.
 */
const ORDER_STATUS_ICONS: Record<StoreOrderStatus, LucideIcon> = {
  pending: Clock3,
  pending_payment: Clock3,
  paid: CreditCard,
  confirmed: CheckCircle2,
  shipped: Truck,
  delivered: PackageCheck,
  completed: CheckCircle2,
  payment_failed: XCircle,
  refunded: RotateCcw,
  cancelled: XCircle,
  expired: Clock3,
};

/** The icon for any status the API may return; a dashed circle when unknown. */
export function orderStatusIcon(status: unknown): LucideIcon {
  if (typeof status === "string" && Object.prototype.hasOwnProperty.call(ORDER_STATUS_ICONS, status)) {
    return ORDER_STATUS_ICONS[status as StoreOrderStatus];
  }
  return CircleDashed;
}

/**
 * The icon drawn INSIDE a progress-timeline marker for each stage.
 *
 * A stage that is already done shows a check instead, and one that has not been
 * reached shows an empty outline — so shape carries the state and colour is only
 * reinforcement (`VELNOX_DESIGN_THEME.md` §16: status is never colour-only).
 *
 * Keyed by `OrderProgressStage`, the presentation grouping in `commerce.ts`, so a
 * new stage cannot be added without this map following.
 */
export const ORDER_PROGRESS_STAGE_ICONS: Record<OrderProgressStage, LucideIcon> = {
  placed: ClipboardList,
  payment: CreditCard,
  processing: Package,
  shipped: Truck,
  delivered: PackageCheck,
};

/** The icon of a progress stage (total function — every stage has one). */
export function orderProgressStageIcon(stage: OrderProgressStage): LucideIcon {
  return ORDER_PROGRESS_STAGE_ICONS[stage];
}

export interface OrderStatusBadgeProps {
  /** The raw `orders.status` the API returned (never pre-validated). */
  status: unknown;
  /**
   * The TRANSLATED status text — `t(orderStatusI18nKey(status))` on a customer
   * surface, `t(orderStatus.…, { lang })` on the seller one. When omitted the
   * shared Thai fallback from `ORDER_STATUS_META` is used, so an admin/debug
   * render still shows a real word instead of an empty pill.
   */
  label?: string;
  /** `sm` for list rows, `default` for a page header. */
  size?: "sm" | "default";
  className?: string;
}

export function OrderStatusBadge({ status, label, size = "sm", className }: OrderStatusBadgeProps) {
  const meta = getOrderStatusMeta(status);
  const Icon = orderStatusIcon(status);
  const iconSize = size === "sm" ? "size-3" : "size-3.5";
  return (
    <Badge
      className={`gap-1.5 whitespace-nowrap rounded-full ring-1 ring-inset ${
        size === "sm" ? "text-xs font-semibold" : "text-sm font-semibold"
      } ${meta.badge} ${className ?? ""}`}
    >
      <Icon aria-hidden="true" className={`${iconSize} shrink-0`} />
      {label ?? meta.label}
    </Badge>
  );
}
