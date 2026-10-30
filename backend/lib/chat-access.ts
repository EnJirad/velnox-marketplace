/**
 * Chat conversation audience — the ONE place that answers "who is in this
 * conversation?", for the frames that are EPHEMERAL and therefore never pass
 * through a route handler (`chat:typing`, and the `chat:viewing` presence nudge).
 *
 * Why it exists: messages and read receipts are authorized inside the HTTPS
 * handlers, where the participant shape is already in the SQL (`WHERE
 * c.customer_id = $2`). The WebSocket has no such query — a client frame carries
 * only a conversation id — so typing must resolve membership from the DATABASE
 * before it forwards anything. This module is that lookup; it deliberately knows
 * nothing about who is typing, so it cannot be talked into trusting client input.
 *
 * It reads the SAME `conversations` row the chat core reads and adds no table,
 * column or cache of its own (the caller may memoize the result per socket; that
 * memo is an optimization, never a source of truth).
 */
import { query } from "../db/index.js";
import { CENTER_ROLES } from "./permissions.js";

/**
 * The reserved shop slug an older database still uses for Velnox support
 * threads (see `routes/chat.ts`). Such a row is type CUSTOMER_SELLER but is
 * treated as company support everywhere in the product, so its audience must
 * include company sessions too.
 */
export const SUPPORT_SHOP_SLUG = "velnox-support";

export type ChatConversationType =
  | "CUSTOMER_SELLER"
  | "CUSTOMER_COMPANY"
  | "SELLER_COMPANY"
  | "COMPANY_INTERNAL";

export interface ChatAudience {
  conversationId: string;
  /** The stored type; an unexpected value still resolves to its members. */
  type: string;
  customerUserId: string | null;
  sellerUserId: string | null;
  /** Company support thread, including the legacy reserved-shop shape. */
  supportThread: boolean;
  /** Direct participants: the customer and/or the seller. Company staff are a
   *  ROLE audience and are never listed here. */
  memberUserIds: string[];
  /** Company sessions (owner/admin/staff, resolved from `users.role`) are part
   *  of this audience. True for both company thread kinds and internal rooms. */
  companyAudience: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Cheap shape check so a garbage frame never reaches the database. */
export function isConversationId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

/** Whether a `users.role` value belongs to the company (VelCenter) audience. */
export function isCompanyRole(role: string | null | undefined): boolean {
  return !!role && (CENTER_ROLES as readonly string[]).includes(role);
}

/**
 * Resolve the conversation's audience, or null when the id does not exist.
 * Never throws for a malformed id — the caller is a socket frame, and a bad
 * frame must not take the connection down.
 */
export async function loadChatAudience(conversationId: string): Promise<ChatAudience | null> {
  if (!isConversationId(conversationId)) return null;

  const res = await query(
    `SELECT c.id, c.type, c.customer_id, sl.user_id AS seller_user_id, sh.slug AS shop_slug
       FROM conversations c
       LEFT JOIN sellers sl ON sl.id = c.seller_id
       LEFT JOIN shops sh ON sh.id = c.shop_id
      WHERE c.id = $1`,
    [conversationId],
  );
  const row = res.rows[0];
  if (!row) return null;

  const type = String(row.type ?? "CUSTOMER_SELLER");
  const customerUserId = (row.customer_id as string | null) ?? null;
  const sellerUserId = (row.seller_user_id as string | null) ?? null;
  const supportThread =
    type === "CUSTOMER_COMPANY" || (type === "CUSTOMER_SELLER" && row.shop_slug === SUPPORT_SHOP_SLUG);

  const memberUserIds: string[] = [];
  if (customerUserId) memberUserIds.push(customerUserId);
  if (sellerUserId) memberUserIds.push(sellerUserId);

  return {
    conversationId,
    type,
    customerUserId,
    sellerUserId,
    supportThread,
    memberUserIds,
    companyAudience: supportThread || type === "SELLER_COMPANY" || type === "COMPANY_INTERNAL",
  };
}

/**
 * May this user receive/emit frames for the conversation?
 *
 * Mirrors the route handlers exactly:
 *   - a direct participant (customer or seller) — always;
 *   - a company role, but ONLY for a company thread or internal room — never
 *     for a private CUSTOMER_SELLER thread of a real shop.
 */
export function isChatParticipant(
  audience: ChatAudience,
  userId: string | null | undefined,
  role: string | null | undefined,
): boolean {
  if (!userId) return false;
  if (audience.memberUserIds.includes(userId)) return true;
  return audience.companyAudience && isCompanyRole(role);
}

/**
 * Everyone who should see a frame from `senderUserId`, excluding the sender
 * itself (the socket must never echo typing back to the person typing).
 *
 * The split is the same one the chat core uses for `chat:message`:
 *   customer/seller sender → the other direct participant + company sessions;
 *   company sender         → the direct participants (the customer/seller sees
 *                            the indicator), plus other staff ONLY in an
 *                            internal room, where colleagues are the audience.
 */
export function chatFrameRecipients(
  audience: ChatAudience,
  senderUserId: string,
): { userIds: string[]; includeCompany: boolean } {
  const userIds = audience.memberUserIds.filter((id) => id !== senderUserId);
  const senderIsCompanyOnly = !audience.memberUserIds.includes(senderUserId);
  return {
    userIds,
    includeCompany:
      audience.companyAudience && (!senderIsCompanyOnly || audience.type === "COMPANY_INTERNAL"),
  };
}
