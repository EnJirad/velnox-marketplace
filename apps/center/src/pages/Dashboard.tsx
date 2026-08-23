import { Users, ShoppingBag, DollarSign, Package } from "lucide-react";
import { useI18n } from "@velnox/i18n";

const stats = [
  { key: "total_users", value: "1,234", icon: Users, change: "+45" },
  { key: "total_sellers", value: "89", icon: ShoppingBag, change: "+12" },
  { key: "total_revenue", value: "฿2,450,000", icon: DollarSign, change: "+18%" },
  { key: "active_orders", value: "156", icon: Package, change: "+23" },
];

export default function Dashboard() {
  const { t } = useI18n();
  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border/40 bg-background/80 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 h-16 flex items-center">
          <h1 className="text-lg font-semibold">{t("center.dashboard")}</h1>
        </div>
      </div>
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat) => (
            <div key={stat.key} className="rounded-xl border border-border/60 p-6">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">{t(`center.${stat.key}`)}</p>
                <stat.icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="text-2xl font-bold mt-2">{stat.value}</p>
              <p className="text-xs text-green-600 mt-1">{stat.change}</p>
            </div>
          ))}
        </div>
        <div className="mt-8 rounded-xl border border-border/60 p-6">
          <h2 className="text-lg font-semibold mb-4">{t("center.recent_activity")}</h2>
          <p className="text-sm text-muted-foreground">{t("center.platform_health")}</p>
        </div>
      </div>
    </div>
  );
}
