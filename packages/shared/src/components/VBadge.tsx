/**
 * V Badge — the Velnox verified-seller indicator.
 *
 * The original storefront showed a green "V" on every product of a verified
 * seller and opened an explanation when tapped. The MVP has one verification
 * fact — an APPROVED `seller_profiles` row — so `verified` is the only input;
 * there is no second verification axis to combine.
 */
import { useLanguage } from "../lib/i18n/index.js";
import { cn } from "../lib/utils.js";
import { Popover, PopoverContent, PopoverTrigger } from "./ui/popover.js";

export function VBadge({
  verified,
  size = "sm",
  className,
}: {
  verified: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const { t } = useLanguage();
  if (!verified) return null;

  const sizeClasses = {
    sm: "h-5 w-6 text-[10px]",
    md: "h-6 w-8 text-[11px]",
    lg: "h-7 w-9 text-xs",
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          className={cn(
            "absolute left-2 top-2 z-10 flex items-center justify-center rounded-lg font-extrabold",
            "bg-emerald-600/90 text-white shadow-md backdrop-blur-sm",
            "transition-all duration-150 hover:bg-emerald-600 hover:shadow-lg active:scale-95",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400",
            sizeClasses[size],
            className,
          )}
          aria-label={t("verification.vInfoAriaLabel")}
        >
          V
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={8}
        className="w-80 rounded-2xl border border-slate-200 bg-white p-4 shadow-lg"
      >
        <div className="flex items-center gap-2.5">
          <span className="flex size-7 items-center justify-center rounded-full bg-emerald-100">
            <span className="text-sm font-extrabold text-emerald-700">V</span>
          </span>
          <h3 className="text-sm font-bold text-slate-900">{t("verification.vInfoTitle")}</h3>
        </div>
        <p className="mt-3 text-sm leading-5 text-slate-600">{t("verification.vInfoDesc")}</p>
        <div className="mt-3 rounded-xl bg-slate-50 p-3">
          <p className="text-[11px] leading-4 text-slate-500">
            {t("verification.vInfoDisclaimer")}
          </p>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** Inline V chip for shop/account headers (no overlay). */
export function VBadgeChip({ verified, className }: { verified: boolean; className?: string }) {
  const { t } = useLanguage();
  if (!verified) return null;
  return (
    <span
      title={t("verification.sellerVerifiedTooltip")}
      aria-label={t("verification.sellerVerified")}
      className={cn(
        "inline-flex items-center rounded-lg bg-emerald-50 px-1.5 py-0.5 text-[10px] font-extrabold text-emerald-700 ring-1 ring-inset ring-emerald-600/15",
        className,
      )}
    >
      V
    </span>
  );
}
