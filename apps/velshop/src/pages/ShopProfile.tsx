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
import {
  Bell,
  CalendarDays,
  ChevronRight,
  CircleUserRound,
  Heart,
  LifeBuoy,
  LogOut,
  MapPin,
  Package,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

/**
 * ShopProfile — customer profile page.
 *
 * Upload edit is NOT here. Camera buttons on the profile header have been
 * removed per product spec. Avatar/cover editing is in the Account page
 * (/profile/account → ShopAccount.tsx).
 */
interface ProfileRow {
  to: string;
  labelKey: string;
  descKey: string;
  icon: LucideIcon;
}

const SECTIONS: ProfileRow[] = [
  { to: "/orders", labelKey: "profile.orders", descKey: "profile.ordersDesc", icon: Package },
  { to: "/velrepeat", labelKey: "profile.velrepeat", descKey: "profile.velrepeatDesc", icon: RefreshCw },
  { to: "/wishlist", labelKey: "profile.wishlist", descKey: "profile.wishlistDesc", icon: Heart },
  { to: "/addresses", labelKey: "profile.addresses", descKey: "profile.addressesDesc", icon: MapPin },
  { to: "/notifications", labelKey: "profile.notifications", descKey: "profile.notificationsDesc", icon: Bell },
  { to: "/profile/account", labelKey: "profile.account", descKey: "profile.accountDesc", icon: CircleUserRound },
  { to: "/profile/account", labelKey: "profile.help", descKey: "profile.helpDesc", icon: LifeBuoy },
];

export default function ShopProfile() {
  const { t } = useLanguage();
  const { user, isLoading, isAuthenticated, signOut } = useAuth();
  const myProfile = useAction(api.customer.myProfile);
  const [profile, setProfile] = useState<{
    name: string | null;
    email: string | null;
    phone: string | null;
    avatarUrl: string | null;
    coverUrl: string | null;
    memberSince: number | null;
  } | null>(null);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) return;
    let alive = true;
    myProfile()
      .then((res) => {
        if (!alive) return;
        const data = res as {
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
      })
      .catch((err) => {
        console.error("Load profile error:", err);
      });
    return () => {
      alive = false;
    };
  }, [myProfile, isAuthenticated]);

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      setProfile(null);
      toast.success(t("profile.signedOut"));
    } finally {
      setSigningOut(false);
      setSignOutOpen(false);
    }
  };

  const displayName = profile?.name ?? user?.name ?? user?.email ?? "";
  const displayEmail = profile?.email ?? user?.email ?? "";
  const memberSince = profile?.memberSince ?? null;
  const avatarSrc = profile?.avatarUrl ?? user?.avatarUrl ?? user?.image ?? null;
  const coverSrc = profile?.coverUrl ?? user?.coverUrl ?? null;

  const formatMemberSince = (ms: number) =>
    new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "long", year: "numeric" }).format(
      new Date(ms),
    );

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <main className="mx-auto w-full max-w-2xl px-4 py-8 sm:px-6 sm:py-10">
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
            <Skeleton className="h-64 rounded-3xl" />
          </div>
        ) : isAuthenticated ? (
          <>
            {/* Identity header — cover · avatar · name/email · edit link */}
            <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white">
              {/* Cover */}
              <div className="relative h-40 bg-gradient-to-r from-[#0f766e] via-[#10B981] to-[#34d399] sm:h-44">
                <CoverImage
                  src={coverSrc}
                  alt={t("profile.coverAlt", { name: displayName || "VelShop" })}
                  className="absolute inset-0 size-full object-cover"
                />
              </div>

              {/* Avatar + info */}
              <div className="px-5 pb-5">
                <div className="relative -mt-12 flex w-fit">
                  <span
                    className={`flex size-24 shrink-0 items-center justify-center overflow-hidden rounded-full border-4 border-white shadow-sm ${
                      avatarSrc
                        ? "bg-transparent"
                        : "bg-[#ECFDF5] text-3xl font-bold text-[#10B981]"
                    }`}
                  >
                    {/* AvatarImage was removed — using plain img for simplicity.
                        Avatar editing is in Account page. */}
                    {avatarSrc ? (
                      <img
                        src={avatarSrc}
                        alt={t("profile.avatarAlt", { name: displayName || "VelShop" })}
                        className="size-full object-cover"
                      />
                    ) : (
                      <>{(displayName || "?").slice(0, 1).toUpperCase()}</>
                    )}
                  </span>
                </div>

                <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate text-lg font-bold text-slate-900">
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
              </div>
            </section>

            {/* Menu rows */}
            <section className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white">
              {SECTIONS.map((s, i) => {
                const Icon = s.icon;
                return (
                  <Link
                    key={s.to + s.labelKey}
                    to={s.to}
                    className={`flex items-center gap-3.5 px-5 py-4 transition-colors hover:bg-[#F8FAFC] ${
                      i > 0 ? "border-t border-slate-100" : ""
                    }`}
                  >
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-[12px] bg-slate-100 text-slate-500">
                      <Icon className="size-[18px]" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-slate-900">{t(s.labelKey)}</span>
                      <span className="mt-0.5 block truncate text-xs text-slate-400">{t(s.descKey)}</span>
                    </span>
                    <ChevronRight className="size-4 shrink-0 text-slate-300" />
                  </Link>
                );
              })}
            </section>

            {/* Logout */}
            <section className="mt-4 overflow-hidden rounded-3xl border border-slate-200 bg-white">
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
