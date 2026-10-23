import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { formatBaht, formatLocaleTime, formatRelativeTime } from "@velnox/shared/lib/commerce";
import { connectChatSocket, disconnectChatSocket, onChatEvent, sendChatCommand } from "@velnox/shared/lib/chat-socket";
import { Button } from "@velnox/shared/components/ui/button";
import {
  ArrowLeft,
  CheckCheck,
  ChevronRight,
  Headphones,
  Loader2,
  MessageCircle,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { toast } from "sonner";

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <p className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
      {children}
    </p>
  );
}

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
  product: { id: string; name: string | null; price: number | null; imageUrl: string | null } | null;
  lastMessage: string | null;
  lastMessageAt: number | null;
  unreadCount: number;
  updatedAt: number;
}

interface ChatMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderRole: "customer" | "seller";
  body: string;
  status: string;
  readAt: number | null;
  createdAt: number;
}

const MESSAGES_PAGE = 30;

export default function ShopChat() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user, isAuthenticated } = useAuth();
  const myConversations = useAction(api.customer.myConversations);
  const createConversation = useAction(api.customer.createConversationAction);
  const supportConversationAction = useAction(api.customer.supportConversationAction);
  const conversationMessages = useAction(api.customer.conversationMessages);
  const sendMessage = useAction(api.customer.sendMessageAction);
  const markConversationRead = useAction(api.customer.markConversationReadAction);

  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);
  messagesRef.current = messages;

  // ── Load conversation list ──────────────────────────────────────────
  const loadConversations = useCallback(async () => {
    try {
      const res = await myConversations();
      setConversations((res ?? []) as Conversation[]);
    } catch (err) {
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
      // Update the conversation list (last message / unread)
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
                  unreadCount: message.senderId === user.id ? c.unreadCount : c.unreadCount + 1,
                }
              : c,
          )
          .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      });
      // Append to the open thread if it matches, and the sender isn't us
      if (message.conversationId === activeIdRef.current && message.senderId !== user.id) {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
        void markConversationRead({ conversationId: message.conversationId });
        setConversations((prev) => prev?.map((c) => (c.id === message.conversationId ? { ...c, unreadCount: 0 } : c)) ?? null);
      }
    });
    const offRead = onChatEvent("chat:read", (data: any) => {
      if (data?.conversationId === activeIdRef.current) {
        setMessages((prev) => prev.map((m) => (m.senderId === user.id && m.readAt == null ? { ...m, status: "read", readAt: Date.now() } : m)));
      }
    });
    return () => {
      if (activeIdRef.current) sendChatCommand("chat:viewingEnd", { conversationId: activeIdRef.current });
      offMessage();
      offRead();
      disconnectChatSocket();
    };
  }, [isAuthenticated, user?.id, markConversationRead]);

  // ── Scroll to bottom on new messages ────────────────────────────────
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, active?.id]);

  // ── Open a conversation thread ──────────────────────────────────────
  const supportConvs = conversations?.filter((c) => c.isSupport) ?? [];
  const sellerConvs = conversations?.filter((c) => !c.isSupport) ?? [];

  const convRow = (c: Conversation, support: boolean) => (
    <button
      key={c.id}
      type="button"
      onClick={() => void openConversation(c)}
      className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 ${
        active?.id === c.id ? "bg-[#F0FDF9]" : ""
      }`}
    >
      <span className="relative shrink-0">
        {support ? (
          <span className="flex size-11 items-center justify-center rounded-full bg-[#10B981] text-white">
            <Headphones className="size-5" />
          </span>
        ) : c.shopLogo ? (
          <img src={c.shopLogo} alt="" className="size-11 rounded-full object-cover" />
        ) : (
          <span className="flex size-11 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-400">
            {(c.shopName ?? "?").charAt(0).toUpperCase()}
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
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-sm font-semibold text-slate-900">
              {support ? t("chat.supportTitle") : c.shopName}
            </span>
            {support && (
              <span className="shrink-0 rounded-full bg-[#ECFDF5] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-emerald-700">
                {t("chat.supportBadge")}
              </span>
            )}
          </span>
          <span className="shrink-0 text-[10px] text-slate-400">
            {formatRelativeTime(c.lastMessageAt, lang, t)}
          </span>
        </span>
        <span
          className={`mt-0.5 block truncate text-xs ${
            c.unreadCount > 0 ? "font-medium text-slate-700" : "text-slate-400"
          }`}
        >
          {c.lastMessage ?? "—"}
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-slate-300" />
    </button>
  );

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
        setMessages((res.items ?? []) as ChatMessage[]);
        setHasMore(!!res.hasMore);
        setConversations((prev) => prev?.map((c) => (c.id === conv.id ? { ...c, unreadCount: 0 } : c)) ?? null);
        void markConversationRead({ conversationId: conv.id });
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

  // ── Send a message (optimistic + dedupe by clientId) ────────────────
  const handleSend = useCallback(async () => {
    if (!active || !user?.id) return;
    const body = draft.trim();
    if (!body || sending) return;
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const temp: ChatMessage = {
      id: `temp-${clientId}`,
      conversationId: active.id,
      senderId: user.id,
      senderRole: "customer",
      body,
      status: "sent",
      readAt: null,
      createdAt: Date.now(),
    };
    setDraft("");
    setMessages((prev) => [...prev, temp]);
    setSending(true);
    try {
      const res = await sendMessage({ conversationId: active.id, body, clientId });
      const saved = res?.message as ChatMessage | undefined;
      if (saved) {
        setMessages((prev) => prev.map((m) => (m.id === temp.id ? saved : m)));
        setConversations((prev) => prev?.map((c) => (c.id === active.id ? { ...c, lastMessage: saved.body, lastMessageAt: saved.createdAt, updatedAt: saved.createdAt } : c)) ?? null);
      }
    } catch (err) {
      console.error("Send message error:", err);
      toast.error(t("chat.sendError"));
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
    } finally {
      setSending(false);
    }
  }, [active, draft, sending, user?.id, sendMessage, t]);

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

      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4 flex items-center gap-2">
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <MessageCircle className="size-4 text-[#10B981]" />
            {t("chat.eyebrow")}
          </p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid md:grid-cols-[320px_1fr]">
          {/* ── Conversation list ─────────────────────────────────── */}
          <aside className={`${active ? "hidden md:block" : "block"} max-h-[calc(100dvh-220px)] overflow-y-auto border-slate-200 md:border-r`}>
            <div className="border-b border-slate-100 px-4 py-3">
              <h1 className="text-lg font-bold tracking-tight text-slate-900">{t("chat.title")}</h1>
            </div>
            {conversations === null ? (
              <div className="space-y-2 p-4">
                <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
                <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
                <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
              </div>
            ) : (
              <div className="pb-2">
                {/* Velnox Support — dedicated section, never mixed with sellers */}
                {supportConvs.length > 0 ? (
                  <>
                    <SectionLabel>{t("chat.supportTitle")}</SectionLabel>
                    <div className="border-b border-slate-100">
                      {supportConvs.map((c) => convRow(c, true))}
                    </div>
                  </>
                ) : (
                  <div className="border-b border-slate-100 px-4 py-3.5">
                    <button
                      type="button"
                      onClick={() => void startSupport()}
                      className="flex w-full items-center gap-3 rounded-xl border border-[#10B981]/25 bg-[#F0FDF9] px-3.5 py-3 text-left transition-colors hover:border-[#10B981]/50 hover:bg-[#D1FAE5]"
                    >
                      <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-[#10B981] text-white">
                        <Headphones className="size-5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold text-slate-900">{t("chat.supportTitle")}</span>
                        <span className="mt-0.5 block text-xs leading-5 text-slate-500">{t("chat.chatWithSupport")}</span>
                      </span>
                      <ChevronRight className="size-4 shrink-0 text-slate-300" />
                    </button>
                  </div>
                )}

                {/* Sellers — customer's shop conversations */}
                <SectionLabel>{t("chat.sellers")}</SectionLabel>
                {sellerConvs.length === 0 ? (
                  <div className="px-6 py-10 text-center">
                    <MessageCircle className="mx-auto size-7 text-slate-300" />
                    <p className="mt-3 text-sm font-medium text-slate-600">{t("chat.emptyTitle")}</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">{t("chat.emptyDesc")}</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100">
                    {sellerConvs.map((c) => convRow(c, false))}
                  </div>
                )}
              </div>
            )}
          </aside>

          {/* ── Thread ────────────────────────────────────────────── */}
          <section className={`${active ? "flex" : "hidden md:flex"} h-[calc(100dvh-220px)] min-h-[420px] flex-col`}>
            {!active ? (
              <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
                <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
                  <MessageCircle className="size-7 text-slate-300" />
                </span>
                <p className="mt-4 text-sm font-medium text-slate-600">{t("chat.conversations")}</p>
                <p className="mt-1 text-xs text-slate-400">{t("chat.emptyDesc")}</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                  <button type="button" onClick={closeActive} className="flex size-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 md:hidden" aria-label={t("chat.back")}>
                    <ArrowLeft className="size-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    {active.isSupport ? (
                      <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-900">
                        <Headphones className="size-4 text-[#10B981]" />
                        {t("chat.supportTitle")}
                        <span className="rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[10px] font-semibold text-emerald-700">
                          {t("chat.supportBadge")}
                        </span>
                      </p>
                    ) : (
                      <p className="truncate text-sm font-semibold text-slate-900">{active.shopName}</p>
                    )}
                    {active.isSupport ? (
                      <p className="truncate text-[11px] text-slate-400">{t("chat.supportDesc")}</p>
                    ) : (
                      active.product && (
                        <p className="truncate text-[11px] text-slate-400">{t("chat.productContext")}</p>
                      )
                    )}
                  </div>
                </div>

                {/* Product context */}
                {active.product && (
                  <button
                    type="button"
                    onClick={() => navigate(`/products/${active.product!.id}`)}
                    className="mx-3 mt-3 flex items-center gap-3 rounded-xl border border-slate-200 bg-slate-50 p-2.5 text-left transition-colors hover:border-slate-300"
                  >
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
                    <ChevronRight className="size-4 shrink-0 text-slate-300" />
                  </button>
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
                          const mine = m.senderId === user?.id;
                          return (
                            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                              <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${mine ? "rounded-br-md bg-[#10B981] text-white" : "rounded-bl-md border border-slate-200 bg-slate-50 text-slate-800"}`}>
                                <p className="whitespace-pre-line break-words">{m.body}</p>
                                <p className={`mt-1 flex items-center gap-1 text-[10px] ${mine ? "text-emerald-50/80" : "text-slate-400"}`}>
                                  {formatLocaleTime(m.createdAt, lang)}
                                  {mine && <CheckCheck className={`size-3 ${m.status === "read" ? "text-sky-200" : ""}`} />}
                                </p>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </>
                  )}
                </div>

                {/* Composer */}
                <div className="flex items-center gap-2 border-t border-slate-100 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                  <input
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
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

      <ShopFooter />
    </div>
  );
}