import { AppHeader } from "@velnox/shared/components/AppHeader";
import { Button } from "@velnox/shared/components/ui/button";
import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { formatBaht, formatLocaleTime, formatRelativeTime } from "@velnox/shared/lib/commerce";
import { connectChatSocket, onChatEvent, onChatReconnect, sendChatCommand } from "@velnox/shared/lib/chat-socket";
import { useChatTyping } from "@velnox/shared/lib/chat-typing";
import { applyReadReceipt, isOwnMessage, isSystemMessage, mergeIncomingMessage } from "@velnox/shared/lib/chat-message";
import { TypingDots } from "@velnox/shared/components/chat/typing-dots";
import { notifyChatUnreadChanged } from "@velnox/shared/hooks/use-chat-unread";
import { useRealtimeState } from "@velnox/shared/hooks/use-realtime-state";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronRight,
  Headphones,
  Loader2,
  MessageCircle,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface Conversation {
  id: string;
  type: "CUSTOMER_SELLER" | "SELLER_COMPANY";
  customerId: string | null;
  sellerId: string | null;
  shopId: string | null;
  productId: string | null;
  shopName: string;
  shopLogo: string | null;
  participantId: string | null;
  participantName: string | null;
  participantAvatar: string | null;
  product: { id: string; name: string | null; price: number | null; imageUrl: string | null } | null;
  lastMessage: string | null;
  lastMessageAt: number | null;
  unreadCount: number;
  updatedAt: number;
}

interface ChatMessage {
  id: string;
  conversationId: string;
  /** NULL for a SYSTEM message (`isSystem`); the viewer's own id otherwise. */
  senderId: string | null;
  senderRole: "customer" | "seller" | "company" | "system";
  body: string;
  status: string;
  readAt: number | null;
  createdAt: number;
  /** Automated message written by the platform (daily Velnox Support ack). */
  isSystem?: boolean;
  systemKind?: string | null;
}

