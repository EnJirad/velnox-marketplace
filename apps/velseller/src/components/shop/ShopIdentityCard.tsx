/**
 * Shop identity card — the storefront header of `/seller/shop`.
 *
 * Shows the shop as customers meet it on velshop (cover, logo, name, description,
 * address) and is the only place a seller edits that identity.
 *
 * Two write paths, both server-authoritative:
 *   • text fields → `PATCH /api/seller/shop` (resolves the shop from the session)
 *   • logo / cover → `POST /api/upload/presign|confirm` (backend mints the key
 *     `shop/{shopId}/logo.webp` after checking ownership, then writes the column)
 *
 * The client never sends a shop id to `PATCH`, so one seller cannot write another
 * seller's shop. Every field here exists in `shops` — nothing is invented.
 */
import { useState } from "react";
import { ExternalLink, Loader2, MapPin, Pencil, Store } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@velnox/shared/components/ui/badge";
import { Button } from "@velnox/shared/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@velnox/shared/components/ui/dialog";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Textarea } from "@velnox/shared/components/ui/textarea";
import { VerificationStatusLabel } from "@velnox/shared/components/VBadge";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { SITE_URLS } from "@velnox/shared/lib/sites";
import type { StoreShop, StoreShopAddress, VerificationStatus } from "@velnox/shared/lib/commerce";

import { ShopMediaField } from "./ShopMediaField";

interface ShopIdentityCardProps {
  shop: StoreShop;
  verificationStatus: VerificationStatus;
  onUpdated: () => Promise<void> | void;
}

const EMPTY_ADDRESS: StoreShopAddress = {
  line1: null,
  line2: null,
  subdistrict: null,
  district: null,
  city: null,
  state: null,
  postalCode: null,
  country: "TH",
};

function readAddress(address: StoreShop["address"]): StoreShopAddress {
  if (address && typeof address === "object") return { ...EMPTY_ADDRESS, ...address };
  // Legacy payload: the public shop list still sends one string line.
  return { ...EMPTY_ADDRESS, line1: typeof address === "string" ? address : null };
}

