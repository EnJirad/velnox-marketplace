import { CartDrawer } from "@/components/shop/CartDrawer";
import { LanguageSwitcher } from "@/components/shop/LanguageSwitcher";
import { NotificationBell } from "@/components/shop/NotificationBell";
import { Logo } from "@velnox/shared/components/Logo";
import { Button } from "@velnox/shared/components/ui/button";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useCart } from "@/lib/cart";
import { useLanguage } from "@/lib/i18n";
import { ShoppingCart, User } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

/**
 * VelShop header — kept deliberately minimal so shopping stays the focus.
 * Desktop: logo · Home/Products/Categories · language · notifications · cart · account.
 * Mobile: logo · language · notifications · cart · account (bottom tab bar is the menu).
 * Product search lives on the products page; the header shows a notification
 * bell instead (real unread data, floating panel). Everything else
 * (wishlist, VelRepeat) lives in the profile hub.
 */
export function ShopHeader() {
  const { isAuthenticated, isLoading } = useAuth();
  const { count } = useCart();
  const { t } = useLanguage();
  const location = useLocation();
  const navigate = useNavigate();
  const [cartOpen, setCartOpen] = useState(false);

  const navItem = (to: string, label: string, exact = false) => {
    const active = exact ? location.pathname === to : location.pathname.startsWith(to);
    return (
      <Link
        to={to}
        className={`rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
          active
            ? "bg-slate-100 text-slate-900"
            : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1.5 px-4 sm:gap-2 sm:px-6">
        {/* Brand — mark-only on the smallest screens so the utility row never overflows */}
        <Link to="/" aria-label={t("header.ariaHome", { name: "VelShop" })} className="shrink-0">
          <Logo wordmarkClassName="hidden sm:inline" />
        </Link>

        {/* Desktop navigation */}
        <nav className="ml-3 hidden items-center gap-1 md:flex" aria-label={t("nav.home")}>
          {navItem("/", t("nav.home"), true)}
          {navItem("/products", t("nav.products"))}
          {navItem("/categories", t("nav.categories"))}
        </nav>

        {/* Utility actions */}
        <div className="ml-auto flex items-center gap-1 lg:ml-2">
          {/* Language — desktop full trigger, mobile compact icon */}
          <div className="hidden md:block">
            <LanguageSwitcher variant="desktop" />
          </div>
          <div className="md:hidden">
            <LanguageSwitcher variant="mobile" />
          </div>

          {/* Notifications — real unread data, floating panel (auth only) */}
          <NotificationBell />

          <Button
            variant="ghost"
            size="icon"
            data-cart-icon="true"
            className="relative size-10 cursor-pointer rounded-[10px] text-slate-600 hover:bg-slate-100"
            onClick={() => {
              if (!isAuthenticated && !isLoading) {
                navigate("/auth?returnTo=/");
              } else {
                setCartOpen(true);
              }
            }}
            aria-label={t("header.ariaCart")}
          >
            <ShoppingCart className="size-5" />
            {count > 0 && (
              <span className="absolute right-0 top-0 flex size-5 items-center justify-center rounded-full bg-[#10B981] text-[11px] font-bold text-white">
                {count > 99 ? "99+" : count}
              </span>
            )}
          </Button>

          {isLoading ? null : isAuthenticated ? (
            <Link
              to="/profile"
              className="flex size-10 items-center justify-center rounded-[10px] text-slate-600 transition-colors hover:bg-slate-100"
              aria-label={t("header.ariaProfile")}
            >
              <User className="size-5" />
            </Link>
          ) : (
            <Button
              variant="outline"
              className="h-9 border-slate-200 text-slate-700"
              asChild
            >
              <Link to="/auth?returnTo=/">{t("header.login")}</Link>
            </Button>
          )}
        </div>
      </div>

      <CartDrawer open={cartOpen} onOpenChange={setCartOpen} />
    </header>
  );
}
