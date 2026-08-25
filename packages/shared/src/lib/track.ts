/**
 * Velnox — client-side Customer Memory tracking 
 *
 * Fire-and-forget wrapper around the API /events/track endpoint.
 * Signed-in users are attributed via session cookie.
 * Signed-out visitors get a random anonymousId in localStorage.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { apiUrl as API_BASE } from "./sites";

/** Keep in sync with backend event types. */
export type CustomerEventType =
  | "PRODUCT_VIEW"
  | "PRODUCT_CLICK"
  | "SEARCH"
  | "CATEGORY_VIEW"
  | "SHOP_VIEW"
  | "INTEREST"
  | "WISHLIST_ADD"
  | "WISHLIST_REMOVE"
  | "CART_ADD"
  | "CART_REMOVE"
  | "CHECKOUT_START"
  | "PURCHASE"
  | "REORDER"
  | "VELREPEAT_START"
  | "VELREPEAT_CANCEL"
  | "RECOMMENDATION_CLICK";

const ANON_KEY = "velnox_anon_id";

export function getAnonymousId(): string {
  try {
    let id = window.localStorage.getItem(ANON_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      window.localStorage.setItem(ANON_KEY, id);
    }
    return id;
  } catch {
    return "";
  }
}

export interface TrackOptions {
  entityId?: string;
  value?: string;
  context?: Record<string, unknown>;
}

export interface Tracking {
  track: (type: CustomerEventType, options?: TrackOptions) => void;
}

/** Hook returning a stable `track` function. */
export function useTracking(): Tracking {
  const anonymousId = useMemo(() => getAnonymousId(), []);

  const track = useCallback(
    (type: CustomerEventType, options?: TrackOptions) => {
      fetch(`${API_BASE}/api/events/track`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type,
          entityId: options?.entityId,
          value: options?.value,
          context: options?.context,
          anonymousId,
        }),
      }).catch(() => {
        // fire-and-forget — tracking failures are invisible to the shopper
      });
    },
    [anonymousId],
  );

  return useMemo(() => ({ track }), [track]);
}

/**
 * Guest → account identity merge .
 *
 * Mount once per site. When the browser transitions from signed-out to
 * signed-in, claims the guest's anonymous behavioural history.
 */
export function IdentityMerge() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const attempts = useRef(0);

  useEffect(() => {
    // Check if user is authenticated via session cookie
    fetch(`${API_BASE}/api/auth/me`, { credentials: "include" })
      .then((res) => {
        if (res.ok) setIsAuthenticated(true);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!isAuthenticated || attempts.current >= 3) return;
    const anonId = getAnonymousId();
    if (!anonId) {
      attempts.current = 3;
      return;
    }
    attempts.current += 1;
    fetch(`${API_BASE}/api/events/merge`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ anonymousId: anonId }),
    })
      .then(() => {
        try {
          window.localStorage.removeItem(ANON_KEY);
        } catch {
          /* ignore */
        }
      })
      .catch(() => {});
  }, [isAuthenticated]);

  return null;
}
