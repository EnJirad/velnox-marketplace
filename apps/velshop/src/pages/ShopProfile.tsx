import { CoverImage } from "@velnox/shared/components/ui/cover-image";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@velnox/shared/components/ui/alert-dialog";
import { Button } from "@velnox/shared/components/ui/button";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { api } from "@velnox/shared/lib/api-routes";
import { useAuth } from "@velnox/shared/hooks/use-auth";
import { useAction } from "@velnox/shared/lib/api-routes";
import { AvatarImage } from "@velnox/shared/components/ui/avatar-image";
import {
  Bell,
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  Heart,
  LifeBuoy,
  LogOut,
  MapPin,
  MessageCircle,
  Package,
  RefreshCw,
  Settings2,
  ShieldCheck,
  ShoppingBag,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "react-router";
import { toast } from "sonner";

/**
 * Append a cache-busting ?v= param to force the browser to refetch.
 * Database stores the canonical URL without ?v=; this param is display-only.
 */
function bust(url: string | null | undefined): string | null {
  if (!url) return null;
  const clean = url.replace(/[?&]v=\d+/, "").replace(/\?$/, "");
  return `${clean}?v=${Date.now()}`;
}

/**
 * ShopProfile — customer account center.
 *
 * Identity header (cover · avatar · name/email · status · member since),
 * real quick-stats from the backend account-summary endpoint, and the account
 * menu grouped into Shopping / Communication / Account / Session.
 *
 * Avatar/cover editing lives on the Account page (/profile/account).
 * Help now points to the real Help Center (/help).
 */
interface ProfileRow {
  to: string;
  labelKey: string;
  descKey: string;
  icon: LucideIcon;
}

const SHOPPING: ProfileRow[] = [
  { to: "/orders", labelKey: "profile.orders", descKey: "profile.ordersDesc", icon: Package },
  { to: "/wishlist", labelKey: "profile.wishlist", descKey: "profile.wishlistDesc", icon: Heart },
  { to: "/velrepeat", labelKey: "profile.velrepeat", descKey: "profile.velrepeatDesc", icon: RefreshCw },
  { to: "/addresses", labelKey: "profile.addresses", descKey: "profile.addressesDesc", icon: MapPin },
];

const COMMUNICATION: ProfileRow[] = [
  { to: "/chat", labelKey: "profile.chat", descKey: "profile.chatDesc", icon: MessageCircle },
  { to: "/notifications", labelKey: "profile.notifications", descKey: "profile.notificationsDesc", icon: Bell },
  { to: "/help", labelKey: "profile.help", descKey: "profile.helpDesc", icon: LifeBuoy },
];

const ACCOUNT: ProfileRow[] = [
  { to: "/profile/account", labelKey: "profile.account", descKey: "profile.accountDesc", icon: CircleUserRound },
];

interface AccountStats {
  orders: number | null;
  wishlist: number | null;
  velrepeat: number | null;
  addresses: number | null;
  notificationsUnread: number | null;
  chatUnread: number | null;
}

interface StatTileDef {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  value: number | null;
}

function StatTile({ to, labelKey, icon: Icon, value }: StatTileDef) {
  const { t } = useLanguage();
  if (value == null) return null; // no fake numbers — omit when unavailable
  return (
    <Link
      to={to}
      className="group flex flex-col gap-1.5 rounded-2xl border border-slate-200 bg-white p-3.5 transition-colors hover:border-slate-300 hover:bg-slate-50/60 sm:p-4"
    >
      <span className="flex size-8 items-center justify-center rounded-[10px] bg-slate-100 text-slate-500 transition-colors group-hover:bg-[#ECFDF5] group-hover:text-[#047857]">
        <Icon className="size-4" />
      </span>
      <span className="text-xl font-bold tabular-nums tracking-tight text-slate-900">{value}</span>
      <span className="text-[11px] font-medium leading-4 text-slate-400">{t(labelKey)}</span>
    </Link>
  );
}

export default function ShopProfile() {
  const { t } = useLanguage();
  const { user, isLoading, isAuthenticated, signOut } = useAuth();
  const myProfile = useAction(api.customer.myProfile);
  const accountSummary = useAction(api.customer.accountSummary);
  const [profile, setProfile] = useState<{
    name: string | null;
    email: string | null;
    phone: string | null;
    avatarUrl: string | null;
    coverUrl: string | null;
    memberSince: number | null;
  } | null>(null);
  const [stats, setStats] = useState<AccountStats | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const location = useLocation();

  // Re-fetch profile + real quick-stats when navigating back to this page
  // (e.g. from Account after an avatar/cover upload).
  useEffect(() => {
    if (!isAuthenticated) return;
    let alive = true;
    Promise.allSettled([myProfile(), accountSummary()])
      .then(([profileRes, statsRes]) => {
        if (!alive) return;
        if (profileRes.status === "fulfilled") {
          const data = profileRes.value as {
            name: string | null;
            email: string | null;
            phone: string | null;
            avatarUrl: string | null;
            coverUrl: string | null;
            memberSince: number;
          };
          setProfile({
            name: data.name,
            email: data.email,
            phone: data.phone,
            avatarUrl: data.avatarUrl ?? null,
            coverUrl: data.coverUrl ?? null,
            memberSince: data.memberSince ?? null,
          });
        } else {
          console.error("Load profile error:", profileRes.reason);
        }
        if (statsRes.status === "fulfilled") {
          const s = statsRes.value as Partial<AccountStats>;
          setStats({
            orders: s.orders ?? null,
            wishlist: s.wishlist ?? null,
            velrepeat: s.velrepeat ?? null,
            addresses: s.addresses ?? null,
            notificationsUnread: s.notificationsUnread ?? null,
            chatUnread: s.chatUnread ?? null,
          });
        } else {
          console.error("Load account summary error:", statsRes.reason);
          setStats(null);
        }
      });
    return () => {
      alive = false;
    };
  }, [myProfile, accountSummary, isAuthenticated, location.pathname]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      setProfile(null);
      setStats(null);
      toast.success(t("profile.signedOut"));
    } finally {
      setSigningOut(false);
      setSignOutOpen(false);
    }
  };

  const displayName = profile?.name ?? user?.name ?? user?.email ?? "";
  const displayEmail = profile?.email ?? user?.email ?? "";
  const memberSince = profile?.memberSince ?? null;

  // Use cache-busted URLs so the browser always fetches the latest image
  // when navigating to this page (e.g. after uploading a new avatar/cover
  // on the Account page). The database stores canonical URLs without ?v=.
  const avatarSrc = useMemo(
    () => bust(profile?.avatarUrl ?? user?.avatarUrl ?? user?.image ?? null),
    [profile?.avatarUrl, user?.avatarUrl, user?.image],
  );
  const coverSrc = useMemo(
    () => bust(profile?.coverUrl ?? user?.coverUrl ?? null),
    [profile?.coverUrl, user?.coverUrl],
  );

  const formatMemberSince = (ms: number) =>
    new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric" }).format(
      new Date(ms),
    );

  const statTiles: StatTileDef[] = [
    { to: "/orders", labelKey: "profile.statsOrders", icon: Package, value: stats?.orders ?? null },
    { to: "/wishlist", labelKey: "profile.statsWishlist", icon: Heart, value: stats?.wishlist ?? null },
    { to: "/velrepeat", labelKey: "profile.statsVelRepeat", icon: RefreshCw, value: stats?.velrepeat ?? null },
    { to: "/addresses", labelKey: "profile.statsAddresses", icon: MapPin, value: stats?.addresses ?? null },
  ];
  const visibleTiles = statTiles.filter((s) => s.value != null);

  const notificationsBadge =
    stats?.notificationsUnread != null && stats.notificationsUnread > 0
      ? stats.notificationsUnread
      : 0;

  const renderRow = (row: ProfileRow, showBadge = 0) => {
    const Icon = row.icon;
    return (
      <Link
        key={row.to + row.labelKey}
        to={row.to}
        className="flex items-center gap-3.5 px-5 py-4 transition-colors hover:bg-[#F8FAFC]"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-slate-100 text-slate-500">
          <Icon className="size-[18px]" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-slate-900">{t(row.labelKey)}</span>
          <span className="mt-0.5 block truncate text-xs text-slate-400">{t(row.descKey)}</span>
        </span>
        {showBadge > 0 && (
          <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-[#10B981] text-[11px] font-bold text-white">
            {showBadge > 99 ? "99+" : showBadge}
          </span>
        )}
        <ChevronRight className="size-4 shrink-0 text-slate-300" />
      </Link>
    );
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        {isLoading ? (
          <div className="space-y-4">
            <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <Skeleton className="h-40 rounded-none sm:h-44" />
              <div className="px-5 pb-6">
                <div className="-mt-12">
                  <Skeleton className="size-24 rounded-full border-4 border-white bg-slate-200" />
                </div>
                <Skeleton className="mt-4 h-6 w-44" />
                <Skeleton className="mt-2 h-4 w-64" />
                <Skeleton className="mt-6 h-10 w-36 rounded-[10px]" />
              </div>
            </div>
            <Skeleton className="h-24 rounded-3xl" />
            <Skeleton className="h-64 rounded-3xl" />
          </div>
        ) : isAuthenticated ? (
          <>
            {/* Identity header — cover · avatar · name/email/status */}
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
              <div className="relative h-36 bg-gradient-to-r from-[#0f766e] via-[#10B981] to-[#34d399] sm:h-44">
                <CoverImage
                  src={coverSrc}
                  alt={t("profile.coverAlt", { name: displayName || "VelShop" })}
                  className="absolute inset-0 size-full object-cover"
                />
              </div>

              <div className="px-5 pb-5 sm:px-6">
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="relative -mt-12 flex w-fit">
                    <span
                      className={`flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-white shadow-sm ${
                        avatarSrc
                          ? "bg-transparent"
                          : "bg-[#ECFDF5] text-3xl font-bold text-[#10B981]"
                      }`}
                    >
                      {avatarSrc ? (
                        <AvatarImage
                          src={avatarSrc}
                          alt={t("profile.avatarAlt", { name: displayName || "VelShop" })}
                          className="size-full object-cover"
                          fallback={<>{(displayName || "?").slice(0, 1).toUpperCase()}</>}
                        />
                      ) : (
                        <>{(displayName || "?").slice(0, 1).toUpperCase()}</>
                      )}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mb-1 gap-1.5 border-slate-200 text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                    asChild
                  >
                    <Link to="/profile/account">
                      <Settings2 className="size-3.5" />
                      {t("profile.editProfile")}
                    </Link>
                  </Button>
                </div>

                <div className="mt-3">
                  <p className="truncate text-lg font-bold tracking-tight text-slate-900">
                    {displayName || t("profile.member")}
                  </p>
                  {displayEmail && <p className="truncate text-sm text-slate-500">{displayEmail}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1 rounded-full bg-[#ECFDF5] px-2.5 py-1 text-[11px] font-medium text-emerald-700">
                      <ShieldCheck className="size-3" />
                      {t("profile.statusActive")}
                    </span>
                    {memberSince && (
                      <span className="inline-flex items-center gap-1 text-[11px] text-slate-400">
                        <CalendarDays className="size-3" />
                        {t("profile.memberSince", { date: formatMemberSince(memberSince) })}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </section>

            {/* Quick stats — real counts only (no fake numbers) */}
            {visibleTiles.length > 0 && (
              <section
                className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"
                aria-label={t("profile.statsLabel")}
              >
                {visibleTiles.map((tile) => (
                  <StatTile key={tile.to} {...tile} />
                ))}
              </section>
            )}

            {/* Shopping */}
            <section className="mt-6">
              <p className="px-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {t("profile.groupShopping")}
              </p>
              <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {SHOPPING.map((row, i) => (
                  <div key={row.to} className={i > 0 ? "border-t border-slate-100" : ""}>
                    {renderRow(row)}
                  </div>
                ))}
              </div>
            </section>

            {/* Communication */}
            <section className="mt-6">
              <p className="px-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {t("profile.groupCommunication")}
              </p>
              <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {COMMUNICATION.map((row, i) => (
                  <div key={row.to} className={i > 0 ? "border-t border-slate-100" : ""}>
                    {renderRow(row, row.to === "/notifications" ? notificationsBadge : 0)}
                  </div>
                ))}
              </div>
            </section>

            {/* Account */}
            <section className="mt-6">
              <p className="px-1 text-xs font-semibold uppercase tracking-wider text-slate-400">
                {t("profile.groupAccount")}
              </p>
              <div className="mt-2 overflow-hidden rounded-2xl border border-slate-200 bg-white">
                {ACCOUNT.map((row, i) => (
                  <div key={row.to} className={i > 0 ? "border-t border-slate-100" : ""}>
                    {renderRow(row)}
                  </div>
                ))}
              </div>
            </section>

            {/* Session */}
            <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
              <div className="px-5 py-4">
                <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                  {t("profile.session")}
                </p>
                <Button
                  variant="outline"
                  className="mt-3 w-full gap-1.5 border-red-200 text-red-600 hover:bg-red-50 hover:text-red-600"
                  onClick={() => setSignOutOpen(true)}
                >
                  <LogOut className="size-4" />
                  {t("profile.signOut")}
                </Button>
              </div>
            </section>

            <p className="mt-6 flex items-center justify-center gap-1.5 text-center text-xs text-slate-400">
              <ShoppingBag className="size-3.5 text-[#10B981]" />
              {t("profile.accountNote")}
            </p>
          </>
        ) : (
          <div className="mt-8 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-16 text-center">
            <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
              <UserRound className="size-7 text-slate-400" />
            </span>
            <p className="mt-3 text-sm text-slate-500">{t("profile.notSignedIn")}</p>
            <Button className="mt-5 bg-slate-900 text-white hover:bg-slate-800" asChild>
              <Link to="/auth?returnTo=/profile">{t("profile.signIn")}</Link>
            </Button>
          </div>
        )}
      </main>

      {/* Sign-out confirmation */}
      <AlertDialog open={signOutOpen} onOpenChange={setSignOutOpen}>
        <AlertDialogContent className="bg-white sm:max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-slate-900">{t("profile.signOutTitle")}</AlertDialogTitle>
            <AlertDialogDescription>{t("profile.signOutDesc")}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={signingOut}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 text-white hover:bg-red-700"
              onClick={handleSignOut}
              disabled={signingOut}
            >
              {t("profile.signOutConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <ShopFooter />
    </div>
  );
}