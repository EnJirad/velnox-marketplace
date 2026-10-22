/**
 * The VelShop storefront shell.
 *
 * Restored original chrome: the sticky header, the floating mobile tab bar and
 * the full footer, with every page below rendered from `/api/mvp/*`. There is
 * no second (pre-MVP) page tree to fall back to.
 */
import { MobileTabBar } from "@velnox/shared/components/MobileTabBar";
import { Button } from "@velnox/shared/components/ui/button";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { MvpAuthPanel, MvpLoading } from "@velnox/shared/mvp/ui";
import { Home as HomeIcon, LayoutGrid, Package, ShoppingBag, UserRound } from "lucide-react";
import { lazy, type ReactNode } from "react";
import { Link, Route, Routes, useLocation } from "react-router";
import { ShopFooter } from "@/components/ShopFooter";
import { ShopHeader } from "@/components/ShopHeader";
import { MvpCartProvider, useMvpCart } from "./cart";
import { FavoritesProvider } from "./favorites";
import { RequireSession, SessionProvider, useSession } from "./session";

const HomePage = lazy(() => import("./Home"));
const CatalogPage = lazy(() => import("./Catalog"));
const CategoriesPage = lazy(() => import("./Categories"));
const ProductPage = lazy(() => import("./Product"));
const CartPage = lazy(() => import("./CartPage"));
const CheckoutPage = lazy(() => import("./CheckoutPage"));
const CheckoutSuccessPage = lazy(() => import("./CheckoutSuccess"));
const CheckoutCancelPage = lazy(() => import("./CheckoutCancel"));
const OrdersPage = lazy(() => import("./OrdersPage"));
const OrderDetailPage = lazy(() => import("./OrderDetailPage"));
const WishlistPage = lazy(() => import("./Wishlist"));
const ProfilePage = lazy(() => import("./Profile"));

function Tabs() {
  const { t } = useLanguage();
  const { itemCount } = useMvpCart();
  return (
    <MobileTabBar
      items={[
        { to: "/", label: t("nav.home"), icon: HomeIcon, activeMatch: (path) => path === "/" },
        { to: "/products", label: t("nav.products"), icon: LayoutGrid },
        { to: "/cart", label: t("nav.cart"), icon: ShoppingBag, badge: itemCount },
        { to: "/orders", label: t("nav.orders"), icon: Package },
        { to: "/profile", label: t("nav.profile"), icon: UserRound },
      ]}
    />
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="site-app min-h-screen bg-[#F8FAFC]">
      <ShopHeader />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
      <ShopFooter />
      <Tabs />
    </div>
  );
}

/** `/auth` — the original sign-in screen; an existing session goes straight on. */
function AuthRoute() {
  const { user, loading } = useSession();
  if (loading) return <MvpLoading />;
  if (user) return <MvpAuthPanel title="You are already signed in" description={user.email} />;
  return <MvpAuthPanel oauthApp="velshop" />;
}

function NotFoundRoute() {
  const { pathname } = useLocation();
  const { t } = useLanguage();
  return (
    <div className="py-20 text-center">
      <h1 className="text-2xl font-bold text-slate-900">{t("common.notFound")}</h1>
      <p className="mt-1 text-sm text-slate-500">{pathname}</p>
      <Button asChild className="mt-5 bg-slate-900 text-white hover:bg-slate-800">
        <Link to="/">{t("nav.home")}</Link>
      </Button>
    </div>
  );
}

function Inner() {
  const { user } = useSession();
  return (
    <MvpCartProvider enabled={!!user}>
      <FavoritesProvider>
        <Shell>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/products" element={<CatalogPage />} />
            <Route path="/categories" element={<CategoriesPage />} />
            <Route path="/products/:slug" element={<ProductPage />} />
            <Route path="/cart" element={<CartPage />} />
            <Route
              path="/checkout"
              element={
                <RequireSession>
                  <CheckoutPage />
                </RequireSession>
              }
            />
            <Route path="/checkout/success" element={<CheckoutSuccessPage />} />
            <Route path="/checkout/cancel" element={<CheckoutCancelPage />} />
            <Route
              path="/orders"
              element={
                <RequireSession>
                  <OrdersPage />
                </RequireSession>
              }
            />
            <Route
              path="/orders/:orderId"
              element={
                <RequireSession>
                  <OrderDetailPage />
                </RequireSession>
              }
            />
            <Route
              path="/wishlist"
              element={
                <RequireSession>
                  <WishlistPage />
                </RequireSession>
              }
            />
            <Route
              path="/profile"
              element={
                <RequireSession>
                  <ProfilePage />
                </RequireSession>
              }
            />
            <Route path="/auth" element={<AuthRoute />} />
            <Route path="*" element={<NotFoundRoute />} />
          </Routes>
        </Shell>
      </FavoritesProvider>
    </MvpCartProvider>
  );
}

export default function MvpShopApp() {
  return (
    <SessionProvider>
      <Inner />
    </SessionProvider>
  );
}
