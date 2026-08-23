import { Link } from "react-router";
import { useI18n } from "@velnox/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen flex items-center justify-center bg-background">
      <div className="text-center">
        <span className="text-6xl font-bold text-muted-foreground/20">404</span>
        <h1 className="text-2xl font-bold mt-4">{t("common.page_not_found")}</h1>
        <Link to="/" className="inline-block mt-4 text-sm text-accent hover:text-accent/80">{t("common.back_to_home")}</Link>
      </div>
    </div>
  );
}
