/**
 * SellerNotificationBell — VelSeller header bell + panel.
 *
 * ONE notification system. This renders rows from the existing `notifications`
 * table through the existing endpoints:
 *
 *   GET   /api/customer/notifications          (scoped to the session user)
 *   PATCH /api/customer/notifications/:id/read (ownership enforced in SQL)
 *   PUT   /api/customer/notifications/read-all
 *
 * The server derives the user from the httpOnly session cookie — no user id is
 * ever taken from the client — so a seller can only read/mark their own rows.
 * There is no seller-specific notification API and none is needed: a seller IS a
 * user, and the routes in `backend/routes/chat.ts` are already user-scoped.
 *
 * VelCenter correction requests (`seller_verification_needs_correction`) render
 * the reviewer's structured reason through the shared `reviewReason.*` vocabulary
 * and link into the seller's own verification flow
 * (`/seller/shop?verification=<verificationId>`), so the seller lands on the case
 * that must be fixed. The identifier only selects which flow to open; ownership
 * is enforced by the backend when the wizard loads its evidence.
 *
 * Freshness: the reviewer action pushes `notification:created` over the existing
 * socket fan-out (`sendToUser` + CHANNELS.NOTIFICATION_CREATED). We also refresh
 * when the panel opens and poll every 60s, so a dropped socket can never hide a
 * correction request.
 */
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { connectChatSocket, onChatEvent } from "@velnox/shared/lib/chat-socket";
import { formatRelativeTime } from "@velnox/shared/lib/commerce";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { REVIEW_REASON_CODES, reasonCodeKey } from "@velnox/shared/lib/verification-reasons";
import { AlertTriangle, Bell, BellRing, CheckCheck, Loader2, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router";

const POLL_MS = 60_000;

/** Payload the backend attaches to a notification (see backend/routes/verification.ts). */
interface NotificationData {
  verificationId?: string;
  action?: string;
  reasonCode?: string | null;
  reason?: string | null;
  orderId?: string;
  conversationId?: string;
  productId?: string;
}

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string | null;
  isRead: boolean;
  createdAt: number;
  data: NotificationData | null;
}

/** Icon per notification family — seller-facing set (no customer checkout types). */
function iconFor(type: string) {
  if (type === "seller_verification_needs_correction") return AlertTriangle;
  if (type.startsWith("seller_verification")) return ShieldCheck;
  if (type === "chat") return BellRing;
  return Bell;
}

/** Localized label for the reviewer's structured reason code, when present. */
function reasonLabel(t: (key: string) => string, code?: string | null): string | null {
  if (!code || !(REVIEW_REASON_CODES as string[]).includes(code)) return null;
  return t(reasonCodeKey(code as Parameters<typeof reasonCodeKey>[0]));
}

/**
 * Where a seller notification leads. Verification notifications carry the
 * `verificationId` so the wizard opens the right case; a `needs_correction`
 * request additionally flags the correction state.
 */
function destinationFor(n: NotificationRow): string | null {
  const d = n.data ?? {};
  if (d.verificationId) {
    const base = `/seller/shop?verification=${encodeURIComponent(d.verificationId)}`;
    return d.action === "needs_correction" ? `${base}&correction=1` : base;
  }
  if (d.orderId) return "/seller/orders";
  if (d.conversationId) return "/seller/chat";
  if (d.productId) return "/seller/shop";
  return null;
}

