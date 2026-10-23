/**
 * Account dropdown — the original header menu, on the MVP session.
 *
 * It is presentation only: every destination re-checks the server session, and
 * signing out calls `POST /api/mvp/auth/logout` before the page reloads so the
 * shared session snapshot cannot survive a logout.
 */
import { AvatarImage } from "./ui/avatar-image.js";
import { Button } from "./ui/button.js";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu.js";
import { useLanguage } from "../lib/i18n/index.js";
import { useMvpSessionContext, mvpSignOut } from "../mvp/ui.js";
import { ChevronDown, Heart, LogOut, Package, UserRound } from "lucide-react";
import { useNavigate } from "react-router";

function initials(name?: string, email?: string): string {
  const source = name?.trim() || email?.trim() || "V";
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

const ROLE_KEY: Record<string, string> = {
  owner: "role.owner",
  admin: "role.admin",
  seller: "role.seller",
  customer: "role.customer",
};

export function UserMenu({ align = "end" }: { align?: "start" | "center" | "end" }) {
  const { user, seller, loading } = useMvpSessionContext();
  const { t } = useLanguage();
  const navigate = useNavigate();

  const signOut = async () => {
    await mvpSignOut();
    // Hard navigation: every provider re-reads `/auth/me` from the server.
    window.location.assign("/");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          className="flex h-10 cursor-pointer items-center gap-2 rounded-[10px] px-1.5 py-1 text-slate-700 hover:bg-slate-100 sm:px-2"
          aria-label={t("header.ariaProfile")}
        >
          <span
            className={`relative flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full border ${
              loading
                ? "animate-pulse border-transparent bg-slate-100"
                : user?.avatarUrl
                  ? "border-transparent bg-slate-100"
                  : "border-slate-200 bg-slate-900"
            }`}
          >
            <AvatarImage
              src={user?.avatarUrl ?? undefined}
              alt={user?.name ?? ""}
              className="size-full object-cover"
              fallback={
                <span className="flex size-full items-center justify-center text-xs font-semibold text-white">
                  {initials(user?.name, user?.email)}
                </span>
              }
            />
          </span>
          <span className="hidden text-left lg:block">
            <span className="block max-w-32 truncate text-sm font-medium leading-4 text-slate-900">
              {user?.name || user?.email || t("nav.account")}
            </span>
            <span className="block text-[11px] text-slate-400">
              {t(ROLE_KEY[user?.role ?? "customer"] ?? "role.customer")}
            </span>
          </span>
          <ChevronDown className="hidden size-4 text-slate-400 lg:block" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align={align} className="w-60 bg-white">
        <DropdownMenuLabel>
          <p className="truncate text-sm font-medium text-slate-900">{user?.name || "Velnox"}</p>
          <p className="truncate text-xs font-normal text-slate-400">{user?.email}</p>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem className="cursor-pointer gap-2" onClick={() => navigate("/profile")}>
          <UserRound className="size-4" />
          {t("nav.profile")}
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer gap-2" onClick={() => navigate("/orders")}>
          <Package className="size-4" />
          {t("nav.orders")}
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer gap-2" onClick={() => navigate("/wishlist")}>
          <Heart className="size-4" />
          {t("nav.wishlist")}
        </DropdownMenuItem>
        {seller?.status === "approved" && (
          <DropdownMenuItem
            className="cursor-pointer gap-2"
            onClick={() =>
              window.location.assign(
                `${(import.meta.env.VITE_VELSELLER_URL as string | undefined) ?? "https://seller.velnox.com"}/`,
              )
            }
          >
            <Package className="size-4" />
            {t("nav.sellerDashboard")}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer gap-2 text-red-600 focus:bg-red-50 focus:text-red-600"
          onClick={() => void signOut()}
        >
          <LogOut className="size-4" />
          {t("profile.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
