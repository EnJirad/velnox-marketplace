"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleCheck, CircleAlert } from "lucide-react";
import { cn } from "@velnox/shared/lib/utils";

/**
 * CenterFlash — one confirmation message, centred in the viewport, that fades
 * in, holds for a moment and fades out.
 *
 * Why not a toast: sonner anchors to a corner of the screen (top-left in this
 * product) and stacks. "Added to cart" is a single, momentary acknowledgement
 * the customer should catch without looking away from the product — it belongs
 * in the middle of the screen, and it must never stack, cover a control or
 * block a tap.
 *
 * Behaviour
 * ---------
 *  - `pointer-events-none` on both layers: the overlay never eats a tap
 *  - one message at a time — a second call replaces the first (no pile-up)
 *  - the fade is a CSS animation; JS only unmounts it afterwards
 *  - `prefers-reduced-motion: reduce` shows the same message with no animation
 *  - `role="status"` + `aria-live="polite"` so a screen reader announces it
 */

export type CenterFlashTone = "success" | "error";

export interface CenterFlashOptions {
  /** The single line the customer reads, e.g. "เพิ่มลงตะกร้าสำเร็จ". */
  message: string;
  /** Optional second line, e.g. the quantity or the variant. */
  description?: string;
  tone?: CenterFlashTone;
  /** How long the message stays fully visible, in ms. */
  holdMs?: number;
}

const DEFAULT_HOLD_MS = 1100;
const FADE_MS = 280;

function prefersReducedMotion(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

interface CenterFlashViewProps extends CenterFlashOptions {
  /** Total lifetime in ms (hold + fade), computed by the hook. */
  totalMs: number;
  reduced: boolean;
}

function CenterFlashView({
  message,
  description,
  tone = "success",
  totalMs,
  reduced,
}: CenterFlashViewProps) {
  const Icon = tone === "error" ? CircleAlert : CircleCheck;
  return (
    <div
      className="pointer-events-none fixed inset-0 z-[200] flex items-center justify-center px-6"
      aria-hidden={false}
    >
      <div
        role="status"
        aria-live="polite"
        className={cn(
          "pointer-events-none flex max-w-[min(22rem,100%)] items-center gap-2.5 rounded-squircle-lg px-4 py-3 shadow-overlay",
          tone === "error" ? "bg-rose-600 text-white" : "bg-slate-900 text-white",
        )}
        style={{
          left: "50%",
          top: "50%",
          position: "fixed",
          transform: reduced ? "translate(-50%, -50%)" : undefined,
          animation: reduced ? undefined : `velnox-center-flash ${totalMs}ms ease forwards`,
        }}
      >
        <Icon className="size-5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-semibold leading-tight">{message}</p>
          {description ? (
            <p className="mt-0.5 text-2xs leading-tight text-white/75">{description}</p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

/**
 * Returns `flash(options)` and the node to render. Render `node` once, at the
 * top level of the page that owns the action.
 */
export function useCenterFlash() {
  const [state, setState] = useState<{ id: number; options: CenterFlashOptions; totalMs: number; reduced: boolean } | null>(
    null,
  );
  const timer = useRef<number | null>(null);

  const clear = useCallback(() => {
    if (timer.current !== null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  const flash = useCallback(
    (options: CenterFlashOptions) => {
      clear();
      const hold = options.holdMs ?? DEFAULT_HOLD_MS;
      const reduced = prefersReducedMotion();
      const totalMs = reduced ? hold : hold + FADE_MS;
      // A new id remounts the node, so the animation restarts instead of
      // continuing a previous flash that is already fading out.
      setState({ id: Date.now(), options, totalMs, reduced });
      timer.current = window.setTimeout(() => setState(null), totalMs);
    },
    [clear],
  );

  useEffect(() => clear, [clear]);

  const node = state ? (
    <CenterFlashView
      key={state.id}
      {...state.options}
      totalMs={state.totalMs}
      reduced={state.reduced}
    />
  ) : null;

  return { flash, node };
}
