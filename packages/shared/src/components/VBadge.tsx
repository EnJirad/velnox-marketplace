/**
 * V✓ Badge — Velnox Verification Badge
 *
 * Shows "V✓" when a product qualifies for verification
 * (both seller AND product verified).
 *
 * For shop-level verification, use `sellerOnly` prop.
 */

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@velnox/shared/components/ui/tooltip";
import { ShieldCheck } from "lucide-react";
import type { VerificationStatus } from "../lib/commerce";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { cn } from "@velnox/shared/lib/utils";

interface VBadgeProps {
  /** Product-level verification status */
  productVerification?: VerificationStatus;
  /** Seller-level verification status */
  sellerVerification?: VerificationStatus;
  /** When true, shows seller-only verification badge (not the combined V✓) */
  sellerOnly?: boolean;
  /** Size variant */
  size?: "sm" | "md" | "lg";
  /** Additional class names */
  className?: string;
}

/**
 * Determine if the product qualifies for the full V✓ badge.
 * BOTH seller AND product must be verified.
 */
export function isProductVerified(
  productVerification?: VerificationStatus,
  sellerVerification?: VerificationStatus,
): boolean {
  return productVerification === "verified" && sellerVerification === "verified";
}

/**
 * Full V✓ product badge — only visible when both seller AND product are verified.
 */
export function VBadge({
  productVerification,
  sellerVerification,
  sellerOnly = false,
  size = "sm",
  className,
}: VBadgeProps) {
  const { t } = useLanguage();

  // For seller-only badge (shop page)
  if (sellerOnly) {
    const isVerified = sellerVerification === "verified";
    if (!isVerified) return null;

    return (
      <TooltipProvider delayDuration={200}>
        <Tooltip>
          <TooltipTrigger asChild>
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
              <span className="text-emerald-600">✓</span>
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-[200px] text-xs">
            {t("verification.sellerVerifiedTooltip")}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }

  // Product-level V✓ badge — requires BOTH seller AND product verified
  const verified = isProductVerified(productVerification, sellerVerification);
  if (!verified) return null;

  return (
    <TooltipProvider delayDuration={200}>
      <Tooltip>
        <TooltipTrigger asChild>
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
            aria-label={t("verification.verifiedProduct")}
          >
            <span className="font-extrabold">V</span>
            <span className="text-emerald-600">✓</span>
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[220px] text-xs">
          {t("verification.productVerifiedTooltip")}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

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
