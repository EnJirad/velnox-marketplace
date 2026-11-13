import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Plus, Save, Trash2, X } from "lucide-react";
import { Button } from "@velnox/shared/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@velnox/shared/components/ui/select";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Textarea } from "@velnox/shared/components/ui/textarea";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { apiBaseUrl } from "@velnox/shared/lib/sites";
import { compressImage } from "@velnox/shared/lib/image-optimize";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { toast } from "sonner";

/**
 * Banner contract v2 (client mirror of backend/lib/banners.ts). v1 rows from
 * older payloads are already mapped server-side before they reach this editor.
 */
interface Row {
  id: string;
  type: "announcement" | "promotion" | "ad";
  zone: "home" | "product" | "store";
  placement:
    | "home_hero"
    | "home_strip"
    | "product_above_gallery"
    | "product_below_image"
    | "product_below_price"
    | "product_above_tabs"
    | "store_header"
    | "store_above_products"
    | "store_between_products";
  slot: number;
  title: string;
  subtitle: string;
  imageUrl: string | null;
  ctaLabel: string;
  ctaUrl: string | null;
  active: boolean;
  sortOrder: number;
  startsAt: string | null;
  endsAt: string | null;
  animation: "none" | "fade" | "slide-up" | "bounce";
  bgColor: string | null;
  textColor: string | null;
}

function newRow(index: number): Row {
  return {
    id: `a${Date.now()}${index}`,
    type: "promotion",
    zone: "home",
    placement: "home_hero",
    slot: index,
    title: "",
    subtitle: "",
    imageUrl: null,
    ctaLabel: "",
    ctaUrl: null,
    active: true,
    sortOrder: index,
    startsAt: null,
    endsAt: null,
    animation: "none",
    bgColor: null,
    textColor: null,
  };
}

const toLocalInput = (iso: string | null): string => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

const fromLocalInput = (value: string): string | null => {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
};

/**
 * VelCenter → Marketing: the VelShop homepage banner system (contract v2).
 *
 * Reads/writes `PUT /api/admin/announcements` (platform_settings key
 * `shop_announcements`). Images go through the existing R2 presign flow with
 * `purpose: "announcement"`; nothing here invents storefront content.
 *
 * The one content rule: a banner needs image OR text — enforced here before the
 * save so the administrator sees the problem where it happens, and enforced
 * again by the backend (400 with the item index).
 */
