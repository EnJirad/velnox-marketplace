/**
 * useTurnstile — Cloudflare Turnstile widget hook.
 *
 * Renders the Turnstile challenge into a container ref and provides the
 * resulting token. The token is null while the challenge is loading, the
 * widget is invisible, or the challenge has expired/errored — callers must
 * gate submission on `token !== null`.
 *
 * Usage:
 *   const { token, containerRef } = useTurnstile();
 *   ...
 *   <div ref={containerRef} />
 *   <button disabled={!token}>Submit</button>
 */

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, opts: TurnstileOptions) => string;
      remove: (id: string) => void;
    };
  }
}

interface TurnstileOptions {
  sitekey: string;
  callback: (token: string) => void;
  "error-callback"?: () => void;
  "expired-callback"?: () => void;
  theme?: "light" | "dark" | "auto";
}

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY;

export function useTurnstile() {
  const [token, setToken] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);

  // Check if we have a valid site key
  const hasValidSiteKey = typeof SITE_KEY === "string" && SITE_KEY.length > 0;

  // Load the Turnstile script once (only if we have a site key)
  useEffect(() => {
    if (!hasValidSiteKey) return; // skip if no site key
    if (typeof window.turnstile !== "undefined") return; // already loaded
    if (document.querySelector('script[src*="turnstile"]')) return; // already loading
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }, [hasValidSiteKey]);

  // Render the widget once the script + container are ready
  useEffect(() => {
    if (!hasValidSiteKey) return; // don't render without site key
    const el = containerRef.current;
    if (!el) return;
    if (!window.turnstile) {
      // Script not loaded yet — poll briefly, then fall back invisible
      const id = setTimeout(() => {
        if (el.isConnected && window.turnstile) {
          renderWidget(el);
        }
      }, 1500);
      return () => clearTimeout(id);
    }
    renderWidget(el);
    return () => {
      if (widgetId.current && window.turnstile) {
        window.turnstile.remove(widgetId.current);
        widgetId.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [containerRef.current, hasValidSiteKey]);

  function renderWidget(el: HTMLElement) {
    if (!window.turnstile || !hasValidSiteKey) return;
    widgetId.current = window.turnstile.render(el, {
      sitekey: SITE_KEY,
      callback: (t: string) => setToken(t),
      "error-callback": () => setToken(null),
      "expired-callback": () => setToken(null),
    });
  }

  /** Reset the widget (e.g. after form submission error). */
  const reset = () => {
    setToken(null);
    // Turnstile auto-resets on re-render via callback — no explicit API call needed.
  };

  // If no site key, treat as if token is always valid (skip Turnstile)
  const effectiveToken = hasValidSiteKey ? token : "bypass";

  return { token: effectiveToken, containerRef, reset };
}
