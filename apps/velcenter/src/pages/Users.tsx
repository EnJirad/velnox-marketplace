import { useI18n } from "@velnox/i18n";

export default function Users() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <h1 className="text-lg font-semibold">{t("center.users")}</h1>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <p className="text-sm text-muted-foreground">{t("center.total_users")}</p>
      </div>
    </div>
  );
}
