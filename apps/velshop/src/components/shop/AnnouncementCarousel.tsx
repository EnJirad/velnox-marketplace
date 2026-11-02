import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, ChevronLeft, ChevronRight } from "lucide-react";
import { Link } from "react-router";
import { cn } from "@velnox/shared/lib/utils";
import { useLanguage } from "@/lib/i18n";

export interface Announcement {
  id: string;
  /** Short label above the title, e.g. the announcement type. */
  eyebrow: string;
  title: string;
  description: string;
  /** Optional destination. The whole slide becomes a link when present. */
  href?: string;
  /** Optional real image (R2 URL minted by the backend). */
  imageUrl?: string | null;
}

interface AnnouncementCarouselProps {
  items: Announcement[];
  /** Rotation interval in ms. Ignored under `prefers-reduced-motion: reduce`. */
  intervalMs?: number;
  className?: string;
}

/**
 * Announcement carousel for the VelShop storefront.
 *
 * The slide area has a fixed height, so switching slides never reflows the page.
 * Rotation uses ONE timeout that is re-armed per index (never a repeating
 * interval), and it is cleared on unmount, on interaction (pointer/hover/focus)
 * and when the document is hidden. Reduced-motion users get no autoplay and no
 * sliding transition.
 *
 * Data contract: `Announcement[]` — the caller supplies real content. This
 * component never invents copy, numbers or destinations.
 */
export function AnnouncementCarousel({
  items,
  intervalMs = 5000,
  className,
}: AnnouncementCarouselProps) {
  const { t } = useLanguage();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [dragX, setDragX] = useState(0);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragStart = useRef<number | null>(null);
  const dragDx = useRef(0);
  const regionRef = useRef<HTMLDivElement>(null);

  const count = items.length;
  const reducedMotion = usePrefersReducedMotion();

  // A single announcement should not animate at all.
  const rotating = count > 1 && !paused && !reducedMotion;

  const goTo = useCallback(
    (next: number) => {
      if (count === 0) return;
      setIndex(((next % count) + count) % count);
    },
    [count],
  );

  // One timeout per (index, rotating) — re-armed, never stacked.
  useEffect(() => {
    if (!rotating) return;
    const id = window.setTimeout(() => goTo(index + 1), intervalMs);
    return () => window.clearTimeout(id);
  }, [index, rotating, intervalMs, goTo]);

  // Pause while the tab is hidden so the carousel does not race in background.
  useEffect(() => {
    const onVisibility = () => setPaused(document.hidden);
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  // Clamp when the list shrinks.
  useEffect(() => {
    if (index >= count) setIndex(0);
  }, [count, index]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (count < 2) return;
    dragStart.current = event.clientX;
    setPaused(true);
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragStart.current == null) return;
    dragDx.current = event.clientX - dragStart.current;
    setDragX(dragDx.current);
  };

  const endDrag = () => {
    if (dragStart.current === null) return;
    const dx = dragDx.current;
    dragStart.current = null;
    dragDx.current = 0;
    setDragX(0);
    if (Math.abs(dx) > 40) goTo(index + (dx < 0 ? 1 : -1));
    setPaused(false);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (count < 2) return;
    if (event.key === "ArrowRight") {
      event.preventDefault();
      goTo(index + 1);
    }
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      goTo(index - 1);
    }
  };

  const label = useMemo(() => {
    if (count === 0) return t("announce.region");
    return t("announce.position", { current: index + 1, total: count });
  }, [count, index, t]);

  if (count === 0) return null;

  const trackStyle = reducedMotion
    ? undefined
    : {
        transform: `translate3d(calc(${-index * 100}% + ${dragX}px), 0, 0)`,
        transition: dragStart.current === null ? "transform 420ms cubic-bezier(0.22,1,0.36,1)" : "none",
      };

  return (
    <div
      ref={regionRef}
      role="region"
      aria-roledescription="carousel"
      aria-label={t("announce.region")}
      onKeyDown={onKeyDown}
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => {
        if (dragStart.current === null) setPaused(false);
      }}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      tabIndex={count > 1 ? 0 : -1}
      className={cn(
        "relative overflow-hidden rounded-2xl border border-[#10B981]/20 bg-[#ECFDF5] outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]/60",
        className,
      )}
    >
      <div
        ref={trackRef}
        className="flex h-[136px] touch-pan-y md:h-[168px]"
        style={trackStyle}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      >
        {items.map((item, i) => {
          const body = (
            <>
              <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-[#059669] sm:text-[11px]">
                {item.eyebrow}
              </span>
              <span className="mt-1 line-clamp-1 text-base font-bold tracking-tight text-slate-900 sm:text-lg">
                {item.title}
              </span>
              <span className="mt-1 line-clamp-2 text-[11px] leading-4 text-slate-600 sm:text-xs sm:leading-5">
                {item.description}
              </span>
              {item.href && (
                <span className="mt-2 inline-flex w-fit items-center gap-1 text-[11px] font-semibold text-[#059669] sm:text-xs">
                  {t("home.bannerCta")}
                  <ArrowRight className="size-3.5" />
                </span>
              )}
            </>
          );
          return (
            <div
              key={item.id}
              role="group"
              aria-roledescription="slide"
              aria-label={`${i + 1} / ${count}`}
              aria-hidden={i !== index}
              className="flex w-full shrink-0 items-stretch"
            >
              <div className="flex min-w-0 flex-1 flex-col justify-center px-4 py-3 sm:px-6">
                {item.href ? (
                  item.href.startsWith("http") ? (
                    <a
                      href={item.href}
                      rel="noopener noreferrer"
                      className="flex flex-col rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]"
                    >
                      {body}
                    </a>
                  ) : (
                    <Link
                      to={item.href}
                      className="flex flex-col rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-[#10B981]"
                    >
                      {body}
                    </Link>
                  )
                ) : (
                  body
                )}
              </div>
              {item.imageUrl && (
                <div className="relative h-full w-[32%] shrink-0 overflow-hidden sm:w-[38%]">
                  <img
                    src={item.imageUrl}
                    alt=""
                    className="size-full object-cover"
                    loading={i === index ? "eager" : "lazy"}
                    decoding="async"
                  />
                  <span
                    className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-[#ECFDF5] to-transparent"
                    aria-hidden="true"
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {count > 1 && (
        <>
          {/* Indicators */}
          <div className="pointer-events-none absolute inset-x-0 bottom-2 flex items-center justify-center gap-1.5">
            {items.map((item, i) => (
              <button
                key={item.id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={t("announce.goTo", { index: i + 1 })}
                aria-current={i === index}
                className={cn(
                  "pointer-events-auto h-1.5 rounded-full transition-all",
                  i === index ? "w-5 bg-[#10B981]" : "w-1.5 bg-[#10B981]/30 hover:bg-[#10B981]/50",
                )}
              />
            ))}
          </div>

          {/* Desktop-only arrows — subtle, in the top-right corner */}
          <div className="absolute right-2 top-2 hidden items-center gap-1 sm:flex">
            <button
              type="button"
              onClick={() => goTo(index - 1)}
              aria-label={t("announce.prev")}
              className="flex size-7 items-center justify-center rounded-full bg-white/70 text-slate-600 transition-colors hover:bg-white hover:text-[#059669]"
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              aria-label={t("announce.next")}
              className="flex size-7 items-center justify-center rounded-full bg-white/70 text-slate-600 transition-colors hover:bg-white hover:text-[#059669]"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>
        </>
      )}

      <span className="sr-only" aria-live="polite">
        {label}
      </span>
    </div>
  );
}

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return reduced;
}
