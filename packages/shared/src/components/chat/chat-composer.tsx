/**
 * Chat composer — the ONE message bar for VelShop, VelSeller and VelCenter.
 *
 * It owns presentation + keyboard/interaction only: the page still owns the
 * draft, the upload, the idempotent send and the retry, so no surface can drift
 * from the existing REST contract.
 *
 * Behaviour kept identical on every surface:
 *   • Enter sends, Shift+Enter starts a new line (desktop convention); the
 *     textarea grows up to ~5 lines instead of scrolling a single line.
 *   • Send is disabled while a send is in flight — the page also guards, this is
 *     the visible half of "no double tap creates two rows".
 *   • An image can be attached with `+`, previewed, removed before sending, and
 *     retried after a failure; an image-only message is allowed when the backend
 *     accepts it (the page decides, the composer only disables on empty draft
 *     AND no image).
 *   • The emoji panel is local (no dependency), inserts at the caret and closes
 *     on Escape / outside click.
 *   • Buttons are ≥44 px targets and the bar sits above the mobile safe area.
 */
import { Loader2, Plus, Send, Smile } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@velnox/shared/lib/utils";
import { ComposerImagePreview } from "./chat-image";
import { EmojiPicker } from "./emoji-picker";

/** Must stay a subset of `CHAT_IMAGE_TYPES` — the server re-validates anyway. */
const ACCEPT = "image/jpeg,image/png,image/webp,image/avif";

export interface ChatPendingImage {
  /** Local object URL of the file the user picked. */
  previewUrl: string;
  /** 0-100 while uploading, `null` before/after the transfer is known. */
  progress: number | null;
  error?: string | null;
}

export interface ChatComposerProps {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  sending?: boolean;
  disabled?: boolean;
  placeholder: string;
  sendLabel: string;
  attachLabel: string;
  emojiLabel?: string;
  inputLabel?: string;
  retryLabel?: string;
  /** Set when the last send failed; renders an inline retry affordance. */
  error?: string | null;
  onRetry?: () => void;
  pendingImage?: ChatPendingImage | null;
  onPickImage?: (file: File) => void;
  onRemoveImage?: () => void;
  onRetryImage?: () => void;
  onTyping?: () => void;
  onStopTyping?: () => void;
  /** e.g. the typing indicator, rendered between the timeline and the bar. */
  footer?: ReactNode;
  maxLength?: number;
}

export function ChatComposer({
  value,
  onChange,
  onSend,
  sending = false,
  disabled = false,
  placeholder,
  sendLabel,
  attachLabel,
  emojiLabel = "Emoji",
  inputLabel,
  retryLabel = "Retry",
  error,
  onRetry,
  pendingImage,
  onPickImage,
  onRemoveImage,
  onRetryImage,
  onTyping,
  onStopTyping,
  footer,
  maxLength = 4000,
}: ChatComposerProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [emojiOpen, setEmojiOpen] = useState(false);

  // Grow with the text, then stop at ~5 lines and scroll inside the field.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
  }, [value]);

  const canSend = !disabled && !sending && (value.trim().length > 0 || !!pendingImage);
  const uploading = pendingImage?.progress !== null && pendingImage?.progress !== undefined && pendingImage.progress < 100;

  function insertEmoji(emoji: string) {
    const el = inputRef.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = `${value.slice(0, start)}${emoji}${value.slice(end)}`;
    if (next.length > maxLength) return;
    onChange(next);
    onTyping?.();
    requestAnimationFrame(() => {
      const node = inputRef.current;
      if (!node) return;
      node.focus();
      const caret = start + emoji.length;
      node.setSelectionRange(caret, caret);
    });
  }

  return (
    <div className="border-t border-slate-100 bg-white pb-[env(safe-area-inset-bottom)]">
      {footer}
      <div className="px-3 pt-2 empty:hidden sm:px-4">
        {pendingImage && (
          <ComposerImagePreview
            previewUrl={pendingImage.previewUrl}
            progress={pendingImage.progress}
            error={pendingImage.error ?? null}
            onRemove={onRemoveImage ?? (() => {})}
            onRetry={onRetryImage}
            sendLabel={retryLabel}
          />
        )}
        {error && (
          <div
            role="alert"
            className="mb-2 flex items-center justify-between gap-3 rounded-xl bg-red-50 px-3 py-2 text-xs text-red-700"
          >
            <span className="min-w-0 truncate">{error}</span>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="shrink-0 rounded-lg px-2 py-1 font-semibold underline-offset-2 hover:underline"
              >
                {retryLabel}
              </button>
            )}
          </div>
        )}
      </div>

      <form
        className="flex items-end gap-1 px-2 py-2 sm:gap-2 sm:px-3 sm:py-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSend) onSend();
        }}
      >
        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset first: picking the same file twice must still fire onChange.
            event.target.value = "";
            if (file) onPickImage?.(file);
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={disabled || sending || uploading}
          aria-label={attachLabel}
          title={attachLabel}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
        >
          <Plus className="size-5" />
        </button>

        <div className="min-w-0 flex-1">
          <textarea
            ref={inputRef}
            value={value}
            rows={1}
            maxLength={maxLength}
            disabled={disabled}
            aria-label={inputLabel ?? placeholder}
            placeholder={placeholder}
            onChange={(event) => {
              onChange(event.target.value);
              if (event.target.value.trim().length > 0) onTyping?.();
              else onStopTyping?.();
            }}
            onBlur={() => onStopTyping?.()}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (canSend) onSend();
              }
            }}
            className={cn(
              "block w-full resize-none rounded-3xl border border-transparent bg-slate-100 px-4 py-3 text-sm leading-5 text-slate-900",
              "outline-none transition-colors placeholder:text-slate-400",
              "focus:border-emerald-500/40 focus:bg-white focus:ring-2 focus:ring-emerald-500/20",
              "disabled:opacity-60",
            )}
          />
        </div>

        <div className="relative shrink-0">
          <button
            type="button"
            onClick={() => setEmojiOpen((open) => !open)}
            disabled={disabled}
            aria-label={emojiLabel}
            aria-expanded={emojiOpen}
            title={emojiLabel}
            className="flex size-11 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 disabled:opacity-40"
          >
            <Smile className="size-5" />
          </button>
          {emojiOpen && (
            <EmojiPicker
              label={emojiLabel}
              onPick={insertEmoji}
              onClose={() => setEmojiOpen(false)}
            />
          )}
        </div>

        <button
          type="button"
          onClick={() => {
            if (canSend) onSend();
          }}
          disabled={!canSend}
          aria-label={sendLabel}
          title={sendLabel}
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-[#10B981] transition-colors hover:bg-emerald-50 disabled:text-slate-300 disabled:hover:bg-transparent"
        >
          {sending ? <Loader2 className="size-5 animate-spin text-slate-400" /> : <Send className="size-5" />}
        </button>
      </form>
    </div>
  );
}
