/**
 * Chat message ownership — the ONE rule all three apps share.
 *
 * Why this module exists: VelShop, VelSeller and VelCenter each rendered their
 * own ownership check, and they did not agree. The dangerous case is a message
 * with **no sender at all**: the automated Velnox Support acknowledgment is
 * stored with `sender_role = 'system'` and `sender_id = NULL`. VelCenter compared
 * against `user?.id ?? null`, so as soon as the viewer's id was not resolved yet
 * the comparison became `null === null` and the platform's own message was drawn
 * on the RIGHT — as if the company had sent it. The other two apps used `user?.id`
 * directly, so the same row was CENTRED instead of placed on the LEFT.
 *
 * The rule, in one sentence: a message is OURS only when it names us as its
 * sender. A system message never names anyone, so it is never ours, and it is
 * always an INCOMING message on the LEFT — for the customer, the seller and the
 * staff alike.
 *
 * Ownership is decided from the sender identity the SERVER stored on the row
 * (`sender_id` / `sender_role` / `system_kind`). Never from a display name, a
 * role alone, or the message body.
 */

/** The subset of the wire shape this module reasons about. */
export interface ChatMessageLike {
  id: string;
  conversationId: string;
  /** `NULL` for a system row; the sender's user id otherwise. */
  senderId?: string | null;
  senderRole?: string | null;
  /** Set by `mapMessage` on the server: `sender_role === "system"`. */
  isSystem?: boolean;
  systemKind?: string | null;
  createdAt?: number;
  readAt?: number | null;
}

/**
 * True when the platform itself wrote the row.
 *
 * Three independent signals, any one of which is enough, because a client must
 * not mis-classify an automated message if one field is missing (an older cached
 * payload, a replayed optimistic object, a future producer that only sets the
 * role):
 *   • `isSystem`   — the server's explicit flag;
 *   • `senderRole` — the stored column ('system');
 *   • `senderId`   — absent/null: nothing and nobody sent it.
 *
 * A row with a NULL sender can never be attributed to the viewer, so treating it
 * as "system" is the only safe reading.
 */
export function isSystemMessage(message: ChatMessageLike | null | undefined): boolean {
  if (!message) return false;
  if (message.isSystem === true) return true;
  if (message.senderRole === "system") return true;
  return message.senderId == null;
}

/**
 * True only when THIS VIEWER sent the message.
 *
 * An unresolved viewer (`null`/`undefined`/empty) owns nothing — that is the
 * whole point of the helper: `null === null` must never mean "mine".
 */
export function isOwnMessage(
  message: ChatMessageLike | null | undefined,
  selfUserId: string | null | undefined,
): boolean {
  if (!message) return false;
  if (!selfUserId) return false;
  if (typeof message.senderId !== "string" || message.senderId.length === 0) return false;
  if (isSystemMessage(message)) return false;
  return message.senderId === selfUserId;
}

/** Which side of the thread the bubble belongs on. */
export type MessageSide = "right" | "left";

/** Messenger rule: ours right, everyone else (and the system) left. */
export function messageSide(
  message: ChatMessageLike | null | undefined,
  selfUserId: string | null | undefined,
): MessageSide {
  return isOwnMessage(message, selfUserId) ? "right" : "left";
}

/**
 * Is this event about the conversation currently open?
 *
 * Guards the "message for another conversation must not be rendered in the
 * active one" requirement in ONE place, so a page can never drift.
 */
export function belongsToConversation(
  message: ChatMessageLike | null | undefined,
  activeConversationId: string | null | undefined,
): boolean {
  if (!message || !activeConversationId) return false;
  return message.conversationId === activeConversationId;
}

/**
 * Append an incoming message, ignoring one we already hold.
 *
 * Dedupe is by message id, which is why the optimistic row uses a `temp-` id and
 * is replaced by the authoritative row from the API response: the same message
 * arriving twice (API reply + WebSocket broadcast, or a retry) must render once.
 */
export function mergeIncomingMessage<T extends { id: string }>(
  list: T[],
  incoming: T | null | undefined,
): T[] {
  if (!incoming || !incoming.id) return list;
  if (list.some((existing) => existing.id === incoming.id)) return list;
  return [...list, incoming];
}

/**
 * Mark the reader's own messages as read up to a bound, without touching
 * anybody else's and without touching system rows (nobody has to read those).
 * Returns the SAME array when nothing changed, so React can skip a re-render.
 */
export function applyReadReceipt<T extends ChatMessageLike>(
  list: T[],
  selfUserId: string | null | undefined,
  upTo: number | null,
): T[] {
  let changed = false;
  const next = list.map((message) => {
    if (!isOwnMessage(message, selfUserId)) return message;
    if (message.readAt != null) return message;
    if (upTo !== null && typeof message.createdAt === "number" && message.createdAt > upTo) {
      return message;
    }
    changed = true;
    return { ...message, readAt: Date.now() } as T;
  });
  return changed ? next : list;
}
