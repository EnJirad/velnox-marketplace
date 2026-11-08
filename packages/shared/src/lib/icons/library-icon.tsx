/**
 * library-icon.tsx — high-level async icon renderer.
 *
 * Resolves a canonical icon identifier (Iconify "prefix:name" or legacy bare
 * Lucide name) and renders it as a real <svg> from locally generated data.
 * Image URLs are rendered as <img>. Missing/unknown identifiers fall back to a
 * custom fallback node (default: a Package icon + the raw identifier as title)
 * so nothing ever renders as a blank or a broken image.
 *
 * - Loads the needed collection data ON DEMAND (lazy chunk, then cached).
 * - Keeps a requested-vs-observed identity cache to avoid flash-of-fallback when
 *   the same identifier is used in a list (each row only shows after load).
 * - Never injects untrusted SVG strings (see icon-render.tsx allowlist parser).
 */
import { Suspense, useEffect, useState, type ReactNode } from "react";
import { Package } from "lucide-react";
import { cn } from "@velnox/shared/lib/utils";
import { resolveIconBody } from "./icon-loader";
import { resolveIdentifier } from "./icon-registry";
import { IconSvg } from "./icon-render";
import type { IconBodyData } from "./icon-types";

export interface LibraryIconProps {
  /** Canonical identifier: "mdi:shopping", "lucide:shopping-bag", "shopping-bag",
   *  or an image / data: URL. */
  icon?: string | null;
  /** Legacy uploaded URL (kept for CategoryIcon compatibility). */
  imageUrl?: string | null;
  className?: string;
  /** Title/aria when provided; used as decorative otherwise. */
  title?: string;
  /** Size in px or CSS length (default "1em"). */
  size?: number | string;
  /** Custom renderer for unknown/empty identifiers. */
  fallback?: () => ReactNode;
  /** Optional node shown while a collection loads (default: null). */
  loading?: () => ReactNode;
}

export function LibraryIcon({
  icon,
  imageUrl,
  className,
  title,
  size = "1em",
  fallback,
  loading,
}: LibraryIconProps) {
  const resolved = resolveIdentifier(icon ?? null);
  const src = imageUrl ?? resolved.url ?? null;

  // Image URL → plain <img>.
  if (src) {
    return (
      <img
        src={src}
        alt={title ?? ""}
        loading="lazy"
        className={cn("object-cover", className)}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
        }}
      />
    );
  }

  // Iconify identifier → async body load.
  if (resolved.kind === "iconify" && resolved.prefix && resolved.name) {
    return (
      <IconifyBody
        prefix={resolved.prefix}
        name={resolved.name}
        className={className}
        title={title}
        size={size}
        fallback={fallback}
        loading={loading}
      />
    );
  }

  return <Fallback className={className} fallback={fallback} title={title} />;
}

function IconifyBody({
  prefix,
  name,
  className,
  title,
  size,
  fallback,
  loading: loadingNode,
}: {
  prefix: string;
  name: string;
  className?: string;
  title?: string;
  size?: number | string;
  fallback?: () => ReactNode;
  loading?: () => ReactNode;
}) {
  const [body, setBody] = useState<IconBodyData | undefined | null>(null);

  useEffect(() => {
    let alive = true;
    setBody(null);
    resolveIconBody(prefix, name)
      .then((b) => {
        if (alive) setBody(b ?? undefined);
      })
      .catch(() => {
        if (alive) setBody(undefined);
      });
    return () => {
      alive = false;
    };
  }, [prefix, name]);

  if (body === null) return loadingNode ? <>{loadingNode()}</> : null;
  if (!body) return <Fallback className={className} fallback={fallback} title={title} />;

  return <IconSvg body={body} className={className} size={size} title={title} />;
}

function Fallback({
  className,
  fallback,
  title,
}: {
  className?: string;
  fallback?: () => ReactNode;
  title?: string;
}) {
  if (fallback) return <>{fallback()}</>;
  return <Package aria-hidden="true" className={className} strokeWidth={2} />;
}

/**
 * Suspense-safe wrapper for icons loaded from local data; included for parity
 * with the rest of the UI kit but each LibraryIcon above already handles its
 * own async load, so this is only needed when a fallback must render instantly.
 */
export function IconLibraryBoundary({
  children,
  fallback = null,
}: {
  children: ReactNode;
  fallback?: ReactNode;
}) {
  return <Suspense fallback={fallback}>{children}</Suspense>;
}
