/**
 * VelCenter — Chat (Company Support / Staff)
 *
 * One component for the three company inboxes:
 *   Customers  — CUSTOMER_COMPANY (plus legacy reserved-shop support rows)
 *   Sellers    — SELLER_COMPANY
 *   Internal   — COMPANY_INTERNAL rooms
 *
 * It owns NO transport and NO second data model. The REST actions live in
 * `api-routes.ts` and hit `routes/center-chat.ts`, which reads the same
 * conversations/messages as the storefront and seller apps. Realtime is the
 * ONE shared socket already mounted by `Center.tsx`; this component only adds
 * event listeners and refetches authoritative state (the socket is delivery,
 * never truth). Every incoming message is deduped by message id.
 */
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@velnox/shared/components/ui/select";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { notifyChatUnreadChanged } from "@velnox/shared/hooks/use-chat-unread";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { formatLocaleTime, formatRelativeTime } from "@velnox/shared/lib/commerce";
import {
  onChatEvent,
  onChatReconnect,
  sendChatCommand,
} from "@velnox/shared/lib/chat-socket";
import { useChatTyping } from "@velnox/shared/lib/chat-typing";
import { TypingDots } from "@velnox/shared/components/chat/typing-dots";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  ArrowLeft,
  Check,
  CheckCheck,
  ChevronRight,
  Headphones,
  Loader2,
  MessageCircle,
  Plus,
  Send,
  Store,
  Users,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

type ChatTab = "customer" | "seller" | "internal";

interface CenterConversation {
  id: string;
  type: "CUSTOMER_COMPANY" | "SELLER_COMPANY" | "COMPANY_INTERNAL";
  legacySupport: boolean;
  title: string | null;
  status: "OPEN" | "ASSIGNED" | "WAITING" | "CLOSED";
  assignedTo: string | null;
  assignedToName: string | null;
  customer: { id: string; name: string | null; avatar: string | null } | null;
  seller: {
    id: string;
    userId: string | null;
    name: string | null;
    avatar: string | null;
    shopName: string | null;
    shopLogo: string | null;
  } | null;
  product: { id: string; name: string | null; price: number | null; imageUrl: string | null } | null;
  lastMessage: string | null;
  lastMessageAt: number | null;
  unreadCount: number;
  updatedAt: number;
}

