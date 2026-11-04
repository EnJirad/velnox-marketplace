/**
 * Shop logo / cover control — one image, one R2 path, no second upload system.
 *
 * The backend already owns this flow:
 *   `POST /api/upload/presign` with `purpose: "shop-logo" | "shop-cover"` mints
 *   `shop/{shopId}/{logo|cover}.webp` **after** proving `sellers.user_id` owns
 *   that shop; `POST /api/upload/confirm` derives the purpose from the key it
 *   minted, re-checks ownership, inspects the stored object (size + MIME) and
 *   then writes `shops.logo` / `shops.cover`.
 *
 * So the client never sends a shop id it did not get from its own profile, never
 * chooses the object key, and never writes the column itself. Upload is a PUT to
 * the presigned URL; removal is an explicit `null` through `PATCH /api/seller/shop`.
 */
import { useRef, useState } from "react";
import { ImagePlus, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@velnox/shared/components/ui/button";
import { api, useAction } from "@velnox/shared/lib/api-routes";
import { compressImage } from "@velnox/shared/lib/image-optimize";
import { useLanguage } from "@velnox/shared/lib/i18n";

const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_BYTES = 5 * 1024 * 1024;

interface ShopMediaFieldProps {
  shopId: string;
  kind: "logo" | "cover";
  value: string | null;
  /** Called with the confirmed public URL, or `null` after removal. */
  onChange: (url: string | null) => void;
}

export function ShopMediaField({ shopId, kind, value, onChange }: ShopMediaFieldProps) {
  const { t } = useLanguage();
  const presign = useAction(api.seller.uploadPresign);
  const confirm = useAction(api.seller.uploadConfirm);
  const removeMedia = useAction(api.seller.updateShop);

  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const purpose = kind === "logo" ? "shop-logo" : "shop-cover";
  const label = kind === "logo" ? t("sellerDash.shop.mediaLogo") : t("sellerDash.shop.mediaCover");

  const handleFile = async (file: File) => {
    setError(null);

    if (!ALLOWED_TYPES.includes(file.type)) {
      setError(t("sellerDash.shop.mediaBadType"));
      return;
    }
    if (file.size > MAX_BYTES) {
      setError(t("sellerDash.shop.mediaTooLarge"));
      return;
    }

    setBusy(true);
    try {
      // The key is always `.webp`; storing non-WebP bytes under it would make the
      // object's metadata lie about its content, so a failed conversion stops here.
      const optimized = await compressImage(file, kind === "logo" ? "avatar" : "cover");
      if (optimized.type !== "image/webp") {
        setError(t("sellerDash.shop.mediaConvertFailed"));
        return;
      }

      const intent = await presign({
        filename: optimized.name,
        contentType: optimized.type,
        purpose,
        shopId,
      });
      if (!intent?.uploadUrl || !intent?.objectKey) {
        setError(t("sellerDash.shop.mediaUploadFailed"));
        return;
      }

      const put = await fetch(intent.uploadUrl, {
        method: "PUT",
        body: optimized,
        headers: { "Content-Type": optimized.type },
      });
      if (!put.ok) {
        setError(t("sellerDash.shop.mediaUploadFailed"));
        return;
      }

      const saved = await confirm({ objectKey: intent.objectKey });
      const url: string | null = saved?.url ?? intent.publicUrl ?? null;
      if (!url) {
        setError(t("sellerDash.shop.mediaUploadFailed"));
        return;
      }
      onChange(url);
      toast.success(t("sellerDash.shop.mediaSaved"));
    } catch (err) {
      console.error("Shop media upload error:", err);
      setError(err instanceof Error ? err.message : t("sellerDash.shop.mediaUploadFailed"));
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleRemove = async () => {
    setBusy(true);
    setError(null);
    try {
      await removeMedia(kind === "logo" ? { logo: null } : { cover: null });
      onChange(null);
    } catch (err) {
      console.error("Shop media removal error:", err);
      toast.error(t("sellerDash.shop.saveFailed"));
    } finally {
      setBusy(false);
    }
  };

  const isCover = kind === "cover";

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-700">{label}</span>
        <span className="text-[11px] text-slate-500">
          {isCover ? t("sellerDash.shop.mediaCoverHint") : t("sellerDash.shop.mediaLogoHint")}
        </span>
      </div>

      <div
        className={
          isCover
            ? "relative overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
            : "relative size-20 overflow-hidden rounded-xl border border-slate-200 bg-slate-50"
        }
        style={isCover ? { aspectRatio: "16 / 9" } : undefined}
      >
        {value ? (
          <img
            src={value}
            alt=""
            className={`size-full ${isCover ? "object-cover" : "object-cover"}`}
            loading="lazy"
          />
        ) : (
          <span className="flex size-full items-center justify-center text-slate-300">
            <ImagePlus className={isCover ? "size-6" : "size-5"} aria-hidden="true" />
          </span>
        )}

        {busy && (
          <span className="absolute inset-0 flex items-center justify-center bg-white/70">
            <Loader2 className="size-5 animate-spin text-[#10B981]" aria-hidden="true" />
            <span className="sr-only">{t("sellerDash.shop.mediaUploading")}</span>
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-11 flex-1 gap-1.5 border-slate-200 text-slate-600"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
        >
          <Upload className="size-4" aria-hidden="true" />
          {value ? t("sellerDash.shop.mediaReplace") : t("sellerDash.shop.mediaUpload")}
        </Button>
        {value && (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-11 text-slate-500 hover:bg-red-50 hover:text-red-600"
            onClick={() => void handleRemove()}
            disabled={busy}
            aria-label={t("sellerDash.shop.mediaRemove")}
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </Button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept={ALLOWED_TYPES.join(",")}
        className="sr-only"
        aria-label={label}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {error && (
        <p role="alert" className="text-xs font-medium text-rose-600">
          {error}
        </p>
      )}
    </div>
  );
}
