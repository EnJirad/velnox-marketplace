/**
 * PHASE 2D — CHAT / SUPPORT FUNDAMENTALS + UNREAD BADGE
 *
 * What this file pins, and why each claim is the one that matters:
 *
 *   1. Message ownership and sender identity come from the SESSION: a customer
 *      reaches only their own conversations, a seller only their own shop's,
 *      and a client-supplied `senderId`/`senderRole` is ignored.
 *   2. Validation is server-side: empty and whitespace-only bodies are 400,
 *      never a row.
 *   3. A retried submission (same `clientId`) replays the stored message —
 *      one row, one realtime push, one notification row, never two.
 *   4. Read state is BOUNDED by `upTo` (the server timestamp of what the reader
 *      actually loaded): a message created after that bound stays unread, so a
 *      stale read request can never swallow a new message.
 *   5. Unread counts are server-derived, ownership-scoped (customer sees only
 *      theirs, seller only theirs), correct, never negative, and separate from
 *      notification rows.
 *   6. The badge surface never renders a fake zero: `null` renders nothing, an
 *      error keeps the last known-good count, and the number comes from the
 *      existing endpoints — no new endpoint, no polling, no second socket.
 *
 * Structure: the structural half needs no database; the behavioural half drives
 * the REAL routes and a REAL WebSocket server and skips unless a safe
 * `TEST_DATABASE_URL` is configured. No production credential is ever read.
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
const INDEX_ROUTE = "backend/routes/index.ts";
const API_ROUTES = "packages/shared/src/lib/api-routes.ts";
const UNREAD_HOOK = "packages/shared/src/hooks/use-chat-unread.ts";
const HEADER = "packages/shared/src/components/AppHeader.tsx";
const PROFILE = "apps/velshop/src/pages/ShopProfile.tsx";
const SHOP_CHAT = "apps/velshop/src/pages/ShopChat.tsx";
const SELLER_CHAT = "apps/velseller/src/pages/SellerChat.tsx";
const SOCKET = "packages/shared/src/lib/chat-socket.ts";

/** Every index at which `needle` occurs in `src`, ascending. */
function allIndices(src: string, needle: string): number[] {
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const i = src.indexOf(needle, from);
    if (i < 0) return out;
    out.push(i);
    from = i + needle.length;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. The wiring, structurally (no database)
// ═══════════════════════════════════════════════════════════════════════════

describe("message sending: session identity + server-side validation", () => {
  const chat = read(CHAT);

  test("the sender is the authenticated session, never a client field", () => {
    // Both send routes resolve the sender from requireAuth's payload…
    expect(chat.split("const userId = req.user!.userId;").length - 1).toBeGreaterThanOrEqual(2);
    // …and the role is a route literal handed to the ONE durable insert helper —
    // nothing the body carries can promote a customer to a seller or impersonate
    // the other side of the thread.
    expect(chat).toContain('senderRole: "customer"');
    expect(chat).toContain('senderRole: "seller"');
    expect(chat).not.toMatch(/req\.body[^)]*senderId/);
    expect(chat).not.toMatch(/req\.body[^)]*sender_role/);
  });

  test("empty and whitespace-only bodies are refused BEFORE any insert", () => {
    const validates = allIndices(chat, "validateBody(req.body?.body)");
    // The TWO human send inserts. The daily acknowledgment is a third
    // `INSERT INTO chat_messages`, written by the SYSTEM after the customer's
    // message is already stored, so it is deliberately not counted here.
    const inserts = allIndices(chat, "await insertHumanMessage({");
    expect(validates.length).toBe(2);
    expect(inserts.length).toBe(2);
    // Route order is customer-send then seller-send; each validation precedes
    // its own insert, so a rejected body can never reach the table.
    expect(validates[0]!).toBeLessThan(inserts[0]!);
    expect(validates[1]!).toBeLessThan(inserts[1]!);
    // The validator trims first: " " is empty, not a message.
    expect(chat).toContain("const trimmed = body.trim();");
    expect(chat).toContain("if (trimmed.length === 0 || trimmed.length > 4000) return null;");
  });

  test("conversation access is scoped server-side for both roles", () => {
    // Customer routes join on the caller's own user id…
    expect(chat).toContain("AND c.customer_id = $2");
    // …seller routes on the seller row resolved from the caller's session.
    expect(chat).toContain("getSellerForUser(req.user!.userId)");
    expect(chat).toContain("WHERE c.seller_id = $2");
    expect(chat).toContain("AND seller_id = $2");
    expect(chat).toContain('res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not an approved seller" } });');
  });
});

