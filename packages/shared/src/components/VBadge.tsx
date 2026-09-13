/**
 * V Badge — Velnox Product Verification Indicator
 *
 * Shows a compact green "V" overlay on product images.
 * Clicking V opens a verification info popover (desktop) or bottom sheet (mobile).
 *
 * Eligibility: BOTH seller AND product must be verified ("verified" status).
 * For shop-level verification, use `sellerOnly` prop.
 */

import { useLanguage } from "@velnox/shared/lib/i18n";
import { cn } from "@velnox/shared/lib/utils";
import type { VerificationStatus } from "../lib/commerce";
import { ShieldCheck, X } from "lucide-react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@velnox/shared/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@velnox/shared/components/ui/sheet";
import { useIsMobile } from "@velnox/shared/hooks/use-mobile";
import { useCallback, useEffect, useRef, useState } from "react";

interface VBadgeProps {
  /** Product-level verification status */
  productVerification?: VerificationStatus;
  /** Seller-level verification status */
  sellerVerification?: VerificationStatus;
  /** When true, shows seller-only verification badge (not the combined V) */
  sellerOnly?: boolean;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Additional class names */
  className?: string;
}

/**
 * Determine if the product qualifies for the V badge.
 * BOTH seller AND product must be verified.
 */
export function isProductVerified(
  productVerification?: VerificationStatus,
  sellerVerification?: VerificationStatus,
): boolean {
  return productVerification === "verified" && sellerVerification === "verified";
}

/* ─── V Verification Info Content ─────────────────────────────────── */

function VVerificationContent({ onClose }: { onClose?: () => void }) {
  const { t } = useLanguage();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-full bg-emerald-100">
            <span className="text-sm font-extrabold text-emerald-700">V</span>
          </span>
          <h3 className="text-sm font-bold text-slate-900">
            {t("verification.vInfoTitle")}
          </h3>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="flex size-7 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
            aria-label="Close"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Description */}
      <p className="text-sm leading-5 text-slate-600">
        {t("verification.vInfoDesc")}
      </p>

      {/* Verification checks */}
      <div className="space-y-2.5">
        <div className="flex items-center gap-2.5">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-100">
            <svg className="size-3 text-emerald-600" viewBox="0 0 12 12" fill="none">
              <path d="M2 6.5L4.5 9L10 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-sm text-slate-700">
            {t("verification.vInfoCheckProduct")}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-100">
            <svg className="size-3 text-emerald-600" viewBox="0 0 12 12" fill="none">
              <path d="M2 6.5L4.5 9L10 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-sm text-slate-700">
            {t("verification.vInfoCheckEvidence")}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-emerald-100">
            <svg className="size-3 text-emerald-600" viewBox="0 0 12 12" fill="none">
              <path d="M2 6.5L4.5 9L10 3" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="text-sm text-slate-700">
            {t("verification.vInfoCheckSeller")}
          </span>
        </div>
      </div>

      {/* Last checked */}
      <p className="text-xs text-slate-400">
        {t("verification.vInfoLastChecked", {
          date: new Date().toLocaleDateString(),
        })}
      </p>

      {/* Disclaimer */}
      <div className="rounded-xl bg-slate-50 p-3">
        <p className="text-[11px] leading-4 text-slate-500">
          {t("verification.vInfoDisclaimer")}
        </p>
      </div>
    </div>
  );
}

/* ─── V Badge (Image Overlay Mode) ────────────────────────────────── */

/**
 * V badge for product image overlays.
 * Renders as a green V button positioned TOP-LEFT on the image.
 * Clicking opens V info popover (desktop) or bottom sheet (mobile).
 */
