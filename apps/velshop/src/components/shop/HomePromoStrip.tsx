import { ArrowRight } from "lucide-react";
import { Link } from "react-router";
import { useLanguage } from "@/lib/i18n";

export interface PromoStripBanner {
  id: string;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  href?: string;
  ctaLabel?: string | null;
}

/**
 * VelShop homepage promo strip — renders the `home_strip` placement of the
 * banner contract (backend/lib/banners.ts), below the category rail.
 *
 * Same three-mode rule as the hero carousel: an image-only card fills with the
 * image, a text-only card renders clean copy, image+text combines. Cards are
 * stacked full-width up to `sm`, then two columns — no fixed heights, no
 * invented content, and the component renders nothing when the placement has
 * no banners.
 */
export function HomePromoStrip({ banners }: { banners: PromoStripBanner[] }) {
  const { t } = useLanguage();
  // The brief scopes the strip to the FIRST strip banner — one compact row
  // below the category rail, not a second carousel.
  const shown = banners.slice(0, 1);
  if (shown.length === 0) return null;

  return (
    <section className="border-b border-slate-100 bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-4 sm:px-6 sm:py-5">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[#059669]">
          {t("marketing.stripEyebrow")}
        </p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {shown.map((banner) => {
            const hasText = Boolean(banner.title || banner.subtitle);
            const inner = (
              <>
                {banner.imageUrl && (
                  <div
                    className={
                      hasText
                        ? "h-28 w-full shrink-0 overflow-hidden rounded-xl sm:h-32 md:h-full md:w-40"
                        : "aspect-[3/1] w-full overflow-hidden rounded-xl"
                    }
                  >
                    <img
                      src={banner.imageUrl}
                      alt=""
                      className="size-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                )}
                {hasText && (
                  <div className="min-w-0 flex-1 py-1">
                    {banner.title && (
                      <p className="text-base font-bold tracking-tight text-slate-900">{banner.title}</p>
                    )}
                    {banner.subtitle && (
                      <p className="mt-1 text-xs leading-5 text-slate-600">{banner.subtitle}</p>
                    )}
                    {banner.href && (
                      <span className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-[#059669]">
                        {banner.ctaLabel || t("marketing.stripCta")}
                        <ArrowRight className="size-3.5" />
                      </span>
                    )}
                  </div>
                )}
              </>
            );
            return (
              <div
                key={banner.id}
                className="flex items-center gap-4 rounded-2xl border border-brand/15 bg-[#ECFDF5]/50 p-3 sm:p-4"
              >
                {banner.href ? (
                  banner.href.startsWith("http") ? (
                    <a
                      href={banner.href}
                      rel="noopener noreferrer"
                      className="flex min-w-0 flex-1 items-center gap-4 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      {inner}
                    </a>
                  ) : (
                    <Link
                      to={banner.href}
                      className="flex min-w-0 flex-1 items-center gap-4 rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-brand"
                    >
                      {inner}
                    </Link>
                  )
                ) : (
                  <div className="flex min-w-0 flex-1 items-center gap-4">{inner}</div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