export function ShopIdentityCard({ shop, verificationStatus, onUpdated }: ShopIdentityCardProps) {
  const { t } = useLanguage();
  const updateShop = useAction(api.seller.updateShop);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [logo, setLogo] = useState<string | null>(shop.logo ?? null);
  const [cover, setCover] = useState<string | null>(shop.cover ?? null);
  const [form, setForm] = useState(() => ({
    name: shop.name ?? "",
    description: shop.description ?? "",
    phone: shop.phone ?? "",
    category: shop.category ?? "",
    address: readAddress(shop.address),
  }));

  const shopHref = shop.slug ? `${SITE_URLS.velshop}/shop/${shop.slug}` : null;
  const statusLabel =
    shop.status === "active"
      ? t("sellerDash.shop.shopStatusActive")
      : shop.status === "suspended"
        ? t("sellerDash.shop.shopStatusSuspended")
        : t("sellerDash.shop.shopStatusClosed");

  const openEditor = () => {
    setForm({
      name: shop.name ?? "",
      description: shop.description ?? "",
      phone: shop.phone ?? "",
      category: shop.category ?? "",
      address: readAddress(shop.address),
    });
    setLogo(shop.logo ?? null);
    setCover(shop.cover ?? null);
    setEditing(true);
  };

  const setAddress = (key: keyof StoreShopAddress, value: string) =>
    setForm((prev) => ({ ...prev, address: { ...prev.address, [key]: value } }));

  const postalInvalid =
    form.address.postalCode !== null &&
    form.address.postalCode !== "" &&
    !/^\d{5}$/.test(String(form.address.postalCode));

  const handleSave = async () => {
    if (!form.name.trim() || postalInvalid) return;
    setSaving(true);
    try {
      await updateShop({
        name: form.name.trim(),
        description: form.description.trim() || null,
        phone: form.phone.trim() || null,
        category: form.category.trim() || null,
        address: {
          line1: form.address.line1?.trim() || null,
          line2: form.address.line2?.trim() || null,
          subdistrict: form.address.subdistrict?.trim() || null,
          district: form.address.district?.trim() || null,
          city: form.address.city?.trim() || null,
          state: form.address.state?.trim() || null,
          postalCode: form.address.postalCode?.trim() || null,
          country: form.address.country?.trim() || "TH",
        },
      });
      toast.success(t("sellerDash.shop.savedToast"));
      setEditing(false);
      await onUpdated();
    } catch (error) {
      // Keep the dialog open with the seller's input intact on failure.
      console.error("Shop update error:", error);
      toast.error(error instanceof Error ? error.message : t("sellerDash.shop.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const addressLine = [
    form.address.line1,
    form.address.subdistrict,
    form.address.district,
    form.address.city,
    form.address.postalCode,
  ]
    .filter((part): part is string => Boolean(part && String(part).trim()))
    .join(" · ");

  return (
    <section
      aria-labelledby="shop-identity-name"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.05)]"
    >
      {/* Storefront banner: the seller's own cover, else the brand band. */}
      <div className="relative h-24 bg-[#ECFDF5] sm:h-32">
        {cover ? (
          <img src={cover} alt="" className="size-full object-cover" loading="lazy" />
        ) : (
          <div
            aria-hidden="true"
            className="size-full bg-[linear-gradient(120deg,#ECFDF5_0%,#F8FAFC_52%,#ECFDF5_100%)]"
          />
        )}
      </div>

      <div className="px-5 pb-5 sm:px-6">
        <div className="-mt-8 flex flex-wrap items-end justify-between gap-3">
          <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white ring-4 ring-white">
            {logo ? (
              <img src={logo} alt="" className="size-full object-cover" />
            ) : (
              <Store className="size-7 text-[#10B981]" aria-hidden="true" />
            )}
          </span>
          <div className="flex flex-wrap items-center gap-2 pb-1">
            {shopHref && (
              <Button variant="outline" className="h-11 gap-1.5 border-slate-200 text-slate-600" asChild>
                <a href={shopHref} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" aria-hidden="true" />
                  {t("sellerDash.shop.viewShop")}
                </a>
              </Button>
            )}
            <Button variant="outline" className="h-11 gap-1.5 border-slate-200" onClick={openEditor}>
              <Pencil className="size-4" aria-hidden="true" />
              {t("sellerDash.shop.identityEdit")}
            </Button>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1.5">
          <h1 id="shop-identity-name" className="text-xl font-bold tracking-tight text-slate-900">
            {shop.name}
          </h1>
          <Badge className="rounded-full bg-slate-100 text-slate-600 ring-1 ring-inset ring-slate-500/10 hover:bg-slate-100">
            {statusLabel}
          </Badge>
          <VerificationStatusLabel status={verificationStatus} />
        </div>

        <p className="mt-1.5 max-w-prose text-sm leading-6 text-slate-500">
          {shop.description || t("sellerDash.shop.subFallback")}
        </p>

        {(addressLine || shop.slug) && (
          <dl className="mt-3 grid gap-1 text-xs text-slate-500">
            {addressLine && (
              <div className="flex items-start gap-1.5">
                <dt className="sr-only">{t("sellerDash.shop.fieldAddressLine1")}</dt>
                <MapPin className="mt-0.5 size-3.5 shrink-0 text-slate-500" aria-hidden="true" />
                <dd className="text-slate-600">{addressLine}</dd>
              </div>
            )}
            {shop.slug && (
              <div className="flex items-center gap-1.5">
                <dt className="text-slate-500">{t("sellerDash.shop.slugLabel")}</dt>
                <dd className="font-medium text-slate-700">velshop/shop/{shop.slug}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <Dialog open={editing} onOpenChange={(next) => !saving && setEditing(next)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{t("sellerDash.shop.identityEdit")}</DialogTitle>
            <DialogDescription>{t("sellerDash.shop.identityEditDesc")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <ShopMediaField
                shopId={shop.id}
                kind="logo"
                value={logo}
                onChange={(url) => {
                  setLogo(url);
                  void onUpdated();
                }}
              />
              <ShopMediaField
                shopId={shop.id}
                kind="cover"
                value={cover}
                onChange={(url) => {
                  setCover(url);
                  void onUpdated();
                }}
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-shop-name">{t("sellerDash.shop.fieldName")}</Label>
              <Input
                id="edit-shop-name"
                value={form.name}
                onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                maxLength={255}
                className="h-11 rounded-[10px]"
                autoComplete="organization"
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="edit-shop-description">{t("sellerDash.shop.fieldDescription")}</Label>
              <Textarea
                id="edit-shop-description"
                value={form.description}
                onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
                rows={3}
                maxLength={2000}
                className="rounded-[10px]"
                placeholder={t("sellerDash.shop.onboardDescPh")}
              />
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="edit-shop-phone">{t("sellerDash.shop.fieldPhone")}</Label>
                <Input
                  id="edit-shop-phone"
                  value={form.phone}
                  onChange={(e) => setForm((prev) => ({ ...prev, phone: e.target.value }))}
                  inputMode="tel"
                  maxLength={20}
                  className="h-11 rounded-[10px] tabular-nums"
                  autoComplete="tel"
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="edit-shop-category">{t("sellerDash.shop.fieldCategory")}</Label>
                <Input
                  id="edit-shop-category"
                  value={form.category}
                  onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
                  maxLength={100}
                  className="h-11 rounded-[10px]"
                  placeholder={t("sellerDash.shop.fieldCategoryPh")}
                  aria-describedby="edit-shop-category-hint"
                />
                <p id="edit-shop-category-hint" className="text-xs text-slate-500">
                  {t("sellerDash.shop.fieldCategoryHint")}
                </p>
              </div>
            </div>

            <fieldset className="grid gap-3">
              <legend className="text-sm font-semibold text-slate-900">
                {t("sellerDash.shop.fieldAddress")}
              </legend>
              <div className="grid gap-2">
                <Label htmlFor="edit-shop-address1">{t("sellerDash.shop.fieldAddressLine1")}</Label>
                <Input
                  id="edit-shop-address1"
                  value={form.address.line1 ?? ""}
                  onChange={(e) => setAddress("line1", e.target.value)}
                  maxLength={255}
                  className="h-11 rounded-[10px]"
                  autoComplete="address-line1"
                />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="edit-shop-subdistrict">{t("sellerDash.shop.fieldSubdistrict")}</Label>
                  <Input
                    id="edit-shop-subdistrict"
                    value={form.address.subdistrict ?? ""}
                    onChange={(e) => setAddress("subdistrict", e.target.value)}
                    maxLength={100}
                    className="h-11 rounded-[10px]"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-shop-district">{t("sellerDash.shop.fieldDistrict")}</Label>
                  <Input
                    id="edit-shop-district"
                    value={form.address.district ?? ""}
                    onChange={(e) => setAddress("district", e.target.value)}
                    maxLength={100}
                    className="h-11 rounded-[10px]"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-shop-city">{t("sellerDash.shop.fieldCity")}</Label>
                  <Input
                    id="edit-shop-city"
                    value={form.address.city ?? ""}
                    onChange={(e) => setAddress("city", e.target.value)}
                    maxLength={100}
                    className="h-11 rounded-[10px]"
                    autoComplete="address-level1"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="edit-shop-postal">{t("sellerDash.shop.fieldPostalCode")}</Label>
                  <Input
                    id="edit-shop-postal"
                    value={form.address.postalCode ?? ""}
                    onChange={(e) => setAddress("postalCode", e.target.value)}
                    inputMode="numeric"
                    maxLength={5}
                    className="h-11 rounded-[10px] tabular-nums"
                    autoComplete="postal-code"
                    aria-invalid={postalInvalid || undefined}
                    aria-describedby={postalInvalid ? "edit-shop-postal-error" : undefined}
                  />
                  {postalInvalid && (
                    <p id="edit-shop-postal-error" role="alert" className="text-xs font-medium text-rose-600">
                      {t("sellerDash.shop.fieldPostalInvalid")}
                    </p>
                  )}
                </div>
              </div>
            </fieldset>
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={() => setEditing(false)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button
              className="h-11 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
              onClick={() => void handleSave()}
              disabled={saving || !form.name.trim() || postalInvalid}
            >
              {saving && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
              {saving ? t("sellerDash.shop.saving") : t("sellerDash.shop.save")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