export function MarketingBanners() {
  const { t } = useLanguage();
  const load = useAction(api.centerAdmin.getAnnouncements);
  const save = useAction(api.centerAdmin.saveAnnouncementsAction);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Unsaved-changes indicator: dirty = current rows differ from the last
  // server-known snapshot.
  const [savedSnapshot, setSavedSnapshot] = useState<string>("[]");
  const dirty = JSON.stringify(rows) !== savedSnapshot;

  useEffect(() => {
    let alive = true;
    load()
      .then((data: Row[]) => {
        if (!alive) return;
        const loaded = Array.isArray(data) ? data : [];
        setRows(loaded);
        setSavedSnapshot(JSON.stringify(loaded));
      })
      .catch(() => {
        if (alive) setRows([]);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [load]);

  const update = useCallback((index: number, patch: Partial<Row>) => {
    setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }, []);

  const move = (index: number, delta: number) => {
    setRows((prev) => {
      const next = [...prev];
      const target = index + delta;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next.map((row, i) => ({ ...row, sortOrder: i, slot: i }));
    });
  };

  const removeImage = (index: number) => update(index, { imageUrl: null });

  const uploadImage = async (index: number, file: File) => {
    setUploadingIndex(index);
    try {
      const webp = await compressImage(file, "cover", { maxBytes: 2_000_000, quality: 0.82 });
      const presignRes = await fetch(`${apiBaseUrl}/upload/presign`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: webp.name || "banner.webp",
          contentType: webp.type,
          purpose: "announcement",
        }),
      });
      const presign = await presignRes.json();
      if (!presignRes.ok || !presign?.data?.uploadUrl) {
        throw new Error(presign?.error?.message ?? "presign failed");
      }
      const put = await fetch(presign.data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": webp.type },
        body: webp,
      });
      if (!put.ok) throw new Error("upload failed");
      const confirmRes = await fetch(`${apiBaseUrl}/upload/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectKey: presign.data.objectKey }),
      });
      const confirm = await confirmRes.json();
      const url = confirm?.data?.url ?? presign.data.publicUrl;
      if (!url) throw new Error("confirm failed");
      update(index, { imageUrl: url });
      toast.success(t("marketing.uploaded"));
    } catch (error) {
      console.error("Banner image upload failed:", error);
      toast.error(t("marketing.uploadFailed"));
    } finally {
      setUploadingIndex(null);
    }
  };

  const onSave = async () => {
    setError(null);
    // Client-side guard for the one hard rule (the backend re-checks and
    // answers 400 with the item index).
    const emptyIndex = rows.findIndex(
      (row) => !row.title.trim() && !row.subtitle.trim() && !row.imageUrl,
    );
    if (emptyIndex >= 0) {
      setError(t("marketing.emptyBannerError"));
      return;
    }
    // Schedule sanity mirrors the backend rule (banners.ts).
    const scheduleIndex = rows.findIndex(
      (row) => row.startsAt && row.endsAt && row.endsAt <= row.startsAt,
    );
    if (scheduleIndex >= 0) {
      setError(t("marketing.errSchedule"));
      return;
    }

    setSaving(true);
    try {
      const payload = rows.map((row, index) => ({
        id: row.id,
        type: row.type,
        zone: row.zone,
        placement: row.placement,
        slot: row.slot ?? index,
        title: row.title.trim(),
        subtitle: row.subtitle.trim(),
        imageUrl: row.imageUrl,
        ctaLabel: row.ctaLabel.trim(),
        ctaUrl: row.ctaUrl,
        active: row.active,
        sortOrder: index,
        startsAt: row.startsAt,
        endsAt: row.endsAt,
        animation: row.animation,
        bgColor: row.bgColor,
        textColor: row.textColor,
      }));
      const saved = await save({ items: payload });
      const savedRows = Array.isArray(saved) ? saved : payload;
      setRows(savedRows);
      setSavedSnapshot(JSON.stringify(savedRows));
      toast.success(t("marketing.saved"));
    } catch (err) {
      console.error("Banner save failed:", err);
      const message = err instanceof Error ? err.message : "";
      // The backend rejects invalid items with "banner N: reason" — surface it.
      const match = /^banner (\d+): (.+)$/.exec(message);
      setError(match ? t("marketing.rejectPrefix", { index: Number(match[1]) + 1 }) + ` — ${match[2]}` : message || t("marketing.saveFailed"));
      toast.error(t("marketing.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  const hasEmptyRow = rows.some(
    (row) => !row.title.trim() && !row.subtitle.trim() && !row.imageUrl,
  );
  const atCap = rows.length >= 10;

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-base font-bold text-slate-900">{t("marketing.title")}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{t("marketing.desc")}</p>
        </div>
        <div className="flex items-center gap-2">
          {dirty && (
            <span className="text-xs font-medium text-amber-600" aria-live="polite">
              {t("marketing.unsaved")}
            </span>
          )}
          <Button
            type="button"
            variant="outline"
            className="gap-1.5 border-slate-200"
            onClick={() => setRows((prev) => [...prev, newRow(prev.length)])}
            disabled={atCap}
          >
            <Plus className="size-4" />
            {t("marketing.add")}
          </Button>
          <Button
            type="button"
            className="gap-1.5 bg-brand text-white hover:bg-brand-strong"
            onClick={onSave}
            disabled={saving || hasEmptyRow}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("marketing.save")}
          </Button>
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-red-200 bg-red-50/70 px-3 py-2 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
          {t("marketing.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row, index) => {
            const hasText = Boolean(row.title.trim() || row.subtitle.trim());
            const mode = row.imageUrl ? (hasText ? "image+text" : "image") : hasText ? "text" : "empty";
            return (
              <li key={row.id} className="rounded-xl border border-slate-200 p-3">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                  {/* Image column — clearly optional */}
                  <div className="flex w-full shrink-0 flex-col gap-1 sm:w-28">
                    {row.imageUrl ? (
                      <div className="relative">
                        <img
                          src={row.imageUrl}
                          alt=""
                          className="h-20 w-full rounded-lg border border-slate-200 object-cover sm:h-16 sm:w-28"
                        />
                        <button
                          type="button"
                          onClick={() => removeImage(index)}
                          aria-label={t("marketing.removeImage")}
                          className="absolute -right-1.5 -top-1.5 flex size-8 items-center justify-center rounded-full bg-white text-slate-500 shadow-sm ring-1 ring-slate-200 hover:text-rose-600"
                        >
                          <X className="size-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex h-16 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400">
                        <ImagePlus className="size-5" />
                      </div>
                    )}
                    <label className="inline-flex min-h-11 cursor-pointer items-center justify-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-2xs text-slate-600 hover:bg-slate-50">
                      {uploadingIndex === index ? (
                        <Loader2 className="size-3 animate-spin" />
                      ) : (
                        <ImagePlus className="size-3" />
                      )}
                      {t("marketing.upload")}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp,image/avif"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0];
                          if (file) void uploadImage(index, file);
                          event.currentTarget.value = "";
                        }}
                      />
                    </label>
                    <p className="text-2xs leading-3.5 text-slate-400">{t("marketing.uploadHint")}</p>
                  </div>

                  <div className="grid min-w-0 flex-1 gap-2">
                    <div className="grid gap-2 sm:grid-cols-2">
                    <div className="grid gap-1">
                      <Label htmlFor={`bn-type-${index}`}>{t("marketing.fieldType")}</Label>
                      <Select
                          value={row.type}
                          onValueChange={(value) => update(index, { type: value as Row["type"] })}
                        >
                          <SelectTrigger id={`bn-type-${index}`} className="h-9 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="announcement">{t("marketing.typeAnnouncement")}</SelectItem>
                            <SelectItem value="promotion">{t("marketing.typePromotion")}</SelectItem>
                            <SelectItem value="ad">{t("marketing.typeAd")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`bn-place-${index}`}>{t("marketing.fieldPlacement")}</Label>
                        <Select
                          value={row.placement}
                          onValueChange={(value) => update(index, { placement: value as Row["placement"] })}
                        >
                          <SelectTrigger id={`bn-place-${index}`} className="h-9 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="home_hero">{t("marketing.placementHero")}</SelectItem>
                            <SelectItem value="home_strip">{t("marketing.placementStrip")}</SelectItem>
                            <SelectItem value="product_above_gallery">{t("marketing.placementProductAboveGallery")}</SelectItem>
                            <SelectItem value="product_below_image">{t("marketing.placementProductBelowImage")}</SelectItem>
                            <SelectItem value="product_below_price">{t("marketing.placementProductBelowPrice")}</SelectItem>
                            <SelectItem value="product_above_tabs">{t("marketing.placementProductAboveTabs")}</SelectItem>
                            <SelectItem value="store_header">{t("marketing.placementStoreHeader")}</SelectItem>
                            <SelectItem value="store_above_products">{t("marketing.placementStoreAboveProducts")}</SelectItem>
                            <SelectItem value="store_between_products">{t("marketing.placementStoreBetweenProducts")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-3">
                      <div className="grid gap-1">
                        <Label>{t("marketing.fieldZone")}</Label>
                        <div className="flex items-center gap-1.5 rounded-squircle-sm border border-slate-200 bg-slate-50 px-2 py-1.5 text-2xs font-medium text-slate-600">
                          <span className="w-2 h-2 rounded-full" style={{ backgroundColor: row.zone === "product" ? "#10b981" : row.zone === "store" ? "#3b82f6" : "#64748b" }}></span>
                          <span>{t(`marketing.zone${row.zone.charAt(0).toUpperCase() + row.zone.slice(1)}`)}</span>
                        </div>
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`bn-anim-${index}`}>{t("marketing.fieldAnimation")}</Label>
                        <Select
                          value={row.animation}
                          onValueChange={(value) => update(index, { animation: value as Row["animation"] })}
                        >
                          <SelectTrigger id={`bn-anim-trigger-${index}`} className="h-9 w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">{t("marketing.animNone")}</SelectItem>
                            <SelectItem value="fade">{t("marketing.animFade")}</SelectItem>
                            <SelectItem value="slide-up">{t("marketing.animSlideUp")}</SelectItem>
                            <SelectItem value="bounce">{t("marketing.animBounce")}</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="grid gap-1">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-1 text-2xs font-medium text-slate-600">{t("marketing.fieldBgColor")}</div>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-6 rounded-squircle-sm border border-slate-200" style={{ backgroundColor: row.bgColor ?? "#f1f5f9" }} />
                            <input
                              type="color"
                              value={row.bgColor ?? "#ffffff"}
                              onChange={(event) => update(index, { bgColor: event.target.value })}
                              className="w-8 h-6 rounded-squircle-sm border-0 p-0 cursor-pointer"
                            />
                          </div>
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-6 rounded-squircle-sm border border-slate-200" style={{ backgroundColor: row.textColor ?? "#0f172a" }} />
                            <input
                              type="color"
                              value={row.textColor ?? "#000000"}
                              onChange={(event) => update(index, { textColor: event.target.value })}
                              className="w-8 h-6 rounded-squircle-sm border-0 p-0 cursor-pointer"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`bn-title-${index}`}>{t("marketing.fieldTitle")}</Label>
                      <Input
                        id={`bn-title-${index}`}
                        value={row.title}
                        onChange={(event) => update(index, { title: event.target.value })}
                        maxLength={120}
                      />
                      <p className="text-2xs text-slate-400">{t("marketing.fieldTitleHint")}</p>
                    </div>
                    <div className="grid gap-1">
                      <Label htmlFor={`bn-sub-${index}`}>{t("marketing.fieldSubtitle")}</Label>
                      <Textarea
                        id={`bn-sub-${index}`}
                        value={row.subtitle}
                        onChange={(event) => update(index, { subtitle: event.target.value })}
                        maxLength={240}
                        rows={2}
                      />
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="grid gap-1">
                        <Label htmlFor={`bn-ctal-${index}`}>{t("marketing.fieldCtaLabel")}</Label>
                        <Input
                          id={`bn-ctal-${index}`}
                          value={row.ctaLabel}
                          onChange={(event) => update(index, { ctaLabel: event.target.value })}
                          maxLength={32}
                          placeholder="/products"
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`bn-ctau-${index}`}>{t("marketing.fieldCtaUrl")}</Label>
                        <Input
                          id={`bn-ctau-${index}`}
                          value={row.ctaUrl ?? ""}
                          onChange={(event) => update(index, { ctaUrl: event.target.value || null })}
                          placeholder="/products"
                        />
                      </div>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="grid gap-1">
                        <Label htmlFor={`bn-start-${index}`}>{t("marketing.fieldStartsAt")}</Label>
                        <Input
                          id={`bn-start-${index}`}
                          type="datetime-local"
                          value={toLocalInput(row.startsAt)}
                          onChange={(event) => update(index, { startsAt: fromLocalInput(event.target.value) })}
                        />
                      </div>
                      <div className="grid gap-1">
                        <Label htmlFor={`bn-end-${index}`}>{t("marketing.fieldEndsAt")}</Label>
                        <Input
                          id={`bn-end-${index}`}
                          type="datetime-local"
                          value={toLocalInput(row.endsAt)}
                          onChange={(event) => update(index, { endsAt: fromLocalInput(event.target.value) })}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 flex-row items-center gap-2 sm:flex-col sm:gap-1">
                    <button
                      type="button"
                      onClick={() => move(index, -1)}
                      aria-label={t("marketing.up")}
                      className="flex size-11 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
                    >
                      <ArrowUp className="size-4" />
                    </button>
                    <button
                      type="button"
                      onClick={() => move(index, 1)}
                      aria-label={t("marketing.down")}
                      className="flex size-11 items-center justify-center rounded-md text-slate-500 hover:bg-slate-100"
                    >
                      <ArrowDown className="size-4" />
                    </button>
                    <label className="flex min-h-11 items-center gap-1.5 text-2xs text-slate-600">
                      <input
                        type="checkbox"
                        checked={row.active}
                        onChange={(event) => update(index, { active: event.target.checked })}
                        className="size-4 accent-brand"
                      />
                      {t("marketing.active")}
                    </label>
                    <button
                      type="button"
                      onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                      aria-label={t("marketing.remove")}
                      className="flex size-11 items-center justify-center rounded-md text-rose-500 hover:bg-rose-50"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

                {/* Content-mode preview: the three modes exactly as the
                    storefront renders them (D3) */}
                <div
                  className={`mt-2 overflow-hidden rounded-lg border ${
                    mode === "empty" ? "border-red-200 bg-red-50/50" : "border-slate-200 bg-slate-50"
                  }`}
                  aria-hidden="true"
                >
                  {mode === "image+text" && (
                    <div className="flex items-stretch">
                      <div className="flex min-w-0 flex-1 flex-col justify-center gap-0.5 px-3 py-2">
                        <span className="text-2xs font-semibold uppercase tracking-wide text-brand-strong">{t("marketing.stripEyebrow")}</span>
                        {row.title.trim() && <span className="text-xs font-bold text-slate-900">{row.title}</span>}
                        {row.subtitle.trim() && <span className="line-clamp-1 text-2xs text-slate-600">{row.subtitle}</span>}
                        {row.ctaUrl && <span className="text-2xs font-semibold text-brand-strong">{row.ctaLabel || t("marketing.stripCta")} →</span>}
                      </div>
                      <img src={row.imageUrl!} alt="" className="h-14 w-[34%] object-cover" />
                    </div>
                  )}
                  {mode === "text" && (
                    <div className="px-3 py-2">
                      {row.title.trim() && <span className="block text-xs font-bold text-slate-900">{row.title}</span>}
                      {row.subtitle.trim() && <span className="mt-0.5 block line-clamp-1 text-2xs text-slate-600">{row.subtitle}</span>}
                      {row.ctaUrl && <span className="mt-1 inline-flex text-2xs font-semibold text-brand-strong">{row.ctaLabel || t("marketing.stripCta")} →</span>}
                    </div>
                  )}
                  {mode === "image" && (
                    <img src={row.imageUrl!} alt="" className="h-14 w-full object-cover" />
                  )}
                  {mode === "empty" && (
                    <p className="px-3 py-2 text-2xs font-medium text-red-700">{t("marketing.emptyBannerError")}</p>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
