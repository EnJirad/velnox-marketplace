import { useCallback, useEffect, useState } from "react";
import { ArrowDown, ArrowUp, ImagePlus, Loader2, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "@velnox/shared/components/ui/button";
import { Input } from "@velnox/shared/components/ui/input";
import { Label } from "@velnox/shared/components/ui/label";
import { Textarea } from "@velnox/shared/components/ui/textarea";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { apiBaseUrl } from "@velnox/shared/lib/sites";
import { compressImage } from "@velnox/shared/lib/image-optimize";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { toast } from "sonner";

interface Row {
  id: string;
  title: string;
  description: string;
  imageUrl: string | null;
  linkUrl: string | null;
  active: boolean;
  sortOrder: number;
}

function newRow(index: number): Row {
  return {
    id: `a${Date.now()}${index}`,
    title: "",
    description: "",
    imageUrl: null,
    linkUrl: null,
    active: true,
    sortOrder: index,
  };
}

/**
 * VelCenter → Settings: the VelShop home announcement carousel.
 *
 * Reads/writes `PUT /api/admin/announcements` (platform_settings key
 * `shop_announcements`). Images go through the existing R2 presign flow with
 * `purpose: "announcement"`; nothing here invents storefront content.
 */
export function AnnouncementSettings() {
  const { t } = useLanguage();
  const load = useAction(api.centerAdmin.getAnnouncements);
  const save = useAction(api.centerAdmin.saveAnnouncementsAction);

  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingIndex, setUploadingIndex] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    load()
      .then((data: Row[]) => {
        if (alive) setRows(Array.isArray(data) ? data : []);
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
      return next.map((row, i) => ({ ...row, sortOrder: i }));
    });
  };

  const uploadImage = async (index: number, file: File) => {
    setUploadingIndex(index);
    try {
      const webp = await compressImage(file, "cover", { maxBytes: 2_000_000, quality: 0.82 });
      const presignRes = await fetch(`${apiBaseUrl}/upload/presign`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          filename: webp.name || "announcement.webp",
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
      toast.success(t("announceAdmin.uploaded"));
    } catch (error) {
      console.error("Announcement image upload failed:", error);
      toast.error(t("announceAdmin.uploadFailed"));
    } finally {
      setUploadingIndex(null);
    }
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const payload = rows.map((row, index) => ({
        id: row.id,
        title: row.title.trim(),
        description: row.description.trim(),
        imageUrl: row.imageUrl,
        linkUrl: row.linkUrl,
        active: row.active,
        sortOrder: index,
      }));
      const saved = await save({ items: payload });
      setRows(Array.isArray(saved) ? saved : payload);
      toast.success(t("announceAdmin.saved"));
    } catch (error) {
      console.error("Announcement save failed:", error);
      toast.error(t("announceAdmin.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-slate-200 bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-base font-bold text-slate-900">{t("announceAdmin.title")}</h3>
          <p className="mt-0.5 text-xs text-slate-500">{t("announceAdmin.desc")}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-1.5 border-slate-200"
            onClick={() => setRows((prev) => [...prev, newRow(prev.length)])}
          >
            <Plus className="size-4" />
            {t("announceAdmin.add")}
          </Button>
          <Button
            type="button"
            className="gap-1.5 bg-[#10B981] text-white hover:bg-[#059669]"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? <Loader2 className="size-4 animate-spin" /> : <Save className="size-4" />}
            {t("announceAdmin.save")}
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-500">{t("common.loading")}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-4 text-sm text-slate-500">
          {t("announceAdmin.empty")}
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((row, index) => (
            <li key={row.id} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-start gap-3">
                <div className="flex w-24 shrink-0 flex-col gap-1">
                  {row.imageUrl ? (
                    <img
                      src={row.imageUrl}
                      alt=""
                      className="h-16 w-24 rounded-lg border border-slate-200 object-cover"
                    />
                  ) : (
                    <div className="flex h-16 w-24 items-center justify-center rounded-lg border border-dashed border-slate-300 text-slate-400">
                      <ImagePlus className="size-5" />
                    </div>
                  )}
                  <label className="inline-flex cursor-pointer items-center justify-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-50">
                    {uploadingIndex === index ? (
                      <Loader2 className="size-3 animate-spin" />
                    ) : (
                      <ImagePlus className="size-3" />
                    )}
                    {t("announceAdmin.upload")}
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
                </div>

                <div className="grid min-w-0 flex-1 gap-2">
                  <div className="grid gap-1">
                    <Label htmlFor={`ann-title-${index}`}>{t("announceAdmin.fieldTitle")}</Label>
                    <Input
                      id={`ann-title-${index}`}
                      value={row.title}
                      onChange={(event) => update(index, { title: event.target.value })}
                      maxLength={120}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`ann-desc-${index}`}>{t("announceAdmin.fieldDesc")}</Label>
                    <Textarea
                      id={`ann-desc-${index}`}
                      value={row.description}
                      onChange={(event) => update(index, { description: event.target.value })}
                      maxLength={240}
                      rows={2}
                    />
                  </div>
                  <div className="grid gap-1">
                    <Label htmlFor={`ann-link-${index}`}>{t("announceAdmin.fieldLink")}</Label>
                    <Input
                      id={`ann-link-${index}`}
                      value={row.linkUrl ?? ""}
                      onChange={(event) => update(index, { linkUrl: event.target.value || null })}
                      placeholder="/products"
                    />
                  </div>
                </div>

                <div className="flex shrink-0 flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={() => move(index, -1)}
                    aria-label={t("announceAdmin.up")}
                    className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                  >
                    <ArrowUp className="size-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(index, 1)}
                    aria-label={t("announceAdmin.down")}
                    className="rounded-md p-1 text-slate-500 hover:bg-slate-100"
                  >
                    <ArrowDown className="size-4" />
                  </button>
                  <label className="mt-1 flex items-center gap-1 text-[11px] text-slate-600">
                    <input
                      type="checkbox"
                      checked={row.active}
                      onChange={(event) => update(index, { active: event.target.checked })}
                      className="size-3.5 accent-[#10B981]"
                    />
                    {t("announceAdmin.active")}
                  </label>
                  <button
                    type="button"
                    onClick={() => setRows((prev) => prev.filter((_, i) => i !== index))}
                    aria-label={t("announceAdmin.remove")}
                    className="rounded-md p-1 text-rose-500 hover:bg-rose-50"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