describe("a retried send replays instead of duplicating", () => {
  const chat = read(CHAT);

  test("the duplicate check runs before the insert, in both send routes", () => {
    const checks = allIndices(chat, "replaySend(dedupeKey)");
    const replies = allIndices(chat, "data: { message: duplicate, clientId, duplicate: true }");
    // The two HUMAN sends only: the daily acknowledgment has its own INSERT but
    // is never reached by a retried request (it is claimed after the message).
    const inserts = allIndices(chat, "await insertHumanMessage({");
    const stores = allIndices(chat, "if (dedupeKey) rememberSend(dedupeKey, message);");
    expect(checks.length).toBe(2);
    expect(replies.length).toBe(2);
    expect(inserts.length).toBe(2);
    expect(stores.length).toBe(2);
    for (let i = 0; i < 2; i += 1) {
      // claim → (replay answers and returns here) → insert → store
      expect(checks[i]!).toBeLessThan(replies[i]!);
      expect(replies[i]!).toBeLessThan(inserts[i]!);
      expect(inserts[i]!).toBeLessThan(stores[i]!);
    }
  });

  test("a replay answers before any push or notification can fire again", () => {
    const reply = chat.indexOf("data: { message: duplicate, clientId, duplicate: true }");
    // Search FORWARD from the reply: the shared `notifyCompanyStaff` helper also
    // contains a `notifyUser` call, and that helper lives above the routes.
    const push = chat.indexOf("CHANNELS.CHAT_MESSAGE", reply);
    expect(reply).toBeGreaterThan(-1);
    expect(reply).toBeLessThan(push);
    // Chat writes NO notification row at all (2026-11 owner rule: the bell is
    // for business events), so a replay cannot fire a bell nudge either.
    expect(chat).not.toContain("await notifyUser(");
    // The claim key ties the retry to conversation + SESSION user + clientId.
    expect(chat).toContain("const dedupeKey = clientId ? `${conversationId}:${userId}:${clientId}` : null;");
    // Bounded in time and size, and honest about the restart caveat in-line.
    expect(chat).toContain("const SEND_DEDUPE_TTL_MS = 10 * 60 * 1000;");
    expect(chat).toContain("const SEND_DEDUPE_MAX_ENTRIES = 1000;");
    expect(chat).toContain("a restart of this process forgets the map");
  });

  test("no schema, DDL or second table is introduced for chat", () => {
    expect(chat).not.toContain("CREATE TABLE");
    expect(chat).not.toContain("CREATE INDEX");
    expect(chat).not.toContain("ALTER TABLE");
    expect(chat).not.toContain("DROP ");
    // Chat stays on the ONE realtime fan-out: addressed sends, no broadcast.
    expect(chat).not.toContain("broadcast(");
    expect(chat).toContain('sendToUser(conv.seller_user_id, "", CHANNELS.CHAT_MESSAGE');
    expect(chat).toContain('sendToUser(conv.customer_id, "", CHANNELS.CHAT_MESSAGE');
  });
});

describe("read is bounded to what the reader actually loaded", () => {
  const chat = read(CHAT);
  const apiRoutes = read(API_ROUTES);

  test("both read routes cap the UPDATE at the caller's upTo", () => {
    expect(allIndices(chat, "const upTo = readUpTo(req);").length).toBe(2);
    // The bound is applied at the precision it actually carries. `createdAt`
    // reaches clients as epoch MILLISECONDS (`mapMessage` → `new Date(...)`)
    // while `created_at` is a microsecond TIMESTAMPTZ: a strict
    // `created_at <= upTo` EXCLUDED the very message the bound was derived from
    // (…:123456 is not <= …:123000), so a bounded read marked nothing and the
    // thread never cleared. The whole named millisecond is covered instead.
    expect(chat).toContain("createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now()");
    expect(chat).toContain(
      "const READ_BOUND_SQL = ` AND created_at < to_timestamp($3::double precision / 1000) + interval '1 millisecond'`;",
    );
    // ONE fragment, used by BOTH read routes — the two cannot drift apart.
    expect(allIndices(chat, "markSql += READ_BOUND_SQL;").length).toBe(2);
    expect(chat).not.toContain("created_at <= to_timestamp(");
    // Only the OTHER side's messages are ever marked — the reader's own stay.
    expect(allIndices(chat, "sender_id <> $2 AND read_at IS NULL").length).toBe(2);
    // Absent upTo keeps the previous unbounded behaviour (old client compat);
    // a present-but-unusable value is a 400, never a silently dropped bound.
    expect(chat).toContain("if (upTo !== null) {");
    expect(chat).toContain('res.status(400).json(READ_BOUND_INVALID);');
    expect(chat).toContain('error: { code: "VALIDATION_ERROR", message: "upTo must be an epoch-ms timestamp" }');
  });

  test("the frontend forwards the bound it derived from the loaded page", () => {
    // Customer, seller and company reads all forward the SAME `upTo` bound.
    expect(apiRoutes.split("{ upTo: a?.upTo })").length - 1).toBe(3);
    for (const page of [SHOP_CHAT, SELLER_CHAT]) {
      const src = read(page);
      // Bound by the SERVER timestamp of the newest loaded message…
      expect(src).toContain("markConversationRead({ conversationId: conv.id, upTo })");
      // …and, for a live message, by that message's own server timestamp.
      expect(src).toContain("upTo: message.createdAt");
      // A failed read is logged, never an unhandled rejection, and the badge is
      // refreshed only after the read actually succeeded.
      expect(src).toContain('.catch((err) => console.error("Mark conversation read failed:", err));');
      expect(src).toContain('notifyChatUnreadChanged(');
    }
  });
});

