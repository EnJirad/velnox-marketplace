/**
 * The VelShop MVP app (Phase 3b Phase C).
 *
 * Mounted from `main.tsx` ONLY when `isMvpMode()` is true, which is impossible in
 * a production build (`packages/shared/src/mvp/config.ts`). When it is not
 * mounted, the legacy storefront is byte-for-byte what it was.
 *
 * Every price, stock level, payment state and order status rendered here comes
 * from `/api/mvp/*`. The browser formats and displays those values; it never
 * derives them.
 */
import { Logo } from "@velnox/shared/components/Logo";
import { Button } from "@velnox/shared/components/ui/button";
import { describeApiMode } from "@velnox/shared/mvp";
import { MvpAuthPanel, MvpLoading, mvpSignOut } from "@velnox/shared/mvp/ui";
import { LogOut, ShoppingCart, UserRound } from "lucide-react";
import { lazy, type ReactNode } from "react";
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from "react-router";
import { MvpCartProvider, useMvpCart } from "./cart";
import { RequireSession, SessionProvider, useSession } from "./session";

const HomePage = lazy(() => import("./Home"));
const CatalogPage = lazy(() => import("./Catalog"));
const ProductPage = lazy(() => import("./Product"));
const CartPage = lazy(() => import("./CartPage"));
const CheckoutPage = lazy(() => import("./CheckoutPage"));
const OrdersPage = lazy(() => import("./OrdersPage"));
const OrderDetailPage = lazy(() => import("./OrderDetailPage"));

const NAV = [
  { to: "/", label: "Home", end: true },
  { to: "/products", label: "Products" },
  { to: "/orders", label: "Orders" },
];

function Header() {
  const { user, loading } = useSession();
  const { itemCount } = useMvpCart();
  const navigate = useNavigate();

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
        <Link to="/" className="flex shrink-0 items-center gap-2" aria-label="VelShop home">
          <Logo wordmarkClassName="hidden sm:inline" />
          <span className="rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700">
            MVP
          </span>
        </Link>

        <nav className="ml-2 hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
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
          <Link
            to="/cart"
            className="relative flex size-10 items-center justify-center rounded-[10px] text-slate-600 hover:bg-slate-100"
            aria-label={`Cart, ${itemCount} item${itemCount === 1 ? "" : "s"}`}
          >
            <ShoppingCart className="size-5" />
            {itemCount > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex min-w-5 items-center justify-center rounded-full bg-[#10B981] px-1 text-[10px] font-bold text-white">
                {itemCount > 99 ? "99+" : itemCount}
              </span>
            )}
          </Link>

          {loading ? (
            <span className="size-8 animate-pulse rounded-full bg-slate-100" aria-hidden="true" />
          ) : user ? (
            <div className="flex items-center gap-1">
              <span className="hidden max-w-32 truncate text-xs font-medium text-slate-600 sm:inline">
                {user.name || user.email}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="size-10 rounded-[10px] text-slate-500"
                title="Sign out"
                aria-label="Sign out"
                onClick={async () => {
                  await mvpSignOut();
                  // Reload so the shared session snapshot (and every guard that
                  // reads it) is re-read from the server, not left stale.
                  window.location.assign("/");
                }}
              >
                <LogOut className="size-4" />
              </Button>
            </div>
          ) : (
            <Button
              variant="ghost"
              className="h-10 gap-1.5 rounded-[10px] text-slate-600"
              onClick={() => navigate("/auth?returnTo=/")}
            >
              <UserRound className="size-4" />
              Sign in
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-1 px-4 py-8 text-xs text-slate-500 sm:px-6">
        <p className="font-semibold text-slate-700">Velnox — MVP staging build</p>
        <p>{describeApiMode()}</p>
        <p>
          Prices, stock, payment state and order status are rendered from the server API. This
          build is for staging verification only.
        </p>
      </div>
    </footer>
  );
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="site-app min-h-screen bg-[#F8FAFC]">
      <Header />
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</main>
      <Footer />
    </div>
  );
}

/** `/auth` — the MVP credential form; an existing session goes straight on. */
function AuthRoute() {
  const { user, loading } = useSession();
  if (loading) return <MvpLoading />;
  if (user) return <MvpAuthPanel title="You are already signed in" description={user.email} />;
  return <MvpAuthPanel />;
}

/** Catch-all inside MVP mode so we never fall through to a legacy page. */
function NotFoundRoute() {
  const { pathname } = useLocation();
  return (
    <div className="py-20 text-center">
      <h1 className="text-2xl font-bold text-slate-900">Page not found</h1>
      <p className="mt-1 text-sm text-slate-500">{pathname}</p>
      <Button asChild className="mt-5 bg-slate-900 text-white hover:bg-slate-800">
        <Link to="/">Back to the storefront</Link>
      </Button>
    </div>
  );
}

function Inner() {
  const { user } = useSession();
  return (
    <MvpCartProvider enabled={!!user}>
      <Shell>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/products" element={<CatalogPage />} />
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
          <Route path="/auth" element={<AuthRoute />} />
          <Route path="*" element={<NotFoundRoute />} />
        </Routes>
      </Shell>
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
