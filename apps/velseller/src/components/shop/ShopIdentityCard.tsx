/**
 * Shop identity card — the storefront header of `/seller/shop`.
 *
 * Shows the shop exactly as customers meet it on velshop (cover, logo, name,
 * description, address) and is the only place a seller edits that identity.
 * Editing uses `PATCH /api/seller/shop`, which resolves the shop from the
 * session — the client never sends a shop id, so one seller cannot write
 * another seller's shop.
 */
import { useState } from "react";
import { ExternalLink, Loader2, Pencil, Store } from "lucide-react";
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
import type { StoreShop, VerificationStatus } from "@velnox/shared/lib/commerce";

interface ShopIdentityCardProps {
  shop: StoreShop;
  verificationStatus: VerificationStatus;
  onUpdated: () => Promise<void> | void;
}

export function ShopIdentityCard({ shop, verificationStatus, onUpdated }: ShopIdentityCardProps) {
  const { t } = useLanguage();
  const updateShop = useAction(api.seller.updateShop);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: shop.name ?? "",
    description: shop.description ?? "",
    phone: shop.phone ?? "",
  });

  const shopHref = shop.slug ? `${SITE_URLS.velshop}/shop/${shop.slug}` : null;
  const statusLabel =
    shop.status === "active"
      ? t("sellerDash.shop.shopStatusActive")
      : shop.status === "suspended"
        ? t("sellerDash.shop.shopStatusSuspended")
        : t("sellerDash.shop.shopStatusClosed");

  const openEditor = () => {
    setForm({ name: shop.name ?? "", description: shop.description ?? "", phone: shop.phone ?? "" });
    setEditing(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      await updateShop({
        name: form.name.trim(),
        description: form.description.trim() || null,
        phone: form.phone.trim() || null,
      });
      toast.success(t("sellerDash.shop.savedToast"));
      setEditing(false);
      await onUpdated();
    } catch (error) {
      console.error("Shop update error:", error);
      toast.error(error instanceof Error ? error.message : t("sellerDash.shop.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section
      aria-labelledby="shop-identity-name"
      className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_12px_30px_rgba(15,23,42,0.05)]"
    >
      {/* Storefront banner: the brand band. */}
      <div className="relative h-24 bg-[#ECFDF5] sm:h-32">
        <div
          aria-hidden="true"
          className="size-full bg-[linear-gradient(120deg,#ECFDF5_0%,#F8FAFC_52%,#ECFDF5_100%)]"
        />
      </div>

      <div className="px-5 pb-5 sm:px-6">
        <div className="-mt-8 flex flex-wrap items-end justify-between gap-3">
          <span className="flex size-16 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-white ring-4 ring-white">
            {shop.imageUrl ? (
              <img src={shop.imageUrl} alt="" className="size-full object-cover" />
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
            <Button
              variant="outline"
              className="h-11 gap-1.5 border-slate-200"
              onClick={openEditor}
            >
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

        {(shop.slug || shop.phone) && (
          <dl className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
            {shop.slug && (
              <div className="flex items-center gap-1.5">
                <dt className="text-slate-400">{t("sellerDash.shop.slugLabel")}</dt>
                <dd className="font-medium text-slate-700">velshop/shop/{shop.slug}</dd>
              </div>
            )}
            {shop.phone && (
              <div className="flex items-center gap-1.5">
                <dt className="text-slate-400">{t("sellerDash.shop.fieldPhone")}</dt>
                <dd className="font-medium tabular-nums text-slate-700">{shop.phone}</dd>
              </div>
            )}
          </dl>
        )}
      </div>

      <Dialog open={editing} onOpenChange={(next) => !saving && setEditing(next)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("sellerDash.shop.identityEdit")}</DialogTitle>
            <DialogDescription>{t("sellerDash.shop.identityEditDesc")}</DialogDescription>
          </DialogHeader>

          <div className="grid gap-4">
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
          </div>

          <DialogFooter className="gap-2">
            <Button variant="outline" className="h-11" onClick={() => setEditing(false)} disabled={saving}>
              {t("common.cancel")}
            </Button>
            <Button
              className="h-11 gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
              onClick={() => void handleSave()}
              disabled={saving || !form.name.trim()}
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
