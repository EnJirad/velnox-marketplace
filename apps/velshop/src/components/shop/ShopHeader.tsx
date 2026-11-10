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
import { MessageCircle, Search, ShoppingCart, User } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

/**
 * VelShop header — two presentations of ONE header system.
 *
 * Mobile: solid brand bar (56 px) — brand mark · white pill search · language ·
 * cart with the real count · chat with the real unread count. Matches the
 * reference app shell; the bottom tab bar stays the primary menu.
 * Desktop: the same solid brand bar — white logo · Home/Products/Categories ·
 * language · notifications · cart · account (its search is the products page box).
 *
 * Search reuses the products page contract (`/products?q=`) — the header only
 * writes that one param, so there is never a second search implementation.
 */
export function ShopHeader() {
  const { isAuthenticated, isLoading } = useAuth();
  const { count } = useCart();
  const { t } = useLanguage();
  const { track } = useTracking();
  const location = useLocation();
  const navigate = useNavigate();
  const [cartOpen, setCartOpen] = useState(false);
  // Real server-derived unread chat count; null while unknown → no badge.
  const { count: chatUnread } = useChatUnread("customer");

  const onProducts = location.pathname === "/products";
  // Search belongs to the storefront (Home) only. The Marketplace renders its own
  // prominent search area inside the page, so the header never stacks a second
  // search box on top of it, and utility screens carry no search at all.
  const showSearch = location.pathname === "/";
  const urlQ = onProducts ? (new URLSearchParams(location.search).get("q") ?? "") : "";
  const [query, setQuery] = useState(urlQ);

  // Keep the pill in step with the URL when the products page changes it.
  useEffect(() => {
    setQuery(urlQ);
  }, [urlQ]);

  const submitSearch = (event: React.FormEvent) => {
    event.preventDefault();
    const term = query.trim();
    if (term) track("SEARCH", { value: term.slice(0, 60) });
    const next = new URLSearchParams(onProducts ? location.search : "");
    if (term) next.set("q", term);
    else next.delete("q");
    next.delete("page");
    const qs = next.toString();
    navigate(`/products${qs ? `?${qs}` : ""}`);
  };

  const openCart = () => {
    if (!isAuthenticated && !isLoading) {
      navigate("/auth?returnTo=/");
    } else {
      setCartOpen(true);
    }
  };

  const navItem = (to: string, label: string, exact = false) => {
    const active = exact ? location.pathname === to : location.pathname.startsWith(to);
    return (
      <Link
        to={to}
        className={`rounded-md px-3 py-2 text-sm font-medium transition-colors ${
          active
            ? "bg-white/20 text-white"
            : "text-white/80 hover:bg-white/15 hover:text-white"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40">
      {/* Mobile brand bar — the reference app shell */}
      <div className="bg-brand md:hidden">
        <div className="mx-auto flex h-14 w-full items-center gap-2 px-3">
          <Link
            to="/"
            aria-label={t("header.ariaHome", { name: "VelShop" })}
            className="flex size-9 shrink-0 items-center justify-center"
          >
            <LogoMark tone="light" className="h-7 w-auto" />
          </Link>

          {showSearch ? (
            <form role="search" onSubmit={submitSearch} className="flex min-w-0 flex-1">
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
          ) : (
            <span className="min-w-0 flex-1" aria-hidden="true" />
          )}
          <LanguageSwitcher variant="mobile" tone="brand" />

          <button
            type="button"
            data-cart-icon="true"
            onClick={openCart}
            aria-label={t("header.ariaCart")}
            className="relative flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 active:bg-white/20"
          >
            <ShoppingCart className="size-6" />
            {count > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-2xs font-bold leading-none text-accent-foreground shadow-sm">
                {count > 99 ? "99+" : count}
              </span>
            )}
          </button>

          <Link
            to="/chat"
            aria-label={t("header.ariaChat")}
            className="relative flex size-9 shrink-0 items-center justify-center rounded-full text-white transition-colors hover:bg-white/15 active:bg-white/20"
          >
            <MessageCircle className="size-6" />
            {chatUnread != null && chatUnread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-white px-1 text-2xs font-bold leading-none text-accent-foreground shadow-sm">
                {chatUnread > 99 ? "99+" : chatUnread}
              </span>
            )}
          </Link>
        </div>
      </div>

      {/* Desktop bar — same solid brand surface as mobile */}
      <div className="hidden border-b border-white/15 bg-brand md:block">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1.5 px-4 sm:gap-2 sm:px-6">
          {/* Brand — mark-only on the smallest screens so the utility row never overflows */}
          <Link to="/" aria-label={t("header.ariaHome", { name: "VelShop" })} className="shrink-0">
            <Logo tone="light" wordmarkClassName="hidden sm:inline" />
          </Link>

          {/* Desktop navigation */}
          <nav className="ml-3 hidden items-center gap-1 md:flex" aria-label={t("nav.home")}>
            {navItem("/", t("nav.home"), true)}
            {navItem("/products", t("nav.market"))}
            {navItem("/categories", t("nav.categories"))}
          </nav>

          {/* Utility actions */}
          <div className="ml-auto flex items-center gap-1 lg:ml-2">
            {/* Language — desktop full trigger */}
            <LanguageSwitcher variant="desktop" tone="brand" />

            {/* Notifications — real unread data, floating panel (auth only) */}
            <NotificationBell tone="brand" />

            <Button
              variant="ghost"
              size="icon"
              data-cart-icon="true"
              className="relative size-10 cursor-pointer rounded-md text-white hover:bg-white/15"
              onClick={openCart}
              aria-label={t("header.ariaCart")}
            >
              <ShoppingCart className="size-5" />
              {count > 0 && (
                <span className="absolute right-0 top-0 flex size-5 items-center justify-center rounded-full bg-white text-2xs font-bold text-brand">
                  {count > 99 ? "99+" : count}
                </span>
              )}
            </Button>

            {isLoading ? null : isAuthenticated ? (
              <Link
                to="/profile"
                className="flex size-10 items-center justify-center rounded-md text-white transition-colors hover:bg-white/15"
                aria-label={t("header.ariaProfile")}
              >
                <User className="size-5" />
              </Link>
            ) : (
              <Button
                variant="outline"
                className="h-9 border-0 bg-white text-brand hover:bg-white/90 hover:text-brand"
                asChild
              >
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
