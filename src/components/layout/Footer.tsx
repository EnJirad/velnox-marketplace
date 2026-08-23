import { Link } from "react-router";
import { useI18n } from "@velnox/i18n";

export function Footer() {
  const { t } = useI18n();
  return (
    <footer className="border-t border-border/40 bg-muted/30">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 py-12 md:grid-cols-4">
          <div className="col-span-2 md:col-span-1">
            <Link to="/" className="flex items-center gap-2">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">V</div>
              <span className="text-lg font-bold tracking-tight">Velnox</span>
            </Link>
            <p className="mt-3 text-sm text-muted-foreground leading-relaxed">{t("common.shop_description")}</p>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-3">{t("common.shop")}</h3>
            <ul className="space-y-2.5">
              <li><Link to="/products" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t("common.all_products")}</Link></li>
              <li><Link to="/products?featured=true" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t("common.featured")}</Link></li>
              <li><Link to="/products" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t("common.categories")}</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-3">{t("common.orders")}</h3>
            <ul className="space-y-2.5">
              <li><Link to="/orders" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t("common.order_history")}</Link></li>
              <li><Link to="/addresses" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t("common.saved_addresses")}</Link></li>
              <li><Link to="/profile" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t("common.profile")}</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-semibold mb-3">{t("common.account")}</h3>
            <ul className="space-y-2.5">
              <li><Link to="/profile" className="text-sm text-muted-foreground hover:text-foreground transition-colors">{t("common.my_account")}</Link></li>
              <li><span className="text-sm text-muted-foreground">{t("common.settings")}</span></li>
              <li><span className="text-sm text-muted-foreground">{t("common.privacy_policy")}</span></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-border/40 py-6 flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">&copy; {new Date().getFullYear()} Velnox. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <span className="text-xs text-muted-foreground">Terms</span>
            <span className="text-xs text-muted-foreground">Privacy</span>
            <span className="text-xs text-muted-foreground">Cookies</span>
          </div>
        </div>
      </div>
    </footer>
  );
}
