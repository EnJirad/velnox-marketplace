/**
 * Chat timeline — the ONE day/grouping rule all three chat surfaces share.
 *
 * A Messenger-style thread is not a flat list of bubbles: it is a sequence of
 * DAYS, each holding runs of messages from the same sender. Both rules are
 * purely presentational, so they live here as pure functions instead of being
 * re-implemented (and drifting) inside VelShop, VelSeller and VelCenter.
 *
 * Nothing here touches the wire format or the server: timestamps arrive as
 * epoch milliseconds from `mapMessage` and are rendered in the viewer's locale.
 */

/** Anything with an id, a timestamp and a sender. */
export interface TimelineMessage {
  id: string;
  createdAt: number;
  senderId?: string | null;
  senderRole?: string | null;
  isSystem?: boolean;
}

/** One rendered row: either a date separator or a message. */
export type TimelineEntry<T extends { id: string }> =
  | { kind: "date"; key: string; at: number; label: string }
  | { kind: "message"; message: T; firstOfGroup: boolean; lastOfGroup: boolean };

/** Local calendar day key (`YYYY-MM-DD`) — the reader's timezone, not UTC. */
export function dayKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * "Today" / "Yesterday" / a locale date.
 *
 * `now` is injectable so the labels are testable without freezing time.
 */
export function dateSeparatorLabel(timestamp: number, now: number = Date.now(), locale = "th-TH"): string {
  const key = dayKey(timestamp);
  const today = dayKey(now);
  const rel = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (key === today) return rel.format(0, "day");
  const yesterday = dayKey(now - 24 * 60 * 60 * 1000);
  if (key === yesterday) return rel.format(-1, "day");
  const sameYear = new Date(timestamp).getFullYear() === new Date(now).getFullYear();
  return new Date(timestamp).toLocaleDateString(locale, {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}

/** Two messages belong to the same visual run when the same sender writes them
 *  inside this window. Kept small: a five-minute silence starts a new group,
 *  which is what Messenger does. */
export const GROUP_WINDOW_MS = 5 * 60 * 1000;

/** "Same person spoke" — system rows never group with anybody (they are notes). */
export function sameSender<T extends TimelineMessage>(a: T, b: T): boolean {
  if (a.isSystem || b.isSystem) return false;
  if (a.senderRole === "system" || b.senderRole === "system") return false;
  const aId = a.senderId ?? null;
  const bId = b.senderId ?? null;
  if (aId === null || bId === null) return false;
  return aId === bId;
}

/**
 * Turn a flat, chronologically ascending page into rows with separators and
 * group flags. O(n) and pure, so a 30-message page costs nothing per render
 * that a `useMemo` cannot absorb.
 */
export function buildTimeline<T extends TimelineMessage>(
  messages: T[],
  options: { now?: number; locale?: string } = {},
): TimelineEntry<T>[] {
  const now = options.now ?? Date.now();
  const locale = options.locale ?? "th-TH";
  const entries: TimelineEntry<T>[] = [];
  let lastDay: string | null = null;

  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]!;
    const key = dayKey(message.createdAt);
    if (key !== lastDay) {
      entries.push({ kind: "date", key, at: message.createdAt, label: dateSeparatorLabel(message.createdAt, now, locale) });
      lastDay = key;
    }
    const prev = messages[i - 1];
    const next = messages[i + 1];
    const firstOfGroup =
      !prev || dayKey(prev.createdAt) !== key || !sameSender(prev, message) ||
      message.createdAt - prev.createdAt > GROUP_WINDOW_MS;
    const lastOfGroup =
      !next || dayKey(next.createdAt) !== key || !sameSender(message, next) ||
      next.createdAt - message.createdAt > GROUP_WINDOW_MS;
    entries.push({ kind: "message", message, firstOfGroup, lastOfGroup });
  }
  return entries;
}

/** Bubble corner shape for a message inside a run (Messenger-style hugging). */
export function groupCorners(first: boolean, last: boolean, mine: boolean): string {
  if (mine) {
    const top = first ? "rounded-tr-2xl" : "rounded-tr-md";
    const bottom = last ? "rounded-br-md" : "rounded-br-md";
    return `${top} ${bottom}`;
  }
  const top = first ? "rounded-tl-2xl" : "rounded-tl-md";
  return `${top} rounded-bl-md`;
}
