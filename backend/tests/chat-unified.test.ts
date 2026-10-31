/**
 * UNIFIED MARKETPLACE CHAT — one core, four conversation types.
 *
 * Covers the required behaviour:
 *   customer↔seller, customer→company, seller→company, company internal,
 *   cross-customer / cross-seller / company-vs-private isolation, addressed
 *   realtime, unread counts, bounded reads, idempotent retries, assignment and
 *   support status.
 *
 * The behavioural half drives the REAL routes against a disposable PostgreSQL
 * (`TEST_DATABASE_URL`) and skips without one. No production credential is read.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import { readFileSync } from "fs";
import { join } from "path";
import { WebSocketServer, WebSocket } from "ws";

import { setupWebSocket } from "../realtime/index.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-unit-tests-only-32chars!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const CHAT = "backend/routes/chat.ts";
const CENTER_CHAT = "backend/routes/center-chat.ts";
const API_ROUTES = "packages/shared/src/lib/api-routes.ts";
const SHOP_CHAT = "apps/velshop/src/pages/ShopChat.tsx";
const SELLER_CHAT = "apps/velseller/src/pages/SellerChat.tsx";
const CENTER_CHAT_UI = "apps/velcenter/src/components/ChatManagement.tsx";
const CENTER_PAGE = "apps/velcenter/src/pages/Center.tsx";
const SCHEMA = "db/schema.sql";

const describeDb = hasTestDatabase() ? describe : describe.skip;
const testFn = hasTestDatabase() ? test : test.skip;

// ═══════════════════════════════════════════════════════════════════════════
// 1. Structure — one core, no second engine/socket/table
// ═══════════════════════════════════════════════════════════════════════════

describe("unified chat is one core, not parallel systems", () => {
  test("all four conversation types live in the existing conversations table", () => {
    const schema = read(SCHEMA);
    expect(schema).toContain("type TEXT NOT NULL DEFAULT 'CUSTOMER_SELLER' CHECK (type IN ('CUSTOMER_SELLER', 'CUSTOMER_COMPANY', 'SELLER_COMPANY', 'COMPANY_INTERNAL'))");
    // One messages table; company replies reuse it with a distinct sender role.
    expect(schema).toContain("sender_role TEXT NOT NULL DEFAULT 'customer' CHECK (sender_role IN ('customer', 'seller', 'company', 'system'))");
    expect(schema).toContain("conversations_participant_shape_check");
    expect(schema).toContain("uq_conversations_customer_company");
    expect(schema).toContain("uq_conversations_seller_company");
    expect(schema).toContain("uq_conversations_internal_title");
    // No duplicate chat engine/table was introduced.
    expect(schema).not.toContain("CREATE TABLE IF NOT EXISTS company_conversations");
    expect(schema).not.toContain("CREATE TABLE IF NOT EXISTS chat_messages_v2");
  });

  test("VelCenter imports the SAME core helpers; it has no chat DDL or socket", () => {
    const center = read(CENTER_CHAT);
    expect(center).toContain('from "./chat.js"');
    expect(center).toContain("loadMessages");
    expect(center).toContain("validateBody");
    expect(center).toContain("readUpTo");
    expect(center).toContain("insertHumanMessage");
    expect(center).toContain('senderRole: "company"');
    // The durable claim lives in ONE helper, not in the console route.
    expect(center).toContain("ON CONFLICT");
    expect(center).not.toContain("CREATE TABLE");
    expect(center).not.toContain("new WebSocket");
    expect(center).not.toContain("broadcast(");
    // Company recipients use the existing addressed paths.
    expect(center).toContain("sendToCenter(CHANNELS.CHAT_MESSAGE");
    expect(center).toContain("sendToUser(row.seller_user_id");
    expect(center).toContain("sendToUser(row.customer_id");
  });

  test("company access never reaches a private customer↔seller thread", () => {
    const center = read(CENTER_CHAT);
    // The only CUSTOMER_SELLER row the company may touch is the reserved-shop
    // legacy support row. Everything else is refused before any query.
    expect(center).toContain('row.type === "CUSTOMER_SELLER" && row.shop_slug === SUPPORT_SHOP_SLUG');
    expect(center).toContain('(c.type = \'CUSTOMER_SELLER\' AND sh.slug = $2)');
    expect(center).toContain('WHERE c.type = \'SELLER_COMPANY\'');
    expect(center).toContain('WHERE c.type = \'COMPANY_INTERNAL\'');
  });

  test("the three surfaces share the one socket and refetch after reconnect", () => {
    for (const page of [SHOP_CHAT, SELLER_CHAT, CENTER_CHAT_UI]) {
      const src = read(page);
      expect(src).toContain("onChatReconnect(");
      expect(src).not.toContain("new WebSocket(");
      expect(src).not.toContain("setInterval(");
      expect(src).toContain('onChatEvent("chat:message"');
      // Incoming messages are deduped by id through the ONE shared helper — the
      // API reply and the socket broadcast must render a single bubble.
      expect(src).toContain("mergeIncomingMessage(prev, message)");
      // Ownership and system classification come from that same shared module.
      expect(src).toContain("isOwnMessage(m,");
      expect(src).toContain("isSystemMessage(m)");
    }
    expect(read(CENTER_PAGE)).toContain('subscribeChatChannel("product:updated")');
    expect(read(API_ROUTES)).toContain('apiGetFresh("/api/center/chat/unread")');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Behaviour — REAL routes + REAL WebSocket against disposable PostgreSQL
// ═══════════════════════════════════════════════════════════════════════════

interface Harness {
  httpUrl: string;
  wsUrl: string;
  close: () => Promise<void>;
}

async function startHarness(): Promise<Harness> {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { setupChatRoutes } = await import("../routes/chat.js");
  const { setupCenterChatRoutes } = await import("../routes/center-chat.js");
  const { setupRoutes } = await import("../routes/index.js");
  setupChatRoutes(app);
  setupCenterChatRoutes(app);
  setupRoutes(app);
  const server: Server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });
  setupWebSocket(wss);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const { port } = server.address() as AddressInfo;
  return {
    httpUrl: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    close: async () => {
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function collector(ws: WebSocket) {
  const frames: any[] = [];
  ws.on("message", (raw) => {
    try {
      frames.push(JSON.parse(String(raw)));
    } catch {
      /* ignore */
    }
  });
  return {
    frames,
    async waitFor(match: (frame: any) => boolean, timeoutMs = 5000): Promise<any> {
      const started = Date.now();
      for (;;) {
        const found = frames.find(match);
        if (found) return found;
        if (Date.now() - started > timeoutMs) throw new Error("timed out waiting for a frame");
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    },
    async has(match: (frame: any) => boolean): Promise<boolean> {
      await new Promise((resolve) => setTimeout(resolve, 250));
      return frames.some(match);
    },
  };
}

