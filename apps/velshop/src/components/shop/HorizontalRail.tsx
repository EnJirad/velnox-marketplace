import { useRef, useState, useCallback, useEffect, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, type LucideIcon } from "lucide-react";
import { cn } from "@velnox/shared/lib/utils";
import { SectionHeader } from "@velnox/shared/components/ui/section-header";

interface HorizontalRailProps {
  /** Rail title (SectionHeader) */
  title: string;
  /** Rail description */
  description?: string;
  /** Leading icon */
  icon?: LucideIcon;
  /** "View all" href */
  viewAllHref?: string;
  /** "View all" label */
  viewAllLabel?: string;
  /** Children — product cards (fixed-width) */
  children: ReactNode;
  /** Card width (desktop) — sets the visible count */
  cardWidth?: number;
  className?: string;
  /** aria-label for the scroll container */
  ariaLabel?: string;
}

/**
 * Horizontal product rail — scrollable row of fixed-width cards with edge
 * arrows (Thaimart / major marketplace pattern). Arrow visibility is
 * scroll-aware; the rail is keyboard-scrollable and touch-scrollable.
 *
 * The rail is intentionally BOUNDED (server-provided slice with a "View all"
 * link) — infinite-scroll feeds belong on the catalog page, where ProductGrid
 * already handles load-more.
 */
export function HorizontalRail({
  title,
  description,
  icon,
  viewAllHref,
  viewAllLabel,
  children,
  cardWidth = 176,
  className,
  ariaLabel,
}: HorizontalRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = useState(false);
  const [canRight, setCanRight] = useState(false);

  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanLeft(el.scrollLeft > 8);
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
  }, []);

  // Re-evaluate when content arrives (async children).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateArrows();
    const observer = new ResizeObserver(() => updateArrows());
    observer.observe(el);
    return () => observer.disconnect();
  }, [updateArrows, children]);

  const scrollByCard = useCallback(
    (dir: 1 | -1) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollBy({ left: dir * (cardWidth + 12), behavior: "smooth" });
    },
    [cardWidth],
  );

  return (
    <section className={cn("border-b border-slate-100 bg-white", className)}>
      <div className="mx-auto w-full max-w-6xl px-4 py-5 sm:px-6 sm:py-6">
        <SectionHeader
          icon={icon}
          title={title}
          description={description}
          viewAllHref={viewAllHref}
          viewAllLabel={viewAllLabel}
        />

        <div className="relative">
          {/* Left arrow — fades in once scrolled */}
          <button
            type="button"
            onClick={() => scrollByCard(-1)}
            aria-label="เลื่อนสินค้าซ้าย"
            className={cn(
              "absolute -left-3 top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-md transition-all hover:bg-slate-50 sm:flex",
              canLeft ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            style={{ width: 36, height: 36 }}
          >
            <ChevronLeft className="size-5" />
          </button>

          <div
            ref={scrollRef}
            role="list"
            aria-label={ariaLabel}
            onScroll={updateArrows}
            className="flex snap-x gap-3 overflow-x-auto scroll-smooth scrollbar-hide pb-2 [-webkit-overflow-scrolling:touch]"
          >
            {children}
          </div>

          {/* Right arrow — visible when more items exist */}
          <button
            type="button"
            onClick={() => scrollByCard(1)}
            aria-label="เลื่อนสินค้าขวา"
            className={cn(
              "absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-600 shadow-md transition-all hover:bg-slate-50 sm:flex",
              canRight ? "opacity-100" : "pointer-events-none opacity-0",
            )}
            style={{ width: 36, height: 36 }}
          >
            <ChevronRight className="size-5" />
          </button>
        </div>
      </div>
    </section>
  );
}

/** Fixed-width wrapper for each rail card — keeps the row uniform. */
export function RailCard({ children, className, width = 176 }: { children: ReactNode; className?: string; width?: number }) {
  return (
    <div
      role="listitem"
      className={cn("shrink-0 snap-start", className)}
      style={{ width }}
    >
      {children}
    </div>
  );
}
