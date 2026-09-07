import { AppHeader } from "@velnox/shared/components/AppHeader";
import { Button } from "@velnox/shared/components/ui/button";
import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { formatBaht } from "@velnox/shared/lib/commerce";
import { connectChatSocket, disconnectChatSocket, onChatEvent } from "@velnox/shared/lib/chat-socket";
import {
  ArrowLeft,
  CheckCheck,
  ChevronRight,
  Loader2,
  MessageCircle,
  Send,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface Conversation {
  id: string;
  customerId: string;
  sellerId: string;
  shopId: string;
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
  senderId: string;
  senderRole: "customer" | "seller";
  body: string;
  status: string;
  readAt: number | null;
  createdAt: number;
}

function timeLabel(ts: number | null): string {
  if (!ts) return "";
  const diff = Date.now() - ts;
  if (diff < 60_000) return "เมื่อสักครู่";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} นาที`;
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  const sameDay = (a: Date, b: Date) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  if (sameDay(d, today)) return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (sameDay(d, yesterday)) return "เมื่อวาน";
  return d.toLocaleDateString([], { day: "numeric", month: "short" });
}

export default function SellerChat() {
  const { user, isAuthenticated } = useAuth();
  const myConversations = useAction(api.seller.sellerConversations);
  const conversationMessages = useAction(api.seller.sellerConversationMessages);
  const sendMessage = useAction(api.seller.sendSellerMessageAction);
  const markConversationRead = useAction(api.seller.markSellerConversationReadAction);

  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [active, setActive] = useState<Conversation | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);

  const loadConversations = useCallback(async () => {
    try {
      const res = await myConversations();
      setConversations((res ?? []) as Conversation[]);
    } catch (err) {
      console.error("Load conversations error:", err);
      setConversations([]);
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
      offMessage();
      offRead();
      disconnectChatSocket();
    };
  }, [isAuthenticated, user?.id, markConversationRead]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length, active?.id]);

  const openConversation = useCallback(
    async (conv: Conversation) => {
      setActive(conv);
      activeIdRef.current = conv.id;
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
        toast.error("โหลดข้อความไม่สำเร็จ");
      } finally {
        setMessagesLoading(false);
      }
    },
    [conversationMessages, markConversationRead],
  );

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
    const clientId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
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
      toast.error("ส่งข้อความไม่สำเร็จ กรุณาลองอีกครั้ง");
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
    } finally {
      setSending(false);
    }
  }, [active, draft, sending, user?.id, sendMessage]);

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <AppHeader />

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
        <div className="mb-4">
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <MessageCircle className="size-4 text-[#10B981]" />
            velseller · แชทกับลูกค้า
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">แชท</h1>
          <p className="mt-1.5 text-sm text-slate-500">ตอบข้อความจากลูกค้าที่สอบถามสินค้าในร้านของคุณ</p>
        </div>

        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid md:grid-cols-[320px_1fr]">
          {/* ── Conversation list ─────────────────────────────────── */}
          <aside className={`${active ? "hidden md:block" : "block"} max-h-[calc(100dvh-260px)] overflow-y-auto border-slate-200 md:border-r`}>
            <div className="border-b border-slate-100 px-4 py-3">
              <h2 className="text-base font-bold text-slate-900">การสนทนา</h2>
            </div>
            {conversations === null ? (
              <div className="space-y-2 p-4">
                <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
                <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
                <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="px-6 py-14 text-center">
                <MessageCircle className="mx-auto size-7 text-slate-300" />
                <p className="mt-3 text-sm font-medium text-slate-600">ยังไม่มีข้อความ</p>
                <p className="mt-1 text-xs leading-5 text-slate-400">เมื่อลูกค้ากด "แชทกับร้านค้า" การสนทนาจะมาแสดงที่นี่</p>
              </div>
            ) : (
              <div className="divide-y divide-slate-100">
                {conversations.map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => void openConversation(c)}
                    className={`flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 ${active?.id === c.id ? "bg-[#F0FDF9]" : ""}`}
                  >
                    <span className="relative shrink-0">
                      {c.participantAvatar ? (
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
                        <span className="truncate text-sm font-semibold text-slate-900">{c.participantName ?? "ลูกค้า"}</span>
                        <span className="shrink-0 text-[10px] text-slate-400">{timeLabel(c.lastMessageAt)}</span>
                      </span>
                      <span className={`mt-0.5 block truncate text-xs ${c.unreadCount > 0 ? "font-medium text-slate-700" : "text-slate-400"}`}>
                        {c.lastMessage ?? "—"}
                      </span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-slate-300" />
                  </button>
                ))}
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
                <p className="mt-4 text-sm font-medium text-slate-600">เลือกการสนทนาเพื่อตอบลูกค้า</p>
              </div>
            ) : (
              <>
                {/* Header */}
                <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
                  <button type="button" onClick={() => setActive(null)} className="flex size-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 md:hidden" aria-label="กลับ">
                    <ArrowLeft className="size-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{active.participantName ?? "ลูกค้า"}</p>
                    {active.product && <p className="truncate text-[11px] text-slate-400">สอบถามเกี่ยวกับสินค้า</p>}
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
                      กำลังโหลดข้อความ...
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
                          โหลดข้อความก่อนหน้า
                        </button>
                      )}
                      {messages.length === 0 ? (
                        <div className="py-12 text-center">
                          <p className="text-sm text-slate-500">ยังไม่มีข้อความ</p>
                          <p className="mt-1 text-xs text-slate-400">เริ่มต้นการสนทนาได้เลย</p>
                        </div>
                      ) : (
                        messages.map((m) => {
                          const mine = m.senderId === user?.id;
                          return (
                            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                              <div className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${mine ? "rounded-br-md bg-slate-900 text-white" : "rounded-bl-md border border-slate-200 bg-slate-50 text-slate-800"}`}>
                                <p className="whitespace-pre-line break-words">{m.body}</p>
                                <p className={`mt-1 flex items-center gap-1 text-[10px] ${mine ? "text-slate-400" : "text-slate-400"}`}>
                                  {new Date(m.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                  {mine && <CheckCheck className={`size-3 ${m.status === "read" ? "text-sky-400" : ""}`} />}
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
                    placeholder="พิมพ์ข้อความ..."
                    aria-label="พิมพ์ข้อความ"
                    maxLength={4000}
                    className="min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
                  />
                  <Button
                    type="button"
                    onClick={() => void handleSend()}
                    disabled={!draft.trim() || sending}
                    className="size-11 shrink-0 gap-1.5 rounded-full bg-[#10B981] p-0 text-white hover:bg-[#059669]"
                    aria-label="ส่งข้อความ"
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