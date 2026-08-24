import { api } from "@velnox/shared/lib/api-routes";
import { compressImage, getOptimizedExtension } from "@velnox/shared/lib/image-optimize";
import { useAction, useMutation } from "@velnox/shared/lib/api-routes";
import { refetchCurrentUser } from "@velnox/shared/lib/api-client";
import { useLanguage } from "@/lib/i18n";
import { Loader2 } from "lucide-react";
import { useCallback, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];
const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

// ─── Safe logging helper (never logs presigned URLs) ────────────────────────

function r2cLog(step: string, data: Record<string, unknown>) {
  const safe = { ...data };
  for (const key of Object.keys(safe)) {
    const val = safe[key];
    if (typeof val === "string" && (val.startsWith("http://") || val.startsWith("https://"))) {
      try {
        const u = new URL(val);
        safe[key] = `${u.origin}/<redacted>`;
      } catch {
        safe[key] = "<redacted>";
      }
    }
  }
  console.log(`[R2 CLIENT] step=${step}`, JSON.stringify(safe));
}

/**
 * Classify a fetch error into a human-readable category.
 */
function classifyFetchError(err: unknown): string {
  if (!(err instanceof TypeError)) return `UnknownError: ${String(err)}`;
  const msg = err.message || "";

  if (msg === "Failed to fetch") {
    return "CorsOrNetworkError: fetch failed — likely CORS block, network offline, or DNS failure. Check R2 CORS settings in Cloudflare dashboard.";
  }
  if (msg.includes("NetworkError")) return "NetworkError: network unavailable";
  if (msg.includes("DNS")) return "DnsError: DNS resolution failed";
  if (msg.includes("timeout")) return "TimeoutError: request timed out";
  if (msg.includes("AbortError")) return "AbortError: request was aborted";
  if (msg.includes("SSL") || msg.includes("TLS")) return "TlsError: TLS/SSL handshake failed";
  return `TypeError: ${msg}`;
}

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
        console.warn("[R2 CLIENT] step=validate status=rejected reason=invalid_type type=", file.type);
        toast.error(t("profile.imageTypeError"));
        resetInput();
        return;
      }
      if (file.size <= 0) {
        console.warn("[R2 CLIENT] step=validate status=rejected reason=empty_file");
        toast.error(t("profile.imageTypeError"));
        resetInput();
        return;
      }
      if (file.size > MAX_BYTES) {
        console.warn("[R2 CLIENT] step=validate status=rejected reason=too_large size=", file.size);
        toast.error(t("profile.imageSizeError"));
        resetInput();
        return;
      }

      r2cLog("validate", { status: "ok", type: file.type, size: file.size, kind });

      // ── Start upload — old image stays visible ──────────────────
      setUploading(true);
      onUploadingChange?.(true);

      // ── Compress large images before upload ─────────────────────
      let uploadFile: File;
      try {
        r2cLog("compress", { status: "started", originalSize: file.size, kind });
        uploadFile = await compressImage(file, kind, {
          maxBytes: kind === "avatar" ? 200_000 : 500_000,
          quality: kind === "avatar" ? 0.85 : 0.80,
        });
        r2cLog("compress", {
          status: "done",
          originalSize: file.size,
          finalSize: uploadFile.size,
          finalType: uploadFile.type,
          compressed: uploadFile.size < file.size,
        });
      } catch (compressErr) {
        r2cLog("compress", { status: "fallback", error: String(compressErr) });
        uploadFile = file;
      }

      // Always force WebP — the fixed R2 key ends with .webp
      if (uploadFile.type !== "image/webp") {
        try {
          uploadFile = await compressImage(uploadFile, kind, {
            maxBytes: kind === "avatar" ? 200_000 : 500_000,
            quality: kind === "avatar" ? 0.85 : 0.80,
          });
        } catch {
          // Last resort: rename — R2 will store whatever MIME we send
        }
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
          // Always send image/webp as mimeType — R2 key is .webp
          const uploadMimeType = "image/webp";
          r2cLog("intent", { status: "requesting", kind, mimeType: uploadMimeType });
          const intentResult = await getUploadIntent({
            kind,
            filename: uploadFile.name,
            mimeType: uploadMimeType,
          });
          intent = intentResult;
          r2cLog("intent", {
            status: "success",
            kind: intentResult.kind,
            objectKey: intentResult.objectKey,
            hasUploadUrl: !!intentResult.uploadUrl,
            expiresAt: intentResult.expiresAt,
          });
        } catch (intentErr: unknown) {
          const errMsg =
            intentErr instanceof Error ? intentErr.message : String(intentErr);
          r2cLog("intent", { status: "failed", error: errMsg });
          console.error("[R2 CLIENT] intent failed:", errMsg);
          toast.error(
            errMsg.includes("not configured")
              ? "ระบบอัปโหลดรูปภาพยังไม่พร้อมใช้งาน"
              : t("profile.imageUploadFailed"),
          );
          return;
        }

        const intentData = intent!;

        // ── Step 2: Direct R2 PUT upload from browser ─────────────
        r2cLog("put", {
          status: "started",
          method: "PUT",
          contentType: "image/webp",
          bodySize: uploadFile.size,
          credentials: "omit",
        });

        let uploadRes: Response;
        try {
          uploadRes = await fetch(intentData.uploadUrl, {
            method: "PUT",
            body: uploadFile,
            headers: { "Content-Type": "image/webp" },
            credentials: "omit",
          });
        } catch (fetchErr: unknown) {
          const classification = classifyFetchError(fetchErr);
          r2cLog("put", {
            status: "failed",
            errorType: "fetch_exception",
            classification,
            message: fetchErr instanceof Error ? fetchErr.message : String(fetchErr),
            name: fetchErr instanceof Error ? fetchErr.name : "unknown",
          });
          console.error("[R2 CLIENT] PUT failed:", classification, fetchErr);
          toast.error(
            classification.includes("CorsOrNetwork")
              ? "ไม่สามารถอัปโหลดรูปได้ — ตรวจสอบการเชื่อมต่ออินเทอร์เน็ต หรือ R2 CORS settings"
              : t("profile.imageUploadFailed"),
          );
          return;
        }

        if (!uploadRes.ok) {
          let responseText = "";
          try {
            responseText = await uploadRes.text();
          } catch {
            responseText = "<could not read body>";
          }
          r2cLog("put", {
            status: "failed",
            errorType: "http_error",
            httpStatus: uploadRes.status,
            httpStatusText: uploadRes.statusText,
            responsePreview: responseText.slice(0, 200),
          });
          console.error("[R2 CLIENT] R2 returned HTTP", uploadRes.status, uploadRes.statusText, responseText.slice(0, 200));
          toast.error(t("profile.imageUploadFailed"));
          return;
        }

        r2cLog("put", {
          status: "success",
          httpStatus: uploadRes.status,
          httpStatusText: uploadRes.statusText,
        });

        // ── Step 3: Confirm upload — persist metadata in Neon ──────
        r2cLog("save", {
          status: "requesting",
          kind,
          objectKey: intentData.objectKey,
          format: getOptimizedExtension(uploadFile),
          bytes: uploadFile.size,
        });

        try {
          const updatedProfile = await saveProfileImage({
            kind,
            objectKey: intentData.objectKey,
            cdnUrl: intentData.cdnUrl,
            format: getOptimizedExtension(uploadFile),
            bytes: uploadFile.size,
          });

          r2cLog("save", {
            status: "success",
            kind,
            avatarUrl: updatedProfile.avatarUrl ? "<present>" : null,
            coverUrl: updatedProfile.coverUrl ? "<present>" : null,
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
              r2cLog("patch", { status: "success", kind });
            } catch (patchErr) {
              r2cLog("patch", {
                status: "failed",
                error: patchErr instanceof Error ? patchErr.message : String(patchErr),
              });
              console.error("[R2 CLIENT] patchUserImage failed (avatar saved to DB):", patchErr);
            }
          }

          if (url) {
            r2cLog("complete", { status: "success", kind, urlLength: url.length });
            onUploaded(url);

            // Refetch global auth state so /api/auth/me returns the
            // new avatar/coverUrl. This ensures ShopProfile.coverSrc
            // (which falls back to user.coverUrl) updates immediately.
            refetchCurrentUser().catch(() => {});
          } else {
            r2cLog("complete", { status: "failed", reason: "no_url_returned" });
            toast.error(t("profile.imageUploadFailed"));
          }
        } catch (saveErr: unknown) {
          const errMsg =
            saveErr instanceof Error ? saveErr.message : String(saveErr);
          r2cLog("save", { status: "failed", error: errMsg });
          console.error("[R2 CLIENT] save failed:", errMsg);
          toast.error("บันทึกรูปไม่สำเร็จ กรุณาลองใหม่อีกครั้ง");
        }
      } catch (err: unknown) {
        const e = err instanceof Error ? err : new Error(String(err));
        r2cLog("unexpected", { status: "failed", name: e.name, message: e.message });
        console.error("[R2 CLIENT] unexpected:", e.name, e.message);
        toast.error(`${e.name}: ${e.message}`);
      } finally {
        setUploading(false);
        onUploadingChange?.(false);
        resetInput();
      }
    },
    [kind, onUploaded, onUploadingChange, resetInput, t, getUploadIntent, saveProfileImage, patchUserImage],
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
