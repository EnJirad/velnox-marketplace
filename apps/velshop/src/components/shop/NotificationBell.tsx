import { useLanguage } from "@/lib/i18n";
import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { formatRelativeTime } from "@velnox/shared/lib/commerce";
import { connectChatSocket, disconnectChatSocket, onChatEvent } from "@velnox/shared/lib/chat-socket";
import {
  Bell,
  BellRing,
  CheckCheck,
  ChevronRight,
  CreditCard,
  Loader2,
  Package,
  RotateCcw,
  Sparkles,
  Truck,
  type LucideIcon,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string | null;
  isRead: boolean;
  createdAt: number;
  data: { conversationId?: string; orderId?: string; productId?: string } | null;
}

const TYPE_ICONS: Record<string, LucideIcon> = {
  order: Package,
  payment: CreditCard,
  shipping: Truck,
  return: RotateCcw,
  refund: RotateCcw,
  promotion: Sparkles,
  system: BellRing,
  chat: BellRing,
  seller: Package,
};

/** Map a notification's payload to a real destination (or null when none exists). */
function notificationDestination(n: NotificationRow): string | null {
  if (n.data?.conversationId) return `/chat?conv=${encodeURIComponent(n.data.conversationId)}`;
  if (n.data?.orderId) return `/orders/${encodeURIComponent(n.data.orderId)}`;
  if (n.data?.productId) return `/products/${encodeURIComponent(n.data.productId)}`;
  return null;
}

/**
 * NotificationBell — header bell + floating panel.
 *
 * Real data only: the unread badge is derived from the backend notifications
 * list (GET /api/customer/notifications), refreshed on mount, on realtime
 * `notification:created`, and every time the panel opens. Clicking an item
 * marks it read and navigates to its real destination when one exists.
 * Not signed in → renders nothing.
 */
export function NotificationBell() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const myNotifications = useAction(api.customer.myNotifications);
  const markRead = useAction(api.customer.markNotificationReadAction);
  const markAll = useAction(api.customer.markAllNotificationsRead);

  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await myNotifications();
      setItems((res.items ?? []) as NotificationRow[]);
    } catch (err) {
      console.error("[notification-bell] load error:", err);
      setItems([]);
    }
  }, [myNotifications]);

  // Initial load + realtime refresh while authenticated.
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    void load();
    connectChatSocket(user.id);
    const off = onChatEvent("notification:created", () => {
      void load();
    });
    return () => {
      off();
      disconnectChatSocket();
    };
  }, [isAuthenticated, user?.id, load]);

  // Refresh whenever the panel opens so the badge/list is never stale.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!isAuthenticated) return null;

  const unread = items?.filter((n) => !n.isRead).length ?? 0;

  const handleOpen = () => {
    setOpen((v) => !v);
  };

  const handleItemClick = async (n: NotificationRow) => {
    if (!n.isRead) {
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)) ?? null);
      try {
        await markRead({ notificationId: n.id });
      } catch (err) {
        console.error("[notification-bell] mark read error:", err);
      }
    }
    const dest = notificationDestination(n);
    setOpen(false);
    if (dest) navigate(dest);
  };

  const handleMarkAll = async () => {
    setLoading(true);
    try {
      await markAll();
      setItems((prev) => prev?.map((x) => ({ ...x, isRead: true })) ?? null);
    } catch (err) {
      console.error("[notification-bell] mark all error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={handleOpen}
        aria-label={
          unread > 0
            ? t("notifications.ariaOpenWithCount", { count: unread })
            : t("notifications.ariaOpen")
        }
        aria-haspopup="true"
        aria-expanded={open}
        className="relative flex size-10 cursor-pointer items-center justify-center rounded-[10px] text-slate-600 transition-colors hover:bg-slate-100"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute right-0 top-0 flex size-5 items-center justify-center rounded-full bg-[#10B981] text-[11px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("notifications.title")}
          className="absolute right-0 top-full z-50 mt-2 w-[min(360px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.14)]"
        >
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <Bell className="size-4 text-[#10B981]" />
              {t("notifications.title")}
            </p>
            <Link
              to="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center gap-0.5 text-xs font-medium text-[#10B981] transition-colors hover:text-[#059669]"
            >
              {t("notifications.viewAll")}
              <ChevronRight className="size-3" />
            </Link>
          </div>

          {/* Body */}
          {items === null ? (
            <div className="space-y-2 p-4">
              <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-slate-100">
                <BellRing className="size-5 text-slate-400" />
              </span>
              <p className="mt-3 text-sm font-semibold text-slate-900">{t("notifications.emptyTitle")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">{t("notifications.allCaughtUp")}</p>
            </div>
          ) : (
            <div className="max-h-[min(60vh,420px)] overflow-y-auto">
              <div className="divide-y divide-slate-100">
                {items.slice(0, 8).map((n) => {
                  const Icon = TYPE_ICONS[n.type] ?? BellRing;
                  return (
                    <button
                      key={n.id}
                      type="button"
                      onClick={() => void handleItemClick(n)}
                      className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-slate-50 ${
                        n.isRead ? "" : "bg-[#F0FDF9]"
                      }`}
                    >
                      <span
                        className={`mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-[10px] ${
                          n.isRead ? "bg-slate-100 text-slate-400" : "bg-[#10B981] text-white"
                        }`}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-semibold text-slate-900">{n.title}</span>
                        {n.message && (
                          <span className="mt-0.5 line-clamp-2 block text-xs leading-5 text-slate-500">{n.message}</span>
                        )}
                        <span className="mt-0.5 block text-[11px] text-slate-400">
                          {formatRelativeTime(n.createdAt, lang, t)}
                        </span>
                      </span>
                      {!n.isRead && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[#10B981]" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Footer */}
          {unread > 0 && (
            <div className="border-t border-slate-100 px-3 py-2">
              <button
                type="button"
                onClick={() => void handleMarkAll()}
                disabled={loading}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                {loading ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
                {t("notifications.markAll")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}