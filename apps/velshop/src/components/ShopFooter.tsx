/**
 * VelShop footer — the original layout, limited to destinations this build
 * actually serves. A footer link to a route that does not exist is worse than
 * no link, so Help/Cookie pages point at the corporate site instead of a dead
 * local path.
 */
import { Logo } from "@velnox/shared/components/Logo";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { SITE_URLS } from "@velnox/shared/lib/sites";
import { useMvpSessionContext } from "@velnox/shared/mvp/ui";
import type { ReactNode } from "react";
import { Link } from "react-router";

export function ShopFooter() {
  const { t } = useLanguage();
  const { user } = useMvpSessionContext();
  const year = new Date().getFullYear();

  return (
    <footer className="mt-16 border-t border-slate-200 bg-white">
      <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
        <div className="flex flex-col gap-10 md:flex-row md:items-start md:justify-between">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-3 text-sm leading-6 text-slate-500">{t("footer.tagline")}</p>
          </div>

          <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
            <FooterColumn title={t("footer.colShop")}>
              <FooterLink to="/products">{t("footer.allProducts")}</FooterLink>
              <FooterLink to="/categories">{t("nav.categories")}</FooterLink>
              <FooterLink to="/cart">{t("nav.cart")}</FooterLink>
            </FooterColumn>

            <FooterColumn title={t("footer.colAccount")}>
              {user ? (
                <>
                  <FooterLink to="/profile">{t("footer.myAccount")}</FooterLink>
                  <FooterLink to="/orders">{t("footer.accountOrders")}</FooterLink>
                  <FooterLink to="/wishlist">{t("footer.wishlist")}</FooterLink>
                </>
              ) : (
                <>
                  <FooterLink to="/auth?returnTo=/">{t("footer.accountLogin")}</FooterLink>
                  <FooterLink to="/products">{t("footer.browseShop")}</FooterLink>
                </>
              )}
            </FooterColumn>

            <FooterColumn title={t("footer.colSeller")}>
              <ExternalLink href={SITE_URLS.velseller}>{t("footer.sellerJoin")}</ExternalLink>
              <ExternalLink href={`${SITE_URLS.velseller}/auth`}>
                {t("footer.sellerLogin")}
              </ExternalLink>
            </FooterColumn>
          </div>
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-3 border-t border-slate-100 pt-5 sm:flex-row">
          <p className="text-xs text-slate-400">{t("footer.rights", { year })}</p>
          <div className="flex items-center gap-4 text-xs text-slate-400">
            <ExternalLink href={`${SITE_URLS.corporate}/privacy`} plain>
              {t("footer.privacy")}
            </ExternalLink>
            <ExternalLink href={`${SITE_URLS.corporate}/terms`} plain>
              {t("footer.terms")}
            </ExternalLink>
            <span>{t("footer.secureNote")}</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <nav aria-label={title}>
      <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">{title}</p>
      <ul className="mt-3 space-y-2">{children}</ul>
    </nav>
  );
}

function FooterLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <li>
      <Link to={to} className="text-sm text-slate-500 transition-colors hover:text-[#10B981]">
        {children}
      </Link>
    </li>
  );
}

function ExternalLink({
  href,
  children,
  plain = false,
}: {
  href: string;
  children: ReactNode;
  plain?: boolean;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={
        plain
          ? "transition-colors hover:text-slate-600"
          : "text-sm text-slate-500 transition-colors hover:text-[#10B981]"
      }
    >
      {children}
    </a>
  );
}
