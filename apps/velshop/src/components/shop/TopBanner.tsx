import { Link } from "react-router";
import { useLanguage } from "@/lib/i18n";
import { ArrowRight, Store, Sparkles } from "lucide-react";
import { SITE_URLS } from "@velnox/shared/lib/sites";

/**
 * Top banner — Thaimart style.
 * "เริ่มธุรกิจของคุณกับ Velnox" with CTA to seller registration.
 * Homepage-only (rendered by ShopHome below the ad carousel), session-dismissible.
 */
export function TopBanner({ onDismiss }: { onDismiss?: () => void }) {
  const { t } = useLanguage();

  return (
    <div className="bg-gradient-to-r from-emerald-600 via-emerald-700 to-emerald-800 text-white">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-white/20">
            <Sparkles className="size-5 text-white" />
          </span>
          <div className="min-w-0">
            <p className="font-semibold text-sm sm:text-base truncate">
              {t("thaimartUi.topBanner.title", { platform: "Velnox" })}
            </p>
            <p className="text-[11px] sm:text-xs opacity-90 truncate">
              {t("thaimartUi.topBanner.subtitle")}
            </p>
          </div>
        </div>

        <Link
          to={SITE_URLS.velseller}
          className="shrink-0 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-4 py-2 text-xs font-semibold hover:bg-white/20 transition-colors whitespace-nowrap"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Store className="size-3.5" />
          {t("thaimartUi.topBanner.cta")}
          <ArrowRight className="size-3.5" />
        </Link>

        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={t("thaimartUi.topBanner.dismiss")}
            className="shrink-0 flex size-8 items-center justify-center rounded-full bg-white/10 hover:bg-white/20 transition-colors"
          >
            <svg className="size-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        )}
      </div>
    </div>
  );
}
