import { cn } from "@velnox/shared/lib/utils";

interface LogoProps {
  className?: string;
  /** Invert the wordmark colors for use on dark surfaces. */
  dark?: boolean;
  /** Show only the brand mark (no wordmark). */
  markOnly?: boolean;
  /** Extra classes for the wordmark span (e.g. hide it below a breakpoint). */
  wordmarkClassName?: string;
}

/** Velnox brand mark: dark "V" mark on a white base. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "relative flex size-9 items-center justify-center rounded-[10px] border border-slate-200 bg-white",
        className,
      )}
      aria-hidden="true"
    >
      <svg
        viewBox="0 0 495 378"
        className="h-6 w-auto"
        fill="#0F172A"
        xmlns="http://www.w3.org/2000/svg"
      >
        <g>
          <path d="M219.21 195.5L222.39 201L235.09 179L151.38 34L33.97 34L111.63 168.5L114.8 174L127.5 152L72.08 56L138.67 56Z" />
          <path d="M224.5 240.33L188.22 177.5L185.05 172L172.35 194L224.5 284.33L356.33 56L422.92 56L367.5 152L380.2 174L383.37 168.5L461.03 34L343.62 34Z" />
          <path d="M212.95 344L236.05 344L322.65 194L309.95 172L306.78 177.5L224.5 320L148.77 188.84L171.77 149L131.36 79L105.95 79L109.13 84.5L146.37 149L123.37 188.84Z" />
          <path d="M259.82 338.5L256.65 344L282.05 344L371.63 188.84L348.63 149L385.87 84.5L389.05 79L363.64 79L323.23 149L346.23 188.84Z" />
        </g>
      </svg>
    </span>
  );
}

/** Velnox wordmark: "Vel" in slate-900 + "nox" in Velnox Green. */
export function Logo({ className, dark = false, markOnly = false, wordmarkClassName }: LogoProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <LogoMark />
      {!markOnly && (
        <span
          className={cn(
            "text-lg font-bold tracking-tight",
            dark ? "text-white" : "text-slate-900",
            wordmarkClassName,
          )}
        >
          Vel<span className="text-[#10B981]">nox</span>
        </span>
      )}
    </span>
  );
}
