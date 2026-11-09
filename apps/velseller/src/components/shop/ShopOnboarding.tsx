/**
 * Seller application — the pre-shop state of `/seller/shop`.
 *
 * `POST /api/seller/apply` is the only endpoint that can create a seller + shop,
 * and it validates four things server-side, so the form must collect all of them
 * or every submission fails:
 *   1. `shopName`
 *   2. `firstName`, `lastName`, `phone`  → persisted in `seller_settings`
 *   3. evidence with the purposes `id_card`, `id_card_back`, `selfie_id`
 *   4. ownership of every evidence object (`media.uploaded_by` = caller)
 *
 * The previous version collected the shop only, so it could never succeed. This
 * version mirrors the contract; it invents no field and sends no id.
 */
import { useState } from "react";
import { ArrowLeft, ArrowRight, Loader2, Store } from "lucide-react";
import { toast } from "sonner";

import { EvidenceUploader, type EvidenceFile } from "@velnox/shared/components/seller/EvidenceUploader";
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Textarea } from "@velnox/shared/components/ui/textarea";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { useLanguage } from "@velnox/shared/lib/i18n";

type Step = 1 | 2;

interface ShopOnboardingProps {
  /** Called after the backend accepted the application, so the page re-reads the profile. */
  onOpened: () => Promise<void> | void;
}

interface FormState {
  shopName: string;
  slug: string;
  description: string;
  category: string;
  phone: string;
  line1: string;
  subdistrict: string;
  district: string;
  city: string;
  postalCode: string;
  firstName: string;
  lastName: string;
}

const EMPTY_FORM: FormState = {
  shopName: "",
  slug: "",
  description: "",
  category: "",
  phone: "",
  line1: "",
  subdistrict: "",
  district: "",
  city: "",
  postalCode: "",
  firstName: "",
  lastName: "",
};

const REQUIRED_PURPOSES = ["id_card", "id_card_back", "selfie_id"] as const;

