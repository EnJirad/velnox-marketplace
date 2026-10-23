/**
 * useSellerApplication — the seller app's access state.
 *
 * Fetches the caller's OWN application from the existing
 * `GET /api/seller/status` endpoint (cookie session, no client ids) and exposes
 * the backend's `sellerAccess` verdict. Everything that is not an explicit
 * approval is `false`: while loading, on a network/API error, and for every
 * status that is not `approved` (no application, pending, under_review,
 * needs_correction, rejected, suspended).
 *
 * Refreshes on window focus, on the tab becoming visible again, and after a
 * successful submission (call `refetch()`), so an approval that happened while
 * the applicant waited shows up without a logout/login. A reviewer decision is
 * also pushed live over the EXISTING per-user socket (`notification:created`),
 * which this hook only treats as a signal to re-read the status API — no new
 * socket, no new channel, and the API stays the source of truth.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../lib/api-client";
import { connectChatSocket, onChatEvent } from "../lib/chat-socket";
import { apiBaseUrl } from "../lib/sites";
import {
  sellerAccessFromStatusResponse,
  type SellerStatusResponse,
} from "../lib/seller-access";

/** The `data` payload of `GET /api/seller/status` (superset of what the UI reads). */
export interface SellerApplication {
  id?: string;
  status?: string | null;
  verificationStatus?: string | null;
  shopName?: string | null;
  shopSlug?: string | null;
  shop?: {
    id?: string;
    name?: string | null;
    slug?: string | null;
    description?: string | null;
    category?: string | null;
    phone?: string | null;
    address?: {
      line1?: string | null;
      line2?: string | null;
      subdistrict?: string | null;
      district?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
      country?: string | null;
    } | null;
  } | null;
  applicantInfo?: {
    firstName?: string | null;
    lastName?: string | null;
    phone?: string | null;
    idNumber?: string | null;
  } | null;
  submittedAt?: string | null;
  rejectionReason?: string | null;
  rejectionReasonCode?: string | null;
  correctionReason?: string | null;
  correctionReasonCode?: string | null;
  identityEvidenceCount?: number;
  hasIdentityVerification?: boolean;
  reviewHistory?: Array<Record<string, unknown>>;
}

export interface SellerApplicationState {
  application: SellerApplication | null;
  /** True ONLY when the backend reports an approved application. */
  sellerAccess: boolean;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
}

export function useSellerApplication(): SellerApplicationState {
  const { user } = useAuth();
  const [application, setApplication] = useState<SellerApplication | null>(null);
  const [sellerAccess, setSellerAccess] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const aliveRef = useRef(true);

  const refetch = useCallback(async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/seller/status`, { credentials: "include" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const payload = (await res.json()) as SellerStatusResponse;
      if (!aliveRef.current) return;
      setApplication((payload.data as SellerApplication | null) ?? null);
      setSellerAccess(sellerAccessFromStatusResponse(payload));
      setError(null);
    } catch (err) {
      if (!aliveRef.current) return;
      // Fail closed — an unreadable status is never an approval.
      console.warn("[seller-access] status fetch failed:", err);
      setApplication(null);
      setSellerAccess(false);
      setError("SELLER_STATUS_UNAVAILABLE");
    } finally {
      if (aliveRef.current) setLoading(false);
    }
  }, []);

  const userId = user?.id ?? null;

  useEffect(() => {
    aliveRef.current = true;
    void refetch();

    const onRefresh = () => { void refetch(); };
    const onVisibility = () => {
      if (document.visibilityState === "visible") void refetch();
    };
    window.addEventListener("focus", onRefresh);
    document.addEventListener("visibilitychange", onVisibility);

    // Reviewer decisions arrive as `notification:created` on the caller's own
    // private channel (the same shared socket the notification bell uses). Any
    // seller-* notification means the application may have moved, so re-read the
    // authoritative status endpoint. The event payload is never used as state.
    if (userId) connectChatSocket(userId);
    const off = onChatEvent("notification:created", (data: { type?: unknown } | null) => {
      const type = typeof data?.type === "string" ? data.type : "";
      if (type.startsWith("seller")) void refetch();
    });

    return () => {
      aliveRef.current = false;
      window.removeEventListener("focus", onRefresh);
      document.removeEventListener("visibilitychange", onVisibility);
      off();
    };
  }, [refetch, userId]);

  return { application, sellerAccess, loading, error, refetch };
}
