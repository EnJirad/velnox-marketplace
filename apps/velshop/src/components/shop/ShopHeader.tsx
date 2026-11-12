import { CartDrawer } from "@/components/shop/CartDrawer";
import { LanguageSwitcher } from "@/components/shop/LanguageSwitcher";
import { NotificationBell } from "@/components/shop/NotificationBell";
import { Logo, LogoMark } from "@velnox/shared/components/Logo";
import { Button } from "@velnox/shared/components/ui/button";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useChatUnread } from "@velnox/shared/hooks/use-chat-unread";
import { useTracking } from "@velnox/shared/lib/track";
import { useCart } from "@/lib/cart";
import { useLanguage } from "@/lib/i18n";
import { MessageCircle, Search, User } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

export function ShopHeader() {
  const { isAuthenticated, isLoading, user } = useAuth();
  const { count } = useCart();
  const { t } = useLanguage();
  const { track } = useTracking();
  const location = useLocation();
  const navigate = useNavigate();
  const [cartOpen, setCartOpen] = useState(false);
  const openCart = () => setCartOpen(true);
  const { count: chatUnread } = useChatUnread("customer");
  const unread = chatUnread != null && chatUnread > 0 ? chatUnread : null;

  const onHome = location.pathname === "/";
  const onProducts = location.pathname === "/products";
  const showSearch = location.pathname === "/";
  const urlQ = onProducts ? (new URLSearchParams(location.search).get("q") ?? "") : "";
  const [query, setQuery] = useState(urlQ);

  const navItem = (to: string, label: string, active = false) => {
    const isActive = location.pathname.startsWith(to) || active;
    return (
      <Link
        key={to}
        to={to}
        className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
          isActive ? "bg-white/20 text-white" : "text-white/80 hover:bg-white/15 hover:text-white"
        }`}
      >
        {label}
      </Link>
    );
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    navigate(`/products?q=${encodeURIComponent(query.trim())}`);
    setQuery("");
  };

  return (
    <header className="sticky top-0 z-40">
      {/* Mobile brand bar — reference app shell */}
      <div className="bg-brand md:hidden">
        <div className="mx-auto flex h-14 w-full items-center gap-2 px-3">
          {showSearch ? (
            <>
              <Link
                to="/"
                aria-label={t("header.ariaHome", { name: "VelShop" })}
                className="flex size-9 shrink-0 items-center justify-center"
              >
                <LogoMark tone="light" className="h-7 w-auto" />
              </Link>
              <form role="search" onSubmit={handleSearch} className="flex min-w-0 flex-1">
                <div className="relative flex min-w-0 flex-1 items-center">
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder={t("header.searchPlaceholder")}
                    aria-label={t("header.ariaSearch")}
                    enterKeyHint="search"
                    className="h-10 w-full min-w-0 appearance-none rounded-full bg-white pl-4 pr-10 text-[13px] text-slate-900 outline-none placeholder:text-slate-400 focus-visible:ring-2 focus-visible:ring-white/70 [&::-webkit-search-cancel-button]:hidden"
                  />
                  <button
                    type="submit"
                    aria-label={t("header.ariaSearch")}
                    className="absolute right-1 flex size-8 cursor-pointer items-center justify-center rounded-full text-slate-500 transition-colors hover:text-brand"
                  >
                    <Search className="size-[18px]" />
                  </button>
                </div>
              </form>
            </>
          ) : (
            <Link
              to="/"
              aria-label={t("header.ariaHome", { name: "VelShop" })}
              className="flex shrink-0 items-center justify-center"
            >
              <Logo tone="light" wordmarkClassName="max-w-[120px] overflow-hidden truncate" />
            </Link>
          )}
          <div className="ml-auto flex items-center gap-2">
            <LanguageSwitcher variant="mobile" tone="brand" />
            <NotificationBell tone="brand" />
            {isLoading ? null : isAuthenticated && user ? (
              <Link
                to="/profile"
                className="flex size-10 items-center justify-center rounded-full text-white hover:bg-white/15"
                aria-label={t("header.ariaProfile")}
              >
                <img
                  src={user.avatarUrl ?? "/logo.svg"}
                  alt={t("header.ariaProfile")}
                  className="size-10 rounded-full object-cover border border-white/20"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "/logo.svg";
                  }}
                />
              </Link>
            ) : (
              <Button variant="outline" className="h-9 border-0 bg-white text-brand hover:bg-white/90 hover:text-brand" asChild>
                <Link to="/auth?returnTo=/">{t("header.login")}</Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Desktop bar */}
      <div className="hidden border-b border-white/15 bg-brand md:block">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-1.5 px-4 sm:gap-2 sm:px-6">
          <Link to="/" aria-label={t("header.ariaHome", { name: "VelShop" })} className="shrink-0">
            {showSearch || onProducts ? (
              <Logo tone="light" markOnly />
            ) : (
              <Logo tone="light" wordmarkClassName="max-w-[140px] overflow-hidden truncate" />
            )}
          </Link>
          <nav className="ml-3 hidden items-center gap-1 md:flex" aria-label={t("nav.home")}>
            {navItem("/", t("nav.home"), true)}
            {navItem("/products", t("nav.market"))}
            {navItem("/categories", t("nav.categories"))}
          </nav>
          <div className="flex items-center gap-2">
            <LanguageSwitcher variant="desktop" tone="brand" />
            <NotificationBell tone="brand" />
            {isLoading ? null : isAuthenticated && user ? (
              <Link
                to="/profile"
                className="flex size-10 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15"
                aria-label={t("header.ariaProfile")}
              >
                <img
                  src={user.avatarUrl ?? "/logo.svg"}
                  alt={t("header.ariaProfile")}
                  className="size-10 rounded-full object-cover border border-white/20"
                  onError={(e) => {
                    (e.target as HTMLImageElement).src = "/logo.svg";
                  }}
                />
              </Link>
            ) : (
              <Button variant="outline" className="h-9 border-0 bg-white text-brand hover:bg-white/90 hover:text-brand" asChild>
                <Link to="/auth?returnTo=/">{t("header.login")}</Link>
              </Button>
            )}
          </div>
        </div>
      </div>

      <CartDrawer open={cartOpen} onOpenChange={setCartOpen} />
    </header>
  );
}
