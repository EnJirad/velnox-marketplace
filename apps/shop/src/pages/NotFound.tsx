import { Link } from "react-router";
import { Layout } from "@/components/layout/Layout";
import { Button } from "@/components/ui/button";
import { useI18n } from "@velnox/i18n";

export default function NotFound() {
  const { t } = useI18n();
  return (
    <Layout>
      <div className="mx-auto max-w-md px-4 py-16 sm:py-24 text-center">
        <div className="mb-6">
          <span className="text-6xl font-bold text-muted-foreground/20">404</span>
        </div>
        <h1 className="text-2xl font-bold mb-2">{t("common.page_not_found")}</h1>
        <p className="text-muted-foreground mb-8">{t("common.page_not_found_desc")}</p>
        <Link to="/">
          <Button size="lg">{t("common.back_to_home")}</Button>
        </Link>
      </div>
    </Layout>
  );
}
