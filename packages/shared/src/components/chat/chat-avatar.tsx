/**
 * Chat avatar — one circular/squircle identity chip for all three surfaces.
 *
 * Falls back to the person's initials when there is no image (or the image
 * fails to load), so a conversation never renders a broken-image icon. The
 * online dot is drawn ONLY when the caller passes an explicit boolean; `null`
 * means "presence is not known here" and renders nothing.
 */
import { useState } from "react";
import { cn } from "@velnox/shared/lib/utils";

const SIZES = {
  sm: "size-9 text-[11px]",
  md: "size-11 text-xs",
  lg: "size-12 text-sm",
} as const;

const DOT_SIZES = {
  sm: "size-2.5",
  md: "size-3",
  lg: "size-3",
} as const;

/** First letters of up to two words, locale-agnostic (Thai included). */
export function initialsOf(name: string | null | undefined): string {
  const clean = (name ?? "").trim();
  if (!clean) return "?";
  const parts = clean.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
}

export function ChatAvatar({
  name,
  src,
  size = "md",
  online,
  className,
}: {
  name?: string | null;
  src?: string | null;
  size?: keyof typeof SIZES;
  /** `true` online, `false` offline, `null`/undefined unknown (no dot). */
  online?: boolean | null;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const showImage = !!src && !broken;

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      {showImage ? (
        <img
          src={src!}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setBroken(true)}
          className={cn(
            "rounded-xl border border-slate-100 bg-slate-100 object-cover",
            SIZES[size],
          )}
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "flex items-center justify-center rounded-xl bg-slate-100 font-semibold text-slate-500",
            SIZES[size],
          )}
        >
          {initialsOf(name)}
        </span>
      )}
      {online === true && (
        <span
          role="img"
          aria-label="online"
          className={cn(
            "absolute -bottom-0.5 -right-0.5 rounded-full border-2 border-white bg-[#10B981]",
            DOT_SIZES[size],
          )}
        />
      )}
    </span>
  );
}
