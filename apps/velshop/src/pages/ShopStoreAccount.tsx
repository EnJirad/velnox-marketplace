/**
 * ShopStoreAccount — the storefront's ONE wholesale application surface.
 *
 * WHAT IT IS
 *   A community shop applies here for a STORE ACCOUNT: store name, a person to
 *   contact and a phone number. VelCenter reviews it, and only an APPROVED
 *   account is sent the selling units a seller marked wholesale
 *   (`product_selling_units.is_wholesale`). Nothing else in the account changes —
 *   no role, no session, no second login.
 *
 * WHY THE PAGE EXISTS AT ALL
 *   The wholesale half of the catalog is invisible until an account is approved,
 *   so without this page there would be no way to ask. It is also the only place
 *   the applicant learns the OUTCOME: pending / approved (and wholesale is now
 *   visible) / not approved, with the reviewer's own note.
 *
 * WHAT THE SERVER DECIDES (this page decides nothing)
 *   * whether the caller already has an account and in what state
 *     (`GET /api/customer/store-account`)
 *   * every validation rule, and whether a re-submission re-enters the queue
 *     (`POST /api/customer/store-account` — one row per user, upserted server-side)
 *   * approval itself, which only VelCenter can perform
 *   The form validates only enough to give an immediate message, and always
 *   surfaces the server's own error text verbatim.
 */
import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { AlertTriangle, CheckCircle2, ChevronLeft, Clock, Loader2, Store, XCircle } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type StoreAccountStatus = "pending" | "approved" | "rejected";

interface StoreAccountRow {
  id: string;
  storeName: string;
  contactName: string;
  contactPhone: string;
  address: string | null;
  note: string | null;
  status: StoreAccountStatus;
  approved: boolean;
  reviewNote: string | null;
  reviewedAt: string | null;
}

interface FormState {
  storeName: string;
  contactName: string;
  contactPhone: string;
  address: string;
  note: string;
}

const EMPTY_FORM: FormState = { storeName: "", contactName: "", contactPhone: "", address: "", note: "" };

