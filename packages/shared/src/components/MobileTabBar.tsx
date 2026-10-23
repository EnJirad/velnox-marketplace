/**
 * App-like floating bottom navigation (mobile).
 *
 * Restored from the original storefront: a rounded, elevated pill above the
 * safe-area inset, hidden from `md` up where the top header takes over. Each
 * app passes its own destinations; the auth flow is a full-screen sheet, so the
 * bar hides there.
 */
import type { LucideIcon } from "lucide-react";
import { Link, useLocation } from "react-router";
import { useLanguage } from "../lib/i18n/index.js";
import { cn } from "../lib/utils.js";

export interface MobileTabItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** Custom active check. Default: exact path or `pathname.startsWith(to + "/")`. */
  activeMatch?: (pathname: string, search: string) => boolean;
  /** Optional badge count (e.g. cart item count). Hidden when 0 / null. */
  badge?: number | null;
}

export function MobileTabBar({ items }: { items: MobileTabItem[] }) {
  const { t } = useLanguage();
  const { pathname, search } = useLocation();
  if (pathname.startsWith("/auth")) return null;

  return (
    <nav
      aria-label={t("nav.ariaMobile")}
      className="pointer-events-none fixed inset-x-0 bottom-0 z-50 flex justify-center px-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] md:hidden"
    >
      <div className="pointer-events-auto flex h-16 w-full max-w-md items-stretch rounded-2xl border border-slate-200/80 bg-white/95 shadow-[0_10px_34px_rgba(15,23,42,0.14)] backdrop-blur">
        {items.map((item) => {
          const Icon = item.icon;
          const active = item.activeMatch
            ? item.activeMatch(pathname, search)
            : pathname === item.to || pathname.startsWith(`${item.to}/`);
          return (
            <Link
              key={item.to}
              to={item.to}
              aria-current={active ? "page" : undefined}
              className={cn(
                "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-1 py-1.5 transition-colors",
                active ? "text-[#10B981]" : "text-slate-400 hover:text-slate-600 active:text-slate-500",
              )}
            >
              <span
                className={cn(
                  "relative flex h-8 w-14 items-center justify-center rounded-full transition-colors",
                  active && "bg-[#ECFDF5]",
                )}
              >
                <Icon className="size-[22px]" strokeWidth={active ? 2.4 : 2} />
                {item.badge != null && item.badge > 0 && (
                  <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-[#10B981] px-1 text-[10px] font-bold leading-none text-white">
                    {item.badge > 99 ? "99+" : item.badge}
                  </span>
                )}
              </span>
              <span
                className={cn("text-[10px] leading-none", active ? "font-semibold" : "font-medium")}
              >
                {item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
