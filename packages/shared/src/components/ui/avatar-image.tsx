import { useEffect, useRef, useState } from "react";
import { avatarSrcSet, optimizedUrl } from "@velnox/shared/lib/image-optimize";

/**
 * Avatar image with preloading + responsive srcset.
 *
 * States:
 * 1. showSkeleton=true (auth still loading) → render skeleton placeholder
 * 2. src is null/empty → render fallback immediately (no avatar exists)
 * 3. src exists, loading → render a skeleton placeholder (same size/shape as avatar)
 * 4. src exists, loaded → reveal actual image
 * 5. src exists, error → render fallback
 */
export function AvatarImage({
  src,
  alt,
  className,
  fallback,
  size = 256,
  showSkeleton = false,
}: {
  src: string | null | undefined;
  alt?: string;
  className?: string;
  fallback?: React.ReactNode;
  /** Logical display size in px (used for srcset sizing hint). */
  size?: number;
  /** When true, show skeleton even if src is null/undefined (auth still loading). */
  showSkeleton?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const [errored, setErrored] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);

  const preloadUrl = src ? optimizedUrl(src, { width: size, format: "webp", quality: 80 }) : "";

  useEffect(() => {
    if (!src) {
      setReady(false);
      setErrored(false);
      return;
    }

    const url = optimizedUrl(src, { width: size, format: "webp", quality: 80 });

    // Check browser cache — if already loaded, skip preload
    const cached = imgRef.current;
    if (cached && cached.src === url && cached.complete && cached.naturalWidth > 0) {
      setReady(true);
      return;
    }

    setReady(false);
    setErrored(false);

    const img = new Image();
    imgRef.current = img;

    img.onload = () => {
      if (imgRef.current === img) {
        setReady(true);
      }
    };
    img.onerror = () => {
      if (imgRef.current === img) {
        setErrored(true);
      }
    };
    img.src = url;

    return () => {
      img.onload = null;
      img.onerror = null;
    };
  }, [src, size]);

  // ── STATE 0: Auth still loading → show skeleton ──────────────────
  // Parent signals that user data hasn't resolved yet.
  // Never show fallback initials during this state.
  if (showSkeleton && !src) {
    return (
      <span
        className="size-full animate-pulse rounded-full bg-slate-200"
        aria-hidden="true"
      />
    );
  }

  // ── STATE 1: No URL → show fallback immediately ──────────────────
  if (!src) {
    return <>{fallback}</>;
  }

  // ── STATE 2: URL exists, loading → skeleton placeholder ──────────
  if (!ready && !errored) {
    return (
      <span
        className="size-full animate-pulse rounded-full bg-slate-200"
        aria-hidden="true"
      />
    );
  }

  // ── STATE 3: Error → show fallback ───────────────────────────────
  if (errored) {
    return <>{fallback}</>;
  }

  // ── STATE 4: Loaded → reveal the actual image ────────────────────
  const srcSet = avatarSrcSet(src);

  return (
    <img
      src={preloadUrl}
      srcSet={srcSet || undefined}
      sizes={`${size}px`}
      alt={alt ?? ""}
      className={className}
      loading="eager"
      decoding="sync"
    />
  );
}
