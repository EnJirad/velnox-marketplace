/**
 * Small presentational pieces shared by the MVP VelShop pages.
 *
 * Deliberately plain and local: the Phase 3b brief is to make the new API usable
 * through the existing storefront, not to redesign it, so these borrow the
 * existing template's slate/white surfaces and Velnox Green accent rather than
 * introducing a second design system.
 */
import { Button } from "@velnox/shared/components/ui/button";
import { formatMoney } from "@velnox/shared/mvp/ui";
import type { MvpOrderStatus, MvpProductSummary } from "@velnox/shared/mvp";
import { ImageOff, Store } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";

/** Order-status → label + tone. The status is always the server's value. */
const ORDER_STATUS: Record<MvpOrderStatus, { label: string; className: string }> = {
  pending_payment: { label: "Awaiting payment", className: "bg-amber-50 text-amber-700 border-amber-200" },
  paid: { label: "Paid", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  processing: { label: "Processing", className: "bg-sky-50 text-sky-700 border-sky-200" },
  shipped: { label: "Shipped", className: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  delivered: { label: "Delivered", className: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelled: { label: "Cancelled", className: "bg-slate-100 text-slate-600 border-slate-200" },
};

export function OrderStatusBadge({ status }: { status: MvpOrderStatus | string }) {
  const entry = ORDER_STATUS[status as MvpOrderStatus] ?? {
    label: String(status).replace(/_/g, " "),
    className: "bg-slate-100 text-slate-600 border-slate-200",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${entry.className}`}
    >
      {entry.label}
    </span>
  );
}

/** A catalogue image with a neutral placeholder — never a broken icon. */
export function ProductImage({
  src,
  alt,
  className = "aspect-square",
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
}) {
  if (!src) {
    return (
      <div className={`flex items-center justify-center rounded-xl bg-slate-100 ${className}`}>
        <ImageOff className="size-6 text-slate-300" />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt}
      loading="lazy"
      className={`w-full rounded-xl bg-slate-100 object-cover ${className}`}
    />
  );
}

/**
 * One published product.
 *
 * `available` is the server's available count (quantity − reserved). It is
 * rendered, never recomputed: the storefront has no inventory authority.
 */
export function ProductTile({ product }: { product: MvpProductSummary }) {
  const soldOut = product.available <= 0;
  return (
    <Link
      to={`/products/${encodeURIComponent(product.slug)}`}
      className="group flex flex-col gap-2 rounded-2xl border border-slate-200 bg-white p-2.5 transition-shadow hover:shadow-[0_12px_30px_rgba(15,23,42,0.08)]"
    >
      <div className="relative">
        <ProductImage src={product.imageUrl} alt={product.name} />
        {soldOut && (
          <span className="absolute left-2 top-2 rounded-full bg-slate-900/80 px-2 py-0.5 text-[10px] font-semibold text-white">
            Sold out
          </span>
        )}
      </div>
      <p className="line-clamp-2 min-h-[2.5rem] text-sm font-medium leading-5 text-slate-900 group-hover:text-[#059669]">
        {product.name}
      </p>
      <p className="text-base font-bold text-slate-900">{formatMoney(product.price)}</p>
      <p className="flex items-center gap-1 text-[11px] text-slate-500">
        <Store className="size-3" />
        {product.seller.storeName}
      </p>
    </Link>
  );
}

export function ErrorLine({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-[10px] bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
      {message}
    </p>
  );
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
      {action}
    </div>
  );
}

export function ViewAllLink({ to }: { to: string }) {
  return (
    <Button variant="ghost" size="sm" asChild className="text-[#059669] hover:text-[#047857]">
      <Link to={to}>View all</Link>
    </Button>
  );
}

/** A price + label row used by every summary block. */
export function SummaryRow({
  label,
  value,
  strong = false,
}: {
  label: string;
  value: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className={strong ? "font-semibold text-slate-900" : "text-slate-500"}>{label}</span>
      <span className={strong ? "text-base font-bold text-slate-900" : "text-slate-700"}>{value}</span>
    </div>
  );
}