describe("the badge is server-derived, event-driven and never a fake zero", () => {
  const hook = read(UNREAD_HOOK);
  const apiRoutes = read(API_ROUTES);

  test("it reuses existing counts; only the company tabs add an aggregate", () => {
    expect(hook).toContain("api.customer.accountSummary()");
    expect(hook).toContain("api.seller.sellerConversations()");
    // The hook only ever goes through the route table: no ad-hoc URL, no
    // hand-rolled fetch, nothing that could bypass the shared API surface.
    expect(hook).not.toContain("fetch(");
    expect(hook).not.toContain("apiPost");
    // The customer and seller surfaces still have NO invented unread endpoint —
    // their counts come from account-summary / the conversation rows. The company
    // tabs genuinely need one aggregate across three conversation types, and it
    // is served by the same chat core (`routes/center-chat.ts`).
    expect(apiRoutes).not.toMatch(/"api\.(customer|seller)\.[^"]*unread/i);
    expect(apiRoutes).toContain('apiGetFresh("/api/center/chat/unread")');
    // account-summary answers fresh: a cached count is a wrong badge.
    expect(apiRoutes).toContain('apiGetFresh("/api/customer/account-summary")');
  });

  test("counting is ownership-scoped on the server, and chat-only", () => {
    const index = read(INDEX_ROUTE);
    // Customer aggregate: this customer's conversations, seller-side messages only.
    expect(index).toContain("WHERE c.customer_id = $1 AND m.sender_role = 'seller' AND m.read_at IS NULL");
    // Seller aggregate: sums per-conversation counts the server computed for
    // THIS seller — the browser never decides which conversations to count.
    expect(hook).toContain("Number(row?.unreadCount)");
    // Chat unread never reads notification rows (the bell owns those).
    expect(hook).not.toContain("myNotifications");
    expect(hook).not.toContain("notificationsUnread");
    expect(hook).not.toContain("setInterval");
  });

  test("unknown stays unknown: loading and error render nothing, never 0", () => {
    expect(hook).toContain("const IDLE: ChatUnreadState = { count: null, status: \"loading\" };");
    // An unusable payload THROWS instead of falling back to a number.
    expect(hook).toContain('throw new Error("chatUnread unavailable");');
    // A failed refresh keeps the last known-good count…
    expect(hook).toContain("setState({ count: state.count, status: \"error\" });");
    // …and a different account can never inherit the previous one's number.
    expect(hook).toContain("if (ownerUserId !== userId || ownerViewer !== viewer) {");
    expect(hook).toContain("ownerUserId !== userId || ownerViewer !== viewer");
  });

  test("it rides the existing shared socket — no polling, no second client", () => {
    expect(hook).toContain('onChatEvent("chat:message"');
    expect(hook).toContain("onChatReconnect(");
    expect(hook).not.toContain("new WebSocket(");
    expect(hook).not.toContain("setInterval(");
    // Coalesced refetch: a burst of messages never piles up requests.
    expect(hook).toContain("if (inFlight) {");
  });

  test("the chat pages drive the badge after their OWN read, not before", () => {
    for (const page of [SHOP_CHAT, SELLER_CHAT]) {
      const src = read(page);
      // `notify` sits INSIDE the success continuation of the read request —
      // the badge is refreshed only after the server confirmed the read.
      expect(src.split(".then(() => notifyChatUnreadChanged(").length - 1).toBe(2);
      expect(src).toContain('notifyChatUnreadChanged(');
    }
    expect(read(SHOP_CHAT)).toContain('notifyChatUnreadChanged("customer")');
    expect(read(SELLER_CHAT)).toContain('notifyChatUnreadChanged("seller")');
  });
});

