/**
 * Product gallery — the ONE layout VelShop and the VelSeller preview share.
 *
 * LAYOUT (reference design)
 * ------------------------
 *   [ MAIN IMAGE ]  |  [ thumb 1 ]
 *                   |  [ thumb 2 ]
 *                   |  [ thumb 3 ]
 *                   |  …
 *
 * The main image is the PRIMARY image the seller chose (sort_order 0 in the
 * gallery type), on the left. The other images are a VERTICAL column on the
 * right, and a real vertical divider sits between the two halves — a line that
 * is always present when there is more than one image and absent when there is
 * only one (it would be a line with nothing on either side).
 *
 * Why shared: the seller's "preview like the real gallery" and the shopfront
 * must be the same thing. Two copies of this layout is how the seller ends up
 * believing an order that the customer never sees.
 *
 * Behaviour
 * ---------
 *  - click a thumbnail to change the main image
 *  - previous / next (buttons + ArrowLeft/ArrowRight on desktop)
 *  - horizontal swipe on touch
 *  - "1 / 6" position counter
 *  - click the main image to zoom (the caller owns the lightbox)
 *  - loading and error states, and a RESERVED box so a slow image cannot shift
 *    the layout (CLS)
 */
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  ImageOff,
  Loader2,
} from "lucide-react";
import { cn } from "@velnox/shared/lib/utils";

export interface GalleryImage {
  id?: string;
  url: string;
  displayUrl?: string;
  thumbUrl?: string;
  alt?: string | null;
}

export interface ProductGalleryProps {
  images: GalleryImage[];
  /** The primary image's index — the seller-chosen main image, not the first
   *  item that happened to arrive. */
  initialIndex?: number;
  /** Which thumbnail is shown as the main image. */
  activeIndex: number;
  onIndexChange: (index: number) => void;
  onOpenZoom?: () => void;
  /** Localised labels — the gallery is shared, the words are not. */
  labels: {
    mainImageAlt: string;
    thumbAlt: (n: number) => string;
    prev: string;
    next: string;
    noImage: string;
  };
  className?: string;
  /** Thumbnail edge length in px on mobile; desktop uses `thumbSizeDesktop`. */
  thumbSize?: number;
}

const SWIPE_PX = 40;

