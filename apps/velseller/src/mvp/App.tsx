/**
 * VelSeller workspace shell.
 *
 * Restored original chrome: the top header with store navigation, the floating
 * mobile tab bar and the shared account menu — all over the MVP seller API.
 *
 * AUTHORISATION IS THE BACKEND'S. Every route is guarded here for the UX, but
 * each mutation is re-authorised server-side (`requireApprovedSeller`, seller
 * ownership scoping, order-status allow-lists).
 */
import { Logo } from "@velnox/shared/components/Logo";
import { MobileTabBar } from "@velnox/shared/components/MobileTabBar";
import { UserMenu } from "@velnox/shared/components/UserMenu";
import { Button } from "@velnox/shared/components/ui/button";
import { useLanguage } from "@velnox/shared/lib/i18n";
import {
  MvpAuthPanel,
  MvpLoading,
  MvpRequireSession,
  MvpSessionProvider,
  useMvpSessionContext,
} from "@velnox/shared/mvp/ui";
import { Package, ShoppingBag, Store, Target } from "lucide-react";
import { lazy, type ReactNode } from "react";
import { Link, NavLink, Route, Routes } from "react-router";

const Workspace = lazy(() => import("./Workspace"));
const ProductEditor = lazy(() => import("./ProductEditor"));
const OrdersPanel = lazy(() => import("./OrdersPanel"));
const StoreProfile = lazy(() => import("./StoreProfile"));

function Shell({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const NAV = [
    { to: "/seller", label: t("sellerNav.overview"), end: true },
    { to: "/seller/products", label: t("sellerNav.products") },
    { to: "/seller/orders", label: t("sellerNav.orders") },
    { to: "/seller/profile", label: t("sellerNav.profile") },
  ];

  return (
    <div className="site-app min-h-screen bg-[#F8FAFC]">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-2 px-4 sm:px-6">
          <Link to="/seller" aria-label="Velnox seller" className="shrink-0">
            <Logo wordmarkClassName="hidden sm:inline" />
          </Link>
          <nav className="ml-3 hidden items-center gap-1 lg:flex" aria-label={t("role.seller")}>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-[10px] px-3 py-1.5 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <UserMenu align="end" />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>

      <MobileTabBar
        items={[
          { to: "/seller", label: t("nav.home"), icon: Target },
          { to: "/seller/products", label: t("sellerNav.products"), icon: Package },
          { to: "/seller/orders", label: t("sellerNav.orders"), icon: ShoppingBag },
          { to: "/seller/profile", label: t("sellerNav.profile"), icon: Store },
        ]}
      />
    </div>
  );
}

function AuthRoute() {
  const { user, loading } = useMvpSessionContext();
  const { t } = useLanguage();
  if (loading) return <MvpLoading />;
  if (user) {
    return (
      <div className="mx-auto max-w-md py-10 text-center">
        <p className="text-sm text-slate-600">{user.email}</p>
        <Button asChild className="mt-4 bg-slate-900 text-white hover:bg-slate-800">
          <Link to="/seller">{t("nav.account")}</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="py-8">
      <MvpAuthPanel
        title={t("role.seller")}
        description={t("footer.sellerJoin")}
        redirectAfterAuth="/seller"
        oauthApp="velseller"
      />
    </div>
  );
}

export default function MvpSellerApp() {
  return (
    <MvpSessionProvider>
      <Shell>
        <Routes>
          <Route
            path="/seller"
            element={
              <MvpRequireSession>
                <Workspace />
              </MvpRequireSession>
            }
          />
          <Route
            path="/seller/products"
            element={
              <MvpRequireSession>
                <Workspace tab="products" />
              </MvpRequireSession>
            }
          />
          <Route
            path="/seller/products/:productId"
            element={
              <MvpRequireSession>
                <ProductEditor />
              </MvpRequireSession>
            }
          />
          <Route
            path="/seller/orders"
            element={
              <MvpRequireSession>
                <OrdersPanel />
              </MvpRequireSession>
            }
          />
          <Route
            path="/seller/profile"
            element={
              <MvpRequireSession>
                <StoreProfile />
              </MvpRequireSession>
            }
          />
          <Route path="/auth" element={<AuthRoute />} />
          <Route
            path="*"
            element={
              <MvpRequireSession>
                <Workspace />
              </MvpRequireSession>
            }
          />
        </Routes>
      </Shell>
    </MvpSessionProvider>
  );
}