describe("the badges render only a confirmed, positive count", () => {
  const header = read(HEADER);
  const profile = read(PROFILE);

  test("seller: both chat entries (desktop nav + <lg icon) carry the badge", () => {
    expect(header).toContain('useChatUnread("seller")');
    // Gated on a real positive number — `null` renders nothing at all.
    expect(header).toContain("const unread = chatUnread != null && chatUnread > 0 ? chatUnread : null;");
    // The convention in this codebase for large counts.
    expect(header).toContain("{unread > 99 ? \"99+\" : unread}");
    // Desktop nav entry (lg+) and the always-visible phone/tablet action.
    expect(header).toContain('{item.to === "/seller/chat" && chatBadge}');
    expect(header).toContain("absolute right-0 top-0 flex h-4 min-w-4");
    // The count is in the accessible name too.
    expect(header).toContain("`แชท (${unread})`");
  });

  test("customer: the profile chat row shows the count, chat≠notifications", () => {
    expect(profile).toContain('useChatUnread("customer")');
    expect(profile).toContain('row.to === \"/chat\"');
    // The notifications row still counts notification rows only.
    expect(profile).toContain('row.to === "/notifications"');
    expect(profile).toContain("notifications?.filter((n) => !n.isRead).length ?? 0");
  });
});

describe("chat keeps the Phase 2A transport and reconnect contract", () => {
  test("the ONE shared socket is still the only browser connection", () => {
    const socket = read(SOCKET);
    expect(socket.split("new WebSocket(").length - 1).toBe(1);
    let appSockets = 0;
    for (const file of new Bun.Glob("apps/**/*.{ts,tsx}").scanSync({ cwd: root })) {
      appSockets += read(file).split("new WebSocket(").length - 1;
    }
    expect(appSockets).toBe(0);
    expect(socket).toContain("function subscribeAll(): void {");
    expect(socket).toContain("notifyReconnect();");
  });

  test("chat pages never own the transport and refetch (replacing) after reconnect", () => {
    for (const page of [SHOP_CHAT, SELLER_CHAT]) {
      const src = read(page);
      expect(src).not.toContain("disconnectChatSocket(");
      expect(src).toContain("onChatReconnect(");
      // REPLACE, never append: a reconnect can't duplicate the list or a message.
      expect(src).toContain("setConversations((res ?? []) as Conversation[]);");
      expect(src).toContain("setMessages((res.items ?? []) as ChatMessage[]);");
      // Live messages are deduped by id before they land in the open thread —
      // now through the ONE shared helper every app renders from.
      expect(src).toContain("mergeIncomingMessage(prev, message)");
    }
  });

  test("a send failure keeps the draft and reuses the clientId on retry", () => {
    for (const page of [SHOP_CHAT, SELLER_CHAT]) {
      const src = read(page);
      expect(src).toContain("retryRef.current = { clientId, body };");
      expect(src).toContain("setDraft(body);");
      // Same text → same clientId; a different text gets a fresh one.
      expect(src).toContain("retry && retry.body === body");
      // The retry state clears only when the server accepted the send.
      expect(src).toContain("retryRef.current = null;");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The behaviour, against the REAL routes (requires TEST_DATABASE_URL)
// ═══════════════════════════════════════════════════════════════════════════

interface Harness {
  httpUrl: string;
  wsUrl: string;
  close: () => Promise<void>;
}

/** A real HTTP + WebSocket server running the real chat routes. */
async function startChatHarness(): Promise<Harness> {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  const { setupChatRoutes } = await import("../routes/chat.js");
  setupChatRoutes(app);
  // The customer unread badge reads GET /api/customer/account-summary, which
  // lives in the main route table (routes/index.ts) — mount the REAL router, so
  // the endpoint under test is the shipped one (including its requireAuth gate),
  // never a stand-in defined here.
  const { setupRoutes } = await import("../routes/index.js");
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

/** Collect frames so a test can await the one it is looking for. */
function collector(ws: WebSocket) {
  const frames: any[] = [];
  const waiters: Array<{ match: (frame: any) => boolean; resolve: (frame: any) => void }> = [];
  ws.on("message", (raw) => {
    let frame: any;
    try {
      frame = JSON.parse(String(raw));
    } catch {
      return;
    }
    frames.push(frame);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i]!.match(frame)) waiters.splice(i, 1)[0]!.resolve(frame);
    }
  });

  const waitFor = (match: (frame: any) => boolean, timeoutMs = 5000): Promise<any> => {
    const found = frames.find((frame) => match(frame));
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("timed out waiting for a frame")), timeoutMs);
      waiters.push({
        match,
        resolve: (frame) => {
          clearTimeout(timer);
          resolve(frame);
        },
      });
    });
  };

  return {
    frames,
    waitFor,
    /** Settle, then report whether ANY frame matched — used for "nothing arrived". */
    async has(match: (frame: any) => boolean): Promise<boolean> {
      await new Promise((r) => setTimeout(r, 250));
      return frames.some((frame) => match(frame));
    },
  };
}

function openSocket(wsUrl: string, token: string): Promise<{ ws: WebSocket; frames: ReturnType<typeof collector> }> {
  const ws = new WebSocket(wsUrl, { headers: { cookie: `velnox_session=${token}` } });
  const frames = collector(ws);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve({ ws, frames }));
    ws.once("error", reject);
  });
}

