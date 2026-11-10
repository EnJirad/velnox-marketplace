import { cn } from "@velnox/shared/lib/utils";

/**
 * Velnox brand mark — the "V" lattice from `public/logo.svg`.
 *
 * Two tones because the mark has to survive both surfaces we use:
 *   • `light` — solid white, for the brand-green header bars.
 *   • `dark`  — Velnox ink (#0F172A), for light surfaces (cards, footers, auth).
 *
 * The mark carries NO plate/box of its own: the surface behind it is the
 * background, so the white tone sits directly on the brand bar.
 */
type LogoTone = "light" | "dark";

const MARK_PATHS = [
  "M219.21 195.5L222.39 201L235.09 179L151.38 34L33.97 34L111.63 168.5L114.8 174L127.5 152L72.08 56L138.67 56Z",
  "M224.5 240.33L188.22 177.5L185.05 172L172.35 194L224.5 284.33L356.33 56L422.92 56L367.5 152L380.2 174L383.37 168.5L461.03 34L343.62 34Z",
  "M212.95 344L236.05 344L322.65 194L309.95 172L306.78 177.5L224.5 320L148.77 188.84L171.77 149L131.36 79L105.95 79L109.13 84.5L146.37 149L123.37 188.84Z",
  "M259.82 338.5L256.65 344L282.05 344L371.63 188.84L348.63 149L385.87 84.5L389.05 79L363.64 79L323.23 149L346.23 188.84Z",
];

interface LogoMarkProps {
  className?: string;
  /** `light` = white mark on brand surfaces, `dark` = ink on light surfaces. */
  tone?: LogoTone;
}

/** Velnox brand mark: the "V" lattice, no background plate. */
export function LogoMark({ className, tone = "dark" }: LogoMarkProps) {
  return (
    <svg
      viewBox="0 0 495 378"
      className={cn(
        "h-6 w-auto shrink-0",
        tone === "light" ? "text-white" : "text-slate-900",
        className,
      )}
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <g>
        {MARK_PATHS.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
    </svg>
  );
}

interface LogoProps {
  className?: string;
  /** Surface the logo sits on — drives both the mark and the wordmark colours. */
  tone?: LogoTone;
  /** Show only the brand mark (no wordmark). */
  markOnly?: boolean;
  /** Extra classes for the wordmark span (e.g. hide it below a breakpoint). */
  wordmarkClassName?: string;
}

/**
 * Velnox lockup: brand mark + "Velnox" wordmark.
 * On brand surfaces the whole lockup is white — a mint "nox" would only reach
 * ~2:1 against the brand green, so the reversed treatment stays single-tone.
 * On light surfaces it keeps the ink + brand-green two-tone.
 */
export function Logo({ className, tone = "dark", markOnly = false, wordmarkClassName }: LogoProps) {
  const light = tone === "light";
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark tone={tone} />
      {!markOnly && (
        <span
          className={cn(
            "text-lg font-bold tracking-tight",
            light ? "text-white" : "text-slate-900",
            wordmarkClassName,
          )}
        >
          Vel{light ? "nox" : <span className="text-brand">nox</span>}
        </span>
      )}
    </span>
  );
}
