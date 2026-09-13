import { api } from "@velnox/shared/lib/api-routes";
import { useAction } from "@velnox/shared/lib/api-routes";
import { Button } from "@velnox/shared/components/ui/button";
import { Badge } from "@velnox/shared/components/ui/badge";
import {
  FileImage,
  FileText,
  Loader2,
  Upload,
  X,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { useRef, useState, useCallback, useEffect, useMemo } from "react";
import { toast } from "sonner";

const MAX_FILES = 20;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/avif",
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
];

const ACCEPT = ALLOWED_TYPES.join(",");

export interface EvidenceFile {
  id: string;
  file: File;
  purpose: string;
  status: "pending" | "uploading" | "uploaded" | "error";
  objectKey?: string;
  cdnUrl?: string;
  previewUrl?: string; // local object URL for instant preview
  progress?: number;
  error?: string;
}

interface EvidenceUploaderProps {
  purpose: string;
  label?: string;
  description?: string;
  files: EvidenceFile[];
  onFilesChange: (files: EvidenceFile[]) => void;
  maxFiles?: number;
}

export function EvidenceUploader({
  purpose,
  label,
  description,
  files,
  onFilesChange,
  maxFiles = MAX_FILES,
}: EvidenceUploaderProps) {
  const getUploadIntent = useAction(api.seller.evidenceUploadIntent);
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Ref to always access the latest files array, avoiding stale closures
  // in uploadFile callbacks that run after state updates
  const filesRef = useRef(files);
  filesRef.current = files;

  const generateId = () => `ev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  const isImage = (type: string) => type.startsWith("image/");

  // Cleanup preview URLs when files are removed
  useEffect(() => {
    return () => {
      // Cleanup all preview URLs on unmount
      for (const f of files) {
        if (f.previewUrl && f.previewUrl.startsWith("blob:")) {
          URL.revokeObjectURL(f.previewUrl);
        }
      }
    };
  }, []); // Only on unmount

  const uploadFile = useCallback(
    async (evidenceFile: EvidenceFile) => {
      const { file } = evidenceFile;
      if (!ALLOWED_TYPES.includes(file.type)) {
        toast.error(`ไฟล์ ${file.name} ไม่ใช่ประเภทที่รองรับ`);
        return;
      }
      if (file.size > MAX_FILE_SIZE) {
        toast.error(`ไฟล์ ${file.name} ใหญ่เกิน 10 MB`);
        return;
      }

      // Use ref to get latest files — avoids stale closure when called
      // right after handleFiles updates state via onFilesChange
      const currentFiles = filesRef.current;

      // Update status to uploading using the LATEST files array
      const updatedFiles = currentFiles.map((f) =>
        f.id === evidenceFile.id ? { ...f, status: "uploading" as const } : f
      );
      onFilesChange(updatedFiles);

      try {
        // 1. Get presigned R2 URL
        const intent = await getUploadIntent({
          filename: file.name,
          mimeType: file.type,
          purpose,
        });

        // 2. Upload to R2
        const uploadRes = await fetch(intent.uploadUrl, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });

        if (!uploadRes.ok) {
          throw new Error(`R2 upload failed: ${uploadRes.status}`);
        }

        // 3. Mark as uploaded — use LATEST files from ref
        const latestFiles = filesRef.current;
        const finalFiles = latestFiles.map((f) =>
          f.id === evidenceFile.id
            ? {
                ...f,
                status: "uploaded" as const,
                objectKey: intent.objectKey,
                cdnUrl: intent.cdnUrl,
                // Keep previewUrl for local display, prefer cdnUrl for uploaded state
              }
            : f
        );
        onFilesChange(finalFiles);
      } catch (err) {
        console.error("Evidence upload error:", err);
        const latestFiles = filesRef.current;
        const errorFiles = latestFiles.map((f) =>
          f.id === evidenceFile.id
            ? {
                ...f,
                status: "error" as const,
                error: err instanceof Error ? err.message : "Upload failed",
              }
            : f
        );
        onFilesChange(errorFiles);
        toast.error(`อัปโหลด "${file.name}" ไม่สำเร็จ`);
      }
    },
    [onFilesChange, getUploadIntent, purpose]
  );

  const handleFiles = useCallback(
    async (fileList: FileList | File[]) => {
      const latestFiles = filesRef.current;
      const newFiles = Array.from(fileList).slice(0, maxFiles - latestFiles.length);
      if (newFiles.length === 0) {
        toast.error(`รองรับสูงสุด ${maxFiles} ไฟล์`);
        return;
      }

      // Create evidence files with local preview URLs immediately
      const evidenceFiles: EvidenceFile[] = newFiles.map((file) => ({
        id: generateId(),
        file,
        purpose,
        status: "pending" as const,
        // Create local object URL for instant preview
        previewUrl: isImage(file.type) ? URL.createObjectURL(file) : undefined,
      }));

      // Add new files to state — uploadFile will use filesRef.current
      // which will be updated by the next render cycle
      const allFiles = [...latestFiles, ...evidenceFiles];
      onFilesChange(allFiles);

      // Upload each file — uploadFile reads filesRef.current for latest state
      setUploading(true);
      for (const ef of evidenceFiles) {
        await uploadFile(ef);
      }
      setUploading(false);
    },
    [onFilesChange, maxFiles, purpose, uploadFile]
  );

  const handleRemove = (id: string) => {
    const latestFiles = filesRef.current;
    const fileToRemove = latestFiles.find((f) => f.id === id);
    // Revoke object URL to prevent memory leak
    if (fileToRemove?.previewUrl && fileToRemove.previewUrl.startsWith("blob:")) {
      URL.revokeObjectURL(fileToRemove.previewUrl);
    }
    onFilesChange(latestFiles.filter((f) => f.id !== id));
  };

  const handleRetry = async (ef: EvidenceFile) => {
    const latestFiles = filesRef.current;
    const retryFiles = latestFiles.map((f) =>
      f.id === ef.id ? { ...f, status: "pending" as const, error: undefined } : f
    );
    onFilesChange(retryFiles);
    setUploading(true);
    await uploadFile({ ...ef, status: "pending" });
    setUploading(false);
  };

  const uploadedCount = files.filter((f) => f.status === "uploaded").length;
  const errorCount = files.filter((f) => f.status === "error").length;
  const hasUploading = files.some((f) => f.status === "uploading" || f.status === "pending");

  // Get the best preview URL for a file: prefer cdnUrl when uploaded, else previewUrl
  const getPreviewUrl = (ef: EvidenceFile): string | undefined => {
    if (ef.status === "uploaded" && ef.cdnUrl) return ef.cdnUrl;
    if (ef.previewUrl) return ef.previewUrl;
    return undefined;
  };

  return (
    <div className="grid gap-2">
      {label && (
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-slate-700">{label}</span>
          {uploadedCount > 0 && (
            <Badge className="gap-1 rounded-full bg-emerald-50 text-emerald-600 ring-1 ring-inset ring-emerald-500/20 text-[10px]">
              <CheckCircle2 className="size-2.5" />
              {uploadedCount}
            </Badge>
          )}
          {errorCount > 0 && (
            <Badge className="gap-1 rounded-full bg-red-50 text-red-600 ring-1 ring-inset ring-red-500/20 text-[10px]">
              <AlertCircle className="size-2.5" />
              {errorCount}
            </Badge>
          )}
        </div>
      )}
      {description && (
        <p className="text-xs text-slate-400">{description}</p>
      )}

      {/* Uploaded files list */}
      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((ef) => {
            const previewUrl = getPreviewUrl(ef);
            return (
              <div
                key={ef.id}
                className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white p-2.5 transition-colors"
              >
                {/* File icon / thumbnail with preview */}
                <div className="size-10 shrink-0 overflow-hidden rounded-lg bg-slate-100">
                  {isImage(ef.file.type) && previewUrl ? (
                    <img
                      src={previewUrl}
                      alt={ef.file.name}
                      className="size-full object-cover"
                      onError={(e) => {
                        // If CDN URL fails, try local preview
                        if (ef.cdnUrl && ef.previewUrl && (e.target as HTMLImageElement).src !== ef.previewUrl) {
                          (e.target as HTMLImageElement).src = ef.previewUrl;
                        }
                      }}
                    />
                  ) : isImage(ef.file.type) ? (
                    <div className="flex size-full items-center justify-center">
                      <FileImage className="size-4 text-slate-400" />
                    </div>
                  ) : (
                    <div className="flex size-full items-center justify-center">
                      <FileText className="size-4 text-slate-400" />
                    </div>
                  )}
                </div>

                {/* File info */}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-medium text-slate-700">
                    {ef.file.name}
                  </p>
                  <p className="text-[10px] text-slate-400">
                    {(ef.file.size / 1024 / 1024).toFixed(1)} MB
                    {ef.status === "uploading" && " · กำลังอัปโหลด..."}
                    {ef.status === "uploaded" && " · อัปโหลดสำเร็จ"}
                    {ef.status === "error" && ef.error && ` · ${ef.error}`}
                  </p>
                </div>

                {/* Status / Actions */}
                <div className="flex shrink-0 items-center gap-1">
                  {ef.status === "uploading" && (
                    <Loader2 className="size-4 animate-spin text-[#10B981]" />
                  )}
                  {ef.status === "uploaded" && (
                    <CheckCircle2 className="size-4 text-[#10B981]" />
                  )}
                  {ef.status === "error" && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-6 px-2 text-[10px] text-[#10B981]"
                      onClick={() => void handleRetry(ef)}
                    >
                      ลองอีกครั้ง
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-6 text-slate-400 hover:text-red-500"
                    onClick={() => handleRemove(ef.id)}
                  >
                    <X className="size-3" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Upload zone */}
      {files.length < maxFiles && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            if (e.dataTransfer.files.length > 0) void handleFiles(e.dataTransfer.files);
          }}
          disabled={uploading}
          className="flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed border-slate-200 bg-slate-50/50 px-3 py-4 text-center transition-colors hover:border-[#10B981]/50 hover:bg-[#ECFDF5]/30 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {uploading ? (
            <>
              <Loader2 className="size-4 animate-spin text-[#10B981]" />
              <p className="text-xs text-slate-500">กำลังอัปโหลด...</p>
            </>
          ) : (
            <>
              <Upload className="size-4 text-slate-400" />
              <p className="text-xs font-medium text-slate-600">
                คลิกหรือลากไฟล์มาวาง
              </p>
              <p className="text-[10px] text-slate-400">
                JPG · PNG · WebP · PDF (สูงสุด 10 MB/ไฟล์ · {files.length}/{maxFiles})
              </p>
            </>
          )}
        </button>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        className="hidden"
        onChange={(e) => e.target.files && void handleFiles(e.target.files)}
      />
    </div>
  );
}
