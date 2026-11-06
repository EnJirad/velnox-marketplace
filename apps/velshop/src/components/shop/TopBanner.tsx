import { Link } from "react-router";
import { useLanguage } from "@/lib/i18n";
import { ArrowRight, Store, BadgeCheck, ShieldCheck } from "lucide-react";
import { SITE_URLS } from "@velnox/shared/lib/sites";

/**
 * Top banner — minimal, flat card matching Velnox design theme.
 * Solid emerald background, no gradients, no shadows, no decorative elements.
 * Homepage-only (rendered by ShopHome below the hero carousel), session-dismissible.
 */
export function TopBanner({ onDismiss }: { onDismiss?: () => void }) {
  const { t } = useLanguage();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <div className="mt-3 rounded-2xl bg-[#10B981] text-white">
        <div className="flex items-center justify-between gap-3 px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/15">
              <Store className="size-5 text-white" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight sm:text-base">
                {t("thaimartUi.topBanner.title", { platform: "Velnox" })}
              </p>
              <p className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] opacity-90 sm:text-xs">
                <ShieldCheck className="size-3 shrink-0" />
                <span className="truncate">{t("thaimartUi.topBanner.subtitle")}</span>
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <Link
              to={SITE_URLS.velseller}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-3.5 py-2 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-50"
            >
              <BadgeCheck className="size-4" />
              {t("thaimartUi.topBanner.cta")}
              <ArrowRight className="size-3.5" />
            </Link>

            {onDismiss && (
              <button
                type="button"
                onClick={onDismiss}
                aria-label={t("thaimartUi.topBanner.dismiss")}
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/20"
              >
                <svg className="size-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
