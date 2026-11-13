import * as React from "react";

import { cn } from "@velnox/shared/lib/utils";

/**
 * One option inside a segmented control (period picker, status filter, tab row).
 *
 * These are deliberately NOT `<Button>`. A Button carries a height, padding and
 * radius that a chip sitting in a tray does not want, and swapping one for the
 * other would change every filter row on the site.
 *
 * What this does own is the part that kept going wrong when it was hand-written:
 * `type="button"` (so a control inside a form never submits it) and
 * `aria-pressed` (so a screen reader announces the selected option). Before the
 * extraction neither was present on the income period pickers.
 *
 * RECIPES — each one reproduces an existing look verbatim, so adopting the
 * component changes no pixels:
 *
 *   tray  — small chip inside a slate tray (income period pickers)
 *   dark  — dark-filled chip used as a filter (seller orders, shop tabs)
 *   brand — emerald-filled chip with a leading icon and a count (my shop, catalog)
 *
 * All three are squircles (`rounded-squircle*`), never pills: a filter chip is a
 * rounded square, and only real circles (avatars, dots) use `rounded-full`.
 *
 * `dark` and `brand` are not migrated yet. They are declared here so the next
 * change has one obvious place to land instead of inventing a fourth recipe:
 *   dark  : shrink-0 rounded-squircle px-4 py-2 text-xs font-medium transition-all
 *           active:   bg-slate-900 text-white shadow-sm
 *           inactive: border border-slate-200 bg-white text-slate-600 hover:border-slate-300
 *   brand : inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-squircle-sm border px-3 py-1.5 text-xs font-medium transition-colors
 *           active:   border-brand bg-brand text-white
 *           inactive: border-slate-200 bg-white text-slate-600 hover:border-slate-300
 */
export type SegmentedVariant = "tray" | "dark" | "brand";

const RECIPES: Record<SegmentedVariant, { base: string; active: string; inactive: string }> = {
  tray: {
    base: "px-3 py-1.5 text-xs font-medium rounded-squircle-sm transition-colors",
    active: "bg-white text-slate-900 shadow-sm",
    inactive: "text-slate-500 hover:text-slate-700",
  },
  dark: {
    base: "shrink-0 rounded-squircle px-4 py-2 text-xs font-medium transition-all",
    active: "bg-slate-900 text-white shadow-sm",
    inactive: "border border-slate-200 bg-white text-slate-600 hover:border-slate-300",
  },
  brand: {
    base: "inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-squircle-sm border px-3 py-1.5 text-xs font-medium transition-colors",
    active: "border-brand bg-brand text-white",
    inactive: "border-slate-200 bg-white text-slate-600 hover:border-slate-300",
  },
};

export interface SegmentedOptionProps extends Omit<React.ComponentProps<"button">, "type"> {
  /** Whether this option is the selected one. Drives both styling and `aria-pressed`. */
  active: boolean;
  variant?: SegmentedVariant;
}

export function SegmentedOption({
  active,
  variant = "tray",
  className,
  ...props
}: SegmentedOptionProps) {
  const recipe = RECIPES[variant];
  return (
    <button
      type="button"
      aria-pressed={active}
      data-active={active}
      data-variant={variant}
      className={cn(recipe.base, active ? recipe.active : recipe.inactive, className)}
      {...props}
    />
  );
}
