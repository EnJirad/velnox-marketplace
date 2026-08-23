import { api } from "@velnox/shared/lib/api-routes";
import { compressImage, getOptimizedExtension } from "@velnox/shared/lib/image-optimize";
import { useAction, useMutation } from "@velnox/shared/lib/api-routes";
import { useLanguage } from "@/lib/i18n";
import { Loader2 } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

interface ProfileImageUploadProps {
  kind: "avatar" | "cover";
  /** Called with the new URL after a successful upload. */
  onUploaded: (url: string) => void;
  /** Called when upload state changes (for spinner overlay on parent). */
  onUploadingChange?: (uploading: boolean) => void;
  children: ReactNode;
}

/**
 * VelShop profile image uploader — browser-direct R2 upload.
 *
 * UX CONTRACT:
 *   OLD IMAGE stays visible during the entire upload.
 *   A spinner overlay is shown on the button while uploading.
 *   On success → onUploaded(newUrl) → parent swaps to new image.
 *   On error   → old image was never removed; toast shows error.
 *
 * We do NOT call onPreview() — the old image must never disappear.
 *
 * Flow:
 * 1. User selects image via native file input
 * 2. Client validates type + size
 * 3. Compress if needed
 * 4. Upload intent request → signed R2 PUT URL
 * 5. Browser uploads DIRECTLY to R2 via fetch PUT
 * 6. Save profile image → Neon metadata + old image cleanup
 * 7. onUploaded(permanentUrl) → parent updates display
 */
export function ProfileImageUpload({
  kind,
  onUploaded,
  onUploadingChange,
  children,
}: ProfileImageUploadProps) {
  const { t } = useLanguage();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const getUploadIntent = useAction(api.customer.getProfileImageUploadIntent);
  const saveProfileImage = useAction(api.customer.saveProfileImage);
  const patchUserImage = useMutation(api.users.patchUserImage);

  const resetInput = useCallback(() => {
    if (inputRef.current) inputRef.current.value = "";
  }, []);

  const handleFile = useCallback(
    async (file: File) => {
      // ── Validation ──────────────────────────────────────────────
      if (!ACCEPTED_TYPES.includes(file.type)) {
        toast.error(t("profile.imageTypeError"));
        resetInput();
        return;
      }
      if (file.size <= 0) {
        toast.error(t("profile.imageTypeError"));
        resetInput();
        return;
      }
      if (file.size > MAX_BYTES) {
        toast.error(t("profile.imageSizeError"));
        resetInput();
        return;
      }

      // ── Start upload — old image stays visible ──────────────────
      // We do NOT create an objectURL or call onPreview.
      // The parent keeps showing the current image throughout.
      setUploading(true);
      onUploadingChange?.(true);

      // ── Compress large images before upload ─────────────────────
      let uploadFile: File;
      try {
        uploadFile = await compressImage(file, kind, {
          maxBytes: kind === "avatar" ? 200_000 : 500_000,
          quality: kind === "avatar" ? 0.85 : 0.80,
        });
      } catch {
        uploadFile = file; // fallback to original
      }

      try {
        // ── Step 1: Request upload intent from backend ──────
        let intent: {
          kind: string;
          uploadUrl: string;
          objectKey: string;
          cdnUrl: string;
          expiresAt: number;
        } | null = null;

        try {
          intent = await getUploadIntent({
            kind,
            filename: uploadFile.name,
            mimeType: uploadFile.type,
          });
        } catch (intentErr: unknown) {
          const errMsg =
            intentErr instanceof Error ? intentErr.message : String(intentErr);
          console.error("[ProfileImageUpload] intent failed:", errMsg);
          toast.error(
            errMsg.includes("not configured")
              ? "ระบบอัปโหลดรูปภาพยังไม่พร้อมใช้งาน"
              : t("profile.imageUploadFailed"),
          );
          // Old image was never removed — no cleanup needed.
          return;
        }

        // ── Step 2: Direct R2 PUT upload from browser ─────────────
        let uploadRes: Response;
        try {
          uploadRes = await fetch(intent!.uploadUrl, {
            method: "PUT",
            body: uploadFile,
            headers: { "Content-Type": uploadFile.type },
            credentials: "omit",
          });
        } catch (fetchErr: unknown) {
          console.error("[ProfileImageUpload] R2 PUT failed:", fetchErr);
          toast.error(t("profile.imageUploadFailed"));
          // Old image was never removed — no cleanup needed.
          return;
        }

        if (!uploadRes.ok) {
          console.error(
            "[ProfileImageUpload] R2 returned",
            uploadRes.status,
          );
          toast.error(t("profile.imageUploadFailed"));
          // Old image was never removed — no cleanup needed.
          return;
        }

        // ── Step 3: Confirm upload — persist metadata in Neon ──────
        try {
          const updatedProfile = await saveProfileImage({
            kind,
            objectKey: intent!.objectKey,
            cdnUrl: intent!.cdnUrl,
            format: getOptimizedExtension(uploadFile),
            bytes: uploadFile.size,
          });

          const url =
            kind === "cover"
              ? updatedProfile.coverUrl
              : updatedProfile.avatarUrl;

          // Sync user image field so currentUser returns the
          // correct avatar after logout/login.
          if (kind === "avatar" && url) {
            try {
              await patchUserImage({ image: url });
            } catch (patchErr) {
              console.error("[ProfileImageUpload] patchUserImage failed (avatar saved to DB):", patchErr);
            }
          }

          if (url) {
            // Upload complete — parent swaps to new image.
            onUploaded(url);
          } else {
            toast.error(t("profile.imageUploadFailed"));
          }
        } catch (saveErr: unknown) {
          const errMsg =
            saveErr instanceof Error ? saveErr.message : String(saveErr);
          console.error("[ProfileImageUpload] save failed:", errMsg);
          toast.error("บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        }
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        console.error("[ProfileImageUpload] unexpected:", e.name, e.message);
        toast.error(`${e.name}: ${e.message}`);
      } finally {
        setUploading(false);
        onUploadingChange?.(false);
        resetInput();
      }
    },
    [kind, onUploaded, onUploadingChange, resetInput, t, getUploadIntent, saveProfileImage],
  );

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />
      <button
        type="button"
        disabled={uploading}
        onClick={() => inputRef.current?.click()}
        className="inline-flex items-center gap-1.5 rounded-full bg-slate-900/60 px-3 py-1.5 text-xs font-medium text-white backdrop-blur transition-colors hover:bg-slate-900/80 disabled:opacity-70"
        aria-label={t(kind === "cover" ? "profile.changeCover" : "profile.changeAvatar")}
      >
        {uploading ? <Loader2 className="size-3.5 animate-spin" /> : children}
      </button>
    </>
  );
}
