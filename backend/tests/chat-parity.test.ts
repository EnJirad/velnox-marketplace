/**
 * Chat parity guards (2026-11-02).
 *
 * These are SOURCE-level assertions for three rules that regressed before and
 * are easy to regress again, because each one lived in one app and not the
 * others:
 *
 *   1. VelCenter must render a normal bubble's attachment (the image bug: the
 *      renderer existed only inside the SYSTEM-message branch).
 *   2. Chat must never write `notifications` rows — the bell is for business
 *      events, and chat unread is per conversation.
 *   3. The inbox preview must prefer the LATEST UNREAD message, and Support must
 *      stay a separate inbox.
 *
 * The behavioural half (real DB + WebSocket) lives in the existing DB-gated
 * suites; this file never replaces it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

const CHAT_ROUTE = "backend/routes/chat.ts";
const CENTER_CHAT_ROUTE = "backend/routes/center-chat.ts";
const CENTER_UI = "apps/velcenter/src/components/ChatManagement.tsx";
const SHOP_UI = "apps/velshop/src/pages/ShopChat.tsx";
const SELLER_UI = "apps/velseller/src/pages/SellerChat.tsx";

const CONVERSATION = "packages/shared/src/components/chat/chat-conversation.tsx";

describe("chat images render through one viewer, in every bubble", () => {
  test("the shared bubble carries the image renderer once, for every sender", () => {
    const shared = read(CONVERSATION);
    // ONE render site now serves both the human and the system row, because the
    // thread body itself is shared — the drift this test was written about
    // (VelCenter's human bubble silently losing images) cannot recur per app.
    expect(shared).toContain("<ChatImageMessage");
    // An image-only message is legal: the body is optional around the image.
    expect(shared).toContain("message.body && (");
    expect(shared).toContain("{message.attachmentUrl && (");
  });

  test("all three surfaces render the shared thread body", () => {
    for (const page of [SHOP_UI, SELLER_UI, CENTER_UI]) {
      const src = read(page);
      expect(src).toContain("<ChatConversation");
      // No page keeps a private image renderer beside the shared one.
      expect(src).not.toContain("<ChatImageMessage");
    }
  });
});

describe("chat never writes bell notifications", () => {
  test("no chat send path calls the notification helpers", () => {
    expect(read(CHAT_ROUTE)).not.toContain("notifyUser(");
    expect(read(CHAT_ROUTE)).not.toContain("notifyCompanyStaff(");
    expect(read(CENTER_CHAT_ROUTE)).not.toContain("notifyUser(");
    expect(read(CENTER_CHAT_ROUTE)).not.toContain("notifyCompanyStaff(");
  });

  test("the bell feed filters historical chat rows out", () => {
    const src = read(CHAT_ROUTE);
    const start = src.indexOf('app.get("/api/customer/notifications"');
    expect(start).toBeGreaterThan(-1);
    const block = src.slice(start, start + 1200);
    expect(block).toContain("AND type <> 'chat'");
  });
});

describe("unread is per conversation and previews the latest unread message", () => {
  test("both inbox queries prefer the latest unread body", () => {
    for (const file of [CHAT_ROUTE, CENTER_CHAT_ROUTE]) {
      const src = read(file);
      expect(src).toContain("last_unread_body");
      expect(src).toContain("r.last_unread_body ?? r.last_message");
      // An image-only unread message must still preview as media, not blank.
      expect(src).toContain("'📷'");
    }
  });

  test("unread counts come from read_at, never from total messages", () => {
    const src = read(CHAT_ROUTE);
    expect(src).toContain("AND m.read_at IS NULL");
    expect(src).not.toContain("COUNT(*) FROM chat_messages WHERE conversation_id = c.id) AS unread_count");
  });
});

describe("Support stays a separate inbox", () => {
  test("customer All/Unread exclude the support thread", () => {
    const src = read(SHOP_UI);
    expect(src).toContain('if (filter === "support") return c.isSupport;');
    expect(src).toContain("if (c.isSupport) return false;");
  });

  test("seller All/Unread exclude the Velnox company thread", () => {
    const src = read(SELLER_UI);
    expect(src).toContain('if (filter === "support") return c.type === "SELLER_COMPANY";');
    expect(src).toContain('if (c.type === "SELLER_COMPANY") return false;');
  });
});

describe("VelCenter has a real Support Inbox", () => {
  test("the center exposes a combined support tab with its own label", () => {
    const ui = read(CENTER_UI);
    expect(ui).toContain('support: { label: "Support Inbox"');
    expect(ui).toContain('const [tab, setTab] = useState<ChatTab>("support");');
    // Support rows are labelled by audience, so the two halves stay visible.
    expect(ui).toContain('tab === "support" && (');
  });

  test("the API accepts the support tab and merges the two audiences", () => {
    const api = read(CENTER_CHAT_ROUTE);
    expect(api).toContain('tab !== "support"');
    expect(api).toContain('listCompanyConversations("customer", viewerId)');
    expect(api).toContain('listCompanyConversations("seller", viewerId)');
    // One badge, derived from the two counts — never a separate counter.
    expect(api).toContain("support: customers + sellers");
  });
});
