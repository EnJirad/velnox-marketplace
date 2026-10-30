/**
 * Chat message ownership, alignment and de-duplication — the shared rule.
 *
 * BEHAVIOURAL tests of `packages/shared/src/lib/chat-message.ts`, the single rule
 * VelShop, VelSeller and VelCenter now render from. No database, no socket, so
 * they always run.
 *
 * The regression pinned here: the automated Velnox Support acknowledgment is
 * stored with `sender_role = 'system'` and `sender_id = NULL`. VelCenter used to
 * compute ownership as `m.senderId === (user?.id ?? null)`, so while the viewer's
 * id was unresolved the comparison became `null === null` and the platform's own
 * message was rendered on the RIGHT. In all three apps the same row was CENTRED
 * instead of LEFT. Both are asserted against below.
 */
import { describe, expect, test } from "bun:test";
import {
  applyReadReceipt,
  belongsToConversation,
  isOwnMessage,
  isSystemMessage,
  mergeIncomingMessage,
  messageSide,
  type ChatMessageLike,
} from "../../packages/shared/src/lib/chat-message.js";

const ME = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CONV = "33333333-3333-4333-8333-333333333333";

/** A human message as `mapMessage` serialises it. */
function human(overrides: Partial<ChatMessageLike> = {}): ChatMessageLike {
  return {
    id: "m-1",
    conversationId: CONV,
    senderId: OTHER,
    senderRole: "customer",
    isSystem: false,
    systemKind: null,
    createdAt: 1_700_000_000_000,
    readAt: null,
    ...overrides,
  };
}

/** The daily support acknowledgment as the server serialises it. */
function systemAck(overrides: Partial<ChatMessageLike> = {}): ChatMessageLike {
  return {
    id: "s-1",
    conversationId: CONV,
    senderId: null,
    senderRole: "system",
    isSystem: true,
    systemKind: "support_daily_ack",
    createdAt: 1_700_000_001_000,
    readAt: null,
    ...overrides,
  };
}

describe("alignment: right only for the authenticated user", () => {
  test("my own message is on the RIGHT", () => {
    const mine = human({ senderId: ME, senderRole: "customer" });
    expect(isOwnMessage(mine, ME)).toBe(true);
    expect(messageSide(mine, ME)).toBe("right");
  });

  test("the other participant's message is on the LEFT", () => {
    const theirs = human({ senderId: OTHER });
    expect(isOwnMessage(theirs, ME)).toBe(false);
    expect(messageSide(theirs, ME)).toBe("left");
  });

  test("seller and customer see each other on the LEFT of their own side", () => {
    const fromCustomer = human({ senderId: OTHER, senderRole: "customer" });
    const fromSeller = human({ id: "m-2", senderId: ME, senderRole: "seller" });
    expect(messageSide(fromCustomer, ME)).toBe("left");
    expect(messageSide(fromSeller, ME)).toBe("right");
    expect(messageSide(fromCustomer, OTHER)).toBe("right");
    expect(messageSide(fromSeller, OTHER)).toBe("left");
  });

  test("company staff messages are incoming for the customer", () => {
    const fromStaff = human({ senderId: OTHER, senderRole: "company" });
    expect(messageSide(fromStaff, ME)).toBe("left");
    expect(messageSide(fromStaff, OTHER)).toBe("right");
  });
});

describe("system messages are always incoming (LEFT)", () => {
  test("the acknowledgment is never mine, whoever is looking", () => {
    const ack = systemAck();
    expect(isSystemMessage(ack)).toBe(true);
    expect(messageSide(ack, ME)).toBe("left");
    expect(messageSide(ack, OTHER)).toBe("left");
  });

  test("a null sender with an unresolved viewer is NEVER classified as outgoing", () => {
    // The exact production bug: `null === null` used to be true in VelCenter.
    const ack = systemAck();
    expect(isOwnMessage(ack, null)).toBe(false);
    expect(isOwnMessage(ack, undefined)).toBe(false);
    expect(isOwnMessage(ack, "")).toBe(false);
    expect(messageSide(ack, null)).toBe("left");
  });

  test("a null/absent sender with no system flag is still treated as system", () => {
    // Defensive: an older payload may carry only the NULL sender.
    expect(isSystemMessage(human({ senderId: null, isSystem: undefined, senderRole: "company" }))).toBe(true);
  });

  test("a system row is identified by any one of its three signals", () => {
    expect(isSystemMessage({ ...systemAck(), isSystem: undefined })).toBe(true);
    expect(isSystemMessage({ ...systemAck(), senderRole: null, isSystem: undefined })).toBe(true);
    expect(isSystemMessage(human())).toBe(false);
  });

  test("no viewer id means nothing is mine", () => {
    expect(isOwnMessage(human({ senderId: ME }), null)).toBe(false);
    expect(isOwnMessage(human({ senderId: ME }), undefined)).toBe(false);
  });
});

describe("render rules that keep the thread consistent", () => {
  test("an event for another conversation is not rendered in the active one", () => {
    const elsewhere = human({ conversationId: "44444444-4444-8444-8444-444444444444" });
    expect(belongsToConversation(elsewhere, CONV)).toBe(false);
    expect(belongsToConversation(human(), CONV)).toBe(true);
    expect(belongsToConversation(human(), null)).toBe(false);
  });

  test("the API reply and the socket broadcast render ONE bubble", () => {
    const saved = human({ senderId: ME });
    const afterApi = mergeIncomingMessage([], saved);
    expect(afterApi.length).toBe(1);
    // The same message arriving again over the socket adds nothing …
    const afterSocket = mergeIncomingMessage(afterApi, { ...saved });
    expect(afterSocket.length).toBe(1);
    // … while a genuinely new one is appended.
    const withNext = mergeIncomingMessage(afterSocket, human({ id: "m-9" }));
    expect(withNext.map((m) => m.id)).toEqual([saved.id, "m-9"]);
  });

  test("a duplicate keeps the SAME array reference (no wasted re-render)", () => {
    const list = [human()];
    expect(mergeIncomingMessage(list, human())).toBe(list);
    expect(mergeIncomingMessage(list, null)).toBe(list);
  });

  test("read receipts tick only my own messages, up to the bound", () => {
    const mineOlder = human({ id: "mine-1", senderId: ME, createdAt: 1000 });
    const mineNewer = human({ id: "mine-2", senderId: ME, createdAt: 5000 });
    const theirs = human({ id: "theirs-1", senderId: OTHER, createdAt: 1000 });
    const ack = systemAck({ id: "ack-1", createdAt: 1000 });

    const ticked = applyReadReceipt([mineOlder, mineNewer, theirs, ack], ME, 1000);
    expect(ticked[0]!.readAt).not.toBeNull();
    // Ahead of the bound the reader never loaded it, so it stays unread.
    expect(ticked[1]!.readAt).toBeNull();
    // Somebody else's message is never ticked by my receipt.
    expect(ticked[2]!.readAt).toBeNull();
    // A system message is never "read" — nobody has to read it.
    expect(ticked[3]!.readAt).toBeNull();
  });

  test("a receipt with nothing to change keeps the array reference", () => {
    const list = [human({ senderId: OTHER })];
    expect(applyReadReceipt(list, ME, 1000)).toBe(list);
    const alreadyRead = [human({ senderId: ME, readAt: 123 })];
    expect(applyReadReceipt(alreadyRead, ME, 5000)).toBe(alreadyRead);
  });
});
