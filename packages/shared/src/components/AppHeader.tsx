import { Logo } from "@velnox/shared/components/Logo";
import { SellerNotificationBell } from "@velnox/shared/components/SellerNotificationBell";
import { UserMenu } from "@velnox/shared/components/UserMenu";
import { useChatUnread } from "@velnox/shared/hooks/use-chat-unread";
import { MessageCircle, RefreshCw, ShoppingBag, Store, Target, Wallet } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";

const NAV_ITEMS = [
  { to: "/seller/goals", label: "แดชบอร์ดเป้าหมาย", icon: Target },
  { to: "/seller/shop", label: "ร้านของฉัน", icon: Store },
  { to: "/seller/reorder", label: "Smart Reorder", icon: RefreshCw },
  { to: "/seller/orders", label: "ออเดอร์", icon: ShoppingBag },
  { to: "/seller/chat", label: "แชท", icon: MessageCircle },
  { to: "/seller/income", label: "รายได้", icon: Wallet },
];

export function AppHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  // Real unread chat count from the server (scoped to this seller's own
  // conversations). `null` = not confirmed yet → render NOTHING: a loading or
  // failed badge must never look like "0 unread".
  const { count: chatUnread } = useChatUnread("seller");
  const unread = chatUnread != null && chatUnread > 0 ? chatUnread : null;
  const chatBadge =
    unread == null ? null : (
      <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#10B981] px-1 text-[10px] font-bold leading-none text-white">
        {unread > 99 ? "99+" : unread}
      </span>
    );

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2 sm:gap-5">
          <button type="button" onClick={() => navigate("/")} aria-label="Velnox">
            <Logo />
          </button>
          <nav className="hidden items-center gap-1 lg:flex">
            {NAV_ITEMS.map((item) => {
              const active = location.pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  }`}
                >
                  <item.icon className="size-4" />
                  {item.label}
                  {item.to === "/seller/chat" && chatBadge}
                </Link>
              );
            })}
          </nav>
        </div>

        <div className="flex items-center gap-1">
          {/*
            Chat entry for phones and tablets. The header nav above is lg-only and
            the mobile tab bar has five slots (Goals · Shop · Orders · Income ·
            Profile) — customer conversations are a core seller workflow, so chat
            gets its own always-visible action instead of being unreachable.
          */}
          <Link
            to="/seller/chat"
            aria-label={unread != null ? `แชท (${unread})` : "แชท"}
            aria-current={location.pathname.startsWith("/seller/chat") ? "page" : undefined}
            className={`relative flex size-10 items-center justify-center rounded-[10px] transition-colors lg:hidden ${
              location.pathname.startsWith("/seller/chat")
                ? "bg-slate-100 text-slate-900"
                : "text-slate-600 hover:bg-slate-100"
            }`}
          >
            <MessageCircle className="size-5" />
            {unread != null && (
              <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#10B981] px-1 text-[10px] font-bold leading-none text-white">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
          {/* VelCenter correction requests reach the seller here. */}
          <SellerNotificationBell />
          <UserMenu />
        </div>
      </div>
    </header>
  );
}