const describeDb = hasTestDatabase() ? describe : describe.skip;
const testFn = hasTestDatabase() ? test : test.skip;

describeDb("chat support, end to end (requires TEST_DATABASE_URL)", () => {
  const fixtureUsers: Array<string | null> = [];
  let harness: Harness;

  beforeAll(async () => {
    harness = await startChatHarness();
  });

  afterAll(async () => {
    await harness?.close();
    // Conversations and messages cascade from users (ON DELETE CASCADE), so the
    // shared purge helper removes every fixture this suite created.
    await purgeUsers(fixtureUsers.splice(0));
  });

  async function makeUser(role: string, tag: string): Promise<string> {
    const { query } = await import("../db/index.js");
    const res = await query(
      `INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id`,
      [`p2d-${tag}-${crypto.randomUUID().slice(0, 8)}@test.invalid`, `P2D ${tag}`, role],
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
    shopId: string;
  }

  /** An approved seller with a shop and a fresh customer for this tag. */
  async function seedPair(tag: string): Promise<Pair> {
    const { query } = await import("../db/index.js");
    const customerId = await makeUser("customer", `${tag}-buyer`);
    const sellerUserId = await makeUser("seller", `${tag}-seller`);
    const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [
      sellerUserId,
    ]);
    const shop = await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
      seller.rows[0].id,
      `P2D ${tag} shop`,
      `p2d-${tag}-${crypto.randomUUID().slice(0, 6)}`,
    ]);
    return { customerId, sellerUserId, shopId: shop.rows[0].id };
  }

  async function openConversation(pair: Pair): Promise<string> {
    const res = await call("POST", "/api/customer/conversations", pair.customerId, { shopId: pair.shopId });
    expect(res.status).toBe(200);
    return res.data.data.id;
  }

  async function send(
    role: "customer" | "seller",
    userId: string,
    conversationId: string,
    body: string,
    clientId?: string,
  ) {
    const path =
      role === "customer"
        ? `/api/customer/conversations/${conversationId}/messages`
        : `/api/seller/conversations/${conversationId}/messages`;
    return call("POST", path, userId, { body, clientId });
  }

  async function readThread(role: "customer" | "seller", userId: string, conversationId: string, upTo?: number) {
    const path =
      role === "customer"
        ? `/api/customer/conversations/${conversationId}/read`
        : `/api/seller/conversations/${conversationId}/read`;
    return call("POST", path, userId, upTo === undefined ? {} : { upTo });
  }

  async function customerUnread(userId: string): Promise<number> {
    const res = await call("GET", "/api/customer/account-summary", userId);
    expect(res.status).toBe(200);
    return res.data.data.chatUnread as number;
  }

  async function sellerUnread(userId: string): Promise<number> {
    const res = await call("GET", "/api/seller/conversations", userId);
    expect(res.status).toBe(200);
    const rows = res.data.data as Array<{ unreadCount?: number }>;
    return rows.reduce((sum, row) => sum + (row.unreadCount ?? 0), 0);
  }

  testFn("every chat endpoint refuses an unauthenticated caller", async () => {
    for (const [method, path, body] of [
      ["GET", "/api/customer/conversations", undefined],
      ["GET", "/api/seller/conversations", undefined],
      ["GET", "/api/customer/account-summary", undefined],
      ["POST", "/api/customer/conversations", { shopId: "x" }],
      ["POST", "/api/customer/conversations/00000000-0000-4000-8000-000000000000/messages", { body: "hi" }],
      ["POST", "/api/customer/conversations/00000000-0000-4000-8000-000000000000/read", {}],
      ["POST", "/api/seller/conversations/00000000-0000-4000-8000-000000000000/messages", { body: "hi" }],
    ] as Array<[string, string, unknown]>) {
      const res = await call(method, path, undefined, body);
      expect(res.status).toBe(401);
    }
  });

  testFn("customer B and seller B cannot reach customer A's conversation", async () => {
    const a = await seedPair("iso-a");
    const convId = await openConversation(a);
    const customerB = await makeUser("customer", "iso-cb");
    const sellerBUser = await makeUser("seller", "iso-sb");
    const { query } = await import("../db/index.js");
    // sellerB must be an approved seller for its endpoints to answer 404 rather
    // than 403 — the isolation claim is about ownership, not seller status.
    await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved')`, [sellerBUser]);

    // Stranger reads: 404, never another user's messages.
    expect((await call("GET", `/api/customer/conversations/${convId}/messages`, customerB)).status).toBe(404);
    expect((await call("POST", `/api/customer/conversations/${convId}/messages`, customerB, { body: "peek" })).status).toBe(404);
    expect((await call("POST", `/api/customer/conversations/${convId}/read`, customerB, {})).status).toBe(404);
    expect((await call("GET", `/api/seller/conversations/${convId}/messages`, sellerBUser)).status).toBe(404);
    expect((await call("POST", `/api/seller/conversations/${convId}/read`, sellerBUser, {})).status).toBe(404);

    // Stranger lists never contain the conversation; the owner's list does.
    const bList = await call("GET", "/api/customer/conversations", customerB);
    expect((bList.data.data as Array<{ id: string }>).some((c) => c.id === convId)).toBe(false);
    const aList = await call("GET", "/api/customer/conversations", a.customerId);
    expect((aList.data.data as Array<{ id: string }>).some((c) => c.id === convId)).toBe(true);
    const sbList = await call("GET", "/api/seller/conversations", sellerBUser);
    expect((sbList.data.data as Array<{ id: string }>).some((c) => c.id === convId)).toBe(false);
    const saList = await call("GET", "/api/seller/conversations", a.sellerUserId);
    expect((saList.data.data as Array<{ id: string }>).some((c) => c.id === convId)).toBe(true);
  });

  testFn("empty and whitespace-only messages are rejected, never persisted", async () => {
    const pair = await seedPair("valid");
    const convId = await openConversation(pair);

    for (const body of ["", "   ", "\n\t  \n"]) {
      const res = await send("customer", pair.customerId, convId, body);
      expect(res.status).toBe(400);
    }
    const sellerRes = await send("seller", pair.sellerUserId, convId, "   ");
    expect(sellerRes.status).toBe(400);

    const { query } = await import("../db/index.js");
    const rows = await query(`SELECT COUNT(*)::int AS c FROM chat_messages WHERE conversation_id = $1`, [convId]);
    expect(rows.rows[0].c).toBe(0);
  });

  testFn("sender identity comes from the session even when the body lies", async () => {
    const pair = await seedPair("ident");
    const convId = await openConversation(pair);

    const res = await send("customer", pair.customerId, convId, "hello from me");
    // The direct call above sends only body+clientId; forge the fields too.
    const forged = await call(
      "POST",
      `/api/customer/conversations/${convId}/messages`,
      pair.customerId,
      { body: "spoof attempt", senderId: pair.sellerUserId, senderRole: "seller" },
    );
    expect(forged.status).toBe(200);
    expect(forged.data.data.message.senderId).toBe(pair.customerId);
    expect(forged.data.data.message.senderRole).toBe("customer");
    expect(res.status).toBe(200);
    expect(res.data.data.message.senderId).toBe(pair.customerId);

    const { query } = await import("../db/index.js");
    const rows = await query(
      `SELECT sender_id, sender_role, created_at, status FROM chat_messages
        WHERE conversation_id = $1 AND body = 'spoof attempt'`,
      [convId],
    );
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].sender_id).toBe(pair.customerId);
    expect(rows.rows[0].sender_role).toBe("customer");
    expect(rows.rows[0].created_at).toBeTruthy();
    expect(rows.rows[0].status).toBe("sent");
  });

  testFn("a retried send creates one message, one push and NO bell notification", async () => {
    const pair = await seedPair("dup");
    const convId = await openConversation(pair);
    const clientId = crypto.randomUUID();

    const first = await send("customer", pair.customerId, convId, "did you get this?", clientId);
    expect(first.status).toBe(200);
    const firstId = first.data.data.message.id as string;

    const second = await send("customer", pair.customerId, convId, "did you get this?", clientId);
    expect(second.status).toBe(200);
    expect(second.data.data.duplicate).toBe(true);
    expect(second.data.data.message.id).toBe(firstId);

    const { query } = await import("../db/index.js");
    const messages = await query(`SELECT COUNT(*)::int AS c FROM chat_messages WHERE conversation_id = $1`, [convId]);
    expect(messages.rows[0].c).toBe(1);
    // NO notification row, for this send or the retry: chat unread is a
    // per-conversation state in Messages, and the global bell is business-only
    // (owner rule 2026-11). The realtime push above is the only signal.
    const notes = await query(
      `SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND type = 'chat'`,
      [pair.sellerUserId],
    );
    expect(notes.rows[0].c).toBe(0);

    // A fresh clientId is a genuinely new submission: it does store.
    const third = await send("customer", pair.customerId, convId, "one more", crypto.randomUUID());
    expect(third.status).toBe(200);
    expect(third.data.data.duplicate).toBeUndefined();
    const after = await query(`SELECT COUNT(*)::int AS c FROM chat_messages WHERE conversation_id = $1`, [convId]);
    expect(after.rows[0].c).toBe(2);
    // A brand-new message is still a Messages-only event.
    const notesAfter = await query(
      `SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND type = 'chat'`,
      [pair.sellerUserId],
    );
    expect(notesAfter.rows[0].c).toBe(0);
  });

  testFn("repeated get-or-create returns the same conversation", async () => {
    const pair = await seedPair("getorcreate");
    const first = await openConversation(pair);
    const second = await openConversation(pair);
    expect(second).toBe(first);

    const { query } = await import("../db/index.js");
    const rows = await query(`SELECT COUNT(*)::int AS c FROM conversations WHERE customer_id = $1`, [
      pair.customerId,
    ]);
    expect(rows.rows[0].c).toBe(1);
  });

  testFn("unread counts are correct, and a stale read never swallows a new message", async () => {
    const pair = await seedPair("unread");
    const convId = await openConversation(pair);

    // Zero before anything arrives.
    expect(await customerUnread(pair.customerId)).toBe(0);
    expect(await sellerUnread(pair.sellerUserId)).toBe(0);

    // Seller sends → customer has exactly one unread; the SELLER's own unread
    // is still 0 (outgoing messages are not unread for their sender).
    const m1 = await send("seller", pair.sellerUserId, convId, "first from shop");
    expect(m1.status).toBe(200);
    const m1At = m1.data.data.message.createdAt as number;
    expect(await customerUnread(pair.customerId)).toBe(1);
    expect(await sellerUnread(pair.sellerUserId)).toBe(0);

    // The customer reads exactly what was loaded → clears to zero.
    const read1 = await readThread("customer", pair.customerId, convId, m1At);
    expect(read1.status).toBe(200);
    expect(read1.data.data.marked).toBe(1);
    expect(await customerUnread(pair.customerId)).toBe(0);

    // A new message arrives AFTER that read → unread again (increment).
    await new Promise((r) => setTimeout(r, 10));
    const m2 = await send("seller", pair.sellerUserId, convId, "second from shop");
    expect(m2.status).toBe(200);
    expect(await customerUnread(pair.customerId)).toBe(1);

    // THE RACE: a read request bound to the OLD message must NOT clear the new
    // one — marked 0, unread stays 1.
    const staleRead = await readThread("customer", pair.customerId, convId, m1At);
    expect(staleRead.status).toBe(200);
    expect(staleRead.data.data.marked).toBe(0);
    expect(await customerUnread(pair.customerId)).toBe(1);

    // An unusable bound is a 400, never a silently unbounded mark-all. The probe
    // must use values the wire really carries: a NaN serializes to `null` in
    // JSON, which is the ABSENT "legacy" case (200 mark-all), not an unusable one.
    for (const unusable of [-1, "not-a-timestamp"] as const) {
      const badBound = await call("POST", `/api/customer/conversations/${convId}/read`, pair.customerId, {
        upTo: unusable,
      });
      expect(badBound.status).toBe(400);
    }
    expect(await customerUnread(pair.customerId)).toBe(1);

    // Reading with the NEW message's timestamp clears it.
    const read2 = await readThread("customer", pair.customerId, convId, m2.data.data.message.createdAt as number);
    expect(read2.status).toBe(200);
    expect(read2.data.data.marked).toBe(1);
    expect(await customerUnread(pair.customerId)).toBe(0);

    // The seller side mirrors it: the customer's own message is unread for the
    // seller, and the seller's read clears it.
    const m3 = await send("customer", pair.customerId, convId, "question for the shop");
    expect(m3.status).toBe(200);
    expect(await sellerUnread(pair.sellerUserId)).toBe(1);
    const sellerRead = await readThread("seller", pair.sellerUserId, convId, m3.data.data.message.createdAt as number);
    expect(sellerRead.status).toBe(200);
    expect(sellerRead.data.data.marked).toBe(1);
    expect(await sellerUnread(pair.sellerUserId)).toBe(0);
  });

  testFn("unread counts never leak across customers or shops", async () => {
    const a = await seedPair("leak-a");
    const b = await seedPair("leak-b");
    const convA = await openConversation(a);
    await openConversation(b);

    // One message each way in pair A: the seller's message is unread for
    // customer A alone, the customer's reply for seller A alone (a sender's own
    // message is never unread for them — pinned above). Pair B, whose thread
    // stays empty, must read zero on BOTH sides: A's non-zero counts may never
    // surface for another customer or another shop.
    await send("seller", a.sellerUserId, convA, "only for customer A");
    await send("customer", a.customerId, convA, "only for shop A");

    expect(await customerUnread(a.customerId)).toBe(1);
    expect(await sellerUnread(a.sellerUserId)).toBe(1);
    expect(await customerUnread(b.customerId)).toBe(0);
    expect(await sellerUnread(b.sellerUserId)).toBe(0);
  });

  testFn("an incoming message and a read receipt reach only the counterparty", async () => {
    const a = await seedPair("rt");
    const convId = await openConversation(a);
    const strangerId = await makeUser("customer", "rt-stranger");

    const sellerSock = await openSocket(harness.wsUrl, tokenFor(a.sellerUserId));
    const strangerSock = await openSocket(harness.wsUrl, tokenFor(strangerId));
    // Open BEFORE the read: an addressed frame has no queue — it is delivered
    // only to connections that exist at that moment.
    const customerSock = await openSocket(harness.wsUrl, tokenFor(a.customerId));
    try {
      const sent = await send("customer", a.customerId, convId, "ping for the seller");
      expect(sent.status).toBe(200);

      const frame = await sellerSock.frames.waitFor((f) => f.type === "chat:message");
      expect(frame.type).toBe("chat:message");
      // The frame arrives on the RECIPIENT's private channel — the addressed
      // delivery path from Phase 2A/2C (`sendToUser` with no explicit channel),
      // never a shared broadcast channel another socket could subscribe to.
      expect(frame.channel).toBe(`user:${a.sellerUserId}`);
      expect(frame.data.conversationId).toBe(convId);
      expect(frame.data.message.body).toBe("ping for the seller");
      expect(frame.data.message.senderId).toBe(a.customerId);

      // A different user's socket receives NOTHING — delivery is addressed to
      // the conversation's participants, never broadcast.
      expect(await strangerSock.frames.has((f) => f.type === "chat:message")).toBe(false);

      // The seller's read is pushed to the customer's own channel only.
      const read = await readThread("seller", a.sellerUserId, convId);
      expect(read.status).toBe(200);
      const readFrame = await customerSock.frames.waitFor((f) => f.type === "chat:read");
      expect(readFrame.data.conversationId).toBe(convId);
      expect(readFrame.data.readerId).toBe(a.sellerUserId);
      expect(await strangerSock.frames.has((f) => f.type === "chat:read")).toBe(false);
    } finally {
      sellerSock.ws.close();
      strangerSock.ws.close();
      customerSock.ws.close();
    }
  });

  testFn("one conversation carries ONE unread state and previews its newest unread message", async () => {
    const pair = await seedPair("preview");
    const convId = await openConversation(pair);
    const sent: any[] = [];
    for (const text of ["Message 1", "Message 2", "Message 3", "Message 4"]) {
      const res = await send("seller", pair.sellerUserId, convId, text);
      expect(res.status).toBe(200);
      sent.push(res.data.data.message);
      // Distinct server timestamps so the unread ordering is real, not a tie.
      await new Promise((r) => setTimeout(r, 5));
    }

    const list = await call("GET", "/api/customer/conversations", pair.customerId);
    const row = (list.data.data as any[]).find((c) => c.id === convId);
    // Four messages, ONE conversation state: nothing is counted twice and the
    // preview is the newest UNREAD message (not the last read one).
    expect(row.unreadCount).toBe(4);
    expect(row.lastMessage).toBe("Message 4");
    expect(row.isSupport).toBe(false);

    // Four messages produced ZERO bell rows: chat unread is not a notification.
    const { query } = await import("../db/index.js");
    const notes = await query(
      `SELECT COUNT(*)::int AS c FROM notifications WHERE user_id = $1 AND type = 'chat'`,
      [pair.customerId],
    );
    expect(notes.rows[0].c).toBe(0);

    // Reading what was loaded clears the badge and keeps the preview.
    const newest = sent[sent.length - 1]!.createdAt as number;
    const read = await readThread("customer", pair.customerId, convId, newest);
    expect(read.status).toBe(200);
    expect(read.data.data.marked).toBe(4);

    const afterRead = await call("GET", "/api/customer/conversations", pair.customerId);
    const afterRow = (afterRead.data.data as any[]).find((c) => c.id === convId);
    expect(afterRow.unreadCount).toBe(0);
    expect(afterRow.lastMessage).toBe("Message 4");

    // Only the NEW messages become unread again.
    await send("seller", pair.sellerUserId, convId, "Message 5");
    await new Promise((r) => setTimeout(r, 5));
    await send("seller", pair.sellerUserId, convId, "Message 6");

    const finalList = await call("GET", "/api/customer/conversations", pair.customerId);
    const finalRow = (finalList.data.data as any[]).find((c) => c.id === convId);
    expect(finalRow.unreadCount).toBe(2);
    expect(finalRow.lastMessage).toBe("Message 6");
  });

  testFn("Support is classified separately from commerce in the same list API", async () => {
    const pair = await seedPair("support-sep");
    const commerceId = await openConversation(pair);
    const support = await call("POST", "/api/customer/support/conversation", pair.customerId, {});
    expect(support.status).toBe(200);
    const supportId = support.data.data.id as string;

    const list = await call("GET", "/api/customer/conversations", pair.customerId);
    const rows = list.data.data as any[];
    // The customer app splits its inbox on THIS flag — support must never be
    // mistaken for a shop thread (and vice versa).
    expect(rows.find((c) => c.id === supportId)?.isSupport).toBe(true);
    expect(rows.find((c) => c.id === commerceId)?.isSupport).toBe(false);
  });
});