interface CenterMessage {
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

interface Counts {
  customers: number;
  sellers: number;
  internal: number;
}

const EMPTY_COUNTS: Counts = { customers: 0, sellers: 0, internal: 0 };

const STATUS_META: Record<CenterConversation["status"], { label: string; className: string }> = {
  OPEN: { label: "เปิดใหม่", className: "bg-amber-50 text-amber-700 ring-amber-600/15" },
  ASSIGNED: { label: "รับเรื่องแล้ว", className: "bg-sky-50 text-sky-700 ring-sky-600/15" },
  WAITING: { label: "รอผู้ใช้ตอบ", className: "bg-slate-100 text-slate-600 ring-slate-500/15" },
  CLOSED: { label: "ปิดแล้ว", className: "bg-emerald-50 text-emerald-700 ring-emerald-600/15" },
};

const TAB_META: Record<ChatTab, { label: string; icon: typeof Users; countKey: keyof Counts }> = {
  customer: { label: "ลูกค้า", icon: Users, countKey: "customers" },
  seller: { label: "ผู้ขาย", icon: Store, countKey: "sellers" },
  internal: { label: "ภายใน", icon: MessageCircle, countKey: "internal" },
};

function conversationTitle(c: CenterConversation): string {
  if (c.type === "COMPANY_INTERNAL") return c.title ?? "ห้องภายใน";
  if (c.type === "SELLER_COMPANY") return c.seller?.shopName ?? c.seller?.name ?? "ผู้ขาย";
  return c.customer?.name ?? "ลูกค้า";
}

function conversationSubtitle(c: CenterConversation): string {
  if (c.type === "COMPANY_INTERNAL") return "แชทภายในบริษัท";
  if (c.type === "SELLER_COMPANY") return c.seller?.name ?? "ผู้ขาย";
  return "Velnox Support";
}

export default function ChatManagement() {
  const { user } = useAuth();
  const { lang, t } = useLanguage();
  const userId = user?.id ?? null;

  const listAction = useAction(api.center.chatConversations);
  const unreadAction = useAction(api.center.chatUnread);
  const staffAction = useAction(api.center.chatStaff);
  const messagesAction = useAction(api.center.chatMessages);
  const sendAction = useAction(api.center.sendChatMessage);
  const readAction = useAction(api.center.markChatRead);
  const updateAction = useAction(api.center.updateChatConversation);
  const createRoomAction = useAction(api.center.createInternalConversation);

  const [tab, setTab] = useState<ChatTab>("customer");
  const [items, setItems] = useState<CenterConversation[] | null>(null);
  const [counts, setCounts] = useState<Counts>(EMPTY_COUNTS);
  const [staff, setStaff] = useState<Array<{ id: string; name: string | null; role: string }>>([]);
  const [active, setActive] = useState<CenterConversation | null>(null);
  const [messages, setMessages] = useState<CenterMessage[]>([]);
  const [messagesLoading, setMessagesLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const [newRoom, setNewRoom] = useState("");
  const [creatingRoom, setCreatingRoom] = useState(false);
  const [updating, setUpdating] = useState(false);
  // Ephemeral typing state: throttled on the way out, auto-expired on the way in.
  const { typingUserIds, notifyTyping, notifyStop } = useChatTyping(
    active?.id ?? null,
    userId,
  );

  const scrollRef = useRef<HTMLDivElement>(null);
  const activeIdRef = useRef<string | null>(null);
  const tabRef = useRef<ChatTab>("customer");
  tabRef.current = tab;
  const retryRef = useRef<{ clientId: string; body: string } | null>(null);

  const loadList = useCallback(
    async (which: ChatTab) => {
      setError(false);
      try {
        const res = await listAction({ type: which });
        setItems((res?.items ?? []) as CenterConversation[]);
      } catch (err) {
        console.error("Load company conversations error:", err);
        setError(true);
      }
    },
    [listAction],
  );

  const loadCounts = useCallback(async () => {
    try {
      const res = await unreadAction();
      setCounts({
        customers: Number(res?.customers ?? 0),
        sellers: Number(res?.sellers ?? 0),
        internal: Number(res?.internal ?? 0),
      });
    } catch (err) {
      console.error("Load company unread error:", err);
    }
  }, [unreadAction]);

  useEffect(() => {
    void loadList(tab);
  }, [tab, loadList]);

  useEffect(() => {
    void loadCounts();
    staffAction()
      .then((res) => setStaff((res?.items ?? []) as Array<{ id: string; name: string | null; role: string }>))
      .catch((err) => console.error("Load chat staff error:", err));
  }, [loadCounts, staffAction]);

  const markRead = useCallback(
    async (conversationId: string, upTo?: number) => {
      try {
        await readAction({ conversationId, ...(upTo === undefined ? {} : { upTo }) });
        notifyChatUnreadChanged("center");
      } catch (err) {
        console.error("Mark company chat read failed:", err);
      }
    },
    [readAction],
  );

  const openConversation = useCallback(
    async (conv: CenterConversation) => {
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
        const res = await messagesAction({ conversationId: conv.id });
        const list = (res?.items ?? []) as CenterMessage[];
        setMessages(list);
        setHasMore(!!res?.hasMore);
        setItems((prev) =>
          prev?.map((row) => (row.id === conv.id ? { ...row, unreadCount: 0 } : row)) ?? null,
        );
        const upTo = list.length > 0 ? list[list.length - 1]!.createdAt : undefined;
        void markRead(conv.id, upTo);
      } catch (err) {
        console.error("Load company messages error:", err);
        toast.error("โหลดข้อความไม่สำเร็จ");
      } finally {
        setMessagesLoading(false);
      }
    },
    [messagesAction, markRead],
  );

  // Realtime: the shared socket signals, this surface refetches. Incoming
  // messages are deduped by id; a reconnect re-reads the whole thread.
  useEffect(() => {
    if (!userId) return;
    const offMessage = onChatEvent("chat:message", (data: any) => {
      const message = data?.message as CenterMessage | undefined;
      if (!message) return;
      if (message.conversationId === activeIdRef.current) {
        setMessages((prev) => (prev.some((m) => m.id === message.id) ? prev : [...prev, message]));
        // A SYSTEM message is never unread — no badge, no read round-trip.
        if (message.senderId !== userId && !message.isSystem) void markRead(message.conversationId, message.createdAt);
      }
      // The event is only a signal: re-read both the list (last message /
      // unread) and the tab counts from the server. A conversation the list did
      // not have yet arrives this way too, without inventing a row client-side.
      void loadList(tabRef.current);
      void loadCounts();
    });
    const offRead = onChatEvent("chat:read", (data: any) => {
      if (data?.conversationId !== activeIdRef.current) return;
      // A staff member's own read receipt must never tick their own messages.
      if (userId && data?.readerId === userId) return;
      const upTo = typeof data?.upTo === "number" ? data.upTo : null;
      setMessages((prev) =>
        prev.map((m) =>
          m.senderId === userId &&
          !m.isSystem &&
          m.readAt == null &&
          (upTo === null || m.createdAt <= upTo)
            ? { ...m, readAt: m.readAt ?? Date.now() }
            : m,
        ),
      );
    });
    const offCreated = onChatEvent("chat:conversation", () => {
      void loadList(tabRef.current);
      void loadCounts();
    });
    const offReconnect = onChatReconnect(() => {
      void loadList(tabRef.current);
      void loadCounts();
      const activeId = activeIdRef.current;
      if (!activeId) return;
      messagesAction({ conversationId: activeId })
        .then((res) => {
          setMessages((res?.items ?? []) as CenterMessage[]);
          setHasMore(!!res?.hasMore);
        })
        .catch((err) => console.error("Reload company messages after reconnect failed:", err));
    });
    return () => {
      if (activeIdRef.current) sendChatCommand("chat:viewingEnd", { conversationId: activeIdRef.current });
      offMessage();
      offRead();
      offCreated();
      offReconnect();
    };
  }, [userId, markRead, loadList, loadCounts, messagesAction]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages.length, active?.id]);

