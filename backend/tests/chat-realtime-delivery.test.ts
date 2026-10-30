/**
 * REAL-TIME CHAT DELIVERY — the full path, over the REAL WebSocket.
 *
 * Per conversation type this traces the chain the task asked to trace:
 * HTTP send → row persisted in PostgreSQL → addressed publication → the
 * authorised socket receives `chat:message` carrying the stored message → a
 * socket that is NOT a participant receives nothing.
 *
 * Not a "the connection opened" test: every case asserts on a frame that can
 * only exist if the INSERT committed AND the publisher addressed it correctly.
 *
 * DB-gated: `TEST_DATABASE_URL` only (`helpers/test-db.ts` refuses production).
 * The socket path is the one production runs — `setupWebSocket` on the same HTTP
 * server as the Express routes, exactly like `server.ts`.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "http";
import type { AddressInfo } from "net";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { WebSocketServer, WebSocket } from "ws";

import { setupWebSocket } from "../realtime/index.js";
import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "test-secret-for-chat-delivery-tests!!";

const describeDb = hasTestDatabase() ? describe : describe.skip;
const testFn = hasTestDatabase() ? test : test.skip;

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

/** Collect frames and wait for a predicate — never a bare sleep as an assertion. */
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
    /** Did anything matching arrive at all within a short window? */
    async has(match: (frame: any) => boolean, settleMs = 400): Promise<boolean> {
      await new Promise((resolve) => setTimeout(resolve, settleMs));
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

describeDb("real-time chat delivery (requires TEST_DATABASE_URL)", () => {
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
      `INSERT INTO users (email, name, role, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [`rt-${tag}-${crypto.randomUUID().slice(0, 8)}@test.invalid`, `RT ${tag}`, role],
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
      [seller.rows[0].id, `RT ${tag}`, `rt-${tag}-${crypto.randomUUID().slice(0, 6)}`],
    );
    const created = await call("POST", "/api/customer/conversations", customerId, {
      shopId: shop.rows[0].id,
    });
    expect(created.status).toBe(200);
    return { customerId, sellerUserId, conversationId: created.data.data.id as string };
  }

  // ── CUSTOMER_SELLER ───────────────────────────────────────────────────────
  testFn("customer sends → the SELLER receives the stored message over the socket", async () => {
    const { customerId, sellerUserId, conversationId } = await seedShopThread("rt-cs");

    const sellerSocket = await openSocket(harness.wsUrl, tokenFor(sellerUserId));
    const customerSocket = await openSocket(harness.wsUrl, tokenFor(customerId));
    try {
      const sent = await call(
        "POST",
        `/api/customer/conversations/${conversationId}/messages`,
        customerId,
        { body: "is the blue one in stock?", clientId: crypto.randomUUID() },
      );
      expect(sent.status).toBe(200);
      const storedId = sent.data.data.message.id as string;

      const frame = await sellerSocket.frames.waitFor(
        (f) => f.type === "chat:message" && f.data?.message?.id === storedId,
      );
      expect(frame.data.conversationId).toBe(conversationId);
      expect(frame.data.message.senderId).toBe(customerId);
      expect(frame.data.message.senderRole).toBe("customer");

      // The sender does not need an echo of its own message.
      expect(
        await customerSocket.frames.has(
          (f) => f.type === "chat:message" && f.data?.message?.id === storedId,
        ),
      ).toBe(false);
    } finally {
      sellerSocket.ws.close();
      customerSocket.ws.close();
    }
  });

  testFn("seller replies → the CUSTOMER receives the stored message over the socket", async () => {
    const { customerId, sellerUserId, conversationId } = await seedShopThread("rt-sc");

    const customerSocket = await openSocket(harness.wsUrl, tokenFor(customerId));
    const sellerSocket = await openSocket(harness.wsUrl, tokenFor(sellerUserId));
    try {
      const sent = await call(
        "POST",
        `/api/seller/conversations/${conversationId}/messages`,
        sellerUserId,
        { body: "yes, three left", clientId: crypto.randomUUID() },
      );
      expect(sent.status).toBe(200);
      const storedId = sent.data.data.message.id as string;

      const frame = await customerSocket.frames.waitFor(
        (f) => f.type === "chat:message" && f.data?.message?.id === storedId,
      );
      expect(frame.data.message.senderRole).toBe("seller");
      expect(frame.data.message.senderId).toBe(sellerUserId);
    } finally {
      customerSocket.ws.close();
      sellerSocket.ws.close();
    }
  });

  // ── CUSTOMER_COMPANY (+ the automated acknowledgment) ─────────────────────
  testFn("customer → Velnox Support: the staff socket gets the message AND the system ack", async () => {
    const customerId = await makeUser("customer", "rt-support");
    const staffId = await makeUser("staff", "rt-support-staff");

    const opened = await call("POST", "/api/customer/support/conversation", customerId, {});
    expect(opened.status).toBe(200);
    const conversationId = opened.data.data.id as string;

    const staffSocket = await openSocket(harness.wsUrl, tokenFor(staffId));
    const customerSocket = await openSocket(harness.wsUrl, tokenFor(customerId));
    try {
      const sent = await call(
        "POST",
        `/api/customer/conversations/${conversationId}/messages`,
        customerId,
        { body: "my parcel has not arrived", clientId: crypto.randomUUID() },
      );
      expect(sent.status).toBe(200);
      const customerMessageId = sent.data.data.message.id as string;

      // 1. Authorised staff sees the customer's message.
      const toStaff = await staffSocket.frames.waitFor(
        (f) => f.type === "chat:message" && f.data?.message?.id === customerMessageId,
      );
      expect(toStaff.data.message.senderRole).toBe("customer");

      // 2. The acknowledgment is a REAL message, published over the socket.
      const ackOnStaff = await staffSocket.frames.waitFor(
        (f) => f.type === "chat:message" && f.data?.message?.isSystem === true,
      );
      expect(ackOnStaff.data.message.senderId).toBeNull();
      expect(ackOnStaff.data.message.senderRole).toBe("system");
      expect(ackOnStaff.data.message.systemKind).toBe("support_daily_ack");

      // 3. … and it reaches the CUSTOMER in real time too.
      const ackOnCustomer = await customerSocket.frames.waitFor(
        (f) => f.type === "chat:message" && f.data?.message?.isSystem === true,
      );
      expect(ackOnCustomer.data.message.id).toBe(ackOnStaff.data.message.id);
      expect(ackOnCustomer.data.conversationId).toBe(conversationId);

      // The delivered frame and the stored row are the same message.
      const { query } = await import("../db/index.js");
      const rows = await query(
        `SELECT sender_id, sender_role, system_kind FROM chat_messages WHERE id = $1`,
        [ackOnCustomer.data.message.id],
      );
      expect(rows.rows.length).toBe(1);
      expect(rows.rows[0].sender_role).toBe("system");
      expect(rows.rows[0].sender_id).toBeNull();
    } finally {
      staffSocket.ws.close();
      customerSocket.ws.close();
    }
  });

  testFn("staff replies in support → the CUSTOMER receives it over the socket", async () => {
    const customerId = await makeUser("customer", "rt-support-reply");
    const staffId = await makeUser("staff", "rt-support-reply-staff");

    const opened = await call("POST", "/api/customer/support/conversation", customerId, {});
    const conversationId = opened.data.data.id as string;

    const customerSocket = await openSocket(harness.wsUrl, tokenFor(customerId));
    try {
      const sent = await call(
        "POST",
        `/api/center/chat/conversations/${conversationId}/messages`,
        staffId,
        { body: "we are checking with the courier", clientId: crypto.randomUUID() },
      );
      expect(sent.status).toBe(200);
      const storedId = sent.data.data.message.id as string;

      const frame = await customerSocket.frames.waitFor(
        (f) => f.type === "chat:message" && f.data?.message?.id === storedId,
      );
      expect(frame.data.message.senderRole).toBe("company");
      expect(frame.data.message.senderId).toBe(staffId);
    } finally {
      customerSocket.ws.close();
    }
  });

  // ── SELLER_COMPANY ────────────────────────────────────────────────────────
  testFn("seller → company: authorised staff receive it over the socket", async () => {
    const sellerUserId = await makeUser("seller", "rt-seller-company");
    const staffId = await makeUser("staff", "rt-seller-company-staff");
    const { query } = await import("../db/index.js");
    await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved')`, [sellerUserId]);

    const opened = await call("POST", "/api/seller/company/conversation", sellerUserId, {});
    expect(opened.status).toBe(200);
    const conversationId = opened.data.data.id as string;

    const staffSocket = await openSocket(harness.wsUrl, tokenFor(staffId));
    try {
      const sent = await call(
        "POST",
        `/api/seller/conversations/${conversationId}/messages`,
        sellerUserId,
        { body: "question about my payout", clientId: crypto.randomUUID() },
      );
      expect(sent.status).toBe(200);
      const storedId = sent.data.data.message.id as string;

      const frame = await staffSocket.frames.waitFor(
        (f) => f.type === "chat:message" && f.data?.message?.id === storedId,
      );
      expect(frame.data.message.senderRole).toBe("seller");
    } finally {
      staffSocket.ws.close();
    }
  });

  // ── COMPANY_INTERNAL ──────────────────────────────────────────────────────
  testFn("internal room: one staff member's message reaches the other staff socket", async () => {
    const staffA = await makeUser("staff", "rt-internal-a");
    const staffB = await makeUser("staff", "rt-internal-b");

    const title = `RT internal ${crypto.randomUUID().slice(0, 8)}`;
    fixtureTitles.push(title);
    const created = await call("POST", "/api/center/chat/internal/conversations", staffA, { title });
    expect(created.status).toBe(200);
    const conversationId = created.data.data.id as string;

    const socketB = await openSocket(harness.wsUrl, tokenFor(staffB));
    try {
      const sent = await call(
        "POST",
        `/api/center/chat/conversations/${conversationId}/messages`,
        staffA,
        { body: "internal note for the team", clientId: crypto.randomUUID() },
      );
      expect(sent.status).toBe(200);
      const storedId = sent.data.data.message.id as string;

      const frame = await socketB.frames.waitFor(
        (f) => f.type === "chat:message" && f.data?.message?.id === storedId,
      );
      expect(frame.data.conversationId).toBe(conversationId);
      expect(frame.data.message.senderRole).toBe("company");
    } finally {
      socketB.ws.close();
    }
  });

  // ── authorization boundary ────────────────────────────────────────────────
  testFn("a non-participant never receives another conversation's messages", async () => {
    const { customerId, conversationId } = await seedShopThread("rt-outsider");
    const outsiderId = await makeUser("customer", "rt-outsider-bystander");
    const staffId = await makeUser("staff", "rt-outsider-staff");

    const outsiderSocket = await openSocket(harness.wsUrl, tokenFor(outsiderId));
    const staffSocket = await openSocket(harness.wsUrl, tokenFor(staffId));
    try {
      const sent = await call(
        "POST",
        `/api/customer/conversations/${conversationId}/messages`,
        customerId,
        { body: "private to this shop", clientId: crypto.randomUUID() },
      );
      expect(sent.status).toBe(200);
      const storedId = sent.data.data.message.id as string;

      // Another customer is not a participant …
      expect(
        await outsiderSocket.frames.has(
          (f) => f.type === "chat:message" && f.data?.message?.id === storedId,
        ),
      ).toBe(false);
      // … and neither is company staff: a private CUSTOMER_SELLER thread is not
      // company data (it is not the reserved support shop).
      expect(
        await staffSocket.frames.has(
          (f) => f.type === "chat:message" && f.data?.message?.id === storedId,
        ),
      ).toBe(false);
    } finally {
      outsiderSocket.ws.close();
      staffSocket.ws.close();
    }
  });

  // ── reconnect / durability ────────────────────────────────────────────────
  testFn("a message sent while a socket was closed is still there after reconnecting", async () => {
    const { customerId, sellerUserId, conversationId } = await seedShopThread("rt-reconnect");

    // The seller is offline for this message.
    const sent = await call(
      "POST",
      `/api/customer/conversations/${conversationId}/messages`,
      customerId,
      { body: "sent while you were away", clientId: crypto.randomUUID() },
    );
    expect(sent.status).toBe(200);

    // On reconnect the authoritative state comes from the API, not from a
    // replay of missed socket frames.
    const sellerSocket = await openSocket(harness.wsUrl, tokenFor(sellerUserId));
    try {
      const view = await call("GET", `/api/seller/conversations/${conversationId}/messages`, sellerUserId);
      expect(view.status).toBe(200);
      const bodies = (view.data.data.items as any[]).map((m) => m.body);
      expect(bodies).toContain("sent while you were away");
    } finally {
      sellerSocket.ws.close();
    }
  });
});
