import { MapPicker } from "@/components/shop/MapPicker";
import { ShopFooter } from "@/components/shop/ShopFooter";
import { ShopHeader } from "@/components/shop/ShopHeader";
import { useLanguage } from "@/lib/i18n";
import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@velnox/shared/components/ui/dialog";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Skeleton } from "@velnox/shared/components/ui/skeleton";
import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import { AlertCircle, Loader2, MapPin, Pencil, Plus, Star, Trash2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface AddressRow {
  id: string;
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string | null;
  subdistrict: string | null;
  district: string | null;
  province: string | null;
  postalCode: string | null;
  country: string;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
}

interface FormState {
  label: string;
  recipientName: string;
  phone: string;
  line1: string;
  line2: string;
  subdistrict: string;
  district: string;
  province: string;
  postalCode: string;
  latitude: number | null;
  longitude: number | null;
  isDefault: boolean;
  /** Coordinates are only valid once the customer confirms them on the map. */
  locationConfirmed: boolean;
}

type AddressFormErrors = {
  recipientName?: string;
  phone?: string;
  line1?: string;
  subdistrict?: string;
  province?: string;
  postalCode?: string;
  gps?: string;
};

function formatAddress(a: AddressRow): string {
  return [a.line1, a.line2, a.subdistrict, a.district, a.province, a.postalCode].filter(Boolean).join(" · ");
}

/** Validate a single field and return its error message (or undefined if valid). */
function validateField(
  name: keyof AddressFormErrors,
  form: FormState,
): string | undefined {
  switch (name) {
    case "recipientName":
      if (!form.recipientName.trim()) return "กรุณากรอกชื่อผู้รับ";
      if (form.recipientName.trim().length > 120) return "ชื่อผู้รับต้องไม่เกิน 120 ตัวอักษร";
      return undefined;
    case "phone": {
      const phone = form.phone.trim();
      if (!phone) return "กรุณากรอกเบอร์โทรศัพท์";
      // Strip spaces, dashes, parentheses for validation
      const cleaned = phone.replace(/[\s\-()]/g, "");
      if (!/^[0-9+]+$/.test(cleaned)) return "กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง";
      if (cleaned.length < 9 || cleaned.length > 15) return "เบอร์โทรศัพท์ต้องมี 9–15 หลัก";
      return undefined;
    }
    case "line1":
      if (!form.line1.trim()) return "กรุณากรอกที่อยู่ให้ครบถ้วน";
      return undefined;
    case "subdistrict":
      if (!form.subdistrict.trim()) return "กรุณาเลือกตำบล/แขวง";
      return undefined;
    case "province":
      if (!form.province.trim()) return "กรุณากรอกจังหวัด";
      return undefined;
    case "postalCode": {
      const pc = form.postalCode.trim();
      if (!pc) return "กรุณากรอกรหัสไปรษณีย์";
      if (!/^\d{5}$/.test(pc)) return "กรุณากรอกรหัสไปรษณีย์ให้ถูกต้อง (5 หลัก)";
      return undefined;
    }
    case "gps":
      if (form.latitude == null || form.longitude == null) return "กรุณาเลือกตำแหน่ง GPS";
      if (!form.locationConfirmed) return "กรุณายืนยันตำแหน่งบนแผนที่";
      if (form.latitude < -90 || form.latitude > 90) return "ตำแหน่ง GPS ไม่ถูกต้อง";
      if (form.longitude < -180 || form.longitude > 180) return "ตำแหน่ง GPS ไม่ถูกต้อง";
      return undefined;
  }
}

/** Validate all fields and return an errors object (empty if all valid). */
function validateAll(form: FormState): AddressFormErrors {
  const errors: AddressFormErrors = {};
  const fields: (keyof AddressFormErrors)[] = [
    "recipientName", "phone", "line1", "subdistrict", "province", "postalCode", "gps",
  ];
  for (const f of fields) {
    const err = validateField(f, form);
    if (err) errors[f] = err;
  }
  return errors;
}

/** Map known backend error messages to field-level Thai errors. */
function mapBackendError(message: string): { field?: keyof AddressFormErrors; message: string } | null {
  if (message.includes("phone") || message.includes("เบอร์โทร")) {
    return { field: "phone", message: "กรุณากรอกเบอร์โทรศัพท์ให้ถูกต้อง" };
  }
  if (message.includes("recipientName") || message.includes("ชื่อผู้รับ")) {
    return { field: "recipientName", message: "กรุณากรอกชื่อผู้รับ" };
  }
  if (message.includes("line1") || message.includes("ที่อยู่")) {
    return { field: "line1", message: "กรุณากรอกที่อยู่ให้ครบถ้วน" };
  }
  if (message.includes("province") || message.includes("จังหวัด") || message.includes("เมือง")) {
    return { field: "province", message: "กรุณากรอกจังหวัด" };
  }
  if (message.includes("postal") || message.includes("รหัสไปรษณีย์")) {
    return { field: "postalCode", message: "กรุณากรอกรหัสไปรษณีย์ให้ถูกต้อง" };
  }
  if (message.includes("GPS") || message.includes("gps") || message.includes("พิกัด")) {
    return { field: "gps", message: "กรุณาเลือกตำแหน่ง GPS บนแผนที่" };
  }
  return null;
}

/** Inline error display component. */
function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="mt-1 flex items-center gap-1 text-xs text-red-500" role="alert">
      <AlertCircle className="size-3 shrink-0" />
      {message}
    </p>
  );
}

