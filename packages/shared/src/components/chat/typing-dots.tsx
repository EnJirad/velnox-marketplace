import { cn } from "@velnox/shared/lib/utils";

/**
 * Messenger-style three-dot typing indicator.
 *
 * Shared by VelShop, VelSeller and VelCenter so the animation is identical in
 * every surface. The animation is pure CSS (no JS timer per dot, no library) and
 * is disabled under `prefers-reduced-motion` — the dots then show a static,
 * still-legible state instead of bouncing.
 *
 * The marker is announced to screen readers once (`role="status"` +
 * `aria-live="polite"`); the dots themselves are decorative.
 */
export function TypingDots({ label, className }: { label?: string; className?: string }) {
  return (
    <div
      className={cn("flex items-center gap-2", className)}
      role="status"
      aria-live="polite"
      aria-label={label ?? "…"}
    >
      <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-2">
        <span className="velnox-typing-dot size-1.5 rounded-full bg-slate-400" />
        <span className="velnox-typing-dot size-1.5 rounded-full bg-slate-400" />
        <span className="velnox-typing-dot size-1.5 rounded-full bg-slate-400" />
      </span>
      {label ? <span className="text-[11px] text-slate-400">{label}</span> : null}
      <style>{`
        .velnox-typing-dot {
          animation: velnox-typing 1.2s infinite ease-in-out;
        }
        .velnox-typing-dot:nth-child(2) { animation-delay: 0.15s; }
        .velnox-typing-dot:nth-child(3) { animation-delay: 0.3s; }
        @keyframes velnox-typing {
          0%, 60%, 100% { opacity: 0.35; transform: translateY(0); }
          30% { opacity: 1; transform: translateY(-2px); }
        }
        @media (prefers-reduced-motion: reduce) {
          .velnox-typing-dot { animation: none; opacity: 0.6; }
        }
      `}</style>
    </div>
  );
}
