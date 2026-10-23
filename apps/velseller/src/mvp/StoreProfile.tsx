/**
 * `/seller/profile` — the store profile page (the original "My shop" screen).
 *
 * Store name and description are editable by the owner while the application is
 * `pending` or `approved`; a rejected or suspended store is read-only and says
 * so from the server's own state. The verified "V" chip is shown for approved
 * stores only — the same fact every product card reads.
 */
import { VBadgeChip } from "@velnox/shared/components/VBadge";
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { getMvpApi } from "@velnox/shared/mvp";
import { MvpErrorState, MvpLoading, toMvpError, useMvpQuery } from "@velnox/shared/mvp/ui";
import { Loader2, ShieldCheck, Store } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

export default function StoreProfile() {
  const { t } = useLanguage();
  const status = useMvpQuery(() => getMvpApi().seller.status(), []);
  const seller = status.data?.seller ?? null;

  const [storeName, setStoreName] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!seller) return;
    setStoreName(seller.store_name ?? seller.storeName ?? "");
    setDescription(seller.description ?? "");
  }, [seller]);

  if (status.loading) return <MvpLoading label={t("common.loading")} />;
  if (status.error) return <MvpErrorState error={status.error} onRetry={status.reload} />;
  if (!seller) {
    return (
      <div className="mx-auto w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-6 text-center">
        <Store className="mx-auto size-6 text-slate-300" />
        <p className="mt-3 text-sm text-slate-600">{t("profile.notSignedIn")}</p>
      </div>
    );
  }

  const editable = seller.status === "pending" || seller.status === "approved";

  const save = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await getMvpApi().seller.updateProfile({
        storeName: storeName.trim(),
        description: description.trim() || null,
      });
      toast.success(t("sellerNav.profileSaved"));
      status.reload();
    } catch (err) {
      setError(toMvpError(err).message);
      toast.error(t("sellerNav.profileFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto grid w-full max-w-lg gap-4">
      <div>
        <h1 className="text-2xl font-black tracking-tight text-slate-900">
          {t("sellerNav.profileTitle")}
        </h1>
        <p className="mt-1 text-sm text-slate-500">{t("sellerNav.profileDesc")}</p>
      </div>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="flex size-11 items-center justify-center rounded-xl bg-emerald-50">
              <Store className="size-5 text-[#10B981]" />
            </span>
            <div>
              <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                {storeName || seller.store_name || seller.storeName}
                <VBadgeChip verified={seller.status === "approved"} />
              </p>
              <p className="text-xs text-slate-400">/{seller.slug}</p>
            </div>
          </div>
          <span
            className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${
              seller.status === "approved"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                : seller.status === "pending"
                  ? "border-amber-200 bg-amber-50 text-amber-700"
                  : "border-slate-200 bg-slate-100 text-slate-600"
            }`}
          >
            {seller.status}
          </span>
        </div>

        <form onSubmit={save} className="mt-5 grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="store-name" className="text-xs font-medium text-slate-500">
              {t("sellerNav.storeName")}
            </Label>
            <Input
              id="store-name"
              required
              minLength={2}
              maxLength={120}
              value={storeName}
              onChange={(event) => setStoreName(event.target.value)}
              disabled={busy || !editable}
              className="h-11 rounded-[10px] border-slate-200"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="store-desc" className="text-xs font-medium text-slate-500">
              {t("sellerNav.storeDesc")}
            </Label>
            <textarea
              id="store-desc"
              rows={3}
              value={description}
              maxLength={2000}
              onChange={(event) => setDescription(event.target.value)}
              disabled={busy || !editable}
              className="rounded-[10px] border border-slate-200 bg-white px-3 py-2.5 text-sm outline-none focus:border-[#10B981] focus:ring-2 focus:ring-[#10B981]/20 disabled:bg-slate-50"
            />
          </div>

          {error && (
            <p className="rounded-[10px] bg-rose-50 px-3 py-2 text-xs text-rose-700" role="alert">
              {error}
            </p>
          )}

          {editable ? (
            <Button
              type="submit"
              className="h-11 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
              disabled={busy || storeName.trim().length < 2}
            >
              {busy && <Loader2 className="size-4 animate-spin" />}
              {t("sellerNav.profileSave")}
            </Button>
          ) : (
            <p className="flex items-start gap-1.5 rounded-[10px] bg-[#F8FAFC] px-3 py-2 text-[11px] leading-5 text-slate-500">
              <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-slate-400" />
              {seller.rejection_reason ?? seller.suspension_reason ?? t("common.error")}
            </p>
          )}
        </form>
      </section>
    </div>
  );
}
