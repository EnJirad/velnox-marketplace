/**
 * IdentityDocumentUploader — single-image identity document upload with a REAL preview.
 *
 * Why this exists:
 * The seller onboarding previously stored a browser `File` in React state and only
 * rendered the filename. No object URL was ever created, so a selected image could
 * never appear — the "selected but no preview" bug.
 *
 * Behaviour (spec §5 / §6 / §11):
 *  1. validate file type
 *  2. validate file size
 *  3. immediately create a local preview with URL.createObjectURL()
 *  4. display the ACTUAL selected image (desktop + Android Chrome + iOS Safari)
 *  5. allow replacing / removing the image
 *  6. upload to Cloudflare R2 through the existing Velnox evidence architecture
 *     (POST /api/seller/evidence/upload-intent → PUT → POST /api/seller/evidence/confirm)
 *
 * The local preview is shown immediately and never waits for the upload.
 * The upload is asynchronous; the parent only receives a persisted document
 * reference once the media record exists in Neon.
 */
import { Button } from "@velnox/shared/components/ui/button";
import { Label } from "@velnox/shared/components/ui/label";
import { useAction, api } from "@velnox/shared/lib/api-routes";
import { useLanguage } from "@velnox/shared/lib/i18n";
import { AlertCircle, CheckCircle2, Image as ImageIcon, Loader2, RefreshCw, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB — matches the evidence backend limit
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const ACCEPT = ALLOWED_TYPES.join(",");

/** A persisted identity document (media row already stored in Neon). */
export interface IdentityDocumentRef {
  /** R2 object key — the durable, private reference persisted with the application. */
  objectKey: string;
  /** URL returned by the evidence-confirm response. */
  url: string;
  filename: string;
  contentType: string;
  fileSize: number;
}

type DocStatus = "empty" | "uploading" | "uploaded" | "error";

interface IdentityDocumentUploaderProps {
  /** Stable evidence purpose, e.g. `id_card`, `id_card_back`, `selfie_id`. */
  purpose: string;
  label: string;
  hint?: string;
  required?: boolean;
  /** Persisted document reference, or null when nothing has been uploaded. */
  value: IdentityDocumentRef | null;
  onChange: (doc: IdentityDocumentRef | null) => void;
  disabled?: boolean;
}

export function IdentityDocumentUploader({
  purpose,
  label,
  hint,
  required = false,
  value,
  onChange,
  disabled = false,
}: IdentityDocumentUploaderProps) {
  const { t } = useLanguage();
  const getUploadIntent = useAction(api.seller.evidenceUploadIntent);
  const confirmUpload = useAction(api.seller.evidenceConfirm);

  const inputRef = useRef<HTMLInputElement>(null);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [status, setStatus] = useState<DocStatus>(value ? "uploaded" : "empty");
  const [error, setError] = useState<string | null>(null);

  // Keep the latest preview in a ref so the unmount cleanup can revoke it
  // without re-running the effect (which would revoke a live URL).
  const previewRef = useRef<string | null>(null);
  previewRef.current = localPreview;

  useEffect(() => {
    return () => {
      if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    };
  }, []);

  const revokePreview = useCallback(() => {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current);
      previewRef.current = null;
    }
    setLocalPreview(null);
  }, []);

  const upload = useCallback(
    async (file: File) => {
      setStatus("uploading");
      setError(null);
      try {
        // 1. Presigned R2 upload URL through the existing Velnox evidence API
        const intent = await getUploadIntent({
          filename: file.name,
          mimeType: file.type,
          purpose,
        });
        if (!intent?.uploadUrl || !intent?.objectKey) {
          throw new Error("PRESIGN_FAILED");
        }

        // 2. Direct PUT to R2 — the signature is bound to this exact Content-Type
        const putRes = await fetch(intent.uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        if (!putRes.ok) throw new Error(`R2_PUT_${putRes.status}`);

        // 3. Persist the media row in Neon. Only after this succeeds do we
        //    hand a reference to the parent — no pending state without evidence.
        const confirmed = await confirmUpload({
          objectKey: intent.objectKey,
          publicUrl: intent.cdnUrl,
          filename: file.name,
          contentType: file.type,
          fileSize: file.size,
        });
        if (!confirmed?.objectKey) throw new Error("CONFIRM_FAILED");

        onChange({
          objectKey: confirmed.objectKey,
          url: confirmed.url || intent.cdnUrl || "",
          filename: confirmed.filename || file.name,
          contentType: file.type,
          fileSize: file.size,
        });
        setStatus("uploaded");
      } catch (err) {
        console.error(`[identity-doc] upload failed purpose=${purpose}`, err);
        setError(t("identityDoc.uploadFailed"));
        setStatus("error");
        onChange(null);
      }
    },
    [getUploadIntent, confirmUpload, onChange, purpose, t],
  );

  const handlePick = useCallback(
    async (fileList: FileList | null) => {
      const file = fileList?.[0];
      if (!file) return;

      // 1. validate file type
      if (!ALLOWED_TYPES.includes(file.type)) {
        toast.error(t("identityDoc.invalidType"));
        return;
      }
      // 2. validate file size
      if (file.size > MAX_FILE_SIZE) {
        toast.error(t("identityDoc.tooLarge"));
        return;
      }

      // 3./4. Immediately show the real selected image — never wait for R2
      revokePreview();
      const objectUrl = URL.createObjectURL(file);
      previewRef.current = objectUrl;
      setLocalPreview(objectUrl);
      setError(null);
      onChange(null); // invalidate the previous persisted reference

      // 6. Upload in the background
      await upload(file);
    },
    [onChange, revokePreview, t, upload],
  );

  const handleRemove = useCallback(() => {
    revokePreview();
    setStatus("empty");
    setError(null);
    onChange(null);
    if (inputRef.current) inputRef.current.value = "";
  }, [onChange, revokePreview]);

  // Prefer the freshly picked local file; fall back to the persisted document.
  const displayUrl = localPreview ?? (status === "uploaded" ? value?.url ?? null : null);
  const fileName = value?.filename ?? null;

  return (
    <div className="grid gap-2" data-purpose={purpose}>
      <div className="flex items-center gap-2">
        <Label className="text-xs font-medium text-slate-500">
          {label}
          {required && <span className="ml-0.5 text-rose-500">*</span>}
        </Label>
        {status === "uploading" && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber-600">
            <Loader2 className="size-3 animate-spin" />
            {t("identityDoc.uploading")}
          </span>
        )}
        {status === "uploaded" && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-emerald-600">
            <CheckCircle2 className="size-3" />
            {t("identityDoc.uploaded")}
          </span>
        )}
        {status === "error" && (
          <span className="inline-flex items-center gap-1 text-[10px] font-medium text-rose-600">
            <AlertCircle className="size-3" />
            {t("identityDoc.failed")}
          </span>
        )}
      </div>

      {displayUrl ? (
        <div className="overflow-hidden rounded-[12px] border border-slate-200 bg-slate-50">
          {/* Real image preview of the ACTUAL selected file */}
          <div className="flex items-center justify-center bg-slate-100">
            <img
              src={displayUrl}
              alt={label}
              className="max-h-56 w-full object-contain"
              loading="lazy"
            />
          </div>
          <div className="flex items-center gap-2 border-t border-slate-200 bg-white px-3 py-2">
            <ImageIcon className="size-3.5 shrink-0 text-slate-400" />
            <p className="min-w-0 flex-1 truncate text-[11px] text-slate-500" title={fileName ?? label}>
              {fileName ?? t("identityDoc.previewOnly")}
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 px-2 text-[11px] text-slate-600"
              onClick={() => inputRef.current?.click()}
              disabled={disabled || status === "uploading"}
            >
              <RefreshCw className="size-3" />
              {t("identityDoc.replace")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 shrink-0 gap-1 px-2 text-[11px] text-rose-600 hover:bg-rose-50"
              onClick={handleRemove}
              disabled={disabled || status === "uploading"}
            >
              <Trash2 className="size-3" />
              {t("identityDoc.remove")}
            </Button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || status === "uploading"}
          className="flex min-h-28 w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-[12px] border-2 border-dashed border-slate-200 bg-slate-50/60 px-4 py-6 text-center transition-colors hover:border-[#10B981]/50 hover:bg-[#ECFDF5]/40 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {status === "uploading" ? (
            <Loader2 className="size-5 animate-spin text-[#10B981]" />
          ) : (
            <Upload className="size-5 text-slate-400" />
          )}
          <span className="text-xs font-medium text-slate-600">{t("identityDoc.choose")}</span>
          <span className="text-[10px] text-slate-400">{t("identityDoc.formats")}</span>
        </button>
      )}

      {hint && !error && <p className="text-[10px] text-slate-400">{hint}</p>}
      {error && <p className="text-[10px] font-medium text-rose-600">{error}</p>}

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => void handlePick(e.target.files)}
      />
    </div>
  );
}
