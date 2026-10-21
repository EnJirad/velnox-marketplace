/**
 * VelCenter MVP admin console (Phase 3b Phase D).
 *
 * Mounted from `main.tsx` only when `isMvpMode()` is true; the legacy VelCenter
 * (owner bootstrap, staff RBAC, the pre-MVP review queues) is untouched.
 *
 * ADMIN AUTHORITY IS SERVER-SIDE. There is no client role check to bypass: every
 * endpoint behind these panels requires an `admin`/`owner` session and returns
 * 403 otherwise, which the panels render as "Not allowed". Staff RBAC is out of
 * scope for the MVP, so no permission codes are consulted here.
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

const Admin = lazy(() => import("./Admin"));

const NAV = [
  { to: "/", label: "Overview", end: true },
  { to: "/sellers", label: "Sellers" },
  { to: "/products", label: "Products" },
  { to: "/categories", label: "Categories" },
];

function Shell({ children }: { children: ReactNode }) {
  const { user } = useMvpSessionContext();
  const navigate = useNavigate();
  return (
    <div className="site-app min-h-screen bg-[#F8FAFC]">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-2">
            <Logo wordmarkClassName="hidden sm:inline" />
            <span className="rounded-full border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-slate-600">
              Center · MVP
            </span>
          </Link>
          <nav className="ml-3 hidden items-center gap-1 md:flex" aria-label="Admin">
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
            <span className="hidden max-w-40 truncate text-xs text-slate-500 sm:inline">{user?.email}</span>
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
      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">{children}</main>
      <footer className="mx-auto w-full max-w-6xl px-4 pb-10 text-[11px] text-slate-400 sm:px-6">
        {describeApiMode()} · admin actions are authorised by the API on every request.
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
          <Link to="/">Open the console</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="py-8">
      <MvpAuthPanel
        title="Administrator sign in"
        description="Only an admin or owner account can use this console."
        redirectAfterAuth="/"
      />
    </div>
  );
}

/**
 * `tab` selects which panel the route renders; the panels themselves fetch on
 * mount, so a deep link like `/sellers?status=pending` is shareable.
 */
const PANEL_ROUTES: Array<{ path: string; tab: "overview" | "sellers" | "products" | "categories" }> = [
  { path: "/", tab: "overview" },
  { path: "/sellers", tab: "sellers" },
  { path: "/products", tab: "products" },
  { path: "/categories", tab: "categories" },
];

export default function MvpAdminApp() {
  return (
    <MvpSessionProvider>
      <Shell>
        <Routes>
          {PANEL_ROUTES.map((entry) => (
            <Route
              key={entry.path}
              path={entry.path}
              element={
                <MvpRequireSession>
                  <Admin tab={entry.tab} />
                </MvpRequireSession>
              }
            />
          ))}
          <Route path="/auth" element={<AuthRoute />} />
          <Route
            path="*"
            element={
              <MvpRequireSession>
                <Admin tab="overview" />
              </MvpRequireSession>
            }
          />
        </Routes>
      </Shell>
    </MvpSessionProvider>
  );
}
