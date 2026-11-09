/**
 * The ONE message renderer for every chat surface.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * VelShop, VelSeller and VelCenter each rendered their own bubble markup, so the
 * three conversations looked like three different products and every behaviour
 * (day separators, grouping, ticks, system notes, image messages) was
 * implemented — and could be broken — three times. `lib/chat-timeline.ts`
 * already owns the *rules* (which day a message belongs to, which messages form
 * one sender run); this file owns the *appearance* of those rows.
 *
 * DESIGN (2026-11-09 redesign)
 * ---------------------------
 *  • Quiet by default: one solid brand bubble for "mine", one white bubble for
 *    "theirs", no drop shadows on messages. Depth is reserved for floating UI.
 *  • Grouping is visible: messages from the same sender inside the 5-minute
 *    window sit tight together (0.5 gap) and only the LAST one carries the tail,
 *    so a burst reads as one thought instead of five separate cards.
 *  • Time is inside the bubble, once per run, small and low-contrast; a full
 *    timestamp belongs in the header/day pill, not repeated on every line.
 *  • System notes are not bubbles: the platform speaking is a quiet centred line,
 *    which stops it competing with real conversation.
 *  • Read state is a tick, never a colour change on the whole bubble.
 *
 * Presentation only: no fetching, no sockets, no scroll position. The page keeps
 * its own data source and (optionally) its own scroll container.
 */
import { Check, CheckCheck, Sparkles } from "lucide-react";
import { cn } from "@velnox/shared/lib/utils";
import { buildTimeline, type TimelineMessage } from "@velnox/shared/lib/chat-timeline";
import { isOwnMessage, isSystemMessage } from "@velnox/shared/lib/chat-message";
import { ChatImageMessage } from "./chat-image";

/** The shape every chat page already maps its rows into. */
export interface ConversationMessage extends TimelineMessage {
  /** Every rendered row belongs to the open thread; `buildTimeline` needs it. */
  conversationId: string;
  body: string;
  readAt?: number | null;
  attachmentUrl?: string | null;
  systemKind?: string | null;
}

export interface ChatConversationLabels {
  /** Localised time, e.g. "14:32". */
  formatTime: (ms: number) => string;
  imageAlt: string;
  viewImage: string;
  systemMessage: string;
  /** "Delivered" / "Read" — used as the tick's accessible name. */
  deliveredLabel?: string;
  readLabel?: string;
}

// The ownership rule is NOT re-implemented here: `lib/chat-message.ts` owns it so
// a message with a NULL sender can never be attributed to the viewer.
const isSystemRow = (m: ConversationMessage) => isSystemMessage(m);
const isOwnRow = (m: ConversationMessage, meId: string | null | undefined) =>
  isOwnMessage(m, meId);

/** One sender run's bubble. Exported for tests and for surfaces with bespoke rows. */
export function ChatBubble({
  message,
  mine,
  lastOfGroup,
  labels,
}: {
  message: ConversationMessage;
  mine: boolean;
  lastOfGroup: boolean;
  labels: ChatConversationLabels;
}) {
  const read = message.readAt != null;
  return (
    <div className={cn("flex w-full", mine ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "min-w-0 max-w-[80%] px-3 py-2 text-[14px] leading-6 sm:max-w-[68%]",
          "rounded-2xl",
          // Soft brand tint, not a saturated brand block: 4 messages of solid
          // emerald-600 is a wall of green. Dark text on a pale emerald surface
          // keeps contrast high while staying calm.
          mine
            ? "border border-emerald-200/70 bg-emerald-50 text-slate-900"
            : "border border-slate-200/80 bg-white text-slate-800",
          // Only the last bubble of a run gets the "tail" corner, which is what
          // makes a burst read as one message.
          lastOfGroup && (mine ? "rounded-br-md" : "rounded-bl-md"),
        )}
      >
        {message.attachmentUrl && (
          <div className={cn(message.body ? "mb-1.5" : "")}>
            <ChatImageMessage
              url={message.attachmentUrl}
              alt={labels.imageAlt}
              label={labels.viewImage}
            />
          </div>
        )}
        {message.body && (
          <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.body}</p>
        )}
        <div
          className={cn(
            "mt-0.5 flex items-center justify-end gap-1 text-[11px] tabular-nums",
            mine ? "text-emerald-800/60" : "text-slate-400",
          )}
        >
          <span>{labels.formatTime(message.createdAt)}</span>
          {mine && (
            <span
              aria-label={read ? labels.readLabel : labels.deliveredLabel}
              className="flex items-center"
            >
              {read ? (
                <CheckCheck className="size-3.5" aria-hidden="true" />
              ) : (
                <Check className="size-3.5" aria-hidden="true" />
              )}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

/** A day boundary: a quiet centred pill, never a full-width rule. */
export function ChatDaySeparator({ label }: { label: string }) {
  return (
    <div className="flex justify-center py-2.5">
      <span className="rounded-full border border-slate-200/80 bg-white px-2.5 py-1 text-[11px] font-medium text-slate-500">
        {label}
      </span>
    </div>
  );
}

/** The platform speaking — centred, muted, and obviously not a person. */
export function ChatSystemNote({
  body,
  time,
  label,
}: {
  body: string;
  time: string;
  label: string;
}) {
  return (
    <div role="note" aria-label={label} className="flex justify-center py-1.5">
      <p className="flex max-w-[85%] items-start gap-1.5 text-center text-[12px] leading-5 text-slate-500">
        <Sparkles className="mt-0.5 size-3.5 shrink-0 text-emerald-500" aria-hidden="true" />
        <span className="min-w-0">
          <span className="whitespace-pre-wrap break-words">{body}</span>
          <span className="ml-1 whitespace-nowrap text-[11px] text-slate-400">{time}</span>
        </span>
      </p>
    </div>
  );
}

/**
 * The whole thread body: day separators, sender runs, images, ticks, system
 * notes. Renders nothing else — the page owns the scroll box, so this stays a
 * pure function of (messages, meId, now).
 */
export function ChatConversation({
  messages,
  meId,
  labels,
  locale = "th-TH",
  emptyTitle,
  emptyDesc,
  className,
}: {
  messages: ConversationMessage[];
  meId: string | null | undefined;
  labels: ChatConversationLabels;
  locale?: string;
  emptyTitle?: string;
  emptyDesc?: string;
  className?: string;
}) {
  if (messages.length === 0) {
    return (
      <div className={cn("py-12 text-center", className)}>
        <p className="text-sm font-medium text-slate-600">{emptyTitle}</p>
        {emptyDesc && <p className="mt-1 text-xs text-slate-400">{emptyDesc}</p>}
      </div>
    );
  }

  const rows = buildTimeline(messages, { locale });

  return (
    <div className={cn("flex flex-col", className)}>
      {rows.map((row) => {
        if (row.kind === "date") {
          return <ChatDaySeparator key={`day-${row.key}`} label={row.label} />;
        }
        const m = row.message as ConversationMessage;
        if (isSystemRow(m)) {
          return (
            <ChatSystemNote
              key={m.id}
              body={m.body}
              time={labels.formatTime(m.createdAt)}
              label={labels.systemMessage}
            />
          );
        }
        return (
          <div key={m.id} className={cn(row.firstOfGroup ? "mt-2.5" : "mt-0.5", "first:mt-0")}>
            <ChatBubble
              message={m}
              mine={isOwnRow(m, meId)}
              lastOfGroup={row.lastOfGroup}
              labels={labels}
            />
          </div>
        );
      })}
    </div>
  );
}