export function ShopOnboarding({ onOpened }: ShopOnboardingProps) {
  const { t } = useLanguage();
  const openShop = useAction(api.commerce.openShop);
  const confirmEvidence = useAction(api.seller.evidenceConfirm);

  const [step, setStep] = useState<Step>(1);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [files, setFiles] = useState<EvidenceFile[]>([]);
  const [error, setError] = useState<string | null>(null);

  const set = (key: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  const postalInvalid = form.postalCode !== "" && !/^\d{5}$/.test(form.postalCode);
  const stepOneValid = form.shopName.trim().length > 0 && !postalInvalid;

  const uploadedFor = (purpose: string) =>
    files.find((f) => f.purpose === purpose && f.status === "uploaded" && f.cdnUrl)?.cdnUrl ?? null;

  const hasUploading = files.some((f) => f.status === "uploading" || f.status === "pending");
  const missingDocs = REQUIRED_PURPOSES.filter((purpose) => !uploadedFor(purpose));
  const stepTwoValid =
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    form.phone.trim().length > 0 &&
    missingDocs.length === 0 &&
    !hasUploading;

  const replacePurpose = (purpose: string, next: EvidenceFile[]) =>
    setFiles((prev) => [...prev.filter((f) => f.purpose !== purpose), ...next]);

  /** Persist the R2 object metadata so a refresh does not lose the document. */
  const handleUploaded = async (info: {
    objectKey: string;
    cdnUrl: string;
    filename: string;
    contentType: string;
    fileSize: number;
    purpose: string;
  }) => {
    try {
      await confirmEvidence({
        objectKey: info.objectKey,
        publicUrl: info.cdnUrl,
        filename: info.filename,
        contentType: info.contentType,
        fileSize: info.fileSize,
      });
    } catch (err) {
      console.error("Evidence confirmation error:", err);
      toast.error(t("sellerDash.shop.toastFailed"));
    }
  };

  const handleSubmit = async () => {
    setError(null);
    if (step === 1) {
      if (!stepOneValid) return;
      setStep(2);
      return;
    }
    if (!stepTwoValid) {
      if (missingDocs.length > 0) setError(t("sellerDash.shop.onboardMissingDocs"));
      return;
    }

    setBusy(true);
    try {
      await openShop({
        shopName: form.shopName.trim(),
        shopSlug: form.slug.trim() || undefined,
        shopDescription: form.description.trim() || undefined,
        shopCategory: form.category.trim() || undefined,
        shopAddress: {
          line1: form.line1.trim() || undefined,
          subdistrict: form.subdistrict.trim() || undefined,
          district: form.district.trim() || undefined,
          city: form.city.trim() || undefined,
          postalCode: form.postalCode.trim() || undefined,
          country: "TH",
        },
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        phone: form.phone.trim(),
        idCardFrontUrl: uploadedFor("id_card"),
        idCardBackUrl: uploadedFor("id_card_back"),
        selfieUrl: uploadedFor("selfie_id"),
        identityEvidence: REQUIRED_PURPOSES.map((purpose) => uploadedFor(purpose)).filter(
          (url): url is string => Boolean(url),
        ),
      });
      await onOpened();
    } catch (err) {
      console.error("Open shop error:", err);
      toast.error(err instanceof Error ? err.message : t("sellerDash.shop.toastFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-float sm:p-8">
        <span className="flex size-12 items-center justify-center rounded-xl bg-[#ECFDF5]">
          <Store className="size-6 text-[#10B981]" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {t("sellerDash.shop.onboardTitle")}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{t("sellerDash.shop.onboardDesc")}</p>

        <ol className="mt-5 flex items-center gap-2 text-xs font-medium">
          {([1, 2] as Step[]).map((value) => (
            <li
              key={value}
              aria-current={step === value ? "step" : undefined}
              className={`flex-1 rounded-full px-3 py-1.5 text-center ${
                step === value
                  ? "bg-[#ECFDF5] text-[#047857] ring-1 ring-inset ring-emerald-600/20"
                  : "bg-slate-100 text-slate-500"
              }`}
            >
              {value === 1 ? t("sellerDash.shop.onboardStepShop") : t("sellerDash.shop.onboardStepIdentity")}
            </li>
          ))}
        </ol>

        <form
          className="mt-6 grid gap-5"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void handleSubmit();
          }}
        >
          {step === 1 && (
            <>
              <div className="grid gap-2">
                <Label htmlFor="shop-name">{t("sellerDash.shop.onboardName")}</Label>
                <Input
                  id="shop-name"
                  value={form.shopName}
                  onChange={set("shopName")}
                  placeholder={t("sellerDash.shop.onboardNamePh")}
                  className="h-11 rounded-[10px]"
                  maxLength={255}
                  autoComplete="organization"
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="shop-slug">{t("sellerDash.shop.onboardSlug")}</Label>
                <Input
                  id="shop-slug"
                  value={form.slug}
                  onChange={set("slug")}
                  placeholder="my-shop"
                  className="h-11 rounded-[10px]"
                  aria-describedby="shop-slug-hint"
                  autoCapitalize="none"
                  spellCheck={false}
                />
                <p id="shop-slug-hint" className="text-xs text-slate-500">
                  {t("sellerDash.shop.slugHint")}
                </p>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="shop-description">{t("sellerDash.shop.onboardDescLabel")}</Label>
                <Textarea
                  id="shop-description"
                  rows={3}
                  value={form.description}
                  onChange={set("description")}
                  placeholder={t("sellerDash.shop.onboardDescPh")}
                  className="rounded-[10px]"
                  maxLength={2000}
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="shop-category">{t("sellerDash.shop.fieldCategory")}</Label>
                  <Input
                    id="shop-category"
                    value={form.category}
                    onChange={set("category")}
                    className="h-11 rounded-[10px]"
                    maxLength={100}
                    placeholder={t("sellerDash.shop.fieldCategoryPh")}
                    aria-describedby="shop-category-hint"
                  />
                  <p id="shop-category-hint" className="text-xs text-slate-500">
                    {t("sellerDash.shop.fieldCategoryHint")}
                  </p>
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="shop-phone">{t("sellerDash.shop.fieldPhone")}</Label>
                  <Input
                    id="shop-phone"
                    value={form.phone}
                    onChange={set("phone")}
                    inputMode="tel"
                    maxLength={20}
                    className="h-11 rounded-[10px] tabular-nums"
                    autoComplete="tel"
                  />
                </div>
              </div>

              <fieldset className="grid gap-3">
                <legend className="text-sm font-semibold text-slate-900">
                  {t("sellerDash.shop.fieldAddress")}
                </legend>
                <div className="grid gap-2">
                  <Label htmlFor="shop-address1">{t("sellerDash.shop.fieldAddressLine1")}</Label>
                  <Input
                    id="shop-address1"
                    value={form.line1}
                    onChange={set("line1")}
                    maxLength={255}
                    className="h-11 rounded-[10px]"
                    autoComplete="address-line1"
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="grid gap-2">
                    <Label htmlFor="shop-subdistrict">{t("sellerDash.shop.fieldSubdistrict")}</Label>
                    <Input
                      id="shop-subdistrict"
                      value={form.subdistrict}
                      onChange={set("subdistrict")}
                      maxLength={100}
                      className="h-11 rounded-[10px]"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="shop-district">{t("sellerDash.shop.fieldDistrict")}</Label>
                    <Input
                      id="shop-district"
                      value={form.district}
                      onChange={set("district")}
                      maxLength={100}
                      className="h-11 rounded-[10px]"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="shop-city">{t("sellerDash.shop.fieldCity")}</Label>
                    <Input
                      id="shop-city"
                      value={form.city}
                      onChange={set("city")}
                      maxLength={100}
                      className="h-11 rounded-[10px]"
                      autoComplete="address-level1"
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="shop-postal">{t("sellerDash.shop.fieldPostalCode")}</Label>
                    <Input
                      id="shop-postal"
                      value={form.postalCode}
                      onChange={set("postalCode")}
                      inputMode="numeric"
                      maxLength={5}
                      className="h-11 rounded-[10px] tabular-nums"
                      autoComplete="postal-code"
                      aria-invalid={postalInvalid || undefined}
                      aria-describedby={postalInvalid ? "shop-postal-error" : undefined}
                    />
                    {postalInvalid && (
                      <p id="shop-postal-error" role="alert" className="text-xs font-medium text-rose-600">
                        {t("sellerDash.shop.fieldPostalInvalid")}
                      </p>
                    )}
                  </div>
                </div>
              </fieldset>
            </>
          )}

          {step === 2 && (
            <>
              <p className="rounded-xl bg-slate-50 px-4 py-3 text-xs leading-5 text-slate-500">
                {t("sellerDash.shop.onboardIdentityNote")}
              </p>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="applicant-first">{t("sellerDash.shop.onboardFirstName")}</Label>
                  <Input
                    id="applicant-first"
                    value={form.firstName}
                    onChange={set("firstName")}
                    maxLength={100}
                    className="h-11 rounded-[10px]"
                    autoComplete="given-name"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="applicant-last">{t("sellerDash.shop.onboardLastName")}</Label>
                  <Input
                    id="applicant-last"
                    value={form.lastName}
                    onChange={set("lastName")}
                    maxLength={100}
                    className="h-11 rounded-[10px]"
                    autoComplete="family-name"
                  />
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="applicant-phone">{t("sellerDash.shop.onboardPhone")}</Label>
                <Input
                  id="applicant-phone"
                  value={form.phone}
                  onChange={set("phone")}
                  inputMode="tel"
                  maxLength={20}
                  className="h-11 rounded-[10px] tabular-nums"
                  autoComplete="tel"
                />
              </div>

              <EvidenceUploader
                purpose="id_card"
                label={t("sellerDash.shop.verifyDocIdCard")}
                description={t("sellerDash.shop.verifyReq1")}
                files={files.filter((f) => f.purpose === "id_card")}
                onFilesChange={(next) => replacePurpose("id_card", next)}
                onUploadSuccess={handleUploaded}
                maxFiles={2}
              />
              <EvidenceUploader
                purpose="id_card_back"
                label={t("sellerDash.shop.verifyDocIdCardBack")}
                description={t("sellerDash.shop.verifyReq1")}
                files={files.filter((f) => f.purpose === "id_card_back")}
                onFilesChange={(next) => replacePurpose("id_card_back", next)}
                onUploadSuccess={handleUploaded}
                maxFiles={2}
              />
              <EvidenceUploader
                purpose="selfie_id"
                label={t("sellerDash.shop.verifyDocSelfie")}
                description={t("sellerDash.shop.verifyReq2")}
                files={files.filter((f) => f.purpose === "selfie_id")}
                onFilesChange={(next) => replacePurpose("selfie_id", next)}
                onUploadSuccess={handleUploaded}
                maxFiles={2}
              />

              <p className="text-xs leading-5 text-slate-500">{t("sellerDash.shop.verifyPrivacy")}</p>
            </>
          )}

          {error && (
            <p role="alert" className="rounded-[10px] bg-rose-50 px-3 py-2.5 text-sm font-medium text-rose-700">
              {error}
            </p>
          )}

          <div className="mt-1 flex items-center gap-2">
            {step === 2 && (
              <Button
                type="button"
                variant="outline"
                className="h-11"
                onClick={() => {
                  setError(null);
                  setStep(1);
                }}
                disabled={busy}
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                {t("sellerDash.shop.verifyBack")}
              </Button>
            )}
            <Button
              type="submit"
              className="h-11 flex-1 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
              disabled={busy || (step === 1 ? !stepOneValid : !stepTwoValid)}
            >
              {busy && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {step === 1 ? (
                <>
                  {t("sellerDash.shop.verifyNext")}
                  <ArrowRight className="size-4" aria-hidden="true" />
                </>
              ) : busy ? (
                t("sellerDash.shop.onboardOpening")
              ) : (
                t("sellerDash.shop.onboardCta")
              )}
            </Button>
          </div>
        </form>
      </div>
    </main>
  );
}