export function ProductGallery({
  images,
  initialIndex = 0,
  activeIndex,
  onIndexChange,
  onOpenZoom,
  labels,
  className,
  thumbSize = 64,
}: ProductGalleryProps) {
  const count = images.length;
  const hasMoreThanOne = count > 1;
  // The index may arrive from the server as "the primary image's sort_order";
  // clamp it so a stale primary can never blank the gallery.
  const safeIndex = Math.min(Math.max(activeIndex, 0), Math.max(count - 1, 0));
  const active = count > 0 ? images[safeIndex] : null;

  const [mainLoaded, setMainLoaded] = useState(false);
  const [mainFailed, setMainFailed] = useState(false);
  const [failedThumbs, setFailedThumbs] = useState<Set<string>>(new Set());

  // A new main image must not keep the previous image's loading state.
  useEffect(() => {
    setMainLoaded(false);
    setMainFailed(false);
  }, [active?.url]);

  const go = useCallback(
    (next: number) => {
      if (count === 0) return;
      onIndexChange(((next % count) + count) % count);
    },
    [count, onIndexChange],
  );

  // ── Keyboard (desktop) ─────────────────────────────────────────────────
  const rootRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!hasMoreThanOne) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") go(safeIndex - 1);
      else if (event.key === "ArrowRight") go(safeIndex + 1);
    };
    const node = rootRef.current;
    node?.addEventListener("keydown", onKey);
    return () => node?.removeEventListener("keydown", onKey);
  }, [go, safeIndex, hasMoreThanOne]);

  // ── Swipe (touch) ──────────────────────────────────────────────────────
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (event: React.TouchEvent) => {
    touchStartX.current = event.touches[0]?.clientX ?? null;
  };
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = touchStartX.current;
    touchStartX.current = null;
    if (start === null || !hasMoreThanOne) return;
    const delta = (event.changedTouches[0]?.clientX ?? start) - start;
    if (Math.abs(delta) < SWIPE_PX) return;
    go(delta < 0 ? safeIndex + 1 : safeIndex - 1);
  };

  if (count === 0) {
    return (
      <div
        className={cn(
          "flex aspect-square w-full items-center justify-center rounded-2xl border border-slate-200 bg-slate-50",
          className,
        )}
        role="img"
        aria-label={labels.noImage}
      >
        <span className="flex flex-col items-center gap-2 text-slate-400">
          <ImageOff className="size-10" aria-hidden />
          <span className="text-xs font-medium">{labels.noImage}</span>
        </span>
      </div>
    );
  }

  const thumbSrc = (img: GalleryImage) => img.thumbUrl || img.displayUrl || img.url;

  return (
    <div
      ref={rootRef}
      className={cn("flex min-w-0 items-stretch", className)}
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {/* ── MAIN ──────────────────────────────────────────────────────── */}
      <div
        className="relative min-w-0 flex-1 overflow-hidden rounded-2xl border border-slate-200 bg-white"
        style={{ aspectRatio: "1 / 1" }}
      >
        {active && !mainFailed && (
          <>
            {/* The box is reserved from the first paint, so a slow image cannot
                push the price, the buy button or the seller preview around. */}
            {!mainLoaded && (
              <span className="absolute inset-0 flex items-center justify-center bg-white">
                <Loader2 className="size-6 animate-spin text-slate-300" aria-hidden />
              </span>
            )}
            <img
              key={active.url}
              src={active.displayUrl || active.url}
              alt={active.alt || labels.mainImageAlt}
              className={cn(
                "size-full object-contain p-1.5 transition-opacity duration-200 sm:p-2",
                mainLoaded ? "opacity-100" : "opacity-0",
                onOpenZoom ? "cursor-zoom-in" : "",
              )}
              loading="eager"
              decoding="async"
              draggable={false}
              onLoad={() => setMainLoaded(true)}
              onError={() => setMainFailed(true)}
              onClick={onOpenZoom}
            />
          </>
        )}
        {mainFailed && (
          <span className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-50 text-slate-400">
            <ImageOff className="size-8" aria-hidden />
            <span className="text-xs">{labels.noImage}</span>
          </span>
        )}

        {hasMoreThanOne && (
          <>
            <button
              type="button"
              onClick={() => go(safeIndex - 1)}
              className="absolute left-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-slate-900"
              aria-label={labels.prev}
            >
              <ChevronLeft className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => go(safeIndex + 1)}
              className="absolute right-2 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-full border border-slate-200 bg-white/95 text-slate-600 shadow-sm backdrop-blur transition hover:bg-white hover:text-slate-900"
              aria-label={labels.next}
            >
              <ChevronRight className="size-4" />
            </button>
            <span className="pointer-events-none absolute bottom-2 right-2 rounded-full bg-black/55 px-2 py-0.5 text-2xs font-medium tabular-nums text-white backdrop-blur">
              {safeIndex + 1} / {count}
            </span>
          </>
        )}
      </div>

      {/* ── VERTICAL DIVIDER ─────────────────────────────────────────────
          A real element (not a border on one side): it is centred in its own
          gutter, so it keeps an equal distance from the main image and the
          thumbnail column, and it is hidden only when there is nothing to
          divide. */}
      {hasMoreThanOne && (
        <span aria-hidden className="mx-2.5 w-px shrink-0 self-stretch bg-slate-200" />
      )}

      {/* ── THUMBNAILS (vertical, fixed-size, scrollable, fade out when scrolled) ──────────────────────────────── */}
      {hasMoreThanOne && (
        <div
          className="flex shrink-0 flex-col gap-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ width: thumbSize + 8, maxHeight: "100%" }}
          role="tablist"
          aria-label={labels.mainImageAlt}
        >
          {images.map((img, i) => {
            const key = img.id ?? img.url;
            const isActive = i === safeIndex;
            const broken = failedThumbs.has(key);
            return (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={isActive}
                aria-label={labels.thumbAlt(i + 1)}
                onClick={() => onIndexChange(i)}
                className={cn(
                  "shrink-0 overflow-hidden rounded-md border-2 bg-white transition-colors",
                  isActive
                    ? "border-brand ring-1 ring-brand/20"
                    : "border-slate-200 hover:border-slate-300",
                )}
                style={{ width: thumbSize, height: thumbSize }}
              >
                {broken ? (
                  <span className="flex size-full items-center justify-center bg-slate-50 text-slate-300">
                    <ImageOff className="size-4" aria-hidden />
                  </span>
                ) : (
                  <img
                    src={thumbSrc(img)}
                    alt=""
                    className="size-full object-cover"
                    loading="lazy"
                    decoding="async"
                    onError={() => setFailedThumbs((prev) => new Set(prev).add(key))}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
