"use client";

import { X, ChevronLeft, ChevronRight, Maximize2, Minimize2, Download, Share2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@velnox/shared/lib/utils";
import { Button } from "@velnox/shared/components/ui/button";
import { useLanguage } from "@velnox/shared/lib/i18n";

interface GalleryImage {
  src: string;
  alt?: string;
  thumb?: string;
}

interface GalleryLightboxProps {
  /** Array of images to display */
  images: GalleryImage[];
  /** Initially active index */
  initialIndex?: number;
  /** Whether the lightbox is open */
  open: boolean;
  /** Callback when lightbox closes */
  onOpenChange: (open: boolean) => void;
  /** Product title for accessibility */
  productTitle?: string;
  /** Product ID for tracking */
  productId?: string;
}

/**
 * The top-right toolbar control: a SQUIRCLE plate (rounded square — neither a
 * circle nor a hard square) with the icon centred in it.
 *
 * The flex centring matters: without it the inline SVG sits on the text
 * baseline and rides high inside its plate, which is what made the share /
 * close icons look like they were hanging off their own background.
 */
const TOOLBAR_BUTTON = cn(
  "flex size-10 items-center justify-center rounded-xl",
  "border border-white/10 bg-white/10 text-white",
  "transition-colors hover:bg-white/20 active:bg-white/25",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
);

export function GalleryLightbox({
  images,
  initialIndex = 0,
  open,
  onOpenChange,
  productTitle,
  productId,
}: GalleryLightboxProps) {
  const { t } = useLanguage();
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showThumbs, setShowThumbs] = useState(true);
  const [touchStart, setTouchStart] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mainImageRef = useRef<HTMLImageElement>(null);

  // Sync with initialIndex when it changes
  useEffect(() => {
    setActiveIndex(initialIndex);
  }, [initialIndex]);

  // Reset to initial index when lightbox opens
  useEffect(() => {
    if (open) {
      setActiveIndex(initialIndex);
      setIsFullscreen(false);
      setShowThumbs(true);
      // Prevent body scroll
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open, initialIndex]);

  // Keyboard navigation
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          onOpenChange(false);
          break;
        case "ArrowLeft":
          goToPrev();
          break;
        case "ArrowRight":
          goToNext();
          break;
        case "f":
          toggleFullscreen();
          break;
        case "t":
          setShowThumbs((prev) => !prev);
          break;
        default:
          break;
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  // Touch swipe support
  const handleTouchStart = (e: React.TouchEvent) => {
    setTouchStart(e.touches[0].clientX);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStart === null) return;
    const touchEnd = e.changedTouches[0].clientX;
    const diff = touchStart - touchEnd;
    if (Math.abs(diff) > 50) {
      diff > 0 ? goToNext() : goToPrev();
    }
    setTouchStart(null);
  };

  const goToPrev = useCallback(() => {
    setActiveIndex((prev) => (prev === 0 ? images.length - 1 : prev - 1));
  }, [images.length]);

  const goToNext = useCallback(() => {
    setActiveIndex((prev) => (prev === images.length - 1 ? 0 : prev + 1));
  }, [images.length]);

  const goToIndex = useCallback((index: number) => {
    setActiveIndex(index);
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement && containerRef.current) {
      containerRef.current.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  }, []);

  const handleDownload = useCallback(() => {
    const image = images[activeIndex];
    const link = document.createElement("a");
    link.href = image.src;
    link.download = `${productTitle || "image"}-${activeIndex + 1}.jpg`;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }, [images, activeIndex, productTitle]);

  const handleShare = useCallback(async () => {
    const image = images[activeIndex];
    if (navigator.share) {
      try {
        await navigator.share({
          title: productTitle || "Product Image",
          url: image.src,
        });
      } catch {
        // User cancelled or share failed
      }
    } else {
      // Fallback: copy to clipboard
      navigator.clipboard.writeText(image.src).catch(() => {});
    }
  }, [images, activeIndex, productTitle]);

  if (!open || images.length === 0) return null;

  const currentImage = images[activeIndex];

  return (
    <div
      ref={containerRef}
      className={cn(
        "fixed inset-0 z-[100] flex items-center justify-center",
        "bg-black/95 backdrop-blur-sm",
        "animate-in fade-in duration-200"
      )}
      role="dialog"
      aria-modal="true"
      aria-label={t("galleryLightbox.title", { title: productTitle ?? "" }) ?? "Product gallery"}
      onClick={() => onOpenChange(false)}
    >
      {/* Main image area */}
      <div
        className={cn(
          "relative flex-1 flex items-center justify-center p-4",
          "overflow-hidden",
          isFullscreen ? "p-0" : ""
        )}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Previous button */}
        {images.length > 1 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goToPrev(); }}
            aria-label={t("galleryLightbox.prev") ?? "Previous image"}
            className={cn(
              "absolute left-4 z-10 hidden md:flex items-center justify-center",
              "size-12 rounded-full bg-white/10 text-white",
              "hover:bg-white/20 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            )}
          >
            <ChevronLeft className="size-6" />
          </button>
        )}

        {/* Main image */}
        <figure className="relative max-w-full max-h-[80vh] md:max-h-[90vh]">
          <img
            ref={mainImageRef}
            src={currentImage.src}
            alt={currentImage.alt || `${productTitle || "Product"} ${activeIndex + 1} / ${images.length}`}
            className="max-w-full max-h-full object-contain"
            onClick={(e) => e.stopPropagation()}
            onTouchStart={handleTouchStart}
            onTouchEnd={handleTouchEnd}
          />
          <figcaption className="absolute -bottom-10 left-0 right-0 text-center text-white/80 text-sm opacity-0 transition-opacity duration-200 pointer-events-none group-hover:opacity-100">
            {productTitle && `${productTitle} — `}
            {t("galleryLightbox.imageOf", { current: activeIndex + 1, total: images.length }) ?? `${activeIndex + 1} / ${images.length}`}
          </figcaption>
        </figure>

        {/* Next button */}
        {images.length > 1 && (
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); goToNext(); }}
            aria-label={t("galleryLightbox.next") ?? "Next image"}
            className={cn(
              "absolute right-4 z-10 hidden md:flex items-center justify-center",
              "size-12 rounded-full bg-white/10 text-white",
              "hover:bg-white/20 transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
            )}
          >
            <ChevronRight className="size-6" />
          </button>
        )}

        {/* Counter (mobile) */}
        {images.length > 1 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 md:hidden">
            <span className="px-3 py-1 bg-white/10 text-white text-xs rounded-full backdrop-blur-sm">
              {activeIndex + 1} / {images.length}
            </span>
          </div>
        )}
      </div>

      {/* Top toolbar — one squircle plate per control, icons centred inside. */}
      <div className="absolute right-4 top-4 z-10 flex items-center gap-2 md:right-4 md:top-4">
        {/* Fullscreen toggle */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); toggleFullscreen(); }}
          aria-label={isFullscreen ? t("galleryLightbox.exitFullscreen") ?? "Exit fullscreen" : t("galleryLightbox.enterFullscreen") ?? "Enter fullscreen"}
          className={TOOLBAR_BUTTON}
        >
          {isFullscreen ? <Minimize2 className="size-5" /> : <Maximize2 className="size-5" />}
        </button>

        {/* Download */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleDownload(); }}
          aria-label={t("galleryLightbox.download") ?? "Download image"}
          className={TOOLBAR_BUTTON}
        >
          <Download className="size-5" />
        </button>

        {/* Share */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); handleShare(); }}
          aria-label={t("galleryLightbox.share") ?? "Share image"}
          className={TOOLBAR_BUTTON}
        >
          <Share2 className="size-5" />
        </button>

        {/* Close */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpenChange(false); }}
          aria-label={t("galleryLightbox.close") ?? "Close gallery"}
          className={TOOLBAR_BUTTON}
        >
          <X className="size-5" />
        </button>
      </div>

      {/* Thumbnail strip */}
      {showThumbs && images.length > 1 && (
        <div
          className={cn(
            "absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 p-2 md:bottom-4 md:left-1/2 md:-translate-x-1/2",
            "bg-black/50 backdrop-blur-sm rounded-xl border border-white/10",
            isFullscreen && "hidden"
          )}
          role="tablist"
          aria-label={t("galleryLightbox.thumbnails") ?? "Thumbnails"}
        >
          {images.map((image, index) => (
            <button
              key={image.src}
              type="button"
              role="tab"
              aria-selected={index === activeIndex}
              aria-label={`${t("galleryLightbox.thumbnail") ?? "Thumbnail"} ${index + 1}`}
              onClick={(e) => { e.stopPropagation(); goToIndex(index); }}
              className={cn(
                "relative size-16 md:size-20 shrink-0 rounded-lg overflow-hidden border-2 transition-all",
                index === activeIndex
                  ? "border-emerald-500 ring-2 ring-emerald-500/50 scale-105"
                  : "border-transparent hover:border-white/30 opacity-70 hover:opacity-100"
              )}
            >
              <img
                src={image.thumb || image.src}
                alt=""
                className="w-full h-full object-cover"
                loading="lazy"
              />
              {index === activeIndex && (
                <div className="absolute inset-0 bg-emerald-500/20" />
              )}
            </button>
          ))}
        </div>
      )}

      {/* Thumbnail toggle (when thumbnails hidden) */}
      {!showThumbs && images.length > 1 && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setShowThumbs(true); }}
          aria-label={t("galleryLightbox.showThumbnails") ?? "Show thumbnails"}
          className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 px-4 py-2 bg-black/50 text-white rounded-full backdrop-blur-sm border border-white/10 text-sm"
        >
          {t("galleryLightbox.showThumbnails") ?? "Show thumbnails"}
        </button>
      )}
    </div>
  );
}

export default GalleryLightbox;
