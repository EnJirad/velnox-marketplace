/**
 * VelSeller MVP workspace (Phase 3b Phase D).
 *
 * Mounted from `main.tsx` only when `isMvpMode()` is true. The legacy seller app
 * (goals, shop, income, chat, the pre-MVP application gate) is untouched and
 * remains what a production build renders.
 *
 * AUTHORISATION IS THE BACKEND'S. Every route here is wrapped in a session guard
 * for the UX, but each mutation is re-authorised server-side
 * (`requireApprovedSeller`, seller ownership scoping, order-status allow-lists).
 * Hiding a button is never the control.
 */
import { Logo } from "@velnox/shared/components/Logo";
import { Button } from "@velnox/shared/components/ui/button";
import { describeApiMode } from "@velnox/shared/mvp";
import {
  MvpAuthPanel,
  MvpLoading,
  MvpRequireSession,
  MvpSessionProvider,
  mvpSignOut,
  useMvpSessionContext,
} from "@velnox/shared/mvp/ui";
import { LogOut } from "lucide-react";
import { lazy, type ReactNode } from "react";
import { Link, NavLink, Route, Routes, useNavigate } from "react-router";

const Workspace = lazy(() => import("./Workspace"));
const ProductEditor = lazy(() => import("./ProductEditor"));
const OrdersPanel = lazy(() => import("./OrdersPanel"));

const NAV = [
  { to: "/seller", label: "Overview", end: true },
  { to: "/seller/products", label: "Products" },
  { to: "/seller/orders", label: "Orders" },
];

function Shell({ children }: { children: ReactNode }) {
  const { user } = useMvpSessionContext();
  const navigate = useNavigate();
  return (
    <div className="site-app min-h-screen bg-[#F8FAFC]">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 sm:px-6">
          <Link to="/seller" className="flex items-center gap-2">
            <Logo wordmarkClassName="hidden sm:inline" />
            <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
              Seller · MVP
            </span>
          </Link>
          <nav className="ml-3 hidden items-center gap-1 md:flex" aria-label="Seller">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `rounded-[10px] px-3 py-2 text-sm font-medium ${
                    isActive ? "bg-slate-100 text-slate-900" : "text-slate-500 hover:bg-slate-50"
                  }`
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden max-w-40 truncate text-xs text-slate-500 sm:inline">
              {user?.email}
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="size-9 text-slate-500"
              aria-label="Sign out"
              onClick={async () => {
                await mvpSignOut();
                navigate("/");
              }}
            >
              <LogOut className="size-4" />
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">{children}</main>
      <footer className="mx-auto w-full max-w-5xl px-4 pb-10 text-[11px] text-slate-400 sm:px-6">
        {describeApiMode()} · staging surface, not the production seller console.
      </footer>
    </div>
  );
}

function AuthRoute() {
  const { user, loading } = useMvpSessionContext();
  if (loading) return <MvpLoading />;
  if (user) {
    return (
      <div className="mx-auto max-w-md py-10 text-center">
        <p className="text-sm text-slate-600">Signed in as {user.email}</p>
        <Button asChild className="mt-4 bg-slate-900 text-white hover:bg-slate-800">
          <Link to="/seller">Go to the seller workspace</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="py-8">
      <MvpAuthPanel
        title="Seller sign in"
        description="Use the account you registered with Velnox."
        redirectAfterAuth="/seller"
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