export function SellerNotificationBell() {
  const { t, lang } = useLanguage();
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const myNotifications = useAction(api.customer.myNotifications);
  const markRead = useAction(api.customer.markNotificationReadAction);
  const markAll = useAction(api.customer.markAllNotificationsRead);

  const [items, setItems] = useState<NotificationRow[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await myNotifications();
      setItems(((res as { items?: NotificationRow[] })?.items ?? []) as NotificationRow[]);
    } catch (err) {
      console.error("[seller-notification-bell] load error:", err);
      setItems([]);
    }
  }, [myNotifications]);

  // Initial load + realtime. The socket is a shared singleton also used by the
  // seller chat page, so we deliberately never close it here — only unsubscribe.
  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    void load();
    connectChatSocket(user.id);
    const off = onChatEvent("notification:created", () => {
      void load();
    });
    return () => {
      off();
    };
  }, [isAuthenticated, user?.id, load]);

  // Polling fallback — the correction request must surface even if the socket
  // never connects (proxy/firewall) or the tab slept through the push.
  useEffect(() => {
    if (!isAuthenticated) return;
    const timer = setInterval(() => {
      void load();
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [isAuthenticated, load]);

  // Never show a stale badge: refresh whenever the panel opens.
  useEffect(() => {
    if (open) void load();
  }, [open, load]);

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

  const handleItemClick = async (n: NotificationRow) => {
    if (!n.isRead) {
      setItems((prev) => prev?.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)) ?? null);
      try {
        await markRead({ notificationId: n.id });
      } catch (err) {
        console.error("[seller-notification-bell] mark read error:", err);
        void load();
      }
    }
    const dest = destinationFor(n);
    setOpen(false);
    if (dest) navigate(dest);
  };

  const handleMarkAll = async () => {
    setBusy(true);
    try {
      await markAll();
      setItems((prev) => prev?.map((x) => ({ ...x, isRead: true })) ?? null);
    } catch (err) {
      console.error("[seller-notification-bell] mark all error:", err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={wrapRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label={unread > 0 ? t("notifications.ariaOpenWithCount", { count: unread }) : t("notifications.ariaOpen")}
        aria-haspopup="true"
        aria-expanded={open}
        className="relative flex size-10 cursor-pointer items-center justify-center rounded-[10px] text-slate-600 transition-colors hover:bg-slate-100"
      >
        <Bell className="size-5" />
        {unread > 0 && (
          <span className="absolute right-0 top-0 flex size-5 items-center justify-center rounded-full bg-[#EF4444] text-[11px] font-bold text-white">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t("notifications.title")}
          className="absolute right-0 top-full z-50 mt-2 w-[min(380px,calc(100vw-1.5rem))] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_20px_50px_rgba(15,23,42,0.14)]"
        >
          <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
              <Bell className="size-4 text-[#10B981]" />
              {t("notifications.title")}
            </p>
            {unread > 0 && (
              <span className="rounded-full bg-[#ECFDF5] px-2 py-0.5 text-[11px] font-semibold text-[#047857]">
                {t("notifications.unread", { count: unread })}
              </span>
            )}
          </div>

          {items === null ? (
            <div className="space-y-2 p-4">
              <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
              <div className="h-14 animate-pulse rounded-xl bg-slate-100" />
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center px-6 py-10 text-center">
              <span className="flex size-11 items-center justify-center rounded-2xl bg-slate-100">
                <BellRing className="size-5 text-slate-400" />
              </span>
              <p className="mt-3 text-sm font-semibold text-slate-900">{t("notifications.emptyTitle")}</p>
              <p className="mt-1 text-xs leading-5 text-slate-400">{t("notifications.sellerEmptyDesc")}</p>
            </div>
          ) : (
            <div className="max-h-[min(60vh,420px)] overflow-y-auto">
              <div className="divide-y divide-slate-100">
                {items.slice(0, 10).map((n) => {
                  const Icon = iconFor(n.type);
                  const reason = reasonLabel(t, n.data?.reasonCode);
                  const needsFix = n.type === "seller_verification_needs_correction";
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
                          needsFix
                            ? "bg-amber-100 text-amber-600"
                            : n.isRead
                              ? "bg-slate-100 text-slate-400"
                              : "bg-[#10B981] text-white"
                        }`}
                      >
                        <Icon className="size-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] font-semibold text-slate-900">{n.title}</span>
                        {reason && (
                          <span className="mt-1 inline-block rounded-md bg-amber-50 px-1.5 py-0.5 text-[11px] font-medium text-amber-700">
                            {reason}
                          </span>
                        )}
                        {n.message && (
                          <span className="mt-1 line-clamp-2 block text-xs leading-5 text-slate-500">{n.message}</span>
                        )}
                        <span className="mt-1 flex items-center gap-2 text-[11px] text-slate-400">
                          {formatRelativeTime(n.createdAt, lang, t)}
                          {needsFix && <span className="font-medium text-[#10B981]">· {t("notifications.tapToFix")}</span>}
                        </span>
                      </span>
                      {!n.isRead && <span className="mt-1.5 size-2 shrink-0 rounded-full bg-[#10B981]" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {unread > 0 && (
            <div className="border-t border-slate-100 px-3 py-2">
              <button
                type="button"
                onClick={() => void handleMarkAll()}
                disabled={busy}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:opacity-50"
              >
                {busy ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
                {t("notifications.markAll")}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
