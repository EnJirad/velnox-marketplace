/**
 * `/addresses` — the restored address book.
 *
 * The original shopper page listed saved addresses as cards, edited them in a
 * dialog, and required a map-picked GPS position before an address could be the
 * default. That UX is kept; the data comes from `/api/mvp/addresses`, which
 * scopes every row to the session's user and enforces the same GPS rule
 * server-side.
 *
 * `state` is stored alongside `city` because the canonical `addresses` table
 * requires both, and the legacy form only ever asked for a province — so the
 * chosen province fills both columns and the checkout snapshot stays complete.
 */
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { getMvpApi, type MvpAddress, type MvpAddressInput } from "@velnox/shared/mvp";
import { toMvpError, useMvpQuery } from "@velnox/shared/mvp/ui";
import { AlertCircle, Loader2, MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { MapPicker } from "@/components/shop/MapPicker";

interface FormState {
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  subdistrict: string;
  district: string;
  province: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  /** Coordinates only count once the customer confirms them on the map. */
  locationConfirmed: boolean;
}

type FormErrors = Partial<
  Record<"recipientName" | "phone" | "line1" | "province" | "postalCode" | "gps", string>
>;

const EMPTY_FORM: FormState = {
  label: "Home",
  recipientName: "",
  phone: "",
  line1: "",
  subdistrict: "",
  district: "",
  province: "",
  postalCode: "",
  latitude: null,
  longitude: null,
  isDefault: false,
  locationConfirmed: false,
};

function formatAddress(a: MvpAddress): string {
  return [a.line1, a.line2, a.subdistrict, a.district, a.city, a.postalCode]
    .filter(Boolean)
    .join(" · ");
}

export default function Addresses() {
  const { t } = useLanguage();
  const list = useMvpQuery(() => getMvpApi().addresses.list(), []);
  const [open, setOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [errors, setErrors] = useState<FormErrors>({});
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const openCreate = () => {
    setEditingId(null);
    setErrors({});
    setForm({ ...EMPTY_FORM, label: t("addresses.labelPlaceholder").split(" / ")[0] ?? "Home" });
    setOpen(true);
  };

  const openEdit = (a: MvpAddress) => {
    const hasCoords = a.latitude != null && a.longitude != null;
    setEditingId(a.id);
    setErrors({});
    setForm({
      label: a.label,
      recipientName: a.recipientName,
      phone: a.phone,
      line1: a.line1,
      subdistrict: a.subdistrict ?? "",
      district: a.district ?? "",
      province: a.city,
      postalCode: a.postalCode,
      latitude: a.latitude,
      longitude: a.longitude,
      isDefault: a.isDefault,
      locationConfirmed: hasCoords,
    });
    setOpen(true);
  };

  const setField = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    if (key in errors) setErrors((current) => ({ ...current, [key]: undefined }));
  };

  const setCoords = (lat: number, lng: number, source?: "auto" | "user") => {
    setForm((current) => ({
      ...current,
      latitude: lat,
      longitude: lng,
      // An auto-located position is pre-confirmed; moving the map resets it.
      locationConfirmed: source === "auto" ? true : false,
    }));
    setErrors((current) => ({ ...current, gps: undefined }));
  };

  const validate = (): FormErrors => {
    const next: FormErrors = {};
    if (!form.recipientName.trim()) next.recipientName = t("addresses.required");
    else if (form.recipientName.trim().length > 120)
      next.recipientName = t("addresses.recipientPlaceholder");
    const digits = form.phone.replace(/[\s\-()]/g, "");
    if (!digits) next.phone = t("addresses.required");
    else if (!/^[0-9+]+$/.test(digits) || digits.length < 9 || digits.length > 15)
      next.phone = t("addresses.phonePlaceholder");
    if (!form.line1.trim()) next.line1 = t("addresses.required");
    if (!form.province.trim()) next.province = t("addresses.provinceRequired");
    if (!/^\d{5}$/.test(form.postalCode.trim())) next.postalCode = t("addresses.postalRequired");
    if (form.latitude == null || form.longitude == null) next.gps = t("addresses.locationRequired");
    else if (!form.locationConfirmed) next.gps = t("addresses.confirmLocationRequired");
    return next;
  };

  const save = async () => {
    if (submitting) return;
    const found = validate();
    setErrors(found);
    if (Object.values(found).some(Boolean)) return;

    const payload: MvpAddressInput = {
      label: form.label.trim() || "Home",
      recipientName: form.recipientName.trim(),
      phone: form.phone.trim(),
      line1: form.line1.trim(),
      subdistrict: form.subdistrict.trim() || null,
      district: form.district.trim() || null,
      city: form.province.trim(),
      state: form.province.trim(),
      postalCode: form.postalCode.trim(),
      latitude: form.latitude,
      longitude: form.longitude,
      isDefault: form.isDefault,
    };

    setSubmitting(true);
    try {
      if (editingId) {
        await getMvpApi().addresses.update(editingId, payload);
        toast.success(t("addresses.updateSuccess"));
      } else {
        await getMvpApi().addresses.create(payload);
        toast.success(t("addresses.saveSuccess"));
      }
      setOpen(false);
      list.reload();
    } catch (error) {
      const api = toMvpError(error);
      const gps = /GPS|coordinate/i.test(api.message);
      setErrors(gps ? { gps: api.message } : {});
      toast.error(gps ? api.message : t("addresses.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const setDefault = async (a: MvpAddress) => {
    if (a.isDefault) return;
    if (a.latitude == null || a.longitude == null) {
      toast.error(t("addresses.setDefaultGpsError"));
      return;
    }
    setSubmitting(true);
    try {
      await getMvpApi().addresses.setDefault(a.id);
      toast.success(t("addresses.setDefaultSuccess"));
      list.reload();
    } catch (error) {
      toast.error(toMvpError(error).message || t("addresses.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const remove = async (a: MvpAddress) => {
    setDeletingId(a.id);
    try {
      await getMvpApi().addresses.remove(a.id);
      toast.success(t("addresses.deleteSuccess"));
      list.reload();
    } catch {
      toast.error(t("addresses.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  };

  const addresses = list.data ?? null;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
            <MapPin className="size-4 text-[#10B981]" />
            {t("addresses.eyebrow")}
          </p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
            {t("addresses.title")}
          </h1>
          <p className="mt-1.5 text-sm text-slate-500">{t("addresses.desc")}</p>
        </div>
        <Button className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={openCreate}>
          <Plus className="size-4" />
          {t("addresses.add")}
        </Button>
      </div>

      {list.loading || addresses === null ? (
        <div className="mt-8 space-y-4">
          <Skeleton className="h-32 rounded-2xl" />
          <Skeleton className="h-32 rounded-2xl" />
        </div>
      ) : addresses.length === 0 ? (
        <div className="mt-10 flex flex-col items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-slate-100">
            <MapPin className="size-7 text-slate-400" />
          </span>
          <h2 className="mt-5 text-lg font-semibold text-slate-900">{t("addresses.emptyTitle")}</h2>
          <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">
            {t("addresses.emptyDesc")}
          </p>
          <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={openCreate}>
            <Plus className="size-4" />
            {t("addresses.addFirst")}
          </Button>
        </div>
      ) : (
        <div className="mt-8 space-y-3">
          {addresses.map((a) => {
            const hasGps = a.latitude != null && a.longitude != null;
            return (
              <div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-bold text-slate-900">{a.label}</p>
                      {a.isDefault && (
                        <Badge className="gap-1 rounded-full bg-[#ECFDF5] text-emerald-700 ring-1 ring-inset ring-emerald-600/15 hover:bg-[#ECFDF5]">
                          <Star className="size-3 fill-emerald-600 text-emerald-600" />
                          {t("addresses.default")}
                        </Badge>
                      )}
                      {!hasGps && (
                        <Badge className="rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15 hover:bg-amber-50">
                          {t("addresses.noGps")}
                        </Badge>
                      )}
                    </div>
                    <p className="mt-1.5 text-sm leading-6 text-slate-600">{formatAddress(a)}</p>
                    <p className="mt-1 text-xs text-slate-400">
                      {a.recipientName} · {a.phone}
                      {hasGps && (
                        <span className="ml-2 tabular-nums">
                          GPS {a.latitude!.toFixed(4)}, {a.longitude!.toFixed(4)}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!a.isDefault && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="gap-1 border-slate-200 text-slate-600"
                        onClick={() => void setDefault(a)}
                        disabled={submitting}
                      >
                        <Star className="size-3.5" />
                        {t("addresses.setDefault")}
                      </Button>
                    )}
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8 border-slate-200 text-slate-500"
                      onClick={() => openEdit(a)}
                      aria-label={t("addresses.ariaEdit", { name: a.label })}
                    >
                      <Pencil className="size-3.5" />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon"
                      className="size-8 border-slate-200 text-slate-400 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-500"
                      onClick={() => void remove(a)}
                      disabled={deletingId === a.id}
                      aria-label={t("addresses.ariaDelete", { name: a.label })}
                    >
                      {deletingId === a.id ? (
                        <Loader2 className="size-3.5 animate-spin" />
                      ) : (
                        <Trash2 className="size-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="size-4 text-[#10B981]" />
              {editingId ? t("addresses.dialogEditTitle") : t("addresses.dialogTitle")}
            </DialogTitle>
            <DialogDescription>{t("addresses.dialogDesc")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="addr-label">{t("addresses.labelName")}</Label>
                <Input
                  id="addr-label"
                  value={form.label}
                  onChange={(e) => setField("label", e.target.value)}
                  placeholder={t("addresses.labelPlaceholder")}
                  className="h-11 rounded-[10px] border-slate-200"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="addr-recipient">{t("addresses.recipient")}</Label>
                <Input
                  id="addr-recipient"
                  value={form.recipientName}
                  onChange={(e) => setField("recipientName", e.target.value)}
                  placeholder={t("addresses.recipientPlaceholder")}
                  className={`h-11 rounded-[10px] ${errors.recipientName ? "border-red-500" : "border-slate-200"}`}
                  aria-invalid={!!errors.recipientName}
                />
                <FieldError message={errors.recipientName} />
              </div>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="addr-phone">{t("addresses.phone")}</Label>
              <Input
                id="addr-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => setField("phone", e.target.value)}
                placeholder={t("addresses.phonePlaceholder")}
                className={`h-11 rounded-[10px] ${errors.phone ? "border-red-500" : "border-slate-200"}`}
                aria-invalid={!!errors.phone}
              />
              <FieldError message={errors.phone} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="addr-line1">{t("addresses.line1")}</Label>
              <Input
                id="addr-line1"
                value={form.line1}
                onChange={(e) => setField("line1", e.target.value)}
                placeholder={t("addresses.line1Placeholder")}
                className={`h-11 rounded-[10px] ${errors.line1 ? "border-red-500" : "border-slate-200"}`}
                aria-invalid={!!errors.line1}
              />
              <FieldError message={errors.line1} />
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="addr-subdistrict">{t("addresses.subdistrict")}</Label>
                <Input
                  id="addr-subdistrict"
                  value={form.subdistrict}
                  onChange={(e) => setField("subdistrict", e.target.value)}
                  className="h-11 rounded-[10px] border-slate-200"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="addr-district">{t("addresses.district")}</Label>
                <Input
                  id="addr-district"
                  value={form.district}
                  onChange={(e) => setField("district", e.target.value)}
                  className="h-11 rounded-[10px] border-slate-200"
                />
              </div>
            </div>

            <div className="grid gap-2 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="addr-province">{t("addresses.province")}</Label>
                <Input
                  id="addr-province"
                  value={form.province}
                  onChange={(e) => setField("province", e.target.value)}
                  className={`h-11 rounded-[10px] ${errors.province ? "border-red-500" : "border-slate-200"}`}
                  aria-invalid={!!errors.province}
                />
                <FieldError message={errors.province} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="addr-postal">{t("addresses.postal")}</Label>
                <Input
                  id="addr-postal"
                  inputMode="numeric"
                  value={form.postalCode}
                  onChange={(e) => setField("postalCode", e.target.value)}
                  className={`h-11 rounded-[10px] ${errors.postalCode ? "border-red-500" : "border-slate-200"}`}
                  aria-invalid={!!errors.postalCode}
                />
                <FieldError message={errors.postalCode} />
              </div>
            </div>

            <div className="grid gap-2">
              <Label className="flex items-center gap-1.5">
                {t("addresses.mapLabel")}
                <span className="text-xs font-normal text-slate-400">
                  {t("addresses.mapRequiredNote")}
                </span>
              </Label>
              <div className={`rounded-[10px] ${errors.gps ? "ring-2 ring-red-500 ring-offset-1" : ""}`}>
                <MapPicker
                  latitude={form.latitude}
                  longitude={form.longitude}
                  onChange={setCoords}
                  confirmed={form.locationConfirmed}
                  onConfirm={() => {
                    setForm((current) => ({ ...current, locationConfirmed: true }));
                    setErrors((current) => ({ ...current, gps: undefined }));
                  }}
                  autoLocate={editingId === null}
                  height="h-56"
                />
              </div>
              <FieldError message={errors.gps} />
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => setField("isDefault", e.target.checked)}
                className="size-4 rounded border-slate-300 text-[#10B981]"
              />
              {t("addresses.isDefault")}
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              className="border-slate-200 text-slate-700"
              onClick={() => setOpen(false)}
            >
              {t("common.cancel")}
            </Button>
            <Button
              className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800"
              onClick={() => void save()}
              disabled={submitting}
            >
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {t("addresses.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="flex items-center gap-1 text-xs text-red-500" role="alert">
      <AlertCircle className="size-3 shrink-0" />
      {message}
    </p>
  );
}
