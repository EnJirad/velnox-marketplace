/**
 * VelCenter admin console shell.
 *
 * Restored original chrome: the header with icon tabs, the mobile tab bar and
 * the shared account menu. ADMIN AUTHORITY STAYS SERVER-SIDE: the role check
 * here is a UX gate (it sends a non-admin to the sign-in page instead of
 * rendering panels that will 403); every endpoint re-checks the session and
 * returns 403 otherwise.
 *
 * Staff RBAC (department permissions) is not restored: the canonical MVP schema
 * has no staff/department objects, and inventing a second permission axis here
 * would not be a restoration.
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
import { FolderTree, Package, ShieldCheck, Users } from "lucide-react";
import { lazy, type ReactNode } from "react";
import { Link, NavLink, Navigate, Route, Routes } from "react-router";

const Admin = lazy(() => import("./Admin"));

function AdminOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useMvpSessionContext();
  const { t } = useLanguage();
  if (loading) return <MvpLoading />;
  if (!user) return <Navigate to="/auth" replace />;
  if (user.role !== "admin" && user.role !== "owner") {
    return (
      <div className="mx-auto w-full max-w-lg py-16 text-center">
        <h1 className="text-xl font-bold text-slate-900">{t("auth.noAccess")}</h1>
        <p className="mt-2 text-sm text-slate-500">{user.email}</p>
        <Button asChild className="mt-5 bg-slate-900 text-white hover:bg-slate-800">
          <Link to="/auth">{t("header.login")}</Link>
        </Button>
      </div>
    );
  }
  return <>{children}</>;
}

function Shell({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const NAV = [
    { to: "/", label: t("centerNav.overview"), icon: ShieldCheck, end: true },
    { to: "/sellers", label: t("centerNav.sellers"), icon: Users },
    { to: "/products", label: t("centerNav.products"), icon: Package },
    { to: "/categories", label: t("centerNav.categories"), icon: FolderTree },
  ];

  return (
    <div className="site-app min-h-screen bg-[#F8FAFC]">
      <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-2 px-4 sm:px-6">
          <Link to="/" aria-label={t("centerNav.console")} className="shrink-0">
            <Logo wordmarkClassName="hidden sm:inline" />
          </Link>
          <nav className="ml-3 hidden items-center gap-1 md:flex" aria-label={t("centerNav.console")}>
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `flex items-center gap-1.5 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  }`
                }
              >
                <item.icon className="size-4" />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <UserMenu align="end" />
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>

      <MobileTabBar items={NAV.map(({ to, label, icon }) => ({ to, label, icon }))} />
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
          <Link to="/">{t("centerNav.console")}</Link>
        </Button>
      </div>
    );
  }
  return (
    <div className="py-8">
      <MvpAuthPanel
        title={t("centerNav.console")}
        description={t("auth.noAccess")}
        redirectAfterAuth="/"
        oauthApp="velcenter"
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
          {/* `/auth` must stay OUTSIDE the admin gate: the gate sends an
              anonymous visitor here, so guarding it would loop. */}
          <Route path="/auth" element={<AuthRoute />} />
          {PANEL_ROUTES.map((entry) => (
            <Route
              key={entry.path}
              path={entry.path}
              element={
                <AdminOnly>
                  <MvpRequireSession>
                    <Admin tab={entry.tab} />
                  </MvpRequireSession>
                </AdminOnly>
              }
            />
          ))}
          <Route
            path="*"
            element={
              <AdminOnly>
                <MvpRequireSession>
                  <Admin tab="overview" />
                </MvpRequireSession>
              </AdminOnly>
            }
          />
        </Routes>
      </Shell>
    </MvpSessionProvider>
  );
}