function VOverlayBadge({
  productVerification,
  sellerVerification,
  size = "sm",
  className,
}: {
  productVerification?: VerificationStatus;
  sellerVerification?: VerificationStatus;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { t } = useLanguage();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);

  const verified = isProductVerified(productVerification, sellerVerification);
  if (!verified) return null;

  const toggle = useCallback(
    (e: React.MouseEvent | React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setOpen((prev) => !prev);
    },
    [],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    },
    [open],
  );

  // Close popover on Escape (desktop)
  useEffect(() => {
    if (!open || isMobile) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open, isMobile]);

  const sizeClasses = {
    sm: "size-6 text-[10px]",
    md: "size-7 text-[11px]",
    lg: "size-8 text-xs",
  };

  const badge = (
    <button
      ref={triggerRef}
      type="button"
      onClick={toggle}
      onKeyDown={handleKeyDown}
      className={cn(
        "absolute z-10 flex items-center justify-center rounded-full font-extrabold",
        "bg-emerald-500 text-white shadow-md",
        "transition-all duration-150 ease-out",
        "hover:bg-emerald-600 hover:shadow-lg",
        "active:scale-95",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-1",
        "select-none",
        sizeClasses[size],
        // Position: top-left
        "left-2 top-2",
        className,
      )}
      aria-label={t("verification.vInfoAriaLabel")}
      aria-expanded={open}
    >
      V
    </button>
  );

  // Mobile: use Sheet (bottom sheet)
  if (isMobile) {
    return (
      <>
        {badge}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent
            side="bottom"
            className="max-h-[80dvh] rounded-t-2xl border-t border-slate-200 p-0"
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <SheetTitle className="sr-only">
              {t("verification.vInfoAriaLabel")}
            </SheetTitle>
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-slate-300" />
            </div>
            <div className="px-4 pb-6 pt-2">
              <VVerificationContent onClose={() => setOpen(false)} />
            </div>
          </SheetContent>
        </Sheet>
      </>
    );
  }

  // Desktop: use Popover
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{badge}</PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <VVerificationContent onClose={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  );
}

/* ─── Seller-Only Badge (for shop pages) ──────────────────────────── */

function SellerOnlyBadge({
  sellerVerification,
  size = "sm",
  className,
}: {
  sellerVerification?: VerificationStatus;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { t } = useLanguage();
  const isVerified = sellerVerification === "verified";
  if (!isVerified) return null;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full font-bold",
        "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15",
        size === "sm" && "px-1.5 py-0.5 text-[9px]",
        size === "md" && "px-2 py-0.5 text-[10px]",
        size === "lg" && "px-2.5 py-1 text-xs",
        className,
      )}
      role="img"
      aria-label={t("verification.sellerVerified")}
    >
      <span className="font-extrabold">V</span>
    </span>
  );
}

/* ─── Main Export ──────────────────────────────────────────────────── */

/**
 * VBadge — the main export.
 *
 * - Product mode (default): renders an overlay V button that opens verification info.
 * - Seller-only mode: renders a small inline badge for shop pages.
 */
export function VBadge({
  productVerification,
  sellerVerification,
  sellerOnly = false,
  size = "sm",
  className,
}: VBadgeProps) {
  if (sellerOnly) {
    return (
      <SellerOnlyBadge
        sellerVerification={sellerVerification}
        size={size}
        className={className}
      />
    );
  }

  return (
    <VOverlayBadge
      productVerification={productVerification}
      sellerVerification={sellerVerification}
      size={size}
      className={className}
    />
  );
}

/* ─── Verification Status Display ──────────────────────────────────── */

/**
 * Verification status display text.
 */
export function VerificationStatusLabel({
  status,
  className,
}: {
  status: VerificationStatus;
  className?: string;
}) {
  const { t } = useLanguage();

  const config: Record<
    VerificationStatus,
    { label: string; className: string }
  > = {
    unverified: {
      label: t("verification.statusUnverified"),
      className: "text-slate-400",
    },
    pending: {
      label: t("verification.statusPending"),
      className: "text-amber-600",
    },
    verified: {
      label: t("verification.statusVerified"),
      className: "text-emerald-600",
    },
    rejected: {
      label: t("verification.statusRejected"),
      className: "text-red-500",
    },
    suspended: {
      label: t("verification.statusSuspended"),
      className: "text-orange-500",
    },
  };

  const { label, className: statusClassName } = config[status] ?? config.unverified;

  return (
    <span className={cn("inline-flex items-center gap-1 text-xs font-medium", statusClassName, className)}>
      <ShieldCheck className="size-3" />
      {label}
    </span>
  );
}