export default function ShopStoreAccount() {
  const { t } = useLanguage();
  const loadStoreAccount = useAction(api.customer.myStoreAccount);
  const saveStoreAccount = useAction(api.customer.saveStoreAccount);

  const [account, setAccount] = useState<StoreAccountRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const applyRow = useCallback((row: StoreAccountRow | null) => {
    setAccount(row);
    setForm(
      row
        ? {
            storeName: row.storeName ?? "",
            contactName: row.contactName ?? "",
            contactPhone: row.contactPhone ?? "",
            address: row.address ?? "",
            note: row.note ?? "",
          }
        : EMPTY_FORM,
    );
  }, []);

  useEffect(() => {
    let alive = true;
    loadStoreAccount()
      .then((data) => {
        if (alive) applyRow((data ?? null) as StoreAccountRow | null);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : t("storeAccount.loadError"));
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [loadStoreAccount, applyRow, t]);

  const submit = async () => {
    const storeName = form.storeName.trim();
    const contactName = form.contactName.trim();
    const contactPhone = form.contactPhone.trim();
    if (!storeName || !contactName || !contactPhone) {
      setError(t("storeAccount.requiredError"));
      return;
    }
    if (!/^[0-9+\-\s()]{6,20}$/.test(contactPhone)) {
      setError(t("storeAccount.phoneError"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved = (await saveStoreAccount({
        storeName,
        contactName,
        contactPhone,
        address: form.address.trim() || null,
        note: form.note.trim() || null,
      })) as StoreAccountRow;
      applyRow(saved);
      toast.success(t("storeAccount.saved"));
    } catch (err) {
      const message = err instanceof Error ? err.message : t("storeAccount.saveError");
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const status = account?.status ?? null;
  const statusLabel =
    status === "approved"
      ? t("storeAccount.statusApproved")
      : status === "rejected"
        ? t("storeAccount.statusRejected")
        : t("storeAccount.statusPending");
  const statusNote =
    status === "approved"
      ? t("storeAccount.approvedNote")
      : status === "rejected"
        ? t("storeAccount.rejectedNote")
        : t("storeAccount.pendingNote");
  const StatusIcon = status === "approved" ? CheckCircle2 : status === "rejected" ? XCircle : Clock;
  const statusClass =
    status === "approved"
      ? "bg-emerald-50 text-emerald-700"
      : status === "rejected"
        ? "bg-rose-50 text-rose-700"
        : "bg-amber-50 text-amber-700";
  const submitLabel =
    status === "rejected" ? t("storeAccount.resubmit") : account ? t("storeAccount.update") : t("storeAccount.apply");

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <main className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" className="size-10 shrink-0 text-slate-500" asChild>
            <Link to="/profile" aria-label={t("account.backToProfile")}>
              <ChevronLeft className="size-5" />
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-slate-900">{t("storeAccount.title")}</h1>
            <p className="mt-0.5 text-sm text-slate-500">{t("storeAccount.lead")}</p>
          </div>
        </div>

        {loading ? (
          <div className="mt-8 space-y-4">
            <Skeleton className="h-24 rounded-2xl" />
            <Skeleton className="h-72 rounded-2xl" />
          </div>
        ) : (
          <>
            {account && (
              <section className="mt-8 rounded-3xl border border-slate-200 bg-white p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-1.5 text-sm font-bold text-slate-900">
                      <Store className="size-4 shrink-0 text-[#10B981]" />
                      <span className="truncate">{account.storeName}</span>
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      {account.contactName} · {account.contactPhone}
                    </p>
                  </div>
                  <Badge className={`shrink-0 gap-1 ${statusClass}`}>
                    <StatusIcon className="size-3" />
                    {statusLabel}
                  </Badge>
                </div>
                <p className="mt-3 rounded-[10px] bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                  {statusNote}
                </p>
                {account.reviewNote && (
                  <div className="mt-2 rounded-[10px] border border-slate-100 px-3 py-2">
                    <p className="text-[11px] font-medium text-slate-400">{t("storeAccount.reviewNoteLabel")}</p>
                    <p className="mt-0.5 text-xs text-slate-700">{account.reviewNote}</p>
                  </div>
                )}
              </section>
            )}

            {error && (
              <p className="mt-4 flex items-start gap-1.5 rounded-xl bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                {error}
              </p>
            )}

            <section className="mt-4 rounded-3xl border border-slate-200 bg-white p-5">
              <div className="grid gap-4">
                <div className="grid gap-2">
                  <Label htmlFor="store-name">{t("storeAccount.storeName")}</Label>
                  <Input
                    id="store-name"
                    value={form.storeName}
                    onChange={(e) => setForm((f) => ({ ...f, storeName: e.target.value }))}
                    placeholder={t("storeAccount.storeNamePlaceholder")}
                    className="h-11 rounded-[10px] border-slate-200"
                    maxLength={120}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="store-contact">{t("storeAccount.contactName")}</Label>
                  <Input
                    id="store-contact"
                    value={form.contactName}
                    onChange={(e) => setForm((f) => ({ ...f, contactName: e.target.value }))}
                    className="h-11 rounded-[10px] border-slate-200"
                    maxLength={120}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="store-phone">{t("storeAccount.contactPhone")}</Label>
                  <Input
                    id="store-phone"
                    type="tel"
                    value={form.contactPhone}
                    onChange={(e) => setForm((f) => ({ ...f, contactPhone: e.target.value }))}
                    className="h-11 rounded-[10px] border-slate-200"
                    maxLength={40}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="store-address">{t("storeAccount.address")}</Label>
                  <Input
                    id="store-address"
                    value={form.address}
                    onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
                    className="h-11 rounded-[10px] border-slate-200"
                    maxLength={400}
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="store-note">{t("storeAccount.note")}</Label>
                  <textarea
                    id="store-note"
                    value={form.note}
                    onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
                    rows={3}
                    maxLength={400}
                    className="w-full rounded-[10px] border border-slate-200 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#10B981]"
                  />
                </div>
              </div>
              <Button
                className="mt-5 w-full gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
                onClick={() => void submit()}
                disabled={saving}
              >
                {saving ? <Loader2 className="size-4 animate-spin" /> : <Store className="size-4" />}
                {submitLabel}
              </Button>
            </section>
          </>
        )}
      </main>

      <ShopFooter />
    </div>
  );
}