  const switchTab = useCallback((next: ChatTab) => {
    if (activeIdRef.current) {
      sendChatCommand("chat:viewingEnd", { conversationId: activeIdRef.current });
      activeIdRef.current = null;
    }
    setActive(null);
    setMessages([]);
    setItems(null);
    setTab(next);
  }, []);

  const closeActive = useCallback(() => {
    if (activeIdRef.current) {
      sendChatCommand("chat:viewingEnd", { conversationId: activeIdRef.current });
      activeIdRef.current = null;
    }
    setActive(null);
    setMessages([]);
  }, []);

  const loadOlder = useCallback(async () => {
    if (!active || loadingMore || messages.length === 0) return;
    const oldest = messages[0];
    if (!oldest) return;
    setLoadingMore(true);
    try {
      const res = await messagesAction({ conversationId: active.id, before: String(oldest.createdAt) });
      const older = (res?.items ?? []) as CenterMessage[];
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        return [...older.filter((m) => !seen.has(m.id)), ...prev];
      });
      setHasMore(!!res?.hasMore);
    } catch (err) {
      console.error("Load older company messages error:", err);
    } finally {
      setLoadingMore(false);
    }
  }, [active, loadingMore, messages, messagesAction]);

  const handleSend = useCallback(async () => {
    if (!active || !userId) return;
    const body = draft.trim();
    if (!body || sending) return;
    const retry = retryRef.current;
    const clientId =
      retry && retry.body === body
        ? retry.clientId
        : `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const temp: CenterMessage = {
      id: `temp-${clientId}`,
      conversationId: active.id,
      senderId: userId,
      senderRole: "company",
      body,
      status: "sent",
      readAt: null,
      createdAt: Date.now(),
    };
    setDraft("");
    // Sending ends the typing state now; the idle timer is only a fallback.
    notifyStop();
    setMessages((prev) => [...prev, temp]);
    setSending(true);
    try {
      const res = await sendAction({ conversationId: active.id, body, clientId });
      retryRef.current = null;
      const saved = res?.message as CenterMessage | undefined;
      if (saved) {
        setMessages((prev) => prev.map((m) => (m.id === temp.id ? saved : m)));
        setItems((prev) =>
          prev?.map((c) =>
            c.id === active.id
              ? {
                  ...c,
                  lastMessage: saved.body,
                  lastMessageAt: saved.createdAt,
                  updatedAt: saved.createdAt,
                  status:
                    c.type === "COMPANY_INTERNAL" ? c.status : c.assignedTo ? "WAITING" : "ASSIGNED",
                  assignedTo: c.assignedTo ?? userId,
                }
              : c,
          ) ?? null,
        );
      }
      void loadCounts();
    } catch (err) {
      console.error("Send company message error:", err);
      toast.error("ส่งข้อความไม่สำเร็จ");
      setMessages((prev) => prev.filter((m) => m.id !== temp.id));
      retryRef.current = { clientId, body };
      setDraft(body);
    } finally {
      setSending(false);
    }
  }, [active, draft, sending, userId, sendAction, loadCounts, notifyStop]);

  const updateConversation = useCallback(
    async (patch: { status?: string; assignedTo?: string | null }) => {
      if (!active) return;
      setUpdating(true);
      try {
        const updated = (await updateAction({ conversationId: active.id, ...patch })) as CenterConversation;
        setActive(updated);
        setItems((prev) => prev?.map((c) => (c.id === updated.id ? updated : c)) ?? null);
        void loadCounts();
      } catch (err) {
        console.error("Update company conversation error:", err);
        toast.error("อัปเดตสถานะไม่สำเร็จ");
      } finally {
        setUpdating(false);
      }
    },
    [active, updateAction, loadCounts],
  );

  const createRoom = useCallback(async () => {
    const title = newRoom.trim();
    if (!title || creatingRoom) return;
    setCreatingRoom(true);
    try {
      const created = (await createRoomAction({ title })) as CenterConversation;
      setNewRoom("");
      setTab("internal");
      await loadList("internal");
      void openConversation(created);
    } catch (err) {
      console.error("Create internal room error:", err);
      toast.error("สร้างห้องไม่สำเร็จ");
    } finally {
      setCreatingRoom(false);
    }
  }, [newRoom, creatingRoom, createRoomAction, loadList, openConversation]);

  const list = items ?? [];
  const tabMeta = TAB_META[tab];

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <MessageCircle className="size-4 text-[#10B981]" />
            velcenter · แชทบริษัท
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900">Chat</h2>
          <p className="mt-1 text-sm text-slate-500">
            ลูกค้า ผู้ขาย และทีมงานภายใน — ใช้ระบบแชทเดียวกับหน้าร้าน
          </p>
        </div>
      </div>

      <div className="flex gap-1 rounded-[12px] border border-slate-200 bg-white p-1">
        {(Object.keys(TAB_META) as ChatTab[]).map((key) => {
          const meta = TAB_META[key];
          const unread = counts[meta.countKey];
          return (
            <button
              key={key}
              type="button"
              onClick={() => switchTab(key)}
              aria-pressed={tab === key}
              className={`flex flex-1 items-center justify-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-semibold transition-colors ${
                tab === key ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <meta.icon className="size-4" />
              {meta.label}
              {unread > 0 && (
                <span
                  className={`flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                    tab === key ? "bg-white text-slate-900" : "bg-[#10B981] text-white"
                  }`}
                >
                  {unread > 99 ? "99+" : unread}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm md:grid md:grid-cols-[340px_1fr]">
        <aside className={`${active ? "hidden md:block" : "block"} max-h-[calc(100dvh-320px)] overflow-y-auto border-slate-200 md:border-r`}>
          <div className="border-b border-slate-100 px-4 py-3">
            <h3 className="text-base font-bold text-slate-900">{tabMeta.label}</h3>
            <p className="mt-0.5 text-xs text-slate-400">
              {tab === "customer"
                ? "บทสนทนาของลูกค้ากับ Velnox — ไม่ใช่แชทส่วนตัวกับผู้ขาย"
                : tab === "seller"
                  ? "ผู้ขายติดต่อบริษัทโดยตรง"
                  : "ห้องแชทที่เห็นเฉพาะทีมงานบริษัท"}
            </p>
          </div>

          {tab === "internal" && (
            <div className="flex gap-2 border-b border-slate-100 px-3 py-2.5">
              <input
                value={newRoom}
                onChange={(e) => setNewRoom(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    void createRoom();
                  }
                }}
                placeholder="ชื่อห้องใหม่ เช่น General"
                maxLength={80}
                className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white"
              />
              <Button
                type="button"
                onClick={() => void createRoom()}
                disabled={!newRoom.trim() || creatingRoom}
                className="h-8 gap-1 rounded-lg bg-slate-900 px-3 text-xs text-white hover:bg-slate-800"
              >
                {creatingRoom ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
                สร้าง
              </Button>
            </div>
          )}

          {items === null ? (
            <div className="space-y-2 p-4">
              <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : error ? (
            <div className="px-6 py-14 text-center">
              <MessageCircle className="mx-auto size-7 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">โหลดบทสนทนาไม่สำเร็จ</p>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => void loadList(tab)}
              >
                ลองอีกครั้ง
              </Button>
            </div>
          ) : list.length === 0 ? (
            <div className="px-6 py-14 text-center">
              <MessageCircle className="mx-auto size-7 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-600">
                {tab === "customer"
                  ? "ยังไม่มีลูกค้าติดต่อบริษัท"
                  : tab === "seller"
                    ? "ยังไม่มีผู้ขายติดต่อบริษัท"
                    : "ยังไม่มีห้องแชทภายใน"}
              </p>
              <p className="mt-1 text-xs leading-5 text-slate-400">
                {tab === "internal"
                  ? "สร้างห้องด้านบนเพื่อเริ่มคุยกับทีมงาน"
                  : "เมื่อมีข้อความใหม่ บทสนทนาจะปรากฏที่นี่ทันที"}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {list.map((c) => {
                const title = conversationTitle(c);
                const status = STATUS_META[c.status] ?? STATUS_META.OPEN;
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => void openConversation(c)}
                    className={`flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors hover:bg-slate-50 ${
                      active?.id === c.id ? "bg-[#F0FDF9]" : ""
                    }`}
                  >
                    <span className="relative mt-0.5 shrink-0">
                      {c.type === "COMPANY_INTERNAL" ? (
                        <span className="flex size-10 items-center justify-center rounded-full bg-slate-900 text-white">
                          <Users className="size-4" />
                        </span>
                      ) : c.type === "SELLER_COMPANY" ? (
                        c.seller?.shopLogo ? (
                          <img src={c.seller.shopLogo} alt="" className="size-10 rounded-full object-cover" />
                        ) : (
                          <span className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-slate-500">
                            <Store className="size-4" />
                          </span>
                        )
                      ) : c.customer?.avatar ? (
                        <img src={c.customer.avatar} alt="" className="size-10 rounded-full object-cover" />
                      ) : (
                        <span className="flex size-10 items-center justify-center rounded-full bg-slate-100 text-sm font-semibold text-slate-400">
                          {(title || "?").charAt(0).toUpperCase()}
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
                        <span className="shrink-0 text-[10px] text-slate-400">
                          {formatRelativeTime(c.lastMessageAt, lang, t)}
                        </span>
                      </span>
                      <span className={`mt-0.5 block truncate text-xs ${c.unreadCount > 0 ? "font-medium text-slate-700" : "text-slate-400"}`}>
                        {c.lastMessage ?? "—"}
                      </span>
                      <span className="mt-1 flex items-center gap-1.5">
                        <span className={`rounded-full px-1.5 py-0.5 text-[9px] font-semibold ring-1 ring-inset ${status.className}`}>
                          {status.label}
                        </span>
                        {c.assignedToName && (
                          <span className="truncate text-[9px] text-slate-400">{c.assignedToName}</span>
                        )}
                      </span>
                    </span>
                    <ChevronRight className="mt-1 size-4 shrink-0 text-slate-300" />
                  </button>
                );
              })}
            </div>
          )}
        </aside>

        <section className={`${active ? "flex" : "hidden md:flex"} h-[calc(100dvh-320px)] min-h-[460px] flex-col`}>
          {!active ? (
            <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
              <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
                <Headphones className="size-7 text-slate-300" />
              </span>
              <p className="mt-4 text-sm font-medium text-slate-600">เลือกบทสนทนา</p>
              <p className="mt-1 text-xs text-slate-400">อ่านและตอบได้จากที่นี่</p>
            </div>
          ) : (
            <>
              <div className="border-b border-slate-100 px-4 py-3">
                <div className="flex items-start gap-2">
                  <button
                    type="button"
                    onClick={closeActive}
                    className="flex size-9 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 md:hidden"
                    aria-label="กลับ"
                  >
                    <ArrowLeft className="size-4" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold text-slate-900">{conversationTitle(active)}</p>
                    <p className="truncate text-[11px] text-slate-400">{conversationSubtitle(active)}</p>
                  </div>
                  {active.type !== "COMPANY_INTERNAL" && (
                    <Badge className={`shrink-0 rounded-full ring-1 ring-inset ${STATUS_META[active.status].className}`}>
                      {STATUS_META[active.status].label}
                    </Badge>
                  )}
                </div>

                {active.type !== "COMPANY_INTERNAL" && (
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Select
                      value={active.status}
                      onValueChange={(value) => void updateConversation({ status: value })}
                      disabled={updating}
                    >
                      <SelectTrigger className="h-8 w-[145px] rounded-lg text-xs">
                        <SelectValue placeholder="สถานะ" />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(STATUS_META) as Array<CenterConversation["status"]>).map((status) => (
                          <SelectItem key={status} value={status}>
                            {STATUS_META[status].label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select
                      value={active.assignedTo ?? "unassigned"}
                      onValueChange={(value) =>
                        void updateConversation({ assignedTo: value === "unassigned" ? null : value })
                      }
                      disabled={updating}
                    >
                      <SelectTrigger className="h-8 w-[190px] rounded-lg text-xs">
                        <SelectValue placeholder="ผู้รับผิดชอบ" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="unassigned">ยังไม่มอบหมาย</SelectItem>
                        {staff.map((member) => (
                          <SelectItem key={member.id} value={member.id}>
                            {member.name ?? member.id.slice(0, 8)}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {updating && <Loader2 className="size-3.5 animate-spin text-slate-400" />}
                  </div>
                )}
              </div>

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
                    <span className="block truncate text-xs font-semibold text-slate-900">
                      {active.product.name ?? "สินค้า"}
                    </span>
                    <span className="block text-[10px] text-slate-400">บริบทสินค้าของบทสนทนา</span>
                  </span>
                </div>
              )}

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
                        <p className="mt-1 text-xs text-slate-400">เริ่มบทสนทนาได้จากช่องด้านล่าง</p>
                      </div>
                    ) : (
                      messages.map((m) => {
                        // System message (daily support acknowledgment): centred,
                        // muted and never carries a read tick.
                        if (m.isSystem) {
                          return (
                            <div key={m.id} className="flex justify-center">
                              <div className="max-w-[86%] rounded-2xl border border-dashed border-slate-200 bg-white px-3.5 py-2.5 text-center text-xs leading-5 text-slate-500">
                                <p className="whitespace-pre-line break-words">{m.body}</p>
                                <p className="mt-1 text-[10px] text-slate-400">
                                  {formatLocaleTime(m.createdAt, lang)}
                                </p>
                              </div>
                            </div>
                          );
                        }
                        const mine = m.senderId === userId;
                        return (
                          <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                            <div
                              className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm leading-6 ${
                                mine
                                  ? "rounded-br-md bg-[#10B981] text-white"
                                  : "rounded-bl-md border border-slate-200 bg-slate-50 text-slate-800"
                              }`}
                            >
                              <p className="whitespace-pre-line break-words">{m.body}</p>
                              <p className={`mt-1 flex items-center gap-1 text-[10px] ${mine ? "text-emerald-50/80" : "text-slate-400"}`}>
                                <span>{formatLocaleTime(m.createdAt, lang)}</span>
                                {/* ✓ = stored by the server; ✓✓ = the other side read it. */}
                                {mine &&
                                  (m.readAt != null ? (
                                    <CheckCheck
                                      role="img"
                                      aria-label={t("chat.read")}
                                      className="size-3 text-sky-200"
                                    />
                                  ) : (
                                    <Check
                                      role="img"
                                      aria-label={t("chat.sent")}
                                      className="size-3 text-emerald-50/70"
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
                    <TypingDots label={t("chat.typing")} />
                  </div>
                )}
              </div>

              <div className="flex items-center gap-2 border-t border-slate-100 p-3">
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
                    placeholder="พิมพ์ข้อความ..."
                  aria-label="พิมพ์ข้อความ"
                  maxLength={4000}
                  className="min-w-0 flex-1 rounded-full border border-slate-200 bg-slate-50 px-4 py-2.5 text-sm text-slate-900 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-500 focus:bg-white focus:ring-2 focus:ring-emerald-500/20"
                />
                <Button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={!draft.trim() || sending}
                  className="size-11 shrink-0 rounded-full bg-[#10B981] p-0 text-white hover:bg-[#059669]"
                  aria-label="ส่งข้อความ"
                >
                  {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                </Button>
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
