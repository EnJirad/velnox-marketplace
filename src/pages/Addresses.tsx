import { useEffect, useState } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { useI18n } from "@velnox/i18n";
import { useAuth } from "@velnox/hooks";
import { addressesApi } from "@velnox/api";
import type { Address } from "@velnox/types";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@velnox/ui/EmptyState";
import { Skeleton } from "@velnox/ui/Skeleton";

export default function Addresses() {
  const { t } = useI18n();
  const { isAuthenticated, login } = useAuth();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) {
      setLoading(false);
      return;
    }
    addressesApi
      .list()
      .then((res: { addresses: Address[] }) => setAddresses(res.addresses))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <Layout>
        <div className="mx-auto max-w-md px-4 py-16 text-center">
          <h1 className="text-2xl font-bold mb-2">{t("common.saved_addresses")}</h1>
          <p className="text-muted-foreground mb-6">{t("common.welcome_message")}</p>
          <Button onClick={login}>{t("common.sign_in_with_google")}</Button>
        </div>
      </Layout>
    );
  }

  const handleDelete = async (id: string) => {
    try {
      await addressesApi.delete(id);
      setAddresses((prev) => prev.filter((a) => a.id !== id));
    } catch {
      // silent
    }
  };

  return (
    <Layout>
      <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold tracking-tight">{t("common.saved_addresses")}</h1>
          <Button>
            <Plus className="h-4 w-4 mr-2" />
            {t("common.add_address")}
          </Button>
        </div>

        {loading ? (
          <div className="space-y-4">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="rounded-xl border border-border/60 p-6 space-y-3">
                <Skeleton className="h-5 w-24" />
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-36" />
              </div>
            ))}
          </div>
        ) : addresses.length === 0 ? (
          <EmptyState
            icon={<MapPin className="h-8 w-8 text-muted-foreground/40" />}
            title={t("common.no_address")}
            description={t("common.add_address")}
          />
        ) : (
          <div className="space-y-4">
            {addresses.map((addr) => (
              <div key={addr.id} className="rounded-xl border border-border/60 p-6">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-medium">{addr.label}</span>
                      {addr.isDefault && (
                        <span className="inline-flex items-center rounded-full bg-accent/10 px-2 py-0.5 text-xs font-medium text-accent">
                          {t("common.default_address")}
                        </span>
                      )}
                    </div>
                    <p className="text-sm">{addr.fullName}</p>
                    <p className="text-sm text-muted-foreground">{addr.line1}</p>
                    {addr.line2 && <p className="text-sm text-muted-foreground">{addr.line2}</p>}
                    <p className="text-sm text-muted-foreground">{addr.city}, {addr.state} {addr.postalCode}</p>
                    <p className="text-sm text-muted-foreground">{addr.phone}</p>
                  </div>
                  <button onClick={() => handleDelete(addr.id)} className="text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
