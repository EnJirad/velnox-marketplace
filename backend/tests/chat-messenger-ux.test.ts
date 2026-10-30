/**
 * MESSENGER UX — alignment, delivery/read ticks, the daily support
 * acknowledgment and the ephemeral typing indicator.
 *
 * Two halves, exactly like `chat-unified.test.ts`:
 *
 *   1. STRUCTURE — source/schema assertions that always run (no database).
 *      They pin the properties that make the feature safe: one chat core, one
 *      socket, a DATABASE-level daily claim, and an authorization check on every
 *      typing frame.
 *
 *   2. BEHAVIOUR — the REAL routes and the REAL WebSocket against a disposable
 *      PostgreSQL (`TEST_DATABASE_URL`). Without one these cases SKIP; the
 *      guard in `helpers/test-db.ts` never points them at production.
 *
 * The daily acknowledgment is exercised through the HTTP API only, because that
 * is the only writer. No production credential, no clock travel: "yesterday" is
 * simulated by back-dating the stored `ack_day`, which is exactly the column the
 * unique index keys on.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { readFileSync } from "fs";
import { join } from "path";
import { WebSocketServer, WebSocket } from "ws";

import { setupWebSocket } from "../realtime/index.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-chat-messenger-ux-tests!!";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const CHAT = "backend/routes/chat.ts";
const CENTER_CHAT = "backend/routes/center-chat.ts";
const REALTIME = "backend/realtime/index.ts";
const ACCESS = "backend/lib/chat-access.ts";
const SOCKET = "packages/shared/src/lib/chat-socket.ts";
const TYPING_LIB = "packages/shared/src/lib/chat-typing.ts";
const TYPING_DOTS = "packages/shared/src/components/chat/typing-dots.tsx";
const SHOP_CHAT = "apps/velshop/src/pages/ShopChat.tsx";
const SELLER_CHAT = "apps/velseller/src/pages/SellerChat.tsx";
const CENTER_CHAT_UI = "apps/velcenter/src/components/ChatManagement.tsx";
const SCHEMA = "db/schema.sql";
const RECONCILER = "db/run-sqleditor.sql";

const describeDb = hasTestDatabase() ? describe : describe.skip;
const testFn = hasTestDatabase() ? test : test.skip;

// ═══════════════════════════════════════════════════════════════════════════
// 1. Structure — the invariants that make the behaviour safe
// ═══════════════════════════════════════════════════════════════════════════

describe("system messages are a marker on the ONE messages table", () => {
  test("the canonical schema carries the system columns and the daily claim index", () => {
    const schema = read(SCHEMA);
    // One table, no second chat engine / message table.
    expect(schema).not.toContain("CREATE TABLE IF NOT EXISTS chat_messages_v2");
    expect(schema).not.toContain("CREATE TABLE IF NOT EXISTS support_ack");
    expect(schema).toContain("sender_role TEXT NOT NULL DEFAULT 'customer' CHECK (sender_role IN ('customer', 'seller', 'company', 'system'))");
    expect(schema).toContain("system_kind TEXT");
    expect(schema).toContain("ack_day DATE");
    // One acknowledgment per conversation per calendar day, enforced by the DB.
    expect(schema).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_messages_support_daily_ack");
    expect(schema).toContain("WHERE system_kind = 'support_daily_ack'");
  });

  test("the reconciler can widen the CHECK and add the columns idempotently", () => {
    const sql = read(RECONCILER);
    expect(sql).toContain("ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS system_kind TEXT");
    expect(sql).toContain("ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS ack_day DATE");
    expect(sql).toContain("ALTER TABLE public.chat_messages ALTER COLUMN sender_id DROP NOT NULL");
    expect(sql).toContain("CREATE UNIQUE INDEX IF NOT EXISTS uq_chat_messages_support_daily_ack");
    // The widened CHECK is dropped/re-added behind a definition guard, so a rerun
    // is a no-op and PostgreSQL 11+ keeps a single statement.
    expect(sql).toContain("NOT LIKE '%system%'");
    expect(sql).toContain("CHECK (sender_role IN ('customer', 'seller', 'company', 'system'))");
  });

  test("a system row has no human sender and never counts as unread", () => {
    const chat = read(CHAT);
    // Inserted with a NULL sender and an explicit system role.
    expect(chat).toContain("VALUES ($1, NULL, 'system', $2, $3,");
    // Read/unread SQL keeps excluding rows by `sender_id <> $reader`, which is
    // NULL (never true) for a system row — so it is never marked read and never
    // inflates an unread count.
    expect(chat).toContain("sender_id <> $2 AND read_at IS NULL");
    // The API shape tells the UI it is automated.
    expect(chat).toContain('isSystem: r.sender_role === "system"');
  });
});

describe("the daily acknowledgment is a database claim, not memory", () => {
  test("it is claimed by ON CONFLICT on the partial unique index", () => {
    const chat = read(CHAT);
    expect(chat).toContain("ON CONFLICT (conversation_id, ack_day) WHERE system_kind = 'support_daily_ack' DO NOTHING");
    // No in-process flag can decide eligibility: a restart must not re-send, and
    // a second instance must not disagree.
    expect(chat).not.toContain("ackSentToday");
    expect(chat).not.toContain("lastAckDay");
  });

  test("the day is the database's Asia/Bangkok calendar date", () => {
    const chat = read(CHAT);
    expect(chat).toContain("(NOW() AT TIME ZONE 'Asia/Bangkok')::date");
    // Calendar-day boundary, never a rolling 24h window.
    expect(chat).not.toContain("interval '24 hours'");
  });

  test("it fires only for company threads, after a customer message", () => {
    const chat = read(CHAT);
    expect(chat).toContain('conv.type === "CUSTOMER_COMPANY" || conv.shop_slug === SUPPORT_SHOP_SLUG');
    // One definition + exactly one call site (the customer send handler).
    expect((chat.match(/createDailySupportAck\(/g) ?? []).length).toBe(2);
  });
});

describe("typing is ephemeral, authorized and addressed", () => {
  test("the frame is handled by the ONE existing socket", () => {
    const realtime = read(REALTIME);
    expect(realtime).toContain('msg.type === "chat:typing"');
    expect(realtime).toContain("CHAT_TYPING");
    // Authorization comes from the database, from the same helper the routes use.
    expect(realtime).toContain("isChatParticipant(audience, client.userId, client.role)");
    // Never persisted, never echoed to the sender.
    expect(realtime).not.toContain("INSERT INTO chat_typing");
    expect(realtime).toContain("sendToCenter(CHANNELS.CHAT_TYPING, CHANNELS.CHAT_TYPING, payload, client.userId)");
    // The audience helper resolves membership from `conversations`, not a frame.
    const access = read(ACCESS);
    expect(access).toContain("FROM conversations c");
    expect(access).toContain("export function isChatParticipant");
  });

  test("no second socket and no polling were introduced", () => {
    const socket = read(SOCKET);
    expect(socket.split("new WebSocket(").length - 1).toBe(1);
    const typing = read(TYPING_LIB);
    expect(typing).not.toContain("setInterval");
    expect(typing).toContain("TYPING_SEND_INTERVAL_MS");
    expect(typing).toContain("TYPING_EXPIRE_MS");
    expect(typing).toContain("TYPING_IDLE_MS");
  });

  test("all three surfaces render the shared indicator", () => {
    for (const src of [read(SHOP_CHAT), read(SELLER_CHAT), read(CENTER_CHAT_UI)]) {
      expect(src).toContain("useChatTyping");
      expect(src).toContain("TypingDots");
    }
    // The frame itself is sent from ONE shared hook, not per app.
    expect(read(TYPING_LIB)).toContain('sendChatCommand("chat:typing"');
    // The animation is CSS-only and honours reduced motion.
    const dots = read(TYPING_DOTS);
    expect(dots).toContain("@keyframes velnox-typing");
    expect(dots).toContain("prefers-reduced-motion: reduce");
  });
});

describe("messenger rendering: side, ticks and system bubble", () => {
  test("own messages align right, others left, by sender id only", () => {
    for (const src of [read(SHOP_CHAT), read(SELLER_CHAT), read(CENTER_CHAT_UI)]) {
      expect(src).toContain('const mine = m.senderId === user');
      expect(src).toContain('mine ? "justify-end" : "justify-start"');
      // Ownership never comes from a display name or the body.
      expect(src).not.toContain('m.senderName === user');
    }
  });

  test("✓ means stored, ✓✓ means read", () => {
    for (const src of [read(SHOP_CHAT), read(SELLER_CHAT), read(CENTER_CHAT_UI)]) {
      expect(src).toContain("m.readAt != null ? (");
      expect(src).toContain("<CheckCheck");
      expect(src).toContain("<Check\n");
    }
  });

  test("system messages have their own presentation and no tick", () => {
    for (const src of [read(SHOP_CHAT), read(SELLER_CHAT), read(CENTER_CHAT_UI)]) {
      expect(src).toContain("if (m.isSystem)");
      expect(src).toContain("border-dashed");
    }
  });

  test("a read receipt is applied only to the sender's own messages", () => {
    for (const src of [read(SHOP_CHAT), read(SELLER_CHAT), read(CENTER_CHAT_UI)]) {
      expect(src).toContain("data?.readerId ===");
      expect(src).toContain("m.senderId === user");
      // Bounded by what the reader actually loaded.
      expect(src).toContain("m.createdAt <= upTo");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. Behaviour — real routes + real WebSocket, disposable PostgreSQL
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
      /* ignore malformed frame */
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
      await new Promise((resolve) => setTimeout(resolve, 300));
      return frames.some(match);
    },
  };
}

