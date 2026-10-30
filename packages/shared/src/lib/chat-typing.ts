/**
 * Typing indicator — the CLIENT half of the ephemeral `chat:typing` frame.
 *
 * One hook, reused by every chat surface (VelShop / VelSeller / VelCenter), so
 * the throttling and expiry rules cannot drift between them:
 *
 *   OUTBOUND (the person typing)
 *     • `notifyTyping()` on each keystroke — sent at most once per
 *       TYPING_SEND_INTERVAL_MS, so a fast typist cannot flood the socket (the
 *       server also has its own frame budget);
 *     • an idle timer sends an explicit `typing: false` after
 *       TYPING_IDLE_MS, and `notifyStop()` does it immediately on send/blur;
 *     • never sends on a null conversation, and never sends the body.
 *
 *   INBOUND (the person watching)
 *     • keeps the set of OTHER participants currently typing;
 *     • clears a user after TYPING_EXPIRE_MS even if the stop frame was lost
 *       (a dropped socket must not leave "…is typing" on screen forever);
 *     • ignores the sender's own id, so a client can never render itself.
 *
 * Nothing here is persisted and nothing is polled: the frame is delivery only,
 * and the authoritative conversation state still comes from the REST routes.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { onChatEvent, sendChatCommand } from "./chat-socket";

/** Minimum gap between two "typing: true" frames from this client. */
export const TYPING_SEND_INTERVAL_MS = 2_500;
/** Silence after which this client tells the server it stopped typing. */
export const TYPING_IDLE_MS = 3_000;
/** How long a received "typing" state survives without a refresh. */
export const TYPING_EXPIRE_MS = 6_000;

export interface ChatTyping {
  /** User ids (never our own) currently typing in this conversation. */
  typingUserIds: string[];
  /** Call on every keystroke; internally throttled. */
  notifyTyping: () => void;
  /** Call on send / blur / close; sends the stop frame immediately. */
  notifyStop: () => void;
}

export function useChatTyping(conversationId: string | null, selfUserId: string | null): ChatTyping {
  const [typingUserIds, setTypingUserIds] = useState<string[]>([]);
  const lastSentAtRef = useRef(0);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const expireTimersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const conversationRef = useRef(conversationId);

  useEffect(() => {
    conversationRef.current = conversationId;
  }, [conversationId]);

  const clearIdleTimer = useCallback(() => {
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
  }, []);

  const notifyStop = useCallback(() => {
    clearIdleTimer();
    lastSentAtRef.current = 0;
    const active = conversationRef.current;
    if (!active) return;
    sendChatCommand("chat:typing", { conversationId: active, typing: false });
  }, [clearIdleTimer]);

  const notifyTyping = useCallback(() => {
    const active = conversationRef.current;
    if (!active) return;
    const now = Date.now();
    if (now - lastSentAtRef.current >= TYPING_SEND_INTERVAL_MS) {
      lastSentAtRef.current = now;
      sendChatCommand("chat:typing", { conversationId: active, typing: true });
    }
    // Restart the idle timer on EVERY keystroke: the stop frame is what makes
    // the other side's indicator disappear promptly instead of timing out.
    clearIdleTimer();
    idleTimerRef.current = setTimeout(() => {
      idleTimerRef.current = null;
      lastSentAtRef.current = 0;
      if (conversationRef.current) {
        sendChatCommand("chat:typing", { conversationId: conversationRef.current, typing: false });
      }
    }, TYPING_IDLE_MS);
  }, [clearIdleTimer]);

  // ── Inbound ──────────────────────────────────────────────────────────────
  useEffect(() => {
    setTypingUserIds([]);
    const timers = expireTimersRef.current;
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    if (!conversationId) return;

    const off = onChatEvent("chat:typing", (data: any) => {
      if (data?.conversationId !== conversationId) return;
      const userId = typeof data?.userId === "string" ? data.userId : "";
      if (!userId || userId === selfUserId) return;

      const existing = timers.get(userId);
      if (existing) clearTimeout(existing);

      if (data?.typing === false) {
        timers.delete(userId);
        setTypingUserIds((prev) => prev.filter((id) => id !== userId));
        return;
      }

      timers.set(
        userId,
        setTimeout(() => {
          timers.delete(userId);
          setTypingUserIds((prev) => prev.filter((id) => id !== userId));
        }, TYPING_EXPIRE_MS),
      );
      setTypingUserIds((prev) => (prev.includes(userId) ? prev : [...prev, userId]));
    });

    return () => {
      off();
      for (const timer of timers.values()) clearTimeout(timer);
      timers.clear();
    };
  }, [conversationId, selfUserId]);

  // Leaving the page / switching threads must not leave the other side waiting.
  useEffect(() => () => {
    clearIdleTimer();
    if (conversationRef.current) {
      sendChatCommand("chat:typing", { conversationId: conversationRef.current, typing: false });
    }
  }, [clearIdleTimer]);

  return { typingUserIds, notifyTyping, notifyStop };
}
