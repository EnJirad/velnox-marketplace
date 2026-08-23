import { Package, ShoppingBag, DollarSign, TrendingUp } from "lucide-react";
import { useI18n } from "@velnox/i18n";

const stats = [
  { key: "total_sales", value: "฿125,430", icon: DollarSign, change: "+12%" },
  { key: "total_orders", value: "89", icon: ShoppingBag, change: "+8%" },
  { key: "total_products", value: "24", icon: Package, change: "+3" },
  { key: "revenue", value: "฿45,200", icon: TrendingUp, change: "+15%" },
];

export default function Dashboard() {
  const { t } = useI18n();

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <h1 className="text-lg font-semibold">{t("seller.dashboard")}</h1>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <div key={stat.key} className="rounded-xl border border-border/60 p-6">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{t(`seller.${stat.key}`)}</p>
                <stat.icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-2xl font-bold mt-2">{stat.value}</p>
              <p className="text-xs text-green-600 mt-1">{stat.change}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-xl border border-border/60 p-6">
          <h2 className="text-lg font-semibold mb-4">{t("seller.recent_orders")}</h2>
          <p className="text-sm text-muted-foreground">{t("seller.no_products_yet")}</p>
        </div>
      </div>
    </div>
  );
}
