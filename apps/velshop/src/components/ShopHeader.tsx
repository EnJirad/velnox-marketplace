/**
 * VelShop header — the original one, on the MVP session and cart.
 *
 * Desktop: logo · Home / Products / Categories · language · cart · account.
 * Mobile: logo · language · cart · account, with the floating tab bar below
 * holding the menu. Product search lives on the products page.
 */
import { Logo } from "@velnox/shared/components/Logo";
import { UserMenu } from "@velnox/shared/components/UserMenu";
import { Button } from "@velnox/shared/components/ui/button";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { useMvpSessionContext } from "@velnox/shared/mvp/ui";
import { ShoppingCart } from "lucide-react";
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";
import { useMvpCart } from "@/mvp/cart";
import { CartDrawer } from "./CartDrawer";
import { LanguageSwitcher } from "./LanguageSwitcher";

export function ShopHeader() {
  const { user, loading } = useMvpSessionContext();
  const { t } = useLanguage();
  const { itemCount } = useMvpCart();
  const location = useLocation();
  const navigate = useNavigate();
  const [cartOpen, setCartOpen] = useState(false);

  const navItem = (to: string, label: string, exact = false) => {
    const active = exact ? location.pathname === to : location.pathname.startsWith(to);
    return (
      <Link
        to={to}
        className={`rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
          active ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-1.5 px-4 sm:gap-2 sm:px-6">
        <Link to="/" aria-label={t("header.ariaHome", { name: "VelShop" })} className="shrink-0">
          <Logo wordmarkClassName="hidden sm:inline" />
        </Link>

        <nav className="ml-3 hidden items-center gap-1 md:flex" aria-label={t("nav.home")}>
          {navItem("/", t("nav.home"), true)}
          {navItem("/products", t("nav.products"))}
          {navItem("/categories", t("nav.categories"))}
        </nav>

        <div className="ml-auto flex items-center gap-1 lg:ml-2">
          <div className="hidden md:block">
            <LanguageSwitcher variant="desktop" />
          </div>
          <div className="md:hidden">
            <LanguageSwitcher variant="mobile" />
          </div>

          <Button
            variant="ghost"
            size="icon"
            data-cart-icon="true"
            className="relative size-10 cursor-pointer rounded-[10px] text-slate-600 hover:bg-slate-100"
            onClick={() => {
              if (!user && !loading) navigate("/auth?returnTo=/");
              else setCartOpen(true);
            }}
            aria-label={t("header.ariaCart")}
          >
            <ShoppingCart className="size-5" />
            {itemCount > 0 && (
              <span className="absolute right-0 top-0 flex size-5 items-center justify-center rounded-full bg-[#10B981] text-[11px] font-bold text-white">
                {itemCount > 99 ? "99+" : itemCount}
              </span>
            )}
          </Button>

          {loading ? (
            <span className="size-9 animate-pulse rounded-full bg-slate-100" aria-hidden="true" />
          ) : user ? (
            <UserMenu />
          ) : (
            <Button variant="outline" className="h-9 border-slate-200 text-slate-700" asChild>
              <Link to="/auth?returnTo=/">{t("header.login")}</Link>
            </Button>
          )}
        </div>
      </div>

      <CartDrawer open={cartOpen} onOpenChange={setCartOpen} />
    </header>
  );
}
