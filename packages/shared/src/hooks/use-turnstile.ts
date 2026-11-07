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

  // Load the Turnstile script once
  useEffect(() => {
    if (typeof window.turnstile !== "undefined") return; // already loaded
    if (document.querySelector('script[src*="turnstile"]')) return; // already loading
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  }, []);

  // Render the widget once the script + container are ready
  useEffect(() => {
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
  }, [containerRef.current]);

  function renderWidget(el: HTMLElement) {
    if (!window.turnstile) return;
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

  return { token, containerRef, reset };
}
