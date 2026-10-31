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

describe("VelCenter renders chat images in every bubble", () => {
  test("the normal bubble carries the shared image renderer, not only the system branch", () => {
    const src = read(CENTER_UI);
    // Two render sites: the system/automated bubble AND the human bubble.
    const renders = src.split("<ChatImageMessage").length - 1;
    expect(renders).toBeGreaterThanOrEqual(2);
    // The human bubble guards an empty body (image-only messages are legal).
    expect(src).toContain("{m.body ? (");
    expect(src).toContain("THE ROOT-CAUSE FIX");
  });

  test("all three surfaces use the same viewer component", () => {
    for (const page of [SHOP_UI, SELLER_UI, CENTER_UI]) {
      expect(read(page)).toContain("<ChatImageMessage");
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