export default function ShopAddresses() {
  const { t } = useLanguage();
  const myAddresses = useAction(api.customer.myAddresses);
  const saveAddress = useAction(api.customer.saveAddress);
  const deleteAddress = useAction(api.customer.deleteAddressAction);

  const [addresses, setAddresses] = useState<AddressRow[] | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>({
    label: t("addresses.labelPlaceholder").split(" / ")[0] ?? "บ้าน",
    recipientName: "",
    phone: "",
    line1: "",
    line2: "",
    subdistrict: "",
    district: "",
    province: "",
    postalCode: "",
    latitude: null,
    longitude: null,
    isDefault: false,
    locationConfirmed: false,
  });
  const [errors, setErrors] = useState<AddressFormErrors>({});
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitting, setSubmitting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const formRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setAddresses((await myAddresses()) as unknown as AddressRow[]);
    } catch (err) {
      console.error("Load addresses error:", err);
      setAddresses([]);
    }
  }, [myAddresses]);

  useEffect(() => {
    let alive = true;
    myAddresses()
      .then((res) => {
        if (alive) setAddresses(res as unknown as AddressRow[]);
      })
      .catch((err) => {
        console.error("Load addresses error:", err);
        if (alive) setAddresses([]);
      });
    return () => {
      alive = false;
    };
  }, [myAddresses]);

  const openCreate = () => {
    setEditingId(null);
    setErrors({});
    setTouched({});
    setForm({
      label: t("addresses.labelPlaceholder").split(" / ")[0] ?? "บ้าน",
      recipientName: "",
      phone: "",
      line1: "",
      line2: "",
      subdistrict: "",
      district: "",
      province: "",
      postalCode: "",
      latitude: null,
      longitude: null,
      isDefault: false,
      locationConfirmed: false,
    });
    setDialogOpen(true);
  };

  const openEdit = (a: AddressRow) => {
    setEditingId(a.id);
    setErrors({});
    setTouched({});
    const hasCoords = a.latitude != null && a.longitude != null;
    setForm({
      label: a.label,
      recipientName: a.recipientName,
      phone: a.phone,
      line1: a.line1,
      line2: a.line2 ?? "",
      subdistrict: a.subdistrict ?? "",
      district: a.district ?? "",
      province: a.province ?? "",
      postalCode: a.postalCode ?? "",
      latitude: a.latitude,
      longitude: a.longitude,
      isDefault: a.isDefault,
      locationConfirmed: hasCoords,
    });
    setDialogOpen(true);
  };

  /** Update a single form field and clear its error if now valid. */
  const updateField = <K extends keyof FormState>(name: K, value: FormState[K]) => {
    setForm((f) => {
      const next = { ...f, [name]: value };
      // Real-time error clearing: if the field was touched and is now valid, remove its error
      if (touched[name]) {
        // Map FormState field names to AddressFormErrors keys
        const errorKey = name === "locationConfirmed" || name === "latitude" || name === "longitude"
          ? "gps" as keyof AddressFormErrors
          : name as keyof AddressFormErrors;
        if (errorKey in errors) {
          const fieldError = validateField(errorKey, next);
          if (!fieldError) {
            setErrors((prev) => {
              const { [errorKey]: _, ...rest } = prev;
              return rest;
            });
          }
        }
      }
      return next;
    });
  };

  /** Mark a field as touched (for showing errors on blur). */
  const touchField = (name: string) => {
    setTouched((prev) => ({ ...prev, [name]: true }));
    // Validate the field on blur
    const errorKey = name === "locationConfirmed" || name === "latitude" || name === "longitude"
      ? "gps" as keyof AddressFormErrors
      : name as keyof AddressFormErrors;
    if (errorKey in { recipientName: 1, phone: 1, line1: 1, subdistrict: 1, province: 1, postalCode: 1, gps: 1 }) {
      const fieldError = validateField(errorKey, form);
      if (fieldError) {
        setErrors((prev) => ({ ...prev, [errorKey]: fieldError }));
      }
    }
  };

  /** Scroll to first invalid field in the form. */
  const scrollToFirstError = (errs: AddressFormErrors) => {
    const fieldOrder: (keyof AddressFormErrors)[] = [
      "recipientName", "phone", "line1", "subdistrict", "province", "postalCode", "gps",
    ];
    for (const f of fieldOrder) {
      if (errs[f]) {
        // Map to DOM id
        const idMap: Record<string, string> = {
          recipientName: "addr-recipient",
          phone: "addr-phone",
          line1: "addr-line1",
          subdistrict: "addr-subdistrict",
          province: "addr-province",
          postalCode: "addr-postal",
          gps: "addr-map-section",
        };
        const el = document.getElementById(idMap[f] ?? "");
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          el.focus();
        }
        break;
      }
    }
  };

  const handleSave = async () => {
    // Mark all fields as touched so errors display
    setTouched({
      recipientName: true, phone: true, line1: true,
      subdistrict: true, province: true, postalCode: true, gps: true,
    });

    const validationErrors = validateAll(form);
    if (Object.keys(validationErrors).length > 0) {
      setErrors(validationErrors);
      scrollToFirstError(validationErrors);
      return;
    }

    setErrors({});
    setSubmitting(true);
    try {
      await saveAddress({
        addressId: editingId ?? undefined,
        label: form.label.trim() || t("addresses.labelPlaceholder").split(" / ")[0],
        recipientName: form.recipientName.trim(),
        phone: form.phone.trim(),
        line1: form.line1.trim(),
        line2: form.line2.trim() || undefined,
        subdistrict: form.subdistrict.trim() || undefined,
        district: form.district.trim() || undefined,
        province: form.province.trim() || undefined,
        postalCode: form.postalCode.trim() || undefined,
        country: "TH",
        latitude: form.latitude ?? undefined,
        longitude: form.longitude ?? undefined,
        isDefault: form.isDefault,
      });
      toast.success(editingId ? t("addresses.updateSuccess") : t("addresses.saveSuccess"));
      setDialogOpen(false);
      await load();
    } catch (err) {
      console.error("Save address error:", err);
      const msg = err instanceof Error ? err.message : String(err);

      // Try to map backend error to a field-level error
      const mapped = mapBackendError(msg);
      if (mapped) {
        if (mapped.field) {
          setErrors((prev) => ({ ...prev, [mapped.field!]: mapped.message }));
          scrollToFirstError({ [mapped.field!]: mapped.message });
        } else {
          toast.error(mapped.message);
        }
      } else {
        // Generic friendly error — never expose raw ZodError/Request IDs
        toast.error("ไม่สามารถบันทึกที่อยู่ได้ กรุณาตรวจสอบข้อมูลแล้วลองอีกครั้ง");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (a: AddressRow) => {
    setDeletingId(a.id);
    try {
      await deleteAddress({ addressId: a.id });
      toast.success(t("addresses.deleteSuccess"));
      await load();
    } catch (err) {
      console.error("Delete address error:", err);
      toast.error(t("addresses.deleteFailed"));
    } finally {
      setDeletingId(null);
    }
  };

  const handleSetDefault = async (a: AddressRow) => {
    if (a.isDefault) return;
    if (a.latitude == null || a.longitude == null) {
      toast.error(t("addresses.setDefaultGpsError"));
      return;
    }
    setSubmitting(true);
    try {
      await saveAddress({
        addressId: a.id,
        label: a.label,
        recipientName: a.recipientName,
        phone: a.phone,
        line1: a.line1,
        line2: a.line2 ?? undefined,
        subdistrict: a.subdistrict ?? undefined,
        district: a.district ?? undefined,
        province: a.province ?? undefined,
        postalCode: a.postalCode ?? undefined,
        country: a.country,
        latitude: a.latitude ?? undefined,
        longitude: a.longitude ?? undefined,
        isDefault: true,
      });
      toast.success(t("addresses.setDefaultSuccess"));
      await load();
    } catch (err) {
      console.error("Set default error:", err);
      const msg = err instanceof Error ? err.message : String(err);
      const mapped = mapBackendError(msg);
      toast.error(mapped?.message ?? t("addresses.saveFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const setCoord = (lat: number, lng: number, source?: "auto" | "user") => {
    setForm((f) => ({
      ...f,
      latitude: lat,
      longitude: lng,
      // Auto-located GPS is pre-confirmed; user drag resets confirmation
      locationConfirmed: source === "auto" ? true : false,
    }));
    // Clear GPS error when coordinates change
    if (errors.gps) {
      setErrors((prev) => {
        const { gps: _, ...rest } = prev;
        return rest;
      });
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] text-slate-900">
      <ShopHeader />

      <main className="mx-auto w-full max-w-4xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-sm font-medium text-slate-400">
              <MapPin className="size-4 text-[#10B981]" />
              {t("addresses.eyebrow")}
            </p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">{t("addresses.title")}</h1>
            <p className="mt-1.5 text-sm text-slate-500">{t("addresses.desc")}</p>
          </div>
          <Button className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={openCreate}>
            <Plus className="size-4" />
            {t("addresses.add")}
          </Button>
        </div>

        {addresses === null ? (
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
            <p className="mt-1.5 max-w-sm text-sm leading-6 text-slate-500">{t("addresses.emptyDesc")}</p>
            <Button className="mt-6 gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={openCreate}>
              <Plus className="size-4" />
              {t("addresses.addFirst")}
            </Button>
          </div>
        ) : (
          <div className="mt-8 space-y-3">
            {addresses.map((a) => {
              const gps = a.latitude != null && a.longitude != null;
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
                        {!gps && (
                          <Badge className="rounded-full bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15 hover:bg-amber-50">
                            {t("addresses.noGps")}
                          </Badge>
                        )}
                      </div>
                      <p className="mt-1.5 text-sm leading-6 text-slate-600">{formatAddress(a)}</p>
                      <p className="mt-1 text-xs text-slate-400">
                        {a.recipientName} · {a.phone}
                        {gps && (
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
                          onClick={() => void handleSetDefault(a)}
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
                        onClick={() => void handleDelete(a)}
                        disabled={deletingId === a.id}
                        aria-label={t("addresses.ariaDelete", { name: a.label })}
                      >
                        {deletingId === a.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Address form dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MapPin className="size-4 text-[#10B981]" />
              {editingId ? t("addresses.dialogEditTitle") : t("addresses.dialogTitle")}
            </DialogTitle>
            <DialogDescription>{t("addresses.dialogDesc")}</DialogDescription>
          </DialogHeader>

          <div ref={formRef} className="grid gap-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="addr-label">{t("addresses.labelName")}</Label>
                <Input
                  id="addr-label"
                  value={form.label}
                  onChange={(e) => updateField("label", e.target.value)}
                  placeholder={t("addresses.labelPlaceholder")}
                  className="rounded-[10px] border-slate-200"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="addr-recipient">
                  {t("addresses.recipient")} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="addr-recipient"
                  value={form.recipientName}
                  onChange={(e) => updateField("recipientName", e.target.value)}
                  onBlur={() => touchField("recipientName")}
                  placeholder={t("addresses.recipientPlaceholder")}
                  className={`rounded-[10px] ${
                    touched.recipientName && errors.recipientName
                      ? "border-red-500 focus-visible:ring-red-500"
                      : "border-slate-200"
                  }`}
                  aria-invalid={!!(touched.recipientName && errors.recipientName)}
                  aria-describedby={errors.recipientName ? "err-recipient" : undefined}
                />
                <FieldError id="err-recipient" message={touched.recipientName ? errors.recipientName : undefined} />
              </div>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="addr-phone">
                {t("addresses.phone")} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="addr-phone"
                type="tel"
                value={form.phone}
                onChange={(e) => updateField("phone", e.target.value)}
                onBlur={() => touchField("phone")}
                placeholder={t("addresses.phonePlaceholder")}
                className={`rounded-[10px] ${
                  touched.phone && errors.phone
                    ? "border-red-500 focus-visible:ring-red-500"
                    : "border-slate-200"
                }`}
                aria-invalid={!!(touched.phone && errors.phone)}
                aria-describedby={errors.phone ? "err-phone" : undefined}
              />
              <FieldError id="err-phone" message={touched.phone ? errors.phone : undefined} />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="addr-line1">
                {t("addresses.line1")} <span className="text-red-500">*</span>
              </Label>
              <Input
                id="addr-line1"
                value={form.line1}
                onChange={(e) => updateField("line1", e.target.value)}
                onBlur={() => touchField("line1")}
                placeholder={t("addresses.line1Placeholder")}
                className={`rounded-[10px] ${
                  touched.line1 && errors.line1
                    ? "border-red-500 focus-visible:ring-red-500"
                    : "border-slate-200"
                }`}
                aria-invalid={!!(touched.line1 && errors.line1)}
                aria-describedby={errors.line1 ? "err-line1" : undefined}
              />
              <FieldError id="err-line1" message={touched.line1 ? errors.line1 : undefined} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="grid gap-2">
                <Label htmlFor="addr-subdistrict">
                  {t("addresses.subdistrict")} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="addr-subdistrict"
                  value={form.subdistrict}
                  onChange={(e) => updateField("subdistrict", e.target.value)}
                  onBlur={() => touchField("subdistrict")}
                  className={`rounded-[10px] ${
                    touched.subdistrict && errors.subdistrict
                      ? "border-red-500 focus-visible:ring-red-500"
                      : "border-slate-200"
                  }`}
                  aria-invalid={!!(touched.subdistrict && errors.subdistrict)}
                  aria-describedby={errors.subdistrict ? "err-subdistrict" : undefined}
                />
                <FieldError id="err-subdistrict" message={touched.subdistrict ? errors.subdistrict : undefined} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="addr-district">{t("addresses.district")}</Label>
                <Input
                  id="addr-district"
                  value={form.district}
                  onChange={(e) => updateField("district", e.target.value)}
                  className="rounded-[10px] border-slate-200"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="addr-province">
                  {t("addresses.province")} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="addr-province"
                  value={form.province}
                  onChange={(e) => updateField("province", e.target.value)}
                  onBlur={() => touchField("province")}
                  className={`rounded-[10px] ${
                    touched.province && errors.province
                      ? "border-red-500 focus-visible:ring-red-500"
                      : "border-slate-200"
                  }`}
                  aria-invalid={!!(touched.province && errors.province)}
                  aria-describedby={errors.province ? "err-province" : undefined}
                />
                <FieldError id="err-province" message={touched.province ? errors.province : undefined} />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="addr-postal">
                  {t("addresses.postal")} <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="addr-postal"
                  value={form.postalCode}
                  onChange={(e) => updateField("postalCode", e.target.value)}
                  onBlur={() => touchField("postalCode")}
                  placeholder="10110"
                  maxLength={5}
                  className={`rounded-[10px] ${
                    touched.postalCode && errors.postalCode
                      ? "border-red-500 focus-visible:ring-red-500"
                      : "border-slate-200"
                  }`}
                  aria-invalid={!!(touched.postalCode && errors.postalCode)}
                  aria-describedby={errors.postalCode ? "err-postal" : undefined}
                />
                <FieldError id="err-postal" message={touched.postalCode ? errors.postalCode : undefined} />
              </div>
            </div>

            <div className="grid gap-2">
              <Label>{t("addresses.mapLabel")} <span className="text-red-500">*</span></Label>
              <div
                id="addr-map-section"
                tabIndex={-1}
                className={`rounded-[10px] ${
                  touched.gps && errors.gps
                    ? "ring-2 ring-red-500 ring-offset-1"
                    : ""
                }`}
              >
                <MapPicker
                  latitude={form.latitude}
                  longitude={form.longitude}
                  onChange={setCoord}
                  confirmed={form.locationConfirmed}
                  onConfirm={() => {
                    setForm((f) => ({ ...f, locationConfirmed: true }));
                    // Clear GPS error on confirm
                    if (errors.gps) {
                      setErrors((prev) => {
                        const { gps: _, ...rest } = prev;
                        return rest;
                      });
                    }
                  }}
                  autoLocate={editingId === null}
                  height="h-56"
                />
              </div>
              {touched.gps && errors.gps && (
                <p className="mt-1 flex items-center gap-1 text-xs text-red-500" role="alert">
                  <AlertCircle className="size-3 shrink-0" />
                  {errors.gps}
                </p>
              )}
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={form.isDefault}
                onChange={(e) => updateField("isDefault", e.target.checked)}
                className="size-4 rounded border-slate-300 text-[#10B981]"
              />
              {t("addresses.isDefault")}
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="outline" className="border-slate-200 text-slate-700" onClick={() => setDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button className="gap-1.5 bg-slate-900 text-white hover:bg-slate-800" onClick={() => void handleSave()} disabled={submitting}>
              {submitting && <Loader2 className="size-4 animate-spin" />}
              {t("addresses.save")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ShopFooter />
    </div>
  );
}
