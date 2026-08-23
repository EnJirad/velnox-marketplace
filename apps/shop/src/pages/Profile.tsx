import { Link } from "react-router";
import { User, Package, MapPin, Settings } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { useI18n } from "@velnox/i18n";
import { useAuth } from "@velnox/hooks";
import { AvatarUpload } from "@velnox/ui/AvatarUpload";
import { Button } from "@/components/ui/button";

export default function Profile() {
  const { t } = useI18n();
  const { user, isAuthenticated, login } = useAuth();

  if (!isAuthenticated || !user) {
    return (
      <Layout>
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <h1 className="text-2xl font-bold mb-2">{t("common.profile")}</h1>
          <p className="text-muted-foreground mb-6">{t("common.welcome_message")}</p>
          <Button onClick={login}>{t("common.sign_in_with_google")}</Button>
        </div>
      </Layout>
    );
  }

  const handleAvatarUpload = async (_file: File) => {
    // TODO: Implement via backend API
  };

  return (
    <Layout>
      <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-2xl font-bold tracking-tight mb-8">{t("common.my_account")}</h1>

        {/* Profile Header */}
        <div className="rounded-xl border border-border/60 p-6 mb-6">
          <div className="flex items-center gap-6">
            <AvatarUpload
              currentAvatar={user.avatar}
              onUpload={handleAvatarUpload}
              size="lg"
            />
            <div>
              <h2 className="text-xl font-semibold">{user.name}</h2>
              <p className="text-sm text-muted-foreground">{user.email}</p>
            </div>
          </div>
        </div>

        {/* Menu Items */}
        <div className="space-y-2">
          {[
            { icon: User, label: t("common.personal_info"), href: "/profile" },
            { icon: Package, label: t("common.order_history"), href: "/orders" },
            { icon: MapPin, label: t("common.saved_addresses"), href: "/addresses" },
            { icon: Settings, label: t("common.settings"), href: "/settings" },
          ].map((item) => (
            <Link
              key={item.href}
              to={item.href}
              className="flex items-center gap-4 rounded-xl border border-border/60 p-4 hover:border-accent/30 hover:shadow-sm transition-all"
            >
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                <item.icon className="h-5 w-5 text-muted-foreground" />
              </div>
              <span className="text-sm font-medium">{item.label}</span>
            </Link>
          ))}
        </div>
      </div>
    </Layout>
  );
}
