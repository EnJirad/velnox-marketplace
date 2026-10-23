import { useEffect, useRef, useState } from "react";
import { coverSrcSet, optimizedUrl } from "@velnox/shared/lib/image-optimize";

/**
 * Cover/banner image with preloading.
 *
 * Prevents the flash between gradient placeholder → real cover image
 * by preloading the image before displaying it.
 *
 * States:
 * 1. url is null → render nothing (caller renders gradient)
 * 2. url exists, loading → render nothing (gradient stays visible)
 * 3. url exists, loaded → render <img> fading in
 * 4. url exists, error → render nothing (gradient stays)
 */
export function CoverImage({
  src,
  alt,
  className,
  gradientClassName,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  /** Classes for the gradient background shown while loading / no image. */
  gradientClassName?: string;
}) {
  const [ready, setReady] = useState(false);
  const [errored, setErrored] = useState(false);
  const prevSrcRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!src) {
      setReady(false);
      setErrored(false);
      prevSrcRef.current = undefined;
      return;
    }

    if (src === prevSrcRef.current && ready) return;

    setReady(false);
    setErrored(false);
    prevSrcRef.current = src;

    const img = new Image();
    img.onload = () => {
      if (prevSrcRef.current === src) {
        setReady(true);
      }
    };
    img.onerror = () => {
      if (prevSrcRef.current === src) {
        setErrored(true);
      }
    };
    // Preload a medium-size version
    img.src = optimizedUrl(src, { width: 1280, format: "webp", quality: 80 });

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src, ready]);

  // No URL or not loaded yet → caller renders gradient background
  if (!src || !ready || errored) {
    return null;
  }

  // Loaded → render the cover image
  const srcSet = coverSrcSet(src);
  const optimized = optimizedUrl(src, { width: 1920, format: "webp", quality: 80 });

  return (
    <img
      src={optimized}
      srcSet={srcSet || undefined}
      sizes="100vw"
      alt={alt ?? ""}
      className={className}
      loading="eager"
      decoding="sync"
    />
  );
}
