/**
 * Shop onboarding — the pre-shop state of `/seller/shop`.
 *
 * Extracted from `MyShop.tsx` so the page keeps one responsibility: the seller's
 * live shop. Everything here is the "you have no shop yet" path, and every
 * string comes from `sellerDash.shop.*` (th / en / my).
 *
 * The backend endpoint is `POST /api/seller/apply` (`api.commerce.openShop`):
 * it derives the applicant from the session and creates the seller + shop rows.
 */
import { useState } from "react";
import { Loader2, Store } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Textarea } from "@velnox/shared/components/ui/textarea";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { useLanguage } from "@velnox/shared/lib/i18n";

interface ShopOnboardingProps {
  /** Called after the backend accepted the application, so the page re-reads the profile. */
  onOpened: () => Promise<void> | void;
}

export function ShopOnboarding({ onOpened }: ShopOnboardingProps) {
  const { t } = useLanguage();
  const openShop = useAction(api.commerce.openShop);

  const [form, setForm] = useState({ shopName: "", slug: "", description: "", taxId: "" });
  const [opening, setOpening] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.shopName.trim()) {
      setNameError(t("sellerDash.shop.onboardNameRequired"));
      return;
    }
    setNameError(null);
    setOpening(true);
    try {
      await openShop({
        shopName: form.shopName.trim(),
        slug: form.slug.trim() || undefined,
        description: form.description.trim() || undefined,
        taxId: form.taxId.trim() || undefined,
      });
      await onOpened();
    } catch (error) {
      console.error("Open shop error:", error);
      toast.error(error instanceof Error ? error.message : t("sellerDash.shop.toastFailed"));
    } finally {
      setOpening(false);
    }
  };

  return (
    <main className="mx-auto w-full max-w-lg px-4 py-10 sm:px-6 sm:py-14">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-[0_12px_30px_rgba(15,23,42,0.06)] sm:p-8">
        <span className="flex size-12 items-center justify-center rounded-xl bg-[#ECFDF5]">
          <Store className="size-6 text-[#10B981]" aria-hidden="true" />
        </span>
        <h1 className="mt-5 text-xl font-bold tracking-tight text-slate-900 sm:text-2xl">
          {t("sellerDash.shop.onboardTitle")}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">{t("sellerDash.shop.onboardDesc")}</p>

        <form onSubmit={handleSubmit} className="mt-6 grid gap-5" noValidate>
          <div className="grid gap-2">
            <Label htmlFor="shop-name">{t("sellerDash.shop.onboardName")}</Label>
            <Input
              id="shop-name"
              value={form.shopName}
              onChange={(e) => setForm((prev) => ({ ...prev, shopName: e.target.value }))}
              placeholder={t("sellerDash.shop.onboardNamePh")}
              className="h-11 rounded-[10px]"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? "shop-name-error" : undefined}
              autoComplete="organization"
            />
            {nameError && (
              <p id="shop-name-error" role="alert" className="text-xs font-medium text-rose-600">
                {nameError}
              </p>
            )}
          </div>

          <div className="grid gap-2">
            <Label htmlFor="shop-slug">{t("sellerDash.shop.onboardSlug")}</Label>
            <Input
              id="shop-slug"
              value={form.slug}
              onChange={(e) => setForm((prev) => ({ ...prev, slug: e.target.value }))}
              placeholder="my-shop"
              className="h-11 rounded-[10px]"
              aria-describedby="shop-slug-hint"
              autoCapitalize="none"
              spellCheck={false}
            />
            <p id="shop-slug-hint" className="text-xs text-slate-400">
              {t("sellerDash.shop.slugHint")}
            </p>
          </div>

          <div className="flex flex-col gap-1.5">
            <label htmlFor="shop-description" className="text-sm font-medium text-slate-700">
              {t("sellerDash.shop.onboardDescLabel")}
            </label>
            <Textarea
              id="shop-description"
              rows={3}
              value={form.description}
              onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
              placeholder={t("sellerDash.shop.onboardDescPh")}
              className="rounded-[10px]"
            />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="shop-tax">{t("sellerDash.shop.onboardTax")}</Label>
            <Input
              id="shop-tax"
              value={form.taxId}
              onChange={(e) => setForm((prev) => ({ ...prev, taxId: e.target.value }))}
              inputMode="numeric"
              placeholder="0000000000000"
              className="h-11 rounded-[10px] tabular-nums"
              aria-describedby="shop-tax-hint"
            />
            <p id="shop-tax-hint" className="text-xs text-slate-400">
              {t("sellerDash.shop.onboardTaxHint")}
            </p>
          </div>

          <Button
            type="submit"
            className="mt-1 h-11 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669] focus-visible:ring-2 focus-visible:ring-[#10B981] focus-visible:ring-offset-2"
            disabled={opening}
          >
            {opening && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
            {opening ? t("sellerDash.shop.onboardOpening") : t("sellerDash.shop.onboardCta")}
          </Button>
        </form>
      </div>
    </main>
  );
}
