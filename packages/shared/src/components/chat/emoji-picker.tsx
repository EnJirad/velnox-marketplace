/**
 * Emoji picker — small, dependency-free popover shared by every composer.
 *
 * Why in-house: the chat needs a picker, not a 60 kB emoji database. This is a
 * curated set of the emoji people actually send in a marketplace thread, drawn
 * from the platform's own glyph set (the system font), so there is nothing to
 * download and nothing to keep in sync.
 *
 * Behaviour: opens above the trigger, closes on Escape, on an outside click and
 * after a pick; every cell is a 40 px+ target with an accessible label; the
 * panel is width-capped so a 320 px phone cannot overflow horizontally.
 */
import { useEffect, useRef } from "react";
import { cn } from "@velnox/shared/lib/utils";

const GROUPS: Array<{ label: string; emoji: string[] }> = [
  {
    label: "Smileys",
    emoji: [
      "😀", "😃", "😄", "😁", "😆", "😅", "🙂", "😊", "😇", "🙃",
      "😉", "😍", "🥰", "😘", "😋", "😜", "🤗", "🤔", "🤨", "😐",
      "😴", "😪", "😢", "😭", "😤", "😡", "🥺", "😳", "🤯", "😎",
    ],
  },
  {
    label: "Gestures",
    emoji: [
      "👍", "👎", "👌", "✌️", "🤞", "🙏", "👏", "🙌", "💪", "🤝",
      "👋", "🫶", "☝️", "👇", "👈", "👉",
    ],
  },
  {
    label: "Hearts",
    emoji: ["❤️", "🧡", "💛", "💚", "💙", "💜", "🤍", "🖤", "💔", "💖", "💝", "💯"],
  },
  {
    label: "Objects",
    emoji: [
      "📦", "🚚", "🛍️", "🛒", "💰", "💳", "🎁", "⭐", "✨", "🔥",
      "✅", "❌", "⏰", "📷", "📌", "🔔", "🏷️", "📝",
    ],
  },
];

export function EmojiPicker({
  onPick,
  onClose,
  label = "Emoji",
}: {
  onPick: (emoji: string) => void;
  onClose: () => void;
  label?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    panelRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      {/* Backdrop: a click anywhere else dismisses, without stealing scroll. */}
      <div
        className="fixed inset-0 z-20"
        aria-hidden="true"
        onMouseDown={onClose}
        onTouchStart={onClose}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-label={label}
        tabIndex={-1}
        className="absolute bottom-full right-0 z-30 mb-2 w-[min(19rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-2 shadow-xl outline-none"
      >
        <div className="max-h-64 overflow-y-auto overscroll-contain">
          {GROUPS.map((group) => (
            <div key={group.label} className="mb-1">
              <p className="px-1 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {group.label}
              </p>
              <div className="grid grid-cols-8 gap-0.5">
                {group.emoji.map((emoji) => (
                  <button
                    key={`${group.label}-${emoji}`}
                    type="button"
                    onClick={() => {
                      onPick(emoji);
                      onClose();
                    }}
                    aria-label={emoji}
                    className={cn(
                      "flex size-10 items-center justify-center rounded-lg text-xl leading-none",
                      "hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500",
                    )}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
