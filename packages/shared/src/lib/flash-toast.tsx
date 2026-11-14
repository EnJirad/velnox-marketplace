"use client";

import { useEffect } from "react";
import { useCenterFlash, type CenterFlashOptions, type CenterFlashTone } from "@velnox/shared/components/ui/center-flash";

/**
 * flash-toast — ONE notification surface for the whole shop.
 *
 * The product had two: a centred flash for "added to cart" and sonner toasts in
 * a corner for everything else (wishlist, address saved, review posted, errors).
 * Two surfaces for the same kind of message is what makes an app feel
 * assembled rather than designed.
 *
 * This module keeps the call sites untouched: it exports a `toast` object with
 * the same method names sonner used (`success` / `error` / `warning` / `info` /
 * `message`), so a file only changes its import line. Every call now renders in
 * the centre of the screen, one message at a time.
 *
 * Mount `<CenterFlashHost />` once, near the app root. The host owns the node
 * and registers the dispatcher; without it the calls are no-ops rather than a
 * crash, which keeps shared components safe in an app that has not adopted it.
 */

type FlashDispatcher = (options: CenterFlashOptions) => void;

let dispatcher: FlashDispatcher | null = null;

/** Set by the host. Exported for tests and for non-React callers. */
export function setFlashDispatcher(next: FlashDispatcher | null): void {
  dispatcher = next;
}

interface ToastOptions {
  /** Second line, e.g. the quantity or the reason. */
  description?: string;
  /** How long the message stays visible, in ms. */
  duration?: number;
  /** Accepted for sonner compatibility; the flash ignores them. */
  [key: string]: unknown;
}

function show(tone: CenterFlashTone, message: unknown, options?: ToastOptions): void {
  // A message can arrive as a string, a number, or a React node. Only text can
  // be rendered here, and an empty message must not flash an empty box.
  const text = typeof message === "string" ? message.trim() : message == null ? "" : String(message);
  if (!text) return;
  const description =
    typeof options?.description === "string" ? options.description.trim() : undefined;
  const holdMs = typeof options?.duration === "number" && options.duration > 0 ? options.duration : undefined;
  dispatcher?.({ message: text, description: description || undefined, tone, holdMs });
}

/**
 * Drop-in replacement for `toast` from sonner.
 *
 * `dismiss()` is a no-op on purpose: a flash removes itself, and nothing in the
 * product relies on holding a notification open.
 */
export const toast = {
  success: (message: unknown, options?: ToastOptions) => show("success", message, options),
  error: (message: unknown, options?: ToastOptions) => show("error", message, options),
  warning: (message: unknown, options?: ToastOptions) => show("warning", message, options),
  info: (message: unknown, options?: ToastOptions) => show("info", message, options),
  message: (message: unknown, options?: ToastOptions) => show("info", message, options),
  dismiss: () => {},
  remove: () => {},
};

/**
 * Renders the flash and connects the module-level dispatcher to it.
 * Mount exactly once, inside every provider that may raise a message.
 */
export function CenterFlashHost() {
  const { flash, node } = useCenterFlash();

  useEffect(() => {
    setFlashDispatcher(flash);
    return () => setFlashDispatcher(null);
  }, [flash]);

  return <>{node}</>;
}
