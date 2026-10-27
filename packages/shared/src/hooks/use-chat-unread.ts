/**
 * useChatUnread — ONE server-derived unread count for the chat entries.
 *
 * A tiny module-level store instead of per-component state, because the number
 * must be identical everywhere it renders (the seller header's two chat
 * entries, the profile row) and must move without a page reload. It adds NO
 * transport: the count is re-read from the API when the existing shared socket
 * reports `chat:message` or a reconnect (`chat-socket`, owned by
 * `RealtimeProvider` — still exactly one WebSocket per app, no polling).
 *
 * Counting rules — chat unread and notification unread stay separate on purpose
 * (the notification bell counts `notifications` rows; this never does):
 *   - customer → `GET /api/customer/account-summary` → `chatUnread`
 *   - seller   → the sum of `unreadCount` over `GET /api/seller/conversations`
 * Both are scoped to the authenticated viewer SERVER-side; the browser never
 * decides who owns a conversation, and notification rows are never counted here.
 *
 * `count === null` means "not confirmed by the server yet" and renders NOTHING:
 * an error must never look like "0 unread", and a failed refresh keeps the last
 * known-good number instead of clearing it.
 *
 * After the viewer's own read action, a chat page calls
 * `notifyChatUnreadChanged(viewer)` so the badge drops without waiting for the
 * next message.
 */
import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api-routes";
import { onChatEvent, onChatReconnect } from "../lib/chat-socket";
import { useAuth } from "./use-auth";

export type ChatUnreadViewer = "customer" | "seller";

export interface ChatUnreadState {
  /** null = the server has not confirmed a number yet (loading / failed first load). */
  count: number | null;
  status: "loading" | "ready" | "error";
}

const IDLE: ChatUnreadState = { count: null, status: "loading" };

let state: ChatUnreadState = IDLE;
/** Which account + surface the current `state` belongs to — never leak a count across sessions. */
let ownerUserId: string | null = null;
let ownerViewer: ChatUnreadViewer | null = null;

const listeners = new Set<() => void>();
let inFlight: Promise<void> | null = null;
let queued = false;

function emit(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch {
      // A broken subscriber must never break the badge for the others.
    }
  }
}

function setState(next: ChatUnreadState): void {
  if (next.count === state.count && next.status === state.status) return;
  state = next;
  emit();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Read the authoritative count for this viewer. Throws on anything unusable —
 *  a value we cannot trust must stay `null`, never become a silent 0. */
async function readCount(viewer: ChatUnreadViewer): Promise<number> {
  if (viewer === "customer") {
    const summary = await api.customer.accountSummary();
    const raw = summary?.chatUnread;
    if (typeof raw !== "number" || !Number.isFinite(raw)) {
      throw new Error("chatUnread unavailable");
    }
    return Math.max(0, Math.trunc(raw));
  }
  const rows = await api.seller.sellerConversations();
  if (!Array.isArray(rows)) throw new Error("conversations unavailable");
  let total = 0;
  for (const row of rows as Array<{ unreadCount?: unknown }>) {
    const n = Number(row?.unreadCount);
    if (Number.isFinite(n) && n > 0) total += Math.trunc(n);
  }
  return total;
}

/** Re-read the count from the API. Concurrent calls coalesce into one fetch
 *  plus one trailing refetch, so a burst of messages never piles up requests. */
export async function refreshChatUnread(viewer: ChatUnreadViewer, userId: string): Promise<void> {
  if (ownerUserId !== userId || ownerViewer !== viewer) {
    // A different account or surface: drop the previous number immediately.
    ownerUserId = userId;
    ownerViewer = viewer;
    setState(IDLE);
  }
  if (inFlight) {
    queued = true;
    return;
  }
  inFlight = (async () => {
    try {
      const count = await readCount(viewer);
      setState({ count, status: "ready" });
    } catch (err) {
      console.error("[chat-unread] refresh failed:", err);
      // Keep last-known-good; unknown stays unknown (null never becomes a fake 0).
      setState({ count: state.count, status: "error" });
    } finally {
      inFlight = null;
      if (queued) {
        queued = false;
        const nextViewer = ownerViewer;
        const nextUser = ownerUserId;
        if (nextViewer && nextUser) void refreshChatUnread(nextViewer, nextUser);
      }
    }
  })();
  return inFlight;
}

/** The viewer's own read action succeeded — re-read the count now. No-op until
 *  a badge for this viewer has actually loaded (nothing to update yet). */
export function notifyChatUnreadChanged(viewer: ChatUnreadViewer): void {
  if (ownerViewer !== viewer || !ownerUserId) return;
  void refreshChatUnread(viewer, ownerUserId);
}

/**
 * Reactive badge state for a surface. Fetches once on mount, then refreshes on
 * the existing `chat:message` signal and on reconnect (authoritative refetch —
 * nothing is incremented locally, so a reconnect can never double-count).
 */
export function useChatUnread(viewer: ChatUnreadViewer): ChatUnreadState & { refresh: () => void } {
  const { isAuthenticated, isLoading, user } = useAuth();
  const userId = user?.id ?? null;
  const [, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((tick) => tick + 1)), []);

  const active = isAuthenticated && !!userId;

  useEffect(() => {
    if (!active || !userId) return;
    void refreshChatUnread(viewer, userId);
    const offMessage = onChatEvent("chat:message", () => {
      void refreshChatUnread(viewer, userId);
    });
    const offReconnect = onChatReconnect(() => {
      void refreshChatUnread(viewer, userId);
    });
    return () => {
      offMessage();
      offReconnect();
    };
  }, [active, userId, viewer]);

  const refresh = useCallback(() => {
    if (active && userId) void refreshChatUnread(viewer, userId);
  }, [active, userId, viewer]);

  if (!active) return { count: null, status: isLoading ? "loading" : "ready", refresh };
  // Before the first refresh lands (or after an account switch) the stored
  // number belongs to somebody else — report "unknown", never their count.
  if (ownerUserId !== userId || ownerViewer !== viewer) {
    return { count: null, status: "loading", refresh };
  }
  return { ...state, refresh };
}
