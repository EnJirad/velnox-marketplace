import { Logo } from "@velnox/shared/components/Logo";
import { SellerNotificationBell } from "@velnox/shared/components/SellerNotificationBell";
import { UserMenu } from "@velnox/shared/components/UserMenu";
import { useChatUnread } from "@velnox/shared/hooks/use-chat-unread";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { MessageCircle, RefreshCw, ShoppingBag, Store, Target, Wallet } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router";

const NAV_ITEMS = [
  { to: "/seller/goals", labelKey: "sellerNav.goals", icon: Target },
  { to: "/seller/shop", labelKey: "sellerNav.shop", icon: Store },
  { to: "/seller/orders", labelKey: "sellerNav.orders", icon: ShoppingBag },
  { to: "/seller/chat", labelKey: "sellerNav.chat", icon: MessageCircle },
  { to: "/seller/income", labelKey: "sellerNav.income", icon: Wallet },
];

export function AppHeader() {
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  // Real unread chat count from the server (scoped to this seller's own
  // conversations). `null` = not confirmed yet → render NOTHING: a loading or
  // failed badge must never look like "0 unread".
  const { count: chatUnread } = useChatUnread("seller");
  const unread = chatUnread != null && chatUnread > 0 ? chatUnread : null;
  const chatBadge =
    unread == null ? null : (
      <span className="ml-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-2xs font-bold leading-none text-brand">
        {unread > 99 ? "99+" : unread}
      </span>
    );

  return (
    <header className="sticky top-0 z-40 border-b border-white/15 bg-brand">
      <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
        <div className="flex items-center gap-2 sm:gap-5">
          <button type="button" onClick={() => navigate("/")} aria-label="Velnox">
            <Logo tone="light" wordmarkClassName="max-w-[140px] overflow-hidden truncate" />
          </button>
          <nav className="hidden items-center gap-1 md:flex md:flex-nowrap">
            {NAV_ITEMS.map((item) => {
              const active = location.pathname.startsWith(item.to);
              return (
                <Link
                  key={item.to}
                  to={item.to}
                  className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                    active
                      ? "bg-white/20 text-white"
                      : "text-white/80 hover:bg-white/15 hover:text-white"
                  }`}
                >
                  <item.icon className="size-4" />
                  {t(item.labelKey)}
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
            className={`relative flex size-10 items-center justify-center rounded-md transition-colors md:hidden ${
              location.pathname.startsWith("/seller/chat")
                ? "bg-white/20 text-white"
                : "text-white hover:bg-white/15"
            }`}
          >
            <MessageCircle className="size-5" />
            {unread != null && (
              <span className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-white px-1 text-2xs font-bold leading-none text-brand">
                {unread > 99 ? "99+" : unread}
              </span>
            )}
          </Link>
          {/* VelCenter correction requests reach the seller here. */}
          <SellerNotificationBell tone="brand" />
          <UserMenu tone="brand" />
        </div>
      </div>
    </header>
  );
}
