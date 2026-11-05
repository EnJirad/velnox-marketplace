import { Link } from "react-router";
import { useLanguage } from "@/lib/i18n";
import { ArrowRight, Store, BadgeCheck, ShieldCheck } from "lucide-react";
import { SITE_URLS } from "@velnox/shared/lib/sites";

/**
 * Top banner — Thaimart-inspired but as a rounded, dimensional card.
 *
 * NOT a full-width strip: it sits inside the page container with outer margin,
 * a soft emerald gradient, a subtle top sheen and a raised shadow so it reads
 * as a designed promotion card rather than a flat bar.
 *
 * Homepage-only (rendered by ShopHome below the ad carousel), session-dismissible.
 */
export function TopBanner({ onDismiss }: { onDismiss?: () => void }) {
  const { t } = useLanguage();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
      <div className="relative mt-3 overflow-hidden rounded-2xl bg-gradient-to-br from-emerald-500 via-emerald-600 to-teal-700 text-white shadow-[0_10px_30px_-8px_rgba(16,185,129,0.5)] ring-1 ring-white/20">
        {/* Decorative sheen — subtle top highlight for depth */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(120% 90% at 15% 0%, rgba(255,255,255,0.28) 0%, rgba(255,255,255,0) 42%), radial-gradient(80% 120% at 95% 100%, rgba(13,148,136,0.55) 0%, rgba(13,148,136,0) 60%)",
          }}
        />
        {/* Soft decorative circle */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute -right-10 -top-14 size-44 rounded-full bg-white/10 blur-2xl"
        />

        <div className="relative flex items-center justify-between gap-3 px-4 py-3.5 sm:px-6 sm:py-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-white/20 ring-1 ring-white/30 backdrop-blur-sm">
              <Store className="size-5 text-white" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-bold leading-tight sm:text-base">
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
              className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full bg-white px-3.5 py-2 text-xs font-bold text-emerald-700 shadow-sm transition-all hover:bg-emerald-50 hover:shadow-md active:scale-[0.98]"
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
                className="flex size-7 shrink-0 items-center justify-center rounded-full bg-white/10 transition-colors hover:bg-white/25"
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