async function openSocket(
  wsUrl: string,
  token: string,
): Promise<{ ws: WebSocket; frames: ReturnType<typeof collector> }> {
  const ws = new WebSocket(wsUrl, { headers: { cookie: `velnox_session=${token}` } });
  const frames = collector(ws);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", reject);
  });
  return { ws, frames };
}

describeDb("daily support acknowledgment (requires TEST_DATABASE_URL)", () => {
  const fixtureUsers: Array<string | null> = [];
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness?.close();
    await purgeUsers(fixtureUsers.splice(0));
  });

  async function makeUser(role: string, tag: string): Promise<string> {
    const { query } = await import("../db/index.js");
    const res = await query(
      `INSERT INTO users (email, name, role, status)
       VALUES ($1, $2, $3, 'active') RETURNING id`,
      [`mux-${tag}-${crypto.randomUUID().slice(0, 8)}@test.invalid`, `MUX ${tag}`, role],
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

  async function openSupport(customerId: string): Promise<string> {
    const res = await call("POST", "/api/customer/support/conversation", customerId, {});
    expect(res.status).toBe(200);
    return res.data.data.id as string;
  }

  async function sendCustomer(customerId: string, conversationId: string, body: string, clientId?: string) {
    return call("POST", `/api/customer/conversations/${conversationId}/messages`, customerId, {
      body,
      clientId,
    });
  }

  async function ackRows(conversationId: string): Promise<any[]> {
    const { query } = await import("../db/index.js");
    const res = await query(
      `SELECT id, sender_id, sender_role, system_kind, ack_day, body, read_at
         FROM chat_messages
        WHERE conversation_id = $1 AND system_kind = 'support_daily_ack'
        ORDER BY created_at ASC`,
      [conversationId],
    );
    return res.rows;
  }

  testFn("the first customer message of the day writes exactly one acknowledgment", async () => {
    const customerId = await makeUser("customer", "ack-first");
    const convId = await openSupport(customerId);

    const first = await sendCustomer(customerId, convId, "hello, I need help with an order");
    expect(first.status).toBe(200);

    const acks = await ackRows(convId);
    expect(acks.length).toBe(1);
    // It is a REAL chat message both sides can read, marked as automated …
    expect(acks[0].sender_role).toBe("system");
    expect(acks[0].sender_id).toBeNull();
    expect(acks[0].system_kind).toBe("support_daily_ack");
    expect(String(acks[0].body)).toContain("We have received your message successfully");
    // … and nobody has to read it.
    expect(acks[0].read_at).toBeNull();

    // The API hands it to the participants with the automated marker.
    const view = await call("GET", `/api/customer/conversations/${convId}/messages`, customerId);
    expect(view.status).toBe(200);
    const system = (view.data.data.items as any[]).filter((m) => m.isSystem);
    expect(system.length).toBe(1);
    expect(system[0].senderId).toBeNull();
    expect(system[0].senderRole).toBe("system");
  });

  testFn("further messages on the same calendar day add no second acknowledgment", async () => {
    const customerId = await makeUser("customer", "ack-same-day");
    const convId = await openSupport(customerId);

    await sendCustomer(customerId, convId, "first");
    await sendCustomer(customerId, convId, "second");
    await sendCustomer(customerId, convId, "third");

    expect((await ackRows(convId)).length).toBe(1);
  });

  testFn("a new Asia/Bangkok calendar day resets eligibility", async () => {
    const customerId = await makeUser("customer", "ack-next-day");
    const convId = await openSupport(customerId);
    const { query } = await import("../db/index.js");

    await sendCustomer(customerId, convId, "today's message");
    expect((await ackRows(convId)).length).toBe(1);

    // Move the existing acknowledgment to YESTERDAY (the column the unique index
    // keys on). This is exactly the state a real 00:00 Asia/Bangkok rollover
    // produces: the old claim belongs to a different calendar day.
    await query(
      `UPDATE chat_messages SET ack_day = ack_day - 1
        WHERE conversation_id = $1 AND system_kind = 'support_daily_ack'`,
      [convId],
    );

    await sendCustomer(customerId, convId, "message after midnight");
    const acks = await ackRows(convId);
    expect(acks.length).toBe(2);
    // The two rows really are different days, one day apart.
    const days = acks.map((a) => new Date(a.ack_day).getTime()).sort((a, b) => a - b);
    expect(days[1] - days[0]).toBe(24 * 60 * 60 * 1000);
  });

  testFn("concurrent sends can only produce one acknowledgment", async () => {
    const customerId = await makeUser("customer", "ack-race");
    const convId = await openSupport(customerId);

    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) =>
        sendCustomer(customerId, convId, `parallel ${i}`, `race-${i}-${crypto.randomUUID()}`),
      ),
    );
    for (const res of results) expect(res.status).toBe(200);
    expect((await ackRows(convId)).length).toBe(1);
  });

  testFn("other conversation types never trigger a support acknowledgment", async () => {
    const customerId = await makeUser("customer", "ack-other");
    const sellerUserId = await makeUser("seller", "ack-other-seller");
    const { query } = await import("../db/index.js");
    const seller = await query(
      `INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`,
      [sellerUserId],
    );
    const shop = await query(
      `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [seller.rows[0].id, "MUX ack shop", `mux-ack-${crypto.randomUUID().slice(0, 6)}`],
    );

    const created = await call("POST", "/api/customer/conversations", customerId, {
      shopId: shop.rows[0].id,
    });
    expect(created.status).toBe(200);
    const convId = created.data.data.id as string;

    await sendCustomer(customerId, convId, "is this in stock?");
    expect((await ackRows(convId)).length).toBe(0);
  });

  testFn("the acknowledgment never becomes unread work for either side", async () => {
    const customerId = await makeUser("customer", "ack-unread");
    const staffId = await makeUser("staff", "ack-unread-staff");
    const convId = await openSupport(customerId);

    await sendCustomer(customerId, convId, "unread check");

    const customerList = await call("GET", "/api/customer/conversations", customerId);
    const customerRow = (customerList.data.data as any[]).find((c) => c.id === convId);
    // One unread: the staff has not replied. The system row itself adds nothing.
    expect(customerRow.unreadCount).toBe(0);

    const centerList = await call("GET", "/api/center/chat/conversations?type=customer", staffId);
    const centerRow = (centerList.data.data.items as any[]).find((c) => c.id === convId);
    // Exactly the customer's message is unread — not the acknowledgment.
    expect(centerRow.unreadCount).toBe(1);

    // A read marks only the human message; the system row is never "read".
    const readRes = await call("POST", `/api/center/chat/conversations/${convId}/read`, staffId, {});
    expect(readRes.status).toBe(200);
    expect(readRes.data.data.marked).toBe(1);
    const acks = await ackRows(convId);
    expect(acks[0].read_at).toBeNull();
  });

  testFn("a read receipt reports the bound it actually marked", async () => {
    const customerId = await makeUser("customer", "read-bound");
    const staffId = await makeUser("staff", "read-bound-staff");
    const convId = await openSupport(customerId);

    await sendCustomer(customerId, convId, "read me");

    // The SENDER listens for the receipt its counterpart triggers.
    const customerSocket = await openSocket(harness.wsUrl, tokenFor(customerId));
    try {
      const readRes = await call("POST", `/api/center/chat/conversations/${convId}/read`, staffId, {});
      expect(readRes.status).toBe(200);
      expect(readRes.data.data.marked).toBe(1);

      const frame = await customerSocket.frames.waitFor((f) => f.type === "chat:read");
      expect(frame.data.conversationId).toBe(convId);
      expect(frame.data.readerId).toBe(staffId);
      // The bound is the newest row this read actually marked, in epoch ms.
      expect(typeof frame.data.upTo).toBe("number");
      expect(frame.data.upTo).toBeGreaterThan(0);

      const view = await call("GET", `/api/customer/conversations/${convId}/messages`, customerId);
      const mine = (view.data.data.items as any[]).filter((m) => m.senderRole === "customer");
      expect(mine.length).toBe(1);
      expect(typeof mine[0].readAt).toBe("number");
      expect(mine[0].createdAt).toBeLessThanOrEqual(frame.data.upTo);
    } finally {
      customerSocket.ws.close();
    }
  });
});

describeDb("typing indicator over the existing socket (requires TEST_DATABASE_URL)", () => {
  const fixtureUsers: Array<string | null> = [];
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness();
  });

  afterAll(async () => {
    await harness?.close();
    await purgeUsers(fixtureUsers.splice(0));
  });

  async function makeUser(role: string, tag: string): Promise<string> {
    const { query } = await import("../db/index.js");
    const res = await query(
      `INSERT INTO users (email, name, role, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [`muxt-${tag}-${crypto.randomUUID().slice(0, 8)}@test.invalid`, `MUXT ${tag}`, role],
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

  async function seedShopThread(tag: string) {
    const { query } = await import("../db/index.js");
    const customerId = await makeUser("customer", `${tag}-buyer`);
    const sellerUserId = await makeUser("seller", `${tag}-seller`);
    const seller = await query(
      `INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`,
      [sellerUserId],
    );
    const shop = await query(
      `INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`,
      [seller.rows[0].id, `MUXT ${tag}`, `muxt-${tag}-${crypto.randomUUID().slice(0, 6)}`],
    );
    const created = await call("POST", "/api/customer/conversations", customerId, {
      shopId: shop.rows[0].id,
    });
    expect(created.status).toBe(200);
    return { customerId, sellerUserId, conversationId: created.data.data.id as string };
  }

  function typingFrame(ws: WebSocket, conversationId: string, typing: boolean) {
    ws.send(JSON.stringify({ type: "chat:typing", data: { conversationId, typing } }));
  }

  testFn("typing start reaches the other participant and not the sender", async () => {
    const { customerId, sellerUserId, conversationId } = await seedShopThread("typing");

    const customerSocket = await openSocket(harness.wsUrl, tokenFor(customerId));
    const sellerSocket = await openSocket(harness.wsUrl, tokenFor(sellerUserId));
    try {
      typingFrame(customerSocket.ws, conversationId, true);

      const frame = await sellerSocket.frames.waitFor((f) => f.type === "chat:typing");
      expect(frame.data.conversationId).toBe(conversationId);
      expect(frame.data.userId).toBe(customerId);
      expect(frame.data.typing).toBe(true);

      // Never echoed back to the person typing.
      expect(await customerSocket.frames.has((f) => f.type === "chat:typing")).toBe(false);
    } finally {
      customerSocket.ws.close();
      sellerSocket.ws.close();
    }
  });

  testFn("typing stop is delivered so the indicator can disappear", async () => {
    const { customerId, sellerUserId, conversationId } = await seedShopThread("typing-stop");

    const customerSocket = await openSocket(harness.wsUrl, tokenFor(customerId));
    const sellerSocket = await openSocket(harness.wsUrl, tokenFor(sellerUserId));
    try {
      typingFrame(customerSocket.ws, conversationId, true);
      await sellerSocket.frames.waitFor((f) => f.type === "chat:typing" && f.data.typing === true);

      typingFrame(customerSocket.ws, conversationId, false);
      const stop = await sellerSocket.frames.waitFor(
        (f) => f.type === "chat:typing" && f.data.typing === false,
      );
      expect(stop.data.conversationId).toBe(conversationId);
    } finally {
      customerSocket.ws.close();
      sellerSocket.ws.close();
    }
  });

  testFn("it works in both directions", async () => {
    const { customerId, sellerUserId, conversationId } = await seedShopThread("typing-both");

    const customerSocket = await openSocket(harness.wsUrl, tokenFor(customerId));
    const sellerSocket = await openSocket(harness.wsUrl, tokenFor(sellerUserId));
    try {
      typingFrame(sellerSocket.ws, conversationId, true);
      const toCustomer = await customerSocket.frames.waitFor((f) => f.type === "chat:typing");
      expect(toCustomer.data.userId).toBe(sellerUserId);

      typingFrame(customerSocket.ws, conversationId, true);
      const toSeller = await sellerSocket.frames.waitFor(
        (f) => f.type === "chat:typing" && f.data.userId === customerId,
      );
      expect(toSeller.data.typing).toBe(true);
    } finally {
      customerSocket.ws.close();
      sellerSocket.ws.close();
    }
  });

  testFn("a non-participant never reaches the conversation", async () => {
    const { customerId, sellerUserId, conversationId } = await seedShopThread("typing-outsider");
    const outsiderId = await makeUser("customer", "typing-outsider-bystander");

    const sellerSocket = await openSocket(harness.wsUrl, tokenFor(sellerUserId));
    const outsiderSocket = await openSocket(harness.wsUrl, tokenFor(outsiderId));
    try {
      typingFrame(outsiderSocket.ws, conversationId, true);
      expect(await sellerSocket.frames.has((f) => f.type === "chat:typing")).toBe(false);

      // A staff member is not a participant of a PRIVATE customer↔seller thread
      // either: the frame must be refused by the same authorization.
      const staffId = await makeUser("staff", "typing-outsider-staff");
      const staffSocket = await openSocket(harness.wsUrl, tokenFor(staffId));
      try {
        typingFrame(staffSocket.ws, conversationId, true);
        expect(await sellerSocket.frames.has((f) => f.type === "chat:typing")).toBe(false);
        expect(await customerId).toBeDefined();
      } finally {
        staffSocket.ws.close();
      }
    } finally {
      sellerSocket.ws.close();
      outsiderSocket.ws.close();
    }
  });

  testFn("typing is never persisted", async () => {
    const { customerId, sellerUserId, conversationId } = await seedShopThread("typing-store");
    const { query } = await import("../db/index.js");
    const before = await query("SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id = $1", [
      conversationId,
    ]);

    const customerSocket = await openSocket(harness.wsUrl, tokenFor(customerId));
    const sellerSocket = await openSocket(harness.wsUrl, tokenFor(sellerUserId));
    try {
      typingFrame(customerSocket.ws, conversationId, true);
      typingFrame(customerSocket.ws, conversationId, false);
      await sellerSocket.frames.waitFor((f) => f.type === "chat:typing");
    } finally {
      customerSocket.ws.close();
      sellerSocket.ws.close();
    }

    const after = await query("SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id = $1", [
      conversationId,
    ]);
    expect(after.rows[0].n).toBe(before.rows[0].n);
  });
});
