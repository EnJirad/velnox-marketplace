/**
 * Reusable image upload component.
 * Uses backend presigned URLs to upload directly to Cloudflare R2.
 *
 * Props:
 *   - currentUrl: existing image URL (avatar or cover)
 *   - purpose: "avatar" | "cover"
 *   - onUpload: callback with the new image URL
 *   - label: accessible label text
 */
import { useState, useRef } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { apiBaseUrl as API_BASE } from "@velnox/shared/lib/sites";
import { compressImage } from "@velnox/shared/lib/image-optimize";

interface ImageUploadProps {
  currentUrl?: string | null;
  purpose: "avatar" | "cover";
  onUpload: (url: string) => void;
  label?: string;
  className?: string;
  /** Show a remove button instead of upload when no image is set */
  showRemove?: boolean;
  onRemove?: () => void;
}

export function ImageUpload({
  currentUrl,
  purpose,
  onUpload,
  label = "อัพโหลดรูปภาพ",
  className = "",
  showRemove = false,
  onRemove,
}: ImageUploadProps) {
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/avif"];
    if (!ALLOWED.includes(file.type)) {
      alert("ไฟล์ต้องเป็น JPEG, PNG, WebP หรือ AVIF เท่านั้น");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      alert("ไฟล์ต้องมีขนาดไม่เกิน 10 MB");
      return;
    }

    // Show local preview immediately
    const reader = new FileReader();
    reader.onload = (e) => setPreview(e.target?.result as string);
    reader.readAsDataURL(file);

    setUploading(true);
    try {
      // The R2 key is fixed (`profile/{kind}/{userId}.webp`), so the bytes must
      // really be WebP: convert before signing, and refuse when the browser
      // cannot encode instead of storing a JPEG under a `.webp` key.
      const uploadFile = await compressImage(file, purpose, {
        maxBytes: purpose === "avatar" ? 200_000 : 500_000,
        quality: purpose === "avatar" ? 0.85 : 0.80,
      });
      if (uploadFile.type !== "image/webp") {
        alert("ไม่สามารถแปลงรูปเป็น WebP ได้ กรุณาใช้ไฟล์ JPEG, PNG หรือ WebP");
        setPreview(null);
        return;
      }

      // 1. Get presigned URL — the server maps `purpose` to the canonical
      // `profile/{kind}/{userId}.webp` namespace it validates at confirm time.
      const presignRes = await fetch(`${API_BASE}/upload/presign`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: uploadFile.name, contentType: uploadFile.type, purpose }),
      });
      if (!presignRes.ok) throw new Error("Failed to get upload URL");
      const { data } = await presignRes.json();

      // 2. Upload directly to R2 — the declared type is the type of the bytes
      // the presigned PUT was signed for.
      const uploadRes = await fetch(data.uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": uploadFile.type },
        body: uploadFile,
      });
      if (!uploadRes.ok) throw new Error("Upload failed");

      // 3. Confirm upload on backend — no `purpose` in the body: the server
      // derives it from the object key it minted, so the client cannot steer
      // which reference (avatar / cover) gets written.
      const confirmRes = await fetch(`${API_BASE}/upload/confirm`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ objectKey: data.objectKey }),
      });
      if (!confirmRes.ok) throw new Error("Failed to save upload");
      const { data: saved } = await confirmRes.json();

      onUpload(saved?.url || data.publicUrl);
      setPreview(null);
    } catch (err) {
      console.error("[upload] failed:", err);
      alert("อัพโหลดรูปไม่สำเร็จ กรุณาลองใหม่");
      setPreview(null);
    } finally {
      setUploading(false);
    }
  };

  const displayUrl = preview || currentUrl;

  return (
    <div className={className}>
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) handleFile(file);
          e.target.value = "";
        }}
      />

      <button
        type="button"
        onClick={() => fileRef.current?.click()}
        disabled={uploading}
        className="group relative flex items-center justify-center overflow-hidden rounded-xl border-2 border-dashed border-slate-300 transition-colors hover:border-slate-400 disabled:opacity-50"
      >
        {uploading ? (
          <div className="flex flex-col items-center gap-2 p-4">
            <Loader2 className="size-6 animate-spin text-slate-400" />
            <span className="text-xs text-slate-400">กำลังอัพโหลด...</span>
          </div>
        ) : displayUrl ? (
          <>
            <img src={displayUrl} alt="" className="size-full object-cover" />
            <div className="absolute inset-0 flex items-center justify-center bg-black/40 opacity-0 transition-opacity group-hover:opacity-100">
              <Camera className="size-6 text-white" />
              <span className="ml-2 text-sm font-medium text-white">{label}</span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 p-6 text-slate-400">
            <Camera className="size-8" />
            <span className="text-xs">{label}</span>
          </div>
        )}
      </button>

      {showRemove && currentUrl && !uploading && (
        <button
          type="button"
          onClick={onRemove}
          className="mt-2 flex items-center gap-1 text-xs text-red-500 hover:text-red-700"
        >
          <X className="size-3" />
          ลบรูป
        </button>
      )}
    </div>
  );
}