export default function SellerChat() {
  const { t, lang } = useLanguage();
  const { user, isAuthenticated } = useAuth();
  const realtimeState = useRealtimeState();
  const myConversations = useAction(api.seller.sellerConversations);
  const companyConversationAction = useAction(api.seller.companyConversation);
  const conversationMessages = useAction(api.seller.sellerConversationMessages);
  const sendMessage = useAction(api.seller.sendSellerMessageAction);
  const markConversationRead = useAction(api.seller.markSellerConversationReadAction);

  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [inboxTab, setInboxTab] = useState<"customers" | "company">("customers");
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  // Ephemeral typing state: throttled on the way out, auto-expired on the way in.
  const { typingUserIds, notifyTyping, notifyStop } = useChatTyping(
    active?.id ?? null,
    user?.id ?? null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const conversationsRef = useRef<Conversation[] | null>(null);
  conversationsRef.current = conversations;
  /**
   * A failed send keeps its clientId: resending the SAME text reuses it, so the
   * server replays the stored message instead of writing a duplicate row (or a
   * duplicate notification on the other side).
   */
  const retryRef = useRef<{ clientId: string; body: string } | null>(null);

  const loadConversations = useCallback(async () => {
    setError(false);
    try {
      const res = await myConversations();
      setConversations((res ?? []) as Conversation[]);
    } catch (err) {
      // A failed load is an ERROR, never an empty inbox.
      console.error("Load conversations error:", err);
      setError(true);
    }
  }, [myConversations]);

  useEffect(() => {
    void loadConversations();
  }, [loadConversations]);

  // ── Realtime socket ─────────────────────────────────────────────────
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    connectChatSocket(user.id);
    const offMessage = onChatEvent("chat:message", (data: any) => {
      const message = data?.message as ChatMessage | undefined;
      if (!message) return;
      // A company thread can arrive before this seller opened it — re-read the
      // authoritative list rather than fabricating a row from the event.
      if (conversationsRef.current && !conversationsRef.current.some((c) => c.id === message.conversationId)) {
        void loadConversations();
      }
      // A SYSTEM message is an acknowledgment, not a preview line: it must never
      // become the conversation's `lastMessage`.
      if (!message.isSystem)
        setConversations((prev) => {
          if (!prev) return prev;
          return prev
            .map((c) =>
              c.id === message.conversationId
              ? {
                  ...c,
                  lastMessage: message.body,
                  lastMessageAt: message.createdAt,
                  updatedAt: message.createdAt,
                  unreadCount:
                    message.isSystem || message.senderId === user.id ? c.unreadCount : c.unreadCount + 1,
                }
              : c,
          )
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      });
      if (message.conversationId === activeIdRef.current && !isOwnMessage(message, user.id)) {
        setMessages((prev) => mergeIncomingMessage(prev, message));
        // A SYSTEM message never counts as unread and must not trigger a read.
        if (!isSystemMessage(message)) {
          // Bounded by THIS message's server timestamp: anything newer that
          // arrives next stays unread until the reader actually sees it.
          void markConversationRead({ conversationId: message.conversationId, upTo: message.createdAt })
            .then(() => notifyChatUnreadChanged("seller"))
            .catch((err) => console.error("Mark conversation read failed:", err));
          setConversations((prev) => prev?.map((c) => (c.id === message.conversationId ? { ...c, unreadCount: 0 } : c)) ?? null);
        }
      }
    });
    const offRead = onChatEvent("chat:read", (data: any) => {
      if (data?.conversationId !== activeIdRef.current) return;
      // Our own read receipt must never tick our own messages.
      if (user?.id && data?.readerId === user.id) return;
      // Only what the reader actually had loaded; older backends omit `upTo`
      // and keep the previous mark-all behaviour. The shared helper decides
      // ownership, so a system row is never ticked.
      const upTo = typeof data?.upTo === "number" ? data.upTo : null;
      setMessages((prev) => applyReadReceipt(prev, user?.id, upTo));
    });
    return () => {
      if (activeIdRef.current) sendChatCommand("chat:viewingEnd", { conversationId: activeIdRef.current });
      offMessage();
      offRead();
      // The socket is owned by <RealtimeProvider> and shared with the header
      // bell — leaving this page must never close it.
    };
  }, [isAuthenticated, user?.id, markConversationRead]);

  // Re-read the authoritative data after a reconnect (events published while
  // the transport was down were never delivered).
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    return onChatReconnect(() => {
      void loadConversations();
      const activeId = activeIdRef.current;
      if (!activeId) return;
      conversationMessages({ conversationId: activeId })
        .then((res) => {
          setMessages((res.items ?? []) as ChatMessage[]);
          setHasMore(!!res.hasMore);
        })
        .catch((err) => console.error("Reload messages after reconnect failed:", err));
    });
  }, [isAuthenticated, user?.id, loadConversations, conversationMessages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, active?.id]);

  const closeActive = useCallback(() => {
    if (activeIdRef.current) {
      sendChatCommand("chat:viewingEnd", { conversationId: activeIdRef.current });
      activeIdRef.current = null;
    }
    setActive(null);
  }, []);

  const openConversation = useCallback(
    async (conv: Conversation) => {
      if (activeIdRef.current && activeIdRef.current !== conv.id) {
        sendChatCommand("chat:viewingEnd", { conversationId: activeIdRef.current });
      }
      setActive(conv);
      activeIdRef.current = conv.id;
      sendChatCommand("chat:viewing", { conversationId: conv.id });
      setMessages([]);
      setHasMore(false);
      setMessagesLoading(true);
      try {
        const res = await conversationMessages({ conversationId: conv.id });
        const items = (res.items ?? []) as ChatMessage[];
        setMessages(items);
        setHasMore(!!res.hasMore);
        setConversations((prev) => prev?.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c)) ?? null);
        // Mark read ONLY what this page actually loaded. `upTo` is the SERVER
        // timestamp of the newest message shown (no client clock involved), so
        // a message created after the fetch can never be swallowed as read.
        const upTo = items.length > 0 ? items[items.length - 1]!.createdAt : null;
        if (upTo != null) {
          void markConversationRead({ conversationId: conv.id, upTo })
            .then(() => notifyChatUnreadChanged("seller"))
            .catch((err) => console.error("Mark conversation read failed:", err));
        }
      } catch (err) {
        console.error("Load messages error:", err);
        toast.error(t("chat.loadError"));
      } finally {
        setMessagesLoading(false);
      }
    },
    [conversationMessages, markConversationRead, t],
  );

  const customerConvs = conversations?.filter((c) => c.type !== "SELLER_COMPANY") ?? [];
  const companyConvs = conversations?.filter((c) => c.type === "SELLER_COMPANY") ?? [];

  const startCompany = useCallback(async () => {
    try {
      const conv = (await companyConversationAction()) as Conversation;
      setConversations((prev) =>
        prev ? (prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev]) : [conv],
      );
      setInboxTab("company");
      void openConversation(conv);
    } catch (err) {
      console.error("Start company chat error:", err);
      toast.error(t("chat.supportError"));
    }
  }, [companyConversationAction, openConversation, t]);

  const loadOlder = useCallback(async () => {
    if (!active || loadingMore || messages.length === 0) return;
    const oldest = messages[0];
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const res = await conversationMessages({ conversationId: active.id, before: String(oldest.createdAt) });
      const older = (res.items ?? []) as ChatMessage[];
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...older.filter((m) => !seen.has(m.id)), ...prev];
      });
      setHasMore(!!res.hasMore);
    } catch (err) {
      console.error("Load older messages error:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [active, loadingMore, messages, conversationMessages]);

  const handleSend = useCallback(async () => {
    if (!active || !user?.id) return;
    const body = draft.trim();
    if (!body || sending) return;
    const retry = retryRef.current;
    const clientId =
      retry && retry.body === body
        ? retry.clientId
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const temp: ChatMessage = {
      id: `temp-${clientId}`,
      conversationId: active.id,
      senderId: user.id,
      senderRole: "seller",
      body,
      status: "sent",
      readAt: null,
      createdAt: Date.now(),
    };
    setDraft("");
    // The message already arrived — stop the indicator now rather than waiting
    // for the idle timer.
    notifyStop();
    setMessages((prev) => [...prev, temp]);
    setSending(true);
    try {
      const res = await sendMessage({ conversationId: active.id, body, clientId });
      retryRef.current = null;
      const saved = res?.message as ChatMessage | undefined;
      if (saved) {
        setMessages((prev) => prev.map((m) => (m.id === temp.id ? saved : m)));
        setConversations((prev) => prev?.map((c) => (c.id === active.id ? { ...c, lastMessage: saved.body, lastMessageAt: saved.createdAt, updatedAt: saved.createdAt } : c)) ?? null);
      }
    } catch (err) {
      console.error("Send message error:", err);
      toast.error(t("chat.sendError"));
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
      // An error must not swallow the user's text: restore the draft and keep
      // the clientId so a resend of the same text is idempotent server-side.
      retryRef.current = { clientId, body };
      setDraft(body);
    } finally {
      setSending(false);
    }
  }, [active, draft, sending, user?.id, sendMessage, t, notifyStop]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <AppHeader />

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <MessageCircle className="size-4 text-[#10B981]" />
            {t("sellerChat.eyebrow")}
            {realtimeState === "open" ? (
              <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                <span className="size-1.5 rounded-full bg-emerald-500" />
                {t("realtime.connected")}
              </span>
            ) : (
              <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-amber-700">
                <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                {t("realtime.reconnecting")}
              </span>
            )}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{t("sellerChat.title")}</h1>
          <p className="mt-1.5 text-sm text-slate-500">{t("sellerChat.desc")}</p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid md:grid-cols-[320px_1fr]">
          {/* ── Conversation list ─────────────────────────────────── */}
          <aside className={`${active ? "hidden md:block" : "block"} max-h-[calc(100dvh-260px)] overflow-y-auto border-slate-200 md:border-r`}>
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-base font-bold text-slate-900">{t("sellerChat.conversations")}</h2>
            </div>
            {/* Exactly two primary inboxes, one core: customers and Velnox. */}
            <div className="flex gap-1 border-b border-slate-100 px-3 py-2">
              {(["customers", "company"] as const).map((key) => {
                const list = key === "customers" ? customerConvs : companyConvs;
                const unread = list.reduce((sum, c) => sum + Math.max(0, c.unreadCount), 0);
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setInboxTab(key)}
                    aria-pressed={inboxTab === key}
                    className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-semibold transition-colors ${
                      inboxTab === key ? "bg-[#F0FDF9] text-emerald-700" : "text-slate-500 hover:bg-slate-50"
                    }`}
                  >
                    {key === "company" && <Headphones className="size-3.5" />}
                    <span className="truncate">
                      {key === "customers" ? t("sellerChat.customers") : t("sellerChat.velnox")}
                    </span>
                    {unread > 0 && (
                      <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-[#10B981] px-1 text-[10px] font-bold text-white">
                        {unread > 99 ? "99+" : unread}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
            {conversations === null ? (
              <div className="space-y-2 p-4">
                <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
                <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
                <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
              </div>
            ) : error ? (
              <div className="px-6 py-14 text-center">
                <MessageCircle className="mx-auto size-7 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-600">{t("chat.loadError")}</p>
                <button type="button" onClick={() => void loadConversations()} className="mt-3 inline-flex items-center gap-1 rounded-[10px] border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
                  {t("chat.retry")}
                </button>
              </div>
            ) : (inboxTab === "company" ? companyConvs : customerConvs).length === 0 ? (
              <div className="px-6 py-14 text-center">
                <MessageCircle className="mx-auto size-7 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-600">
                  {inboxTab === "company" ? t("sellerChat.companyEmpty") : t("chat.emptyTitle")}
                </p>
                {inboxTab === "company" ? (
                  <button
                    type="button"
                    onClick={() => void startCompany()}
                    className="mt-4 inline-flex items-center gap-1.5 rounded-[10px] bg-[#10B981] px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-[#059669]"
                  >
                    <Headphones className="size-4" />
                    {t("sellerChat.contactVelnox")}
                  </button>
                ) : (
                  <p className="mt-1 text-xs leading-5 text-slate-400">{t("sellerChat.emptyDesc")}</p>
                )}
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {(inboxTab === "company" ? companyConvs : customerConvs).map((c) => {
                  const isCompany = c.type === "SELLER_COMPANY";
                  const title = isCompany
                    ? t("chat.supportTitle")
                    : c.participantName ?? t("sellerChat.customerFallback");
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => void openConversation(c)}
                      className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 ${active?.id === c.id ? "bg-[#F0FDF9]" : ""}`}
                    >
                      <span className="relative shrink-0">
                        {isCompany ? (
                          <span className="flex size-11 items-center justify-center rounded-full bg-[#10B981] text-white">
                            <Headphones className="size-5" />
                          </span>
                        ) : c.participantAvatar ? (
                          <img src={c.participantAvatar} alt="" className="size-11 rounded-full object-cover" />
                        ) : (
                          <span className="flex size-11 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-400">
                            {(c.participantName ?? "?").charAt(0).toUpperCase()}
                          </span>
                        )}
                        {c.unreadCount > 0 && (
                          <span className="absolute -right-1 -top-1 flex size-4 min-w-4 items-center justify-center rounded-full bg-[#10B981] px-0.5 text-[10px] font-bold text-white">
                            {c.unreadCount > 9 ? "9+" : c.unreadCount}
                          </span>
                        )}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-semibold text-slate-900">{title}</span>
                          <span className="shrink-0 text-[10px] text-slate-400">{formatRelativeTime(c.lastMessageAt, lang, t)}</span>
                        </span>
                        <span className={`mt-0.5 block truncate text-xs ${c.unreadCount > 0 ? "font-medium text-slate-700" : "text-slate-400"}`}>
                          {c.lastMessage ?? "—"}
                        </span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-slate-300" />
                    </button>
                  );
                })}
              </div>
            )}
          </aside>

          {/* ── Thread ────────────────────────────────────────────── */}
          <section className={`${active ? "flex" : "hidden md:flex"} h-[calc(100dvh-260px)] min-h-[460px] flex-col`}>
            {!active ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
                  <MessageCircle className="size-7 text-slate-300" />
                </span>
                <p className="mt-4 text-sm font-medium text-slate-600">{t("sellerChat.chooseConversation")}</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                  <button type="button" onClick={closeActive} className="flex size-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 md:hidden" aria-label={t("chat.back")}>
                    <ArrowLeft className="size-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    {active.type === "SELLER_COMPANY" ? (
                      <>
                        <p className="flex items-center gap-1.5 truncate text-sm font-semibold text-slate-900">
                          <Headphones className="size-4 text-[#10B981]" />
                          {t("chat.supportTitle")}
                          <span className="rounded-full bg-[#ECFDF5] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                            {t("chat.supportBadge")}
                          </span>
                        </p>
                        <p className="truncate text-[11px] text-slate-400">{t("chat.supportDesc")}</p>
                      </>
                    ) : (
                      <>
                        <p className="truncate text-sm font-semibold text-slate-900">{active.participantName ?? t("sellerChat.customerFallback")}</p>
                        {active.product && <p className="truncate text-[11px] text-slate-400">{t("sellerChat.aboutProduct")}</p>}
                      </>
                    )}
                  </div>
                </div>

                {/* Product context */}
                {active.product && (
                  <div className="mx-3 mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5">
                    {active.product.imageUrl ? (
                      <img src={active.product.imageUrl} alt="" className="size-11 shrink-0 rounded-lg object-cover" />
                    ) : (
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-400">
                        <MessageCircle className="size-4" />
                      </span>
                    )}
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold text-slate-900">{active.product.name ?? ""}</span>
                      {active.product.price != null && (
                        <span className="mt-0.5 block text-xs font-bold text-slate-900">{formatBaht(active.product.price)}</span>
                      )}
                    </span>
                  </div>
                )}

                {/* Messages */}
                <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto px-4 py-4">
                  {messagesLoading ? (
                    <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400">
                      <Loader2 className="size-4 animate-spin" />
                      {t("chat.loadingMessages")}
                    </div>
                  ) : (
                    <>
                      {hasMore && (
                        <button
                          type="button"
                          onClick={() => void loadOlder()}
                          disabled={loadingMore}
                          className="mx-auto flex items-center gap-1 text-xs font-medium text-[#10B981] transition-colors hover:text-[#059669] disabled:opacity-50"
                        >
                          {loadingMore && <Loader2 className="size-3 animate-spin" />}
                          {t("chat.loadOlder")}
                        </button>
                      )}
                      {messages.length === 0 ? (
                        <div className="py-12 text-center">
                          <p className="text-sm text-slate-500">{t("chat.emptyTitle")}</p>
                          <p className="mt-1 text-xs text-slate-400">{t("chat.emptyDesc")}</p>
                        </div>
                      ) : (
                        messages.map((m) => {
                          // A system message is ALWAYS incoming (LEFT), with its
                          // own muted style and no read tick.
                          if (isSystemMessage(m)) {
                            return (
                              <div key={m.id} className="flex justify-start">
                                <div
                                  role="note"
                                  aria-label={t("chat.systemMessage")}
                                  className="max-w-[86%] rounded-2xl rounded-bl-md border border-dashed border-slate-300 bg-slate-50 px-3.5 py-2.5 text-xs leading-5 text-slate-500"
                                >
                                  <p className="whitespace-pre-line break-words">{m.body}</p>
                                  <p className="mt-1 text-[10px] text-slate-400">
                                    {formatLocaleTime(m.createdAt, lang)}
                                  </p>
                                </div>
                              </div>
                            );
                          }
                          const mine = isOwnMessage(m, user?.id);
                          return (
                            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                              <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${mine ? "rounded-br-md bg-slate-900 text-white" : "rounded-bl-md border border-slate-200 bg-slate-50 text-slate-800"}`}>
                                <p className="whitespace-pre-line break-words">{m.body}</p>
                                <p className={`mt-1 flex items-center gap-1 text-[10px] text-slate-400`}>
                                  <span>{formatLocaleTime(m.createdAt, lang)}</span>
                                  {/* ✓ = stored by the server; ✓✓ = the customer read it. */}
                                  {mine &&
                                    (m.readAt != null ? (
                                      <CheckCheck
                                        role="img"
                                        aria-label={t("chat.read")}
                                        className="size-3 text-sky-400"
                                      />
                                    ) : (
                                      <Check
                                        role="img"
                                        aria-label={t("chat.sent")}
                                        className="size-3 text-slate-500"
                                      />
                                    ))}
                                </p>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </>
                  )}
                  {typingUserIds.length > 0 && (
                    <div className="pt-1">
                      <TypingDots
                        label={
                          typingUserIds.length === 1 && active?.participantName
                            ? t("chat.typingNamed", { name: active?.participantName ?? "" })
                            : t("chat.typing")
                        }
                      />
                    </div>
                  )}
                </div>

                {/* Composer */}
                <div className="flex items-center gap-2 border-t border-slate-100 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                  <input
                    value={draft}
                    onChange={(e) => {
                      setDraft(e.target.value);
                      if (e.target.value.trim().length > 0) notifyTyping();
                      else notifyStop();
                    }}
                    onBlur={notifyStop}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        void handleSend();
                      }
                    }}
                    placeholder={t("chat.inputPlaceholder")}
                    aria-label={t("chat.typeMessageAria")}
                    maxLength={4000}
                    className="min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <Button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={!draft.trim() || sending}
                    className="size-11 shrink-0 gap-1.5 rounded-full bg-[#10B981] p-0 text-white hover:bg-[#059669]"
                    aria-label={t("chat.sendAria")}
                  >
                    {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                  </Button>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}