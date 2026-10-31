import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { formatBaht, formatLocaleTime, formatRelativeTime } from "@velnox/shared/lib/commerce";
import { connectChatSocket, onChatEvent, onChatReconnect, sendChatCommand } from "@velnox/shared/lib/chat-socket";
import { useChatTyping } from "@velnox/shared/lib/chat-typing";
import {
  applyReadReceipt,
  isOwnMessage,
  isSystemMessage,
  mergeIncomingMessage,
} from "@velnox/shared/lib/chat-message";
import { buildTimeline } from "@velnox/shared/lib/chat-timeline";
import { validateChatImage, uploadChatImage } from "@velnox/shared/lib/chat-attachment";
import { ChatImageMessage } from "@velnox/shared/components/chat/chat-image";
import { ChatComposer } from "@velnox/shared/components/chat/chat-composer";
import {
  ChatConversationRow,
  ChatFilterTabs,
  ChatListState,
  ChatSearchField,
  ChatThreadHeader,
  type ChatFilter,
} from "@velnox/shared/components/chat/chat-inbox";
import { TypingDots } from "@velnox/shared/components/chat/typing-dots";
import { notifyChatUnreadChanged } from "@velnox/shared/hooks/use-chat-unread";
import { useRealtimeState } from "@velnox/shared/hooks/use-realtime-state";
import { Button } from "@velnox/shared/components/ui/button";
import { cn } from "@velnox/shared/lib/utils";
import {
  ArrowDown,
  Check,
  CheckCheck,
  ChevronRight,
  Headphones,
  Loader2,
  MessageCircle,
  Star,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

interface Conversation {
  id: string;
  customerId: string;
  sellerId: string;
  shopId: string;
  productId: string | null;
  /** true for the dedicated Velnox Support conversation (never a seller). */
  isSupport: boolean;
  shopName: string;
  shopLogo: string | null;
  participantId: string | null;
  participantName: string | null;
  participantAvatar: string | null;
  /** Presence of the single counterpart — `null` when it cannot be proved. */
  participantOnline?: boolean | null;
  participantLastSeenAt?: number | null;
  product: { id: string; name: string | null; price: number | null; imageUrl: string | null } | null;
  lastMessage: string | null;
  lastMessageAt: number | null;
  unreadCount: number;
  updatedAt: number;
}

interface ChatMessage {
  id: string;
  conversationId: string;
  /** NULL for a SYSTEM message (see `isSystem`); the viewer's own id otherwise. */
  senderId: string | null;
  senderRole: "customer" | "seller" | "company" | "system";
  body: string;
  status: string;
  readAt: number | null;
  createdAt: number;
  /** Automated message written by the platform (daily Velnox Support ack). */
  isSystem?: boolean;
  systemKind?: string | null;
  /** Image attached to this message (URL derived server-side from the R2 key). */
  attachmentUrl?: string | null;
}

/** Pixels from the bottom that still count as "reading the newest message". */
const NEAR_BOTTOM_PX = 80;

export default function ShopChat() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAuthenticated } = useAuth();
  const realtimeState = useRealtimeState();
  const myConversations = useAction(api.customer.myConversations);
  const supportConversationAction = useAction(api.customer.supportConversationAction);
  const conversationMessages = useAction(api.customer.conversationMessages);
  const sendMessage = useAction(api.customer.sendMessageAction);
  const markConversationRead = useAction(api.customer.markConversationRead);

  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<ChatFilter>("all");
  /** Messages arrived while the reader was scrolled up. */
  const [newBelow, setNewBelow] = useState(0);
  // Ephemeral typing state: throttled on the way out, auto-expired on the way in.
  const { typingUserIds, notifyTyping, notifyStop } = useChatTyping(
    active?.id ?? null,
    user?.id ?? null,
  );
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const nearBottomRef = useRef(true);
  /** Height before an older page is prepended, so the scroll anchor holds. */
  const prevScrollHeightRef = useRef<number | null>(null);
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
      if (!message?.id) return;
      const conversationId = (data?.conversationId as string) ?? message.conversationId;
      const isActive = activeIdRef.current === conversationId;
      if (isActive) {
        setMessages((prev) => mergeIncomingMessage(prev, message));
        if (!nearBottomRef.current) setNewBelow((count) => count + 1);
      }
      setConversations((prev) =>
        prev?.map((c) =>
          c.id === conversationId
            ? {
                ...c,
                lastMessage: message.body || (message.attachmentUrl ? "📷" : c.lastMessage),
                lastMessageAt: message.createdAt,
                updatedAt: message.createdAt,
                unreadCount:
                  isActive || isOwnMessage(message, user.id) ? c.unreadCount : c.unreadCount + 1,
              }
            : c,
        ) ?? null,
      );
      if (isActive) {
        // Someone is watching the thread: keep the server's read state in step.
        void markConversationRead({ conversationId, upTo: message.createdAt })
          .then(() => notifyChatUnreadChanged("customer"))
          .catch(() => {});
      } else if (message.senderId !== user.id) {
        notifyChatUnreadChanged("customer");
      }
    });
    const offRead = onChatEvent("chat:read", (data: any) => {
      if (data?.conversationId !== activeIdRef.current) return;
      const upTo = typeof data?.upTo === "number" ? data.upTo : null;
      setMessages((prev) => applyReadReceipt(prev, user.id, upTo));
    });
    // Presence is authoritative only when the server says so: a userId + boolean.
    const offPresence = onChatEvent("chat:presence", (data: any) => {
      const changedUserId = typeof data?.userId === "string" ? data.userId : null;
      if (!changedUserId) return;
      const online = data?.online === true;
      const at = typeof data?.at === "number" ? data.at : Date.now();
      setConversations((prev) =>
        prev?.map((c) =>
          c.participantId === changedUserId
            ? {
                ...c,
                participantOnline: online,
                participantLastSeenAt: online ? c.participantLastSeenAt ?? null : at,
              }
            : c,
        ) ?? null,
      );
      setActive((prev) =>
        prev && prev.participantId === changedUserId
          ? {
              ...prev,
              participantOnline: online,
              participantLastSeenAt: online ? prev.participantLastSeenAt ?? null : at,
            }
          : prev,
      );
    });
    return () => {
      offMessage();
      offRead();
      offPresence();
    };
  }, [isAuthenticated, user?.id, markConversationRead]);

  // After a reconnect, re-read the authoritative data: anything published while
  // the socket was down was never delivered to this page.
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

  // ── Scroll handling ─────────────────────────────────────────────────
  // A new page of OLDER messages must not move the reader: restore the exact
  // distance from the bottom that they had before the prepend.
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const previousHeight = prevScrollHeightRef.current;
    if (previousHeight !== null) {
      prevScrollHeightRef.current = null;
      el.scrollTop = el.scrollTop + (el.scrollHeight - previousHeight);
      return;
    }
    // A new message may only pull the view down when the reader is at the
    // bottom; otherwise they keep reading and a "new messages" chip appears.
    if (nearBottomRef.current) {
      el.scrollTop = el.scrollHeight;
      setNewBelow(0);
    }
  }, [messages.length, active?.id]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
    if (nearBottomRef.current) setNewBelow(0);
  }, []);

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    nearBottomRef.current = true;
    setNewBelow(0);
  }, []);

  // ── Open a conversation thread ──────────────────────────────────────
  const supportConvs = conversations?.filter((c) => c.isSupport) ?? [];

  const openConversation = useCallback(
    async (conv: Conversation) => {
      if (activeIdRef.current && activeIdRef.current !== conv.id) {
        sendChatCommand("chat:viewingEnd", { conversationId: activeIdRef.current });
      }
      nearBottomRef.current = true;
      setNewBelow(0);
      setSendError(null);
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
            .then(() => notifyChatUnreadChanged("customer"))
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

  // ── Auto-open a conversation from ?conv= (e.g. “Chat with shop” CTA) ──
  useEffect(() => {
    const convId = searchParams.get("conv");
    if (!convId || conversations === null) return;
    const match = conversations.find((c) => c.id === convId);
    if (match) {
      void openConversation(match);
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, conversations, openConversation, setSearchParams]);

  // ── Get-or-create the Velnox Support conversation ──────────────────────
  const startSupport = useCallback(async () => {
    try {
      const conv = (await supportConversationAction()) as Conversation;
      setConversations((prev) =>
        prev ? (prev.some((c) => c.id === conv.id) ? prev : [conv, ...prev]) : [conv],
      );
      void openConversation(conv);
    } catch (err) {
      console.error("Start support chat error:", err);
      toast.error(t("chat.supportError"));
    }
  }, [supportConversationAction, openConversation, t]);

  // ── Auto-open Velnox Support from ?support=1 (Help Center CTA) ────────
  useEffect(() => {
    const wantsSupport = searchParams.get("support");
    if (!wantsSupport || !isAuthenticated) return;
    setSearchParams({}, { replace: true });
    const existing = conversations?.find((c) => c.isSupport);
    if (existing) {
      void openConversation(existing);
    } else {
      void startSupport();
    }
  }, [searchParams, conversations, isAuthenticated, setSearchParams, openConversation, startSupport]);

  // ── Load older messages (keyset pagination) ─────────────────────────
  const loadOlder = useCallback(async () => {
    if (!active || loadingMore || messages.length === 0) return;
    const oldest = messages[0];
    if (!oldest) return;
    setLoadingMore(true);
    prevScrollHeightRef.current = scrollRef.current?.scrollHeight ?? null;
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

  // ── Image attachment (upload happens BEFORE the message is created) ──
  const [pendingImage, setPendingImage] = useState<{ file: File; url: string } | null>(null);
  const [uploadPct, setUploadPct] = useState<number | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);

  const handlePickImage = useCallback(
    (file: File) => {
      const invalid = validateChatImage(file);
      if (invalid) {
        toast.error(invalid);
        return;
      }
      if (pendingImage) URL.revokeObjectURL(pendingImage.url);
      setPendingImage({ file, url: URL.createObjectURL(file) });
      setAttachError(null);
      setUploadPct(null);
      setSendError(null);
    },
    [pendingImage],
  );

  const removeImage = useCallback(() => {
    if (pendingImage) URL.revokeObjectURL(pendingImage.url);
    setPendingImage(null);
    setAttachError(null);
    setUploadPct(null);
  }, [pendingImage]);

  // ── Send a message (optimistic + dedupe by clientId) ────────────────
  const handleSend = useCallback(async () => {
    if (!active || !user?.id) return;
    const body = draft.trim();
    if ((!body && !pendingImage) || sending) return;
    setSendError(null);
    // The upload must succeed before the message exists: a failed PUT can never
    // leave a message pointing at an object that is not in R2.
    let attachmentKey: string | null = null;
    let attachmentUrl: string | null = null;
    if (pendingImage) {
      setUploadPct(0);
      setAttachError(null);
      try {
        attachmentKey = await uploadChatImage(active.id, pendingImage.file, { onProgress: setUploadPct });
        attachmentUrl = pendingImage.url;
      } catch (err) {
        const message = err instanceof Error ? err.message : "Upload failed";
        setAttachError(message);
        setUploadPct(null);
        return;
      }
      setUploadPct(null);
    }
    const retry = retryRef.current;
    const clientId =
      retry && retry.body === body
        ? retry.clientId
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const temp: ChatMessage = {
      id: `temp-${clientId}`,
      conversationId: active.id,
      senderId: user.id,
      senderRole: "customer",
      body,
      status: "sent",
      readAt: null,
      createdAt: Date.now(),
      attachmentUrl,
    };
    setDraft("");
    if (pendingImage) {
      URL.revokeObjectURL(pendingImage.url);
      setPendingImage(null);
    }
    // Sending ends the typing state immediately — the other side should not wait
    // for the idle timer after the message already arrived.
    notifyStop();
    nearBottomRef.current = true;
    setMessages((prev) => [...prev, temp]);
    setSending(true);
    try {
      const res = await sendMessage({ conversationId: active.id, body, clientId, attachmentKey });
      retryRef.current = null;
      const saved = res?.message as ChatMessage | undefined;
      if (saved) {
        setMessages((prev) => prev.map((m) => (m.id === temp.id ? saved : m)));
        setConversations((prev) =>
          prev?.map((c) =>
            c.id === active.id
              ? {
                  ...c,
                  lastMessage: saved.body || (saved.attachmentUrl ? "📷" : ""),
                  lastMessageAt: saved.createdAt,
                  updatedAt: saved.createdAt,
                }
              : c,
          ) ?? null,
        );
      }
    } catch (err) {
      console.error("Send message error:", err);
      // An error must not swallow the user's text: restore the draft and keep
      // the clientId so a resend of the same text is idempotent server-side.
      retryRef.current = { clientId, body };
      setDraft(body);
      setSendError(t("chat.sendError"));
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
    } finally {
      setSending(false);
    }
  }, [active, draft, sending, pendingImage, user?.id, sendMessage, t, notifyStop]);

  // ── Derived inbox ───────────────────────────────────────────────────
  const unreadTotal = useMemo(
    () => (conversations ?? []).reduce((sum, c) => sum + Math.max(0, c.unreadCount), 0),
    [conversations],
  );

  const visibleConversations = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return (conversations ?? [])
      .filter((c) => {
        // Velnox Support is its OWN entry, never mixed into the commerce inbox:
        // All/Unread show buyer↔seller threads only, the Support tab shows the
        // support thread only.
        if (filter === "support") return c.isSupport;
        if (c.isSupport) return false;
        if (filter === "unread") return c.unreadCount > 0;
        return true;
      })
      .filter((c) => {
        if (!needle) return true;
        const haystack = [
          c.shopName,
          c.participantName,
          c.lastMessage,
          c.product?.name,
          c.isSupport ? t("chat.supportTitle") : "",
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(needle);
      })
      .sort((a, b) => (b.lastMessageAt ?? b.updatedAt) - (a.lastMessageAt ?? a.updatedAt));
  }, [conversations, filter, search, t]);

  const activeOnline = active && !active.isSupport ? active.participantOnline ?? null : null;
  const activeStatus = active
    ? active.isSupport
      ? t("chat.supportDesc")
      : activeOnline === true
        ? t("chat.online")
        : active.participantLastSeenAt
          ? t("chat.lastActive", { time: formatRelativeTime(active.participantLastSeenAt, lang, t) })
          : null
    : null;
  const activeName = active ? (active.isSupport ? t("chat.supportTitle") : active.shopName) : "";
  const activeAvatar = active && !active.isSupport ? active.shopLogo : null;

  // ── Login CTA ───────────────────────────────────────────────────────
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
        <ShopHeader />
        <main className="mx-auto flex w-full max-w-md flex-col items-center px-4 py-24 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
            <MessageCircle className="size-7 text-slate-400" />
          </span>
          <h1 className="mt-5 text-xl font-bold text-slate-900">{t("chat.loginToChat")}</h1>
          <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">{t("chat.loginToChatDesc")}</p>
          <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={() => navigate("/auth?returnTo=/chat")}>
            {t("auth.signIn")}
          </Button>
        </main>
        <ShopFooter />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <main className="mx-auto w-full max-w-6xl px-3 py-4 sm:px-6 sm:py-6">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
          <div className="flex h-[calc(100dvh-190px)] min-h-[520px] flex-col md:h-[calc(100dvh-230px)] md:grid md:grid-cols-[minmax(0,340px)_1fr]">
            {/* ── Inbox ─────────────────────────────────────────────── */}
            <section
              className={cn(
                "min-h-0 flex-col border-slate-100 md:flex md:border-r",
                active ? "hidden md:flex" : "flex",
              )}
              aria-label={t("chat.messagesTitle")}
            >
              <header className="flex items-center gap-2 px-4 pb-2 pt-4">
                <MessageCircle className="size-5 text-slate-900" aria-hidden="true" />
                <h1 className="text-xl font-bold tracking-tight text-slate-900">
                  {t("chat.messagesTitle")}
                </h1>
                {unreadTotal > 0 && (
                  <span className="ml-auto rounded-full bg-sky-100 px-2 py-0.5 text-[11px] font-semibold text-sky-900">
                    {unreadTotal > 99 ? "99+" : unreadTotal}
                  </span>
                )}
              </header>

              <div className="px-4">
                <ChatSearchField
                  value={search}
                  onChange={setSearch}
                  placeholder={t("chat.searchPlaceholder")}
                  label={t("chat.searchPlaceholder")}
                />
              </div>

              <div className="px-3 pb-2 pt-3">
                <ChatFilterTabs
                  value={filter}
                  onChange={setFilter}
                  labels={{
                    all: t("chat.filterAll"),
                    unread: t("chat.filterUnread"),
                    support: t("chat.filterSupport"),
                  }}
                  counts={{ unread: unreadTotal }}
                />
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain border-t border-slate-100">
                {conversations === null && !error ? (
                  <ChatListState kind="loading" title={t("chat.loadingMessages")} />
                ) : error ? (
                  <ChatListState
                    kind="error"
                    title={t("chat.loadError")}
                    actionLabel={t("chat.retry")}
                    onAction={() => void loadConversations()}
                  />
                ) : visibleConversations.length === 0 ? (
                  <ChatListState
                    kind="empty"
                    title={search.trim() || filter !== "all" ? t("chat.noResultsTitle") : t("chat.emptyTitle")}
                    description={
                      search.trim() || filter !== "all"
                        ? t("chat.noResultsDesc")
                        : t("chat.emptyDesc")
                    }
                  />
                ) : (
                  visibleConversations.map((c) => (
                    <ChatConversationRow
                      key={c.id}
                      name={c.isSupport ? t("chat.supportTitle") : c.shopName}
                      avatarUrl={c.isSupport ? null : c.shopLogo}
                      preview={c.lastMessage ?? (c.lastMessageAt ? "📷" : "—")}
                      timeLabel={formatRelativeTime(c.lastMessageAt ?? c.updatedAt, lang, t)}
                      unread={c.unreadCount}
                      online={c.isSupport ? null : c.participantOnline ?? null}
                      active={active?.id === c.id}
                      support={c.isSupport}
                      onClick={() => void openConversation(c)}
                    />
                  ))
                )}
              </div>

              {supportConvs.length === 0 && (
                <div className="shrink-0 border-t border-slate-100 p-2">
                  <button
                    type="button"
                    onClick={() => void startSupport()}
                    className="flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <span className="flex size-9 items-center justify-center rounded-xl bg-emerald-50 text-emerald-700">
                      <Headphones className="size-4" />
                    </span>
                    {t("chat.chatWithSupport")}
                  </button>
                </div>
              )}
            </section>

            {/* ── Thread ────────────────────────────────────────────── */}
            <section
              className={cn(
                "relative min-h-0 flex-1 flex-col",
                active ? "flex" : "hidden md:flex",
              )}
              aria-label={activeName || t("chat.conversations")}
            >
              {active ? (
                <>
                  <ChatThreadHeader
                    name={activeName}
                    avatarUrl={activeAvatar}
                    online={activeOnline}
                    status={activeStatus}
                    onBack={() => {
                      sendChatCommand("chat:viewingEnd", { conversationId: active.id });
                      activeIdRef.current = null;
                      setActive(null);
                    }}
                    backLabel={t("chat.back")}
                    actions={
                      realtimeState !== "open" ? (
                        <span className="ml-auto flex items-center gap-1.5 pr-1 text-[11px] font-medium text-amber-700">
                          <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />
                          {t("realtime.reconnecting")}
                        </span>
                      ) : null
                    }
                  />

                  {active.product && (
                    <button
                      type="button"
                      onClick={() => navigate(`/products/${active.product!.id}`)}
                      className="flex shrink-0 items-center gap-3 border-b border-slate-100 px-4 py-2.5 text-left transition-colors hover:bg-slate-50"
                    >
                      {active.product.imageUrl ? (
                        <img src={active.product.imageUrl} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
                      ) : (
                        <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-400">
                          <MessageCircle className="size-4" />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-semibold text-slate-900">
                          {active.product.name ?? ""}
                        </span>
                        {active.product.price != null && (
                          <span className="mt-0.5 block text-xs font-bold text-slate-900">
                            {formatBaht(active.product.price)}
                          </span>
                        )}
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-slate-300" />
                    </button>
                  )}

                  <div
                    ref={scrollRef}
                    onScroll={handleScroll}
                    className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-3 py-4 sm:px-5"
                  >
                    {messagesLoading ? (
                      <div className="flex items-center justify-center gap-2 py-10 text-xs text-slate-400">
                        <Loader2 className="size-4 animate-spin" />
                        {t("chat.loadingMessages")}
                      </div>
                    ) : (
                      <>
                        {hasMore && (
                          <div className="flex justify-center pb-1">
                            <button
                              type="button"
                              onClick={() => void loadOlder()}
                              disabled={loadingMore}
                              className="flex min-h-9 items-center gap-1 rounded-full px-3 text-xs font-medium text-emerald-700 transition-colors hover:bg-emerald-50 disabled:opacity-50"
                            >
                              {loadingMore && <Loader2 className="size-3 animate-spin" />}
                              {t("chat.loadOlder")}
                            </button>
                          </div>
                        )}
                        {messages.length === 0 ? (
                          <div className="py-12 text-center">
                            <p className="text-sm text-slate-500">{t("chat.emptyTitle")}</p>
                            <p className="mt-1 text-xs text-slate-400">{t("chat.emptyDesc")}</p>
                          </div>
                        ) : (
                          buildTimeline(messages, {
                            locale: lang === "th" ? "th-TH" : lang === "my" ? "my-MM" : "en-GB",
                          }).map((entry) => {
                            if (entry.kind === "date") {
                              return (
                                <div key={`day-${entry.key}`} className="flex justify-center py-2 first:pt-0">
                                  <span className="text-[11px] font-medium text-slate-400">{entry.label}</span>
                                </div>
                              );
                            }
                            const m = entry.message;
                            // A system message is ALWAYS incoming: the platform spoke,
                            // not this viewer, so it sits on the LEFT with a distinct
                            // muted bubble and never carries a read tick.
                            if (isSystemMessage(m)) {
                              return (
                                <div key={m.id} className="flex justify-start">
                                  <div
                                    role="note"
                                    aria-label={t("chat.systemMessage")}
                                    className="flex max-w-[85%] items-start gap-2 rounded-2xl rounded-bl-md border border-dashed border-slate-300 bg-slate-50 px-3 py-2 text-[13px] leading-6 text-slate-600"
                                  >
                                    <Star className="mt-1 size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
                                    <span className="min-w-0">
                                      <span className="block whitespace-pre-wrap break-words">{m.body}</span>
                                      <span className="mt-0.5 block text-[10px] text-slate-400">
                                        {formatLocaleTime(m.createdAt, lang)}
                                      </span>
                                    </span>
                                  </div>
                                </div>
                              );
                            }
                            const mine = isOwnMessage(m, user?.id);
                            return (
                              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                                <div
                                  className={cn(
                                    "max-w-[82%] rounded-2xl px-3.5 py-2 text-[14px] leading-6 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:max-w-[72%]",
                                    mine
                                      ? "rounded-br-md bg-[#ECFDF5] text-slate-900"
                                      : "rounded-bl-md bg-slate-100 text-slate-800",
                                  )}
                                >
                                  {m.attachmentUrl && (
                                    <div className="mb-1">
                                      <ChatImageMessage
                                        url={m.attachmentUrl}
                                        alt={t("chat.imageAlt")}
                                        label={t("chat.viewImage")}
                                      />
                                    </div>
                                  )}
                                  {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                                  <div
                                    className={cn(
                                      "mt-1 flex items-center justify-end gap-1 text-[10px] tabular-nums",
                                      mine ? "text-emerald-800/60" : "text-slate-400",
                                    )}
                                  >
                                    <span>{formatLocaleTime(m.createdAt, lang)}</span>
                                    {/* ✓ = stored by the server; ✓✓ = the other side read it. */}
                                    {mine &&
                                      (m.readAt != null ? (
                                        <CheckCheck
                                          role="img"
                                          aria-label={t("chat.seen")}
                                          className="size-3"
                                        />
                                      ) : (
                                        <Check
                                          role="img"
                                          aria-label={t("chat.sent")}
                                          className="size-3"
                                        />
                                      ))}
                                  </div>
                                </div>
                              </div>
                            );
                          })
                        )}
                      </>
                    )}
                  </div>

                  {newBelow > 0 && (
                    <div className="pointer-events-none absolute inset-x-0 bottom-24 flex justify-center">
                      <button
                        type="button"
                        onClick={scrollToBottom}
                        className="pointer-events-auto flex min-h-9 items-center gap-1.5 rounded-full bg-slate-900 px-3 text-xs font-medium text-white shadow-lg"
                      >
                        <ArrowDown className="size-3.5" />
                        {t("chat.newMessages")}
                        {newBelow > 1 ? ` · ${newBelow}` : ""}
                      </button>
                    </div>
                  )}

                  <ChatComposer
                    value={draft}
                    onChange={setDraft}
                    onSend={() => void handleSend()}
                    sending={sending}
                    placeholder={t("chat.inputPlaceholder")}
                    sendLabel={t("chat.sendAria")}
                    attachLabel={t("chat.attachImage")}
                    emojiLabel={t("chat.emoji")}
                    inputLabel={t("chat.typeMessageAria")}
                    retryLabel={t("chat.retry")}
                    error={sendError}
                    onRetry={() => void handleSend()}
                    pendingImage={
                      pendingImage
                        ? { previewUrl: pendingImage.url, progress: uploadPct, error: attachError }
                        : null
                    }
                    onPickImage={handlePickImage}
                    onRemoveImage={removeImage}
                    onRetryImage={() => void handleSend()}
                    onTyping={notifyTyping}
                    onStopTyping={notifyStop}
                    footer={
                      typingUserIds.length > 0 ? (
                        <div className="px-4 pt-2">
                          <TypingDots label={t("chat.typing")} />
                        </div>
                      ) : null
                    }
                  />
                </>
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
                    <MessageCircle className="size-7 text-slate-300" />
                  </span>
                  <p className="text-sm font-semibold text-slate-700">{t("chat.conversations")}</p>
                  <p className="max-w-xs text-xs leading-5 text-slate-500">
                    {t("chat.emptyDesc")}
                  </p>
                </div>
              )}
            </section>
          </div>
        </div>
      </main>

      <ShopFooter />
    </div>
  );
}
