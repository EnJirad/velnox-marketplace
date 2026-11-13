/**
 * useTurnstile — Cloudflare Turnstile widget lifecycle.
 *
 * ── What was wrong with the previous version ─────────────────────────────────
 *
 *   `const effectiveToken = hasValidSiteKey ? token : "bypass";`
 *
 * A missing site key produced the literal string `"bypass"`, which every
 * caller treated as "verification passed". `reset()` set React state to null
 * and did nothing else — the comment claimed Turnstile would reset itself,
 * which it does not, so after one failed submit the widget stayed dead and the
 * customer could never sign in again. There was one state (`token`), no script
 * error handling (a blocked script left the widget invisible forever), and the
 * script was polled for 1.5 s and then silently abandoned.
 *
 * ── The contract now ─────────────────────────────────────────────────────────
 *
 *   state: "loading" | "verifying" | "verified" | "expired" | "error" | "unavailable"
 *
 *   ready  — true ONLY when state === "verified" AND a token is present.
 *            There is no bypass: without a site key the state is "unavailable"
 *            and `ready` stays false forever, so the caller's buttons stay
 *            genuinely disabled.
 *
 *   token  — the challenge response, or null. Cleared on every failure, and
 *            cleared by `consume()` so one token is never submitted twice.
 *
 *   reset()   — calls `turnstile.reset(widgetId)` for real, then re-arms.
 *   consume() — call after a failed sign-in: invalidates the token and resets,
 *               forcing a fresh challenge before the next submit.
 *
 * ── Lifecycle safety ─────────────────────────────────────────────────────────
 *
 *   • The script is loaded through ONE module-level promise shared by every
 *     mounted consumer, so a second render never injects a second script and
 *     never races the first.
 *   • A ref-count keeps the script alive while any widget is mounted; it is
 *     removed only when the last consumer unmounts.
 *   • Every async continuation re-checks `cancelled`, so a widget can never be
 *     rendered into a container that has already unmounted.
 *   • `widgetIdRef` is the single source of truth for the widget, so a
 *     re-render cannot produce a duplicate widget.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type TurnstileState =
  | "loading"
  | "verifying"
  | "verified"
  | "expired"
  | "error"
  | "unavailable";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileRenderOptions) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
      getResponse: (widgetId?: string) => string | undefined;
    };
  }
}

interface TurnstileRenderOptions {
  sitekey: string;
  /** Named form the challenge was solved for; the backend checks it. */
  action?: string;
  theme?: "light" | "dark" | "auto";
  callback: (token: string) => void;
  "error-callback"?: (errorCode?: string) => boolean | void;
  "expired-callback"?: () => void;
  "timeout-callback"?: () => void;
  "unsupported-callback"?: () => void;
}

export interface UseTurnstileOptions {
  /**
   * Challenge action name. Must match the action the backend expects for this
   * form (`password_login`, `password_register`, `member_login`, `google_start`).
   */
  action?: string;
}

export interface UseTurnstileResult {
  state: TurnstileState;
  /** The challenge response. Never a placeholder — null until Cloudflare answers. */
  token: string | null;
  /** True only when a real, unexpired token is in hand. Gate every submit on this. */
  ready: boolean;
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Force a fresh challenge (real widget reset). */
  reset: () => void;
  /** Invalidate the current token after a failed sign-in, then reset. */
  consume: () => void;
  /**
   * Cloudflare's current response for the mounted widget, or null. Used as a
   * submit-time fallback when the callback has not reached React yet.
   */
  peek: () => string | null;
}

const SCRIPT_SRC = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SCRIPT_ATTR = "data-velnox-turnstile";
const SCRIPT_TIMEOUT_MS = 15_000;

/** Shared across every mounted consumer — one script, one promise, no race. */
let scriptPromise: Promise<void> | null = null;
/** How many widgets are currently mounted. The script goes when this hits 0. */
let scriptRefCount = 0;

function siteKey(): string {
  const key = import.meta.env?.VITE_TURNSTILE_SITE_KEY;
  return typeof key === "string" ? key.trim() : "";
}

function loadScript(): Promise<void> {
  if (typeof window === "undefined") return Promise.reject(new Error("no_window"));
  if (window.turnstile) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (error) {
        // Allow a later mount to retry — a transient network failure must not
        // poison the loader for the rest of the page's life.
        scriptPromise = null;
        reject(error);
      } else {
        resolve();
      }
    };

    const existing = document.querySelector<HTMLScriptElement>(`script[${SCRIPT_ATTR}]`);
    const script = existing ?? document.createElement("script");

    if (!existing) {
      script.src = SCRIPT_SRC;
      script.async = true;
      script.defer = true;
      script.setAttribute(SCRIPT_ATTR, "1");
      document.head.appendChild(script);
    }

    // The script may already have executed before this effect ran.
    if (window.turnstile) {
      finish();
      return;
    }

    script.addEventListener("load", () => finish(), { once: true });
    script.addEventListener("error", () => finish(new Error("script_failed")), { once: true });

    const timer = window.setTimeout(
      () => finish(new Error("script_timeout")),
      SCRIPT_TIMEOUT_MS,
    );
  });

  return scriptPromise;
}

function releaseScript(): void {
  scriptRefCount = Math.max(0, scriptRefCount - 1);
  if (scriptRefCount > 0) return; // another widget still needs it — leave it alone
  const script = document.querySelector(`script[${SCRIPT_ATTR}]`);
  if (script) script.remove();
  // `window.turnstile` survives, so a later mount renders immediately; the
  // loader re-injects the element only if the global is gone.
  scriptPromise = null;
}

export function useTurnstile(options: UseTurnstileOptions = {}): UseTurnstileResult {
  const { action } = options;
  const key = siteKey();

  const [state, setState] = useState<TurnstileState>(key ? "loading" : "unavailable");
  const [token, setToken] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  /** Guards against a widget being rendered after unmount. */
  const cancelledRef = useRef(false);
  /** True once this hook has mounted — stops render loops from stale closures. */
  const mountedRef = useRef(false);

  /** Remove the widget (never the script — that is ref-counted separately). */
  const removeWidget = useCallback(() => {
    const id = widgetIdRef.current;
    widgetIdRef.current = null;
    if (id && window.turnstile) {
      try {
        window.turnstile.remove(id);
      } catch {
        // A widget already removed by Turnstile itself — nothing to do.
      }
    }
  }, []);

  const renderWidget = useCallback(() => {
    const container = containerRef.current;
    if (!container || cancelledRef.current) return;
    if (!window.turnstile || !key) return;
    // Never render twice into the same container.
    if (widgetIdRef.current) return;

    setState("verifying");
    try {
      widgetIdRef.current = window.turnstile.render(container, {
        sitekey: key,
        ...(action ? { action } : {}),
        theme: "light",
        callback: (nextToken: string) => {
          if (cancelledRef.current) return;
          if (typeof nextToken !== "string" || nextToken.length === 0) {
            setToken(null);
            setState("error");
            return;
          }
          setToken(nextToken);
          setState("verified");
        },
        "error-callback": () => {
          if (cancelledRef.current) return;
          setToken(null);
          setState("error");
          return true; // let Turnstile retry on its own
        },
        "expired-callback": () => {
          if (cancelledRef.current) return;
          // The token is worthless the moment it expires: drop it first, then
          // reset so a fresh challenge is already on screen.
          setToken(null);
          setState("expired");
          if (widgetIdRef.current && window.turnstile) {
            try {
              window.turnstile.reset(widgetIdRef.current);
            } catch {
              /* widget gone — the next mount re-renders it */
            }
          }
        },
        "timeout-callback": () => {
          if (cancelledRef.current) return;
          setToken(null);
          setState("expired");
        },
        "unsupported-callback": () => {
          if (cancelledRef.current) return;
          setToken(null);
          setState("unavailable");
        },
      });
    } catch {
      setToken(null);
      setState("error");
    }
  }, [action, key]);

  // ── Mount / unmount ────────────────────────────────────────────────────
  useEffect(() => {
    cancelledRef.current = false;

    // No site key: no widget, no token, no way to proceed. This is the
    // "unavailable" state — deliberately NOT a bypass.
    if (!key) {
      setState("unavailable");
      setToken(null);
      return;
    }

    mountedRef.current = true;
    scriptRefCount += 1;
    let released = false;

    loadScript()
      .then(() => {
        if (cancelledRef.current) return;
        renderWidget();
      })
      .catch(() => {
        if (cancelledRef.current) return;
        setToken(null);
        setState("unavailable");
      });

    return () => {
      cancelledRef.current = true;
      mountedRef.current = false;
      removeWidget();
      if (!released) {
        released = true;
        releaseScript();
      }
    };
    // `key` and `action` define which widget exists; a change rebuilds it.
  }, [key, action, renderWidget, removeWidget]);

  // A late container mount (conditional rendering) still gets a widget.
  useEffect(() => {
    if (!key || !mountedRef.current) return;
    if (!containerRef.current) return;
    if (widgetIdRef.current) return;
    if (!window.turnstile) return;
    renderWidget();
  });

  /** Real reset: clear our token, then ask Turnstile for a fresh challenge. */
  const reset = useCallback(() => {
    setToken(null);
    if (!key) {
      setState("unavailable");
      return;
    }
    if (!window.turnstile || !widgetIdRef.current) {
      // Widget not on screen (script still loading, or it failed) — rebuild it.
      setState("loading");
      removeWidget();
      loadScript()
        .then(() => {
          if (!cancelledRef.current) renderWidget();
        })
        .catch(() => {
          if (!cancelledRef.current) setState("unavailable");
        });
      return;
    }
    setState("verifying");
    try {
      window.turnstile.reset(widgetIdRef.current);
    } catch {
      setState("error");
    }
  }, [key, removeWidget, renderWidget]);

  /**
   * After a failed sign-in the token is already spent server-side (single use),
   * so keeping it would only produce a second confusing rejection. Clear it and
   * put a fresh challenge in front of the customer.
   */
  const consume = useCallback(() => {
    setToken(null);
    reset();
  }, [reset]);

  /**
   * Ask the widget directly what it currently holds.
   *
   * Cloudflare can own a valid response for a moment before our `callback`
   * runs (and a `reset()` can leave the widget solved while React state still
   * says "verifying"). Reading `getResponse` closes that gap at submit time.
   *
   * This is a FALLBACK, not a bypass: the value is Cloudflare's own response,
   * and the server still validates it — a spent token is rejected as replayed.
   */
  const peek = useCallback((): string | null => {
    const id = widgetIdRef.current;
    if (!id || !window.turnstile?.getResponse) return null;
    try {
      const live = window.turnstile.getResponse(id);
      return typeof live === "string" && live.length > 0 ? live : null;
    } catch {
      return null;
    }
  }, []);

  return {
    state,
    token,
    ready: state === "verified" && token !== null,
    containerRef,
    reset,
    consume,
    peek,
  };
}