async function openSocket(wsUrl: string, token: string): Promise<{ ws: WebSocket; frames: ReturnType<typeof collector> }> {
  const ws = new WebSocket(wsUrl, { headers: { cookie: `velnox_session=${token}` } });
  const frames = collector(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return { ws, frames };
}

describeDb("unified chat, end to end (requires TEST_DATABASE_URL)", () => {
  const fixtureUsers: Array<string | null> = [];
  const fixtureTitles: string[] = [];
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness?.close();
    const { query } = await import("../db/index.js");
    if (fixtureTitles.length > 0) {
      await query(
        `DELETE FROM conversations WHERE type = 'COMPANY_INTERNAL' AND title = ANY($1::text[])`,
        [fixtureTitles],
      );
    }
    await purgeUsers(fixtureUsers.splice(0));
  });

  async function makeUser(role: string, tag: string): Promise<string> {
    const { query } = await import("../db/index.js");
    const res = await query(
      `INSERT INTO users (email, name, role, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [`p2u-${tag}-${crypto.randomUUID().slice(0, 8)}@test.invalid`, `P2U ${tag}`, role],
    );
    const id = res.rows[0].id as string;
    fixtureUsers.push(id);
    return id;
  }

  function tokenFor(userId: string): string {
    return jwt.sign({ userId, email: `${userId}@test.invalid` }, process.env.JWT_SECRET!, {
      expiresIn: "1h",
    });
  }

  async function call(
    method: string,
    path: string,
    userId?: string,
    body?: unknown,
  ): Promise<{ status: number; data: any }> {
    const res = await fetch(`${harness.httpUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(userId ? { Cookie: `velnox_session=${tokenFor(userId)}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    return { status: res.status, data: await res.json().catch(() => undefined) };
  }

  interface Pair {
    customerId: string;
    sellerUserId: string;
    sellerId: string;
    shopId: string;
    shopName: string;
  }

  async function seedPair(tag: string): Promise<Pair> {
    const { query } = await import("../db/index.js");
    const customerId = await makeUser("customer", `${tag}-buyer`);
    const sellerUserId = await makeUser("seller", `${tag}-seller`);
    const seller = await query(
      `INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`,
      [sellerUserId],
    );
    const shopName = `P2U ${tag} shop`;
    const shop = await query(
      `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [seller.rows[0].id, shopName, `p2u-${tag}-${crypto.randomUUID().slice(0, 6)}`],
    );
    return {
      customerId,
      sellerUserId,
      sellerId: seller.rows[0].id as string,
      shopId: shop.rows[0].id as string,
      shopName,
    };
  }

  async function openSellerConversation(pair: Pair): Promise<string> {
    const res = await call("POST", "/api/customer/conversations", pair.customerId, { shopId: pair.shopId });
    expect(res.status).toBe(200);
    return res.data.data.id as string;
  }

  async function send(
    role: "customer" | "seller" | "company",
    userId: string,
    conversationId: string,
    body: string,
    clientId?: string,
  ) {
    const path =
      role === "customer"
        ? `/api/customer/conversations/${conversationId}/messages`
        : role === "seller"
          ? `/api/seller/conversations/${conversationId}/messages`
          : `/api/center/chat/conversations/${conversationId}/messages`;
    return call("POST", path, userId, { body, clientId });
  }

  async function messages(role: "customer" | "seller" | "company", userId: string, conversationId: string) {
    const path =
      role === "customer"
        ? `/api/customer/conversations/${conversationId}/messages`
        : role === "seller"
          ? `/api/seller/conversations/${conversationId}/messages`
          : `/api/center/chat/conversations/${conversationId}/messages`;
    return call("GET", path, userId);
  }

  // ── Flow A: customer ↔ seller ───────────────────────────────────────────
  testFn("customer opens a shop thread, sends, seller replies, customer receives", async () => {
    const pair = await seedPair("a");
    const convId = await openSellerConversation(pair);

    const first = await send("customer", pair.customerId, convId, "is this in stock?");
    expect(first.status).toBe(200);
    expect(first.data.data.message.senderRole).toBe("customer");

    const sellerList = await call("GET", "/api/seller/conversations", pair.sellerUserId);
    expect(sellerList.status).toBe(200);
    expect((sellerList.data.data as any[]).some((c) => c.id === convId)).toBe(true);

    const sellerView = await messages("seller", pair.sellerUserId, convId);
    expect(sellerView.status).toBe(200);
    expect(sellerView.data.data.items.at(-1).body).toBe("is this in stock?");

    const reply = await send("seller", pair.sellerUserId, convId, "yes, ready to ship");
    expect(reply.status).toBe(200);
    const customerView = await messages("customer", pair.customerId, convId);
    expect(customerView.data.data.items.at(-1).body).toBe("yes, ready to ship");
    expect(customerView.data.data.items.at(-1).senderRole).toBe("seller");
  });

  testFn("another customer and another seller cannot reach the thread", async () => {
    const a = await seedPair("iso-a");
    const b = await seedPair("iso-b");
    const convId = await openSellerConversation(a);
    await send("customer", a.customerId, convId, "private");

    expect((await messages("customer", b.customerId, convId)).status).toBe(404);
    expect((await messages("seller", b.sellerUserId, convId)).status).toBe(404);
    expect((await send("customer", b.customerId, convId, "peek")).status).toBe(404);
    expect((await send("seller", b.sellerUserId, convId, "peek")).status).toBe(404);

    const bList = await call("GET", "/api/customer/conversations", b.customerId);
    expect((bList.data.data as any[]).some((c) => c.id === convId)).toBe(false);
    const sbList = await call("GET", "/api/seller/conversations", b.sellerUserId);
    expect((sbList.data.data as any[]).some((c) => c.id === convId)).toBe(false);
  });

  // ── Flow B: customer → company ──────────────────────────────────────────
  testFn("customer gets a company thread, staff replies, and isolation holds", async () => {
    const pair = await seedPair("b");
    const staff = await makeUser("staff", "b-staff");
    const staffB = await makeUser("admin", "b-admin");

    const created = await call("POST", "/api/customer/support/conversation", pair.customerId);
    expect(created.status).toBe(200);
    expect(created.data.data.type).toBe("CUSTOMER_COMPANY");
    expect(created.data.data.isSupport).toBe(true);
    expect(created.data.data.shopId).toBeNull();
    const convId = created.data.data.id as string;

    // Get-or-create is stable: no duplicate company thread.
    const again = await call("POST", "/api/customer/support/conversation", pair.customerId);
    expect(again.data.data.id).toBe(convId);

    const sent = await send("customer", pair.customerId, convId, "my order never arrived");
    expect(sent.status).toBe(200);

    const customerTab = await call("GET", "/api/center/chat/conversations?type=customer", staff);
    expect(customerTab.status).toBe(200);
    expect((customerTab.data.data.items as any[]).some((c) => c.id === convId)).toBe(true);

    const staffView = await messages("company", staff, convId);
    expect(staffView.status).toBe(200);
    // The customer's message is stored, and the ONE automated acknowledgment for
    // the day follows it (a real system message both sides read).
    const staffItems = staffView.data.data.items as any[];
    expect(staffItems.map((m) => m.body)).toContain("my order never arrived");
    const acknowledged = staffItems.at(-1)!;
    expect(acknowledged.isSystem).toBe(true);
    expect(acknowledged.senderRole).toBe("system");
    expect(acknowledged.senderId).toBeNull();

    const clientId = crypto.randomUUID();
    const reply = await send("company", staff, convId, "we are checking it now", clientId);
    expect(reply.status).toBe(200);
    expect(reply.data.data.message.senderRole).toBe("company");

    // The retried staff send replays, it does not write a second row.
    const retry = await send("company", staff, convId, "we are checking it now", clientId);
    expect(retry.data.data.duplicate).toBe(true);
    expect(retry.data.data.message.id).toBe(reply.data.data.message.id);

    const customerView = await messages("customer", pair.customerId, convId);
    expect(customerView.data.data.items.at(-1).body).toBe("we are checking it now");
    expect(customerView.data.data.items.at(-1).senderRole).toBe("company");

    // Customer chat badge includes company replies.
    const summary = await call("GET", "/api/customer/account-summary", pair.customerId);
    expect(summary.data.data.chatUnread).toBe(1);

    // Staff assignment + support status (lightweight, not a ticket system).
    const patched = await call("PATCH", `/api/center/chat/conversations/${convId}`, staff, {
      status: "ASSIGNED",
      assignedTo: staffB,
    });
    expect(patched.status).toBe(200);
    expect(patched.data.data.status).toBe("ASSIGNED");
    expect(patched.data.data.assignedTo).toBe(staffB);

    const badStatus = await call("PATCH", `/api/center/chat/conversations/${convId}`, staff, { status: "NOPE" });
    expect(badStatus.status).toBe(400);
    const badAssignee = await call("PATCH", `/api/center/chat/conversations/${convId}`, staff, {
      assignedTo: pair.customerId,
    });
    expect(badAssignee.status).toBe(400);

    // Customers/sellers have no company endpoint at all.
    expect((await call("GET", "/api/center/chat/conversations?type=customer", pair.customerId)).status).toBe(403);
    expect((await call("GET", "/api/center/chat/conversations?type=customer", pair.sellerUserId)).status).toBe(403);
  });

  // ── Flow C: seller → company ────────────────────────────────────────────
  testFn("seller contacts Velnox, staff replies, and another seller is refused", async () => {
    const a = await seedPair("c");
    const b = await seedPair("c-other");
    const staff = await makeUser("owner", "c-owner");

    const created = await call("POST", "/api/seller/company/conversation", a.sellerUserId);
    expect(created.status).toBe(200);
    expect(created.data.data.type).toBe("SELLER_COMPANY");
    expect(created.data.data.shopId).toBeNull();
    const convId = created.data.data.id as string;

    const sent = await send("seller", a.sellerUserId, convId, "question about payout");
    expect(sent.status).toBe(200);

    const sellerTab = await call("GET", "/api/center/chat/conversations?type=seller", staff);
    expect((sellerTab.data.data.items as any[]).some((c) => c.id === convId)).toBe(true);

    const staffReply = await send("company", staff, convId, "payouts run every Friday");
    expect(staffReply.status).toBe(200);

    const sellerView = await messages("seller", a.sellerUserId, convId);
    expect(sellerView.data.data.items.at(-1).body).toBe("payouts run every Friday");
    expect(sellerView.data.data.items.at(-1).senderRole).toBe("company");

    expect((await messages("seller", b.sellerUserId, convId)).status).toBe(404);
    expect((await call("GET", "/api/center/chat/conversations?type=seller", b.sellerUserId)).status).toBe(403);
  });

  // ── Flow D: internal ────────────────────────────────────────────────────
  testFn("company staff use an internal room; customers and sellers cannot", async () => {
    const staffA = await makeUser("staff", "d-a");
    const staffB = await makeUser("admin", "d-b");
    const customer = await makeUser("customer", "d-customer");
    const sellerUser = await makeUser("seller", "d-seller");
    const title = `P2U internal ${crypto.randomUUID().slice(0, 8)}`;
    fixtureTitles.push(title);

    const created = await call("POST", "/api/center/chat/internal/conversations", staffA, { title });
    expect(created.status).toBe(200);
    expect(created.data.data.type).toBe("COMPANY_INTERNAL");
    const convId = created.data.data.id as string;

    const bList = await call("GET", "/api/center/chat/conversations?type=internal", staffB);
    expect((bList.data.data.items as any[]).some((c) => c.id === convId)).toBe(true);

    const sent = await send("company", staffA, convId, "ops handover at 18:00");
    expect(sent.status).toBe(200);
    const bView = await messages("company", staffB, convId);
    expect(bView.data.data.items.at(-1).body).toBe("ops handover at 18:00");

    const reply = await send("company", staffB, convId, "acknowledged");
    expect(reply.status).toBe(200);
    const aView = await messages("company", staffA, convId);
    expect(aView.data.data.items.at(-1).body).toBe("acknowledged");

    // No customer or seller can list/read an internal conversation.
    expect((await call("GET", "/api/center/chat/conversations?type=internal", customer)).status).toBe(403);
    expect((await call("GET", "/api/center/chat/conversations?type=internal", sellerUser)).status).toBe(403);
    expect((await messages("company", customer, convId)).status).toBe(403);

    // Internal rooms never leak into the customer/seller tabs.
    const customerTab = await call("GET", "/api/center/chat/conversations?type=customer", staffA);
    expect((customerTab.data.data.items as any[]).some((c) => c.id === convId)).toBe(false);
  });

  // ── Company cannot read a private seller↔customer thread ────────────────
  testFn("company staff cannot open a private customer↔seller conversation", async () => {
    const pair = await seedPair("private");
    const staff = await makeUser("staff", "private-staff");
    const convId = await openSellerConversation(pair);
    await send("customer", pair.customerId, convId, "private seller question");

    expect((await messages("company", staff, convId)).status).toBe(404);
    expect((await send("company", staff, convId, "should not land")).status).toBe(404);
    expect((await call("POST", `/api/center/chat/conversations/${convId}/read`, staff, {})).status).toBe(404);
    const customerTab = await call("GET", "/api/center/chat/conversations?type=customer", staff);
    expect((customerTab.data.data.items as any[]).some((c) => c.id === convId)).toBe(false);
  });

  // ── Realtime: addressed delivery only ───────────────────────────────────
  testFn("chat events reach the correct participant and nobody else", async () => {
    const pair = await seedPair("rt");
    const staff = await makeUser("staff", "rt-staff");
    const stranger = await makeUser("customer", "rt-stranger");

    const company = await call("POST", "/api/customer/support/conversation", pair.customerId);
    const companyConv = company.data.data.id as string;

    const staffSock = await openSocket(harness.wsUrl, tokenFor(staff));
    const strangerSock = await openSocket(harness.wsUrl, tokenFor(stranger));
    const customerSock = await openSocket(harness.wsUrl, tokenFor(pair.customerId));
    try {
      await send("customer", pair.customerId, companyConv, "hello company");
      const toStaff = await staffSock.frames.waitFor((f) => f.type === "chat:message");
      expect(toStaff.data.conversationId).toBe(companyConv);
      expect(toStaff.data.message.body).toBe("hello company");
      expect(await strangerSock.frames.has((f) => f.type === "chat:message")).toBe(false);

      const reply = await send("company", staff, companyConv, "hello customer");
      expect(reply.status).toBe(200);
      const toCustomer = await customerSock.frames.waitFor(
        (f) => f.type === "chat:message" && f.data?.message?.body === "hello customer",
      );
      expect(toCustomer.data.conversationId).toBe(companyConv);
      expect(await strangerSock.frames.has((f) => f.type === "chat:message" && f.data?.conversationId === companyConv)).toBe(false);
    } finally {
      staffSock.ws.close();
      strangerSock.ws.close();
      customerSock.ws.close();
    }

    // Seller→company and company→seller use the same addressed path.
    const sellerCompany = await call("POST", "/api/seller/company/conversation", pair.sellerUserId);
    const sellerConv = sellerCompany.data.data.id as string;
    const sellerSock = await openSocket(harness.wsUrl, tokenFor(pair.sellerUserId));
    const staffSock2 = await openSocket(harness.wsUrl, tokenFor(staff));
    try {
      await send("seller", pair.sellerUserId, sellerConv, "seller needs help");
      const frame = await staffSock2.frames.waitFor((f) => f.type === "chat:message");
      expect(frame.data.conversationId).toBe(sellerConv);
      await send("company", staff, sellerConv, "seller reply");
      const toSeller = await sellerSock.frames.waitFor(
        (f) => f.type === "chat:message" && f.data?.message?.body === "seller reply",
      );
      expect(toSeller.data.conversationId).toBe(sellerConv);
    } finally {
      sellerSock.ws.close();
      staffSock2.ws.close();
    }
  });

  // ── Unread counts ───────────────────────────────────────────────────────
  testFn("unread counts are scoped per role and clear on a bounded read", async () => {
    const pair = await seedPair("unread");
    const staff = await makeUser("staff", "unread-staff");
    const company = await call("POST", "/api/customer/support/conversation", pair.customerId);
    const convId = company.data.data.id as string;

    const before = await call("GET", "/api/center/chat/unread", staff);
    const beforeCustomers = before.data.data.customers as number;

    const m = await send("customer", pair.customerId, convId, "one unread for company");
    expect(m.status).toBe(200);
    const mid = await call("GET", "/api/center/chat/unread", staff);
    expect(mid.data.data.customers).toBe(beforeCustomers + 1);

    const customerRead = await call("POST", `/api/customer/conversations/${convId}/read`, pair.customerId, {
      upTo: m.data.data.message.createdAt,
    });
    expect(customerRead.status).toBe(200);
    expect(customerRead.data.data.marked).toBe(0); // it is the customer's own message

    const staffReply = await send("company", staff, convId, "company answer");
    const summary = await call("GET", "/api/customer/account-summary", pair.customerId);
    expect(summary.data.data.chatUnread).toBe(1);

    const read = await call("POST", `/api/center/chat/conversations/${convId}/read`, staff, {
      upTo: staffReply.data.data.message.createdAt,
    });
    expect(read.status).toBe(200);
    // The customer's earlier message is the staff's incoming message; the
    // staff's own reply is never marked by their own read.
    expect(read.data.data.marked).toBe(1);

    const customerRead2 = await call("POST", `/api/customer/conversations/${convId}/read`, pair.customerId, {
      upTo: staffReply.data.data.message.createdAt,
    });
    expect(customerRead2.data.data.marked).toBe(1);
    const summary2 = await call("GET", "/api/customer/account-summary", pair.customerId);
    expect(summary2.data.data.chatUnread).toBe(0);
  });

  testFn("unread counts never leak between customers, sellers or company tabs", async () => {
    const a = await seedPair("leak-a");
    const b = await seedPair("leak-b");
    const staff = await makeUser("staff", "leak-staff");
    const convA = await openSellerConversation(a);
    await openSellerConversation(b);
    await send("seller", a.sellerUserId, convA, "only for customer A");
    await send("customer", a.customerId, convA, "only for seller A");

    const aSummary = await call("GET", "/api/customer/account-summary", a.customerId);
    const bSummary = await call("GET", "/api/customer/account-summary", b.customerId);
    expect(aSummary.data.data.chatUnread).toBe(1);
    expect(bSummary.data.data.chatUnread).toBe(0);

    const aList = await call("GET", "/api/seller/conversations", a.sellerUserId);
    const bList = await call("GET", "/api/seller/conversations", b.sellerUserId);
    expect((aList.data.data as any[]).reduce((n, c) => n + c.unreadCount, 0)).toBe(1);
    expect((bList.data.data as any[]).reduce((n, c) => n + c.unreadCount, 0)).toBe(0);

    const unread = await call("GET", "/api/center/chat/unread", staff);
    expect(unread.status).toBe(200);
    expect(typeof unread.data.data.customers).toBe("number");
    expect(typeof unread.data.data.sellers).toBe("number");
    expect(typeof unread.data.data.internal).toBe("number");
  });
});
