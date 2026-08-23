import { useI18n } from "@velnox/i18n";

export default function ShopSettings() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <h1 className="text-lg font-semibold">{t("seller.shop_settings")}</h1>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <p className="text-sm text-muted-foreground">{t("seller.shop_settings")}</p>
      </div>
    </div>
  );
}
