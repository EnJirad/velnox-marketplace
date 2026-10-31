/**
 * Chat image UI — the shared renderer + composer preview used by VelShop,
 * VelSeller and VelCenter. One implementation, three surfaces.
 *
 * `ChatImageMessage` renders an image bubble that opens a full-screen viewer.
 * The viewer is a plain fixed overlay (no library): close button, Escape, and a
 * backdrop click all dismiss it, and it never traps scroll on mobile.
 *
 * `ComposerImagePreview` is the pre-send state: thumbnail, progress, an error
 * line with retry, and a remove button.
 */
import { X } from "lucide-react";
import { useEffect, useState } from "react";

export function ChatImageMessage({
  url,
  alt,
  label,
}: {
  url: string;
  alt?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="block overflow-hidden rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500"
        aria-label={label ?? "Open image"}
      >
        <img
          src={url}
          alt={alt ?? ""}
          loading="lazy"
          decoding="async"
          className="max-h-64 w-full max-w-[220px] object-cover"
        />
      </button>
      {open && <ChatImageViewer url={url} alt={alt} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ChatImageViewer({
  url,
  alt,
  onClose,
}: {
  url: string;
  alt?: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={alt ?? "Image"}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/90 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 flex size-10 items-center justify-center rounded-full bg-white/10 text-white hover:bg-white/20"
        aria-label="Close image"
      >
        <X className="size-5" />
      </button>
      <img
        src={url}
        alt={alt ?? ""}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[85vh] max-w-full rounded-lg object-contain"
      />
    </div>
  );
}

export function ComposerImagePreview({
  previewUrl,
  progress,
  error,
  onRemove,
  onRetry,
  sendLabel = "Retry",
}: {
  previewUrl: string;
  progress: number | null;
  error?: string | null;
  onRemove: () => void;
  onRetry?: () => void;
  sendLabel?: string;
}) {
  return (
    <div className="mb-2 flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2">
      <img src={previewUrl} alt="" className="size-14 rounded-lg object-cover" />
      <div className="min-w-0 flex-1">
        {error ? (
          <p className="truncate text-xs text-red-600">{error}</p>
        ) : progress !== null && progress < 100 ? (
          <div className="space-y-1">
            <p className="text-[11px] text-slate-500">Uploading… {progress}%</p>
            <div className="h-1 w-full overflow-hidden rounded-full bg-slate-100">
              <div className="h-full rounded-full bg-[#10B981] transition-all" style={{ width: `${progress}%` }} />
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-slate-500">Ready to send</p>
        )}
        {error && onRetry && (
          <button type="button" onClick={onRetry} className="mt-1 text-xs font-medium text-[#10B981] hover:underline">
            {sendLabel}
          </button>
        )}
      </div>
      <button
        type="button"
        onClick={onRemove}
        className="flex size-8 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        aria-label="Remove image"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}
