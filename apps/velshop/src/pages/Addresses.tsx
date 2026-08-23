import { useEffect, useState } from "react";
import { MapPin, Plus, Trash2 } from "lucide-react";
import { Layout } from "@/components/layout/Layout";
import { useI18n } from "@velnox/i18n";
import { useAuth } from "@/hooks/use-auth";
import type { Address } from "@/types";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";

export default function Addresses() {
  const { t } = useI18n();
  const { isAuthenticated, login } = useAuth();
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!isAuthenticated) { setLoading(false); return; }
    api.get<{ addresses: Address[] }>("/addresses").then((res) => setAddresses(res.addresses)).catch(() => {}).finally(() => setLoading(false));
  }, [isAuthenticated]);

  if (!isAuthenticated) return (<Layout><div className="mx-auto max-w-md px-4 py-16 text-center"><h1 className="text-2xl font-bold mb-2">{t("common.saved_addresses")}</h1><p className="text-muted-foreground mb-6">{t("common.welcome_message")}</p><Button onClick={login}>{t("common.sign_in_with_google")}</Button></div></Layout>);

  const handleDelete = async (id: string) => { try { await api.delete(`/addresses/${id}`); setAddresses((prev) => prev.filter((a) => a.id !== id)); } catch { /* silent */ } };

  return (
    <Layout>
      <div className="mx-auto max-w-2xl px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex items-center justify-between mb-8"><h1 className="text-2xl font-bold tracking-tight">{t("common.saved_addresses")}</h1><Button><Plus className="h-4 w-4 mr-2" />{t("common.add_address")}</Button></div>
        {loading ? <div className="space-y-4">{Array.from({ length: 2 }).map((_, i) => <div key={i} className="rounded-xl border border-border/60 p-6"><div className="h-4 w-32 bg-muted rounded animate-pulse" /></div>)}</div>
        : addresses.length === 0 ? <div className="flex flex-col items-center justify-center py-20"><MapPin className="h-8 w-8 text-muted-foreground/40 mb-4" /><h3 className="text-lg font-medium mb-1">{t("common.no_addresses")}</h3></div>
        : <div className="space-y-4">{addresses.map((address) => (
          <div key={address.id} className="rounded-xl border border-border/60 p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 mb-1"><span className="text-sm font-medium">{address.label}</span>{address.isDefault && <span className="text-xs bg-accent/10 text-accent px-2 py-0.5 rounded-full">Default</span>}</div>
                <p className="text-sm text-muted-foreground">{address.fullName}</p>
                <p className="text-sm text-muted-foreground">{address.line1}{address.line2 ? `, ${address.line2}` : ""}</p>
                <p className="text-sm text-muted-foreground">{address.city}, {address.state} {address.postalCode}</p>
              </div>
              <button onClick={() => handleDelete(address.id)} className="text-muted-foreground hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}</div>}
      </div>
    </Layout>
  );
}
