/**
 * PHASE 2C — REALTIME COMMERCE CORRECTNESS
 *
 * What this file pins, and why each claim is the one that matters:
 *
 *   1. `order:created` is published ONLY after the authoritative order creation
 *      COMMITTED — never for a rolled-back or failed checkout, and never a
 *      second time for a replayed request.
 *   2. `order:updated` reaches only the sessions entitled to that order: the
 *      customer, the shop's seller and connected VelCenter sessions. A stranger
 *      (another customer, another shop) receives nothing.
 *   3. `shipment:updated` is published only for a REAL, persisted parcel move.
 *   4. Notification rows accompany the real business events (row first, socket
 *      frame second), and notification reads/updates are ownership-scoped.
 *   5. Private VelCenter channels are authorized SERVER-side from `users.role`:
 *      an anonymous socket and an ordinary customer connection are refused.
 *
 * Structure: the structural half needs no database; the behavioural half drives
 * the REAL routes and a REAL WebSocket server and skips unless a safe
 * `TEST_DATABASE_URL` (+ `JWT_SECRET`) is configured. No production credential
 * is ever read.
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

const REALTIME = "backend/realtime/index.ts";
const ORDER_EVENTS = "backend/lib/order-events.ts";
const ORDER_NOTIFICATIONS = "backend/lib/order-notifications.ts";
const CART_ROUTE = "backend/routes/cart.ts";
const SELLER_ORDERS_ROUTE = "backend/routes/seller-orders.ts";
const CENTER_ROUTE = "backend/routes/center.ts";
const STRIPE_ROUTE = "backend/routes/stripe.ts";
const SCHEDULER = "backend/jobs/payment-reservation-scheduler.ts";
const CHAT_ROUTE = "backend/routes/chat.ts";
const CENTER_PAGE = "apps/velcenter/src/pages/Center.tsx";
const CHAT_SOCKET = "packages/shared/src/lib/chat-socket.ts";

// ═══════════════════════════════════════════════════════════════════════════
// 1. The wiring, structurally (no database)
// ═══════════════════════════════════════════════════════════════════════════

describe("order:created is published after the commit, once per real creation", () => {
  const cart = read(CART_ROUTE);

  test("the publish sits AFTER the transaction that committed, inside the creation loop", () => {
    const publish = cart.indexOf('publishOrderEvent("order:created"');
    expect(publish).toBeGreaterThan(-1);

    // The only path that reaches it is a request whose orders were just
    // committed: the duplicate/rollback handling (`DuplicateCheckoutError`) and
    // every refusal answer and return BEFORE this point.
    const rollbackPath = cart.indexOf("if (err instanceof DuplicateCheckoutError)");
    expect(rollbackPath).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(rollbackPath);

    // Nothing inside the transaction publishes — the event can only describe a
    // state that is already durable.
    const transactionStart = cart.indexOf("await withTransaction(async (client) => {");
    expect(transactionStart).toBeGreaterThan(-1);
    expect(cart.slice(transactionStart, publish)).not.toContain("publishOrderEvent(");

    // It iterates the orders the transaction actually created…
    expect(cart.slice(publish - 400, publish)).toContain("for (const created of createdOrders) {");
    // …and runs BEFORE the success response that carries them.
    expect(publish).toBeLessThan(cart.lastIndexOf("res.json({ success: true, data: responseData })"));
  });

  test("the event carries identifiers and status only — never customer data", () => {
    const publishCall = cart.slice(
      cart.indexOf('publishOrderEvent("order:created"'),
      cart.lastIndexOf("res.json({ success: true, data: responseData })"),
    );
    for (const forbidden of ["total_amount", "shipping_address", "email", "phone", "recipient_name"]) {
      expect(publishCall).not.toContain(forbidden);
    }
    expect(publishCall).toContain("orderId: created.orderId");
    expect(publishCall).toContain("orderNumber: created.orderNumber");
  });

  test("one event per created order — a multi-shop purchase announces every shop's order", () => {
    // `createdOrders` holds one entry per shop order, so the loop publishes one
    // addressed event per order (there is no single global "purchase" feed).
    expect(cart).toContain("createdOrders.push({ orderId, orderNumber, shopId");
  });
});

describe("order and shipment events are addressed, not broadcast", () => {
  const realtime = read(REALTIME);
  const orderEvents = read(ORDER_EVENTS);

  test("the transport exposes addressed delivery and no subscribable order feed", () => {
    expect(realtime).toContain("export function sendToUsers(");
    expect(realtime).toContain("export function sendToCenter(");
    // Every order/shipment channel left the subscribable set: the old public
    // allowlist is gone and the decision is a server-side role check.
    expect(realtime).not.toContain("isPublicChannel");
    expect(realtime).not.toContain('msg.channel === "order:updated"');
    expect(realtime).not.toContain('msg.channel === "order:created"');
    expect(realtime).not.toContain('msg.channel === "shipment:updated"');
    // An addressed push must not honour a subscription, or the audience could be
    // widened by one.
    expect(realtime).toMatch(/export function sendToUsers\([\s\S]*?const targets = new Set\(userIds\)/);
  });

  test("the publisher resolves the audience from Neon, from the order id alone", () => {
    expect(orderEvents).toContain("export async function resolveOrderParties(");
    // Customer from `orders.user_id`; seller through shops → sellers; both LEFT
    // JOINs so a historical row without a shop resolves to "no seller".
    expect(orderEvents).toMatch(/LEFT JOIN shops sh ON sh\.id = o\.shop_id/);
    expect(orderEvents).toMatch(/LEFT JOIN sellers sl ON sl\.id = sh\.seller_id/);
    expect(orderEvents).toContain("sendToUsers(recipients");
    expect(orderEvents).toContain("sendToCenter(");
    // No caller-supplied recipient: the parameters are the event, the order id
    // and the payload — nothing else.
    expect(orderEvents).toContain(
      "export async function publishOrderEvent(\n  event: OrderEventName,\n  orderId: string,\n  data: Record<string, unknown>,\n)",
    );
  });

  test("delivery is non-fatal and honest about what it does not guarantee", () => {
    expect(orderEvents).toContain("catch (err)");
    expect(orderEvents).toContain("never throws");
    // The outbox has no writer/drain worker in this repository, so the gap is
    // documented instead of being papered over as exactly-once delivery.
    expect(orderEvents).toContain("outbox_events");
    expect(orderEvents).not.toContain("exactly-once");
  });
});

describe("a failed mutation publishes nothing", () => {
  test("the seller route answers every refusal before it publishes", () => {
    const src = read(SELLER_ORDERS_ROUTE);
    const publish = src.indexOf('publishOrderEvent("order:updated"');
    expect(publish).toBeGreaterThan(-1);
    // The refused-order answer (404) and the refused transition (400
    // INVALID_TRANSITION) both answer and return BEFORE the event.
    const refusals = src.indexOf("if (err instanceof HttpError) {");
    expect(refusals).toBeGreaterThan(-1);
    expect(refusals).toBeLessThan(publish);
    expect(src.indexOf('"INVALID_TRANSITION"')).toBeGreaterThan(-1);
    expect(src.indexOf('"INVALID_TRANSITION"')).toBeLessThan(publish);
  });

  test("the center route answers its refusals before it publishes", () => {
    const src = read(CENTER_ROUTE);
    const statusPublish = src.indexOf('publishOrderEvent("order:updated"');
    const shipmentPublish = src.indexOf('publishOrderEvent("shipment:updated"');
    expect(statusPublish).toBeGreaterThan(-1);
    expect(shipmentPublish).toBeGreaterThan(-1);
    expect(src.indexOf("if (err instanceof FulfillmentError) {")).toBeLessThan(statusPublish);
    expect(src.indexOf("if (err instanceof FulfillmentError) {", statusPublish)).toBeLessThan(shipmentPublish);
  });

  test("a shipment move is announced once, and only when it persisted", () => {
    for (const file of [SELLER_ORDERS_ROUTE, CENTER_ROUTE]) {
      const src = read(file);
      const publish = src.indexOf('publishOrderEvent("shipment:updated"');
      expect(publish).toBeGreaterThan(-1);
      // `moved` is false both for a repeat AND for the one call that CREATES the
      // parcel (its row materialises directly in `created`), so the gate must
      // include `created` or a real parcel birth would never be announced.
      expect(src.slice(publish - 400, publish)).toContain("if (outcome.moved || outcome.created) {");
      expect(read("backend/lib/order-shipment.ts")).toContain("created: boolean;");
    }
  });

  test("the customer's own cancel publishes after the commit and on a real move only", () => {
    const src = read(CART_ROUTE);
    const cancelStart = src.indexOf('app.patch("/api/customer/orders/:orderId/cancel"');
    expect(cancelStart).toBeGreaterThan(-1);
    const cancelBody = src.slice(cancelStart, src.indexOf('app.post("/api/customer/reorder"'));
    // The GROUP branch publishes after its transaction committed…
    expect(cancelBody.indexOf('publishOrderEvent("order:updated"')).toBeGreaterThan(
      cancelBody.indexOf("await withTransaction((client) =>"),
    );
    // …and the SINGLE-order branch publishes only after its own transaction
    // committed AND only when the claim actually moved the order.
    const singlePublish = cancelBody.lastIndexOf('publishOrderEvent("order:updated"');
    expect(singlePublish).toBeGreaterThan(cancelBody.lastIndexOf("await withTransaction("));
    expect(cancelBody).toContain("if (!outcome.moved) {");
    expect(cancelBody.indexOf("if (!outcome.moved) {")).toBeLessThan(singlePublish);
    expect(cancelBody).toContain("notifyOrderSellerOfCancellation(");
  });

  test("the webhook and the expiry sweep publish only for the orders they actually claimed", () => {
    const stripe = read(STRIPE_ROUTE);
    expect(stripe).toContain('publishOrderEvent("order:updated"');
    expect(stripe).not.toContain("broadcast(CHANNELS.ORDER_UPDATED");
    // Every single-order webhook branch still gates on `result.moved`.
    expect(stripe).toContain("if (result.moved) {");
    expect(stripe).toContain('await notifyOrderCustomerOfStatus(orderId, "paid");');

    const scheduler = read(SCHEDULER);
    expect(scheduler).toContain('publishOrderEvent("order:updated"');
    expect(scheduler).not.toContain("broadcast(CHANNELS.ORDER_UPDATED");
    // The sweep publishes after its atomic claim won — never for a skipped row.
    expect(scheduler.indexOf("if (!claimed) {")).toBeLessThan(
      scheduler.indexOf('publishOrderEvent("order:updated"'),
    );
  });
});

describe("notification rows follow the business mutation", () => {
  const notifications = read(ORDER_NOTIFICATIONS);

  test("the ROW is written first; the socket frame only nudges the bell", () => {
    const insert = notifications.indexOf("INSERT INTO notifications");
    const push = notifications.indexOf("sendToUser(recipientUserId");
    expect(insert).toBeGreaterThan(-1);
    expect(push).toBeGreaterThan(insert);
    // No second notification system and no second transport: the row goes into
    // the existing table and the frame over the existing per-user channel.
    expect(notifications).toContain("CHANNELS.NOTIFICATION_CREATED");
    expect(notifications).not.toContain("broadcast(");
    expect(notifications).not.toContain("CREATE TABLE");
  });

  test("a notification failure can never fail the committed sale", () => {
    expect(notifications).toContain("catch (err)");
    expect(notifications).toContain("[order-notifications] write failed (non-fatal):");
    expect(notifications).not.toContain("throw ");
  });

  test("who is told what: the seller learns of new orders, the customer of changes", () => {
    const cart = read(CART_ROUTE);
    // New order → the shop's seller (the party who must act).
    expect(cart).toContain("await notifyOrderSellerOfNewOrder(created.orderId);");
    // Customer cancellation → the seller, not the customer who did it.
    expect(cart).toContain("await notifyOrderSellerOfCancellation(");
    expect(cart).not.toContain("notifyOrderCustomerOfStatus(");

    for (const file of [SELLER_ORDERS_ROUTE, CENTER_ROUTE, STRIPE_ROUTE, SCHEDULER]) {
      expect(read(file)).toContain("notifyOrderCustomerOfStatus(");
    }
    for (const file of [SELLER_ORDERS_ROUTE, CENTER_ROUTE]) {
      expect(read(file)).toContain("notifyOrderCustomerOfShipment(orderId, outcome.to);");
    }
    // The copy maps cover the statuses these routes actually produce.
    for (const status of ["confirmed", "shipped", "delivered", "cancelled", "paid", "payment_failed", "expired"]) {
      expect(notifications).toContain(`${status}:`);
    }
    expect(notifications).toContain("SHIPMENT_STATUS_COPY");
  });

  test("notification reads and updates are ownership-scoped", () => {
    const chat = read(CHAT_ROUTE);
    // List: only this user's rows.
    expect(chat).toContain("FROM notifications WHERE user_id = $1");
    // Mark one read: the row must belong to the caller (404 otherwise).
    expect(chat).toContain("UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2");
    // Mark all read: scoped to the caller, never global.
    expect(chat).toContain("UPDATE notifications SET read = TRUE WHERE user_id = $1 AND read = FALSE");
  });
});

describe("private VelCenter channels are authorized server-side", () => {
  const realtime = read(REALTIME);
  const centerPage = read(CENTER_PAGE);

  test("the role comes from the database, never from a frame", () => {
    expect(realtime).toContain('import { CENTER_ROLES, roleOf } from "../lib/permissions.js";');
    expect(realtime).toContain("client.role = await roleOf(client.userId)");
    expect(realtime).not.toMatch(/msg\.role/);
    expect(realtime).not.toMatch(/client\.role\s*=\s*msg/);
  });

  test("every subscription is decided against the connection's own role", () => {
    expect(realtime).toContain("await client.roleReady;");
    expect(realtime).toContain("const isOwnChannel = !!client.userId && channel === `user:${client.userId}`;");
    expect(realtime).toContain("const isSelfChannel = !!client.userId && SELF_CHANNELS.has(channel);");
    expect(realtime).toContain(
      "client.userId && CENTER_CHANNELS.has(channel) && isCenterRole(client.role)",
    );
    expect(realtime).toContain('message: "Channel not allowed"');
    // Every allowed branch requires a resolved `userId`, so an anonymous socket
    // holds no channel at all.
    expect(realtime).toContain("function isCenterRole(role: string | null | undefined): boolean {");
  });

  test("the role is refreshed, and a lost role drops live subscriptions", () => {
    expect(realtime).toContain("if (client.userId) void refreshClientRole(client);");
    expect(realtime).toContain("if (!CENTER_CHANNELS.has(channel)) continue;");
    expect(realtime).toContain("client.subscriptions.delete(channel);");
  });

  test("the console consumes the addressed order events without an order subscription", () => {
    expect(centerPage).toContain('emitCenterEvent("orders")');
    expect(centerPage).toContain('type === "shipment:updated"');
    expect(centerPage).not.toContain('subscribeChatChannel("order:updated")');
  });

  test("the ONE shared socket still resubscribes every wanted channel after a drop", () => {
    const socket = read(CHAT_SOCKET);
    // Phase 2A's ownership/backoff/refetch architecture is untouched.
    expect(socket).toContain("function subscribeAll(): void {");
    expect(socket).toContain("for (const channel of channelRefs.keys()) {");
    expect(socket).toContain("subscribeAll();");
    expect(socket).toContain("notifyReconnect();");
    // The shared client is still the ONLY place a browser WebSocket is built.
    let sockets = 0;
    for (const file of new Bun.Glob("apps/**/*.{ts,tsx}").scanSync({ cwd: root })) {
      sockets += read(file).split("new WebSocket(").length - 1;
    }
    expect(sockets).toBe(0);
    expect(socket.split("new WebSocket(").length - 1).toBe(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The socket itself: an anonymous connection holds no channel
// ═══════════════════════════════════════════════════════════════════════════

interface Harness {
  httpUrl: string;
  wsUrl: string;
  close: () => Promise<void>;
}

/** A real HTTP + WebSocket server running the real `setupWebSocket`. */
async function startHarness(withRoutes: boolean): Promise<Harness> {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  if (withRoutes) {
    const { setupCartRoutes } = await import("../routes/cart.js");
    const { setupSellerOrderRoutes } = await import("../routes/seller-orders.js");
    setupCartRoutes(app);
    setupSellerOrderRoutes(app);
  }
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

type FrameMatch = (frame: any, index: number) => boolean;

interface Socket {
  ws: WebSocket;
  frames: ReturnType<typeof collector>;
}

/** Collect frames so a test can await the one it is looking for. */
function collector(ws: WebSocket) {
  const frames: any[] = [];
  const waiters: Array<{ match: FrameMatch; resolve: (frame: any) => void }> = [];
  ws.on("message", (raw) => {
    let frame: any;
    try {
      frame = JSON.parse(String(raw));
    } catch {
      return;
    }
    const index = frames.length;
    frames.push(frame);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      if (waiters[i]!.match(frame, index)) waiters.splice(i, 1)[0]!.resolve(frame);
    }
  });

  const waitFor = (match: FrameMatch, timeoutMs = 5000): Promise<any> => {
    const index = frames.findIndex((frame, i) => match(frame, i));
    if (index >= 0) return Promise.resolve(frames[index]);
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
    /** Send a subscribe frame and await the server's ANSWER to it. */
    subscribe(channel: string): Promise<any> {
      const from = frames.length;
      ws.send(JSON.stringify({ type: "subscribe", channel }));
      return waitFor(
        (frame, index) =>
          index >= from && (frame.type === "subscribed" || frame.type === "error"),
      );
    },
    /** Settle, then report whether ANY frame matched — used for "nothing arrived". */
    async has(match: FrameMatch): Promise<boolean> {
      await new Promise((r) => setTimeout(r, 250));
      return frames.some((frame, index) => match(frame, index));
    },
  };
}

function openSocket(wsUrl: string, token?: string): Promise<Socket> {
  const ws = token
    ? new WebSocket(wsUrl, { headers: { cookie: `velnox_session=${token}` } })
    : new WebSocket(wsUrl);
  const frames = collector(ws);
  return new Promise((resolve, reject) => {
    ws.once("open", () => resolve({ ws, frames }));
    ws.once("error", reject);
  });
}


describe("an anonymous socket holds no channels (no database needed)", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await startHarness(false);
  });

  afterAll(async () => {
    await harness?.close();
  });

  test("the private admin channels are refused, not silently ignored", async () => {
    const socket = await openSocket(harness.wsUrl);
    try {
      for (const channel of ["audit:created", "config:updated", "notification:created", "product:updated"]) {
        const answer = await socket.frames.subscribe(channel);
        expect(answer.type).toBe("error");
        expect(answer.code).toBe("FORBIDDEN");
      }
    } finally {
      socket.ws.close();
    }
  });

  test("the order and shipment channels do not exist to subscribe to", async () => {
    const socket = await openSocket(harness.wsUrl);
    try {
      for (const channel of ["order:created", "order:updated", "shipment:updated"]) {
        const answer = await socket.frames.subscribe(channel);
        expect(answer.type).toBe("error");
        expect(answer.code).toBe("FORBIDDEN");
      }
      // …and neither does somebody else's private channel.
      const foreign = await socket.frames.subscribe("user:00000000-0000-4000-8000-000000000000");
      expect(foreign.type).toBe("error");
    } finally {
      socket.ws.close();
    }
  });

  test("the self channels are refused too — they need a signed-in owner", async () => {
    const socket = await openSocket(harness.wsUrl);
    try {
      const answer = await socket.frames.subscribe("cart:updated");
      expect(answer.type).toBe("error");
      expect(answer.code).toBe("FORBIDDEN");
    } finally {
      socket.ws.close();
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The behaviour, against the REAL routes (requires TEST_DATABASE_URL)
// ═══════════════════════════════════════════════════════════════════════════

const describeDb = hasTestDatabase() ? describe : describe.skip;
const testFn = hasTestDatabase() ? test : test.skip;

describeDb("order and shipment events, end to end (requires TEST_DATABASE_URL)", () => {
  const PRICE = 90;
  const fixtureUsers: Array<string | null> = [];
  const savedEnv: Record<string, string | undefined> = {};
  let harness: Harness;

  beforeAll(async () => {
    for (const key of [
      "STRIPE_SECRET_KEY",
      "STRIPE_PUBLISHABLE_KEY",
      "STRIPE_WEBHOOK_SECRET",
      "VITE_VELSHOP_URL",
    ] as const) {
      savedEnv[key] = process.env[key];
    }
    delete process.env.STRIPE_PUBLISHABLE_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.VITE_VELSHOP_URL;
    process.env.STRIPE_SECRET_KEY = "sk_test_000000000000000000000000";
    harness = await startHarness(true);
  });

  afterAll(async () => {
    await harness?.close();
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await purgeUsers(fixtureUsers.splice(0));
  });

  async function makeUser(role: string, tag: string): Promise<string> {
    const { query } = await import("../db/index.js");
    const res = await query(
      `INSERT INTO users (email, name, role) VALUES ($1, $2, $3) RETURNING id`,
      [`p2c-${tag}-${crypto.randomUUID().slice(0, 8)}@test.invalid`, `P2C ${tag}`, role],
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

  interface Fixture {
    customerId: string;
    sellerUserId: string;
    shopId: string;
    productId: string;
  }

  /** An approved seller with a shop and one published product (stock 5). */
  async function seedShop(tag: string): Promise<Fixture> {
    const { query } = await import("../db/index.js");
    const customerId = await makeUser("customer", `${tag}-buyer`);
    const sellerUserId = await makeUser("seller", `${tag}-seller`);
    const seller = await query(`INSERT INTO sellers (user_id, status) VALUES ($1, 'approved') RETURNING id`, [
      sellerUserId,
    ]);
    const shop = await query(`INSERT INTO shops (seller_id, name, slug) VALUES ($1, $2, $3) RETURNING id`, [
      seller.rows[0].id,
      `P2C ${tag} shop`,
      `p2c-${tag}-${crypto.randomUUID().slice(0, 6)}`,
    ]);
    const shopId = shop.rows[0].id as string;
    const product = await query(
      `INSERT INTO products (shop_id, name, slug, price, status, sold_count)
       VALUES ($1, $2, $3, $4, 'published', 0) RETURNING id`,
      [shopId, `P2C ${tag} product`, `p2c-${tag}-p-${crypto.randomUUID().slice(0, 6)}`, PRICE],
    );
    const productId = product.rows[0].id as string;
    await query(`INSERT INTO inventory (product_id, quantity, reserved) VALUES ($1, 5, 0)`, [productId]);
    return { customerId, sellerUserId, shopId, productId };
  }

  async function buyNow(
    fixture: Fixture,
    quantity: number,
    requestId: string,
  ): Promise<{ status: number; data?: any }> {
    const res = await fetch(`${harness.httpUrl}/api/customer/checkout`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: `velnox_session=${tokenFor(fixture.customerId)}`,
      },
      body: JSON.stringify({
        paymentMethod: "CARD",
        buyNow: { productId: fixture.productId, variantId: null, quantity },
        requestId,
      }),
    });
    return { status: res.status, data: await res.json().catch(() => undefined) };
  }

  async function notificationsOf(userId: string): Promise<any[]> {
    const { query } = await import("../db/index.js");
    const res = await query(
      `SELECT id, type, title, message, data FROM notifications WHERE user_id = $1 ORDER BY created_at DESC`,
      [userId],
    );
    return res.rows;
  }

  testFn("an owner session may subscribe to the private channels; a customer session may not", async () => {
    const ownerId = await makeUser("owner", "owner");
    const customerId = await makeUser("customer", "plain");

    const owner = await openSocket(harness.wsUrl, tokenFor(ownerId));
    const customer = await openSocket(harness.wsUrl, tokenFor(customerId));
    try {
      for (const channel of ["audit:created", "config:updated", "seller:updated", "product:updated"]) {
        expect((await owner.frames.subscribe(channel)).type).toBe("subscribed");
      }
      // Not even a center session can subscribe to an order feed: those events
      // are addressed by the server, not requested by a client.
      expect((await owner.frames.subscribe("order:updated")).type).toBe("error");
      expect((await owner.frames.subscribe("shipment:updated")).type).toBe("error");
      // Own channel yes, somebody else's no.
      expect((await owner.frames.subscribe(`user:${ownerId}`)).type).toBe("subscribed");
      expect((await owner.frames.subscribe(`user:${customerId}`)).type).toBe("error");

      // A customer connection: own channel and self channels only.
      expect((await customer.frames.subscribe("audit:created")).type).toBe("error");
      expect((await customer.frames.subscribe("product:updated")).type).toBe("error");
      expect((await customer.frames.subscribe(`user:${customerId}`)).type).toBe("subscribed");
      expect((await customer.frames.subscribe("cart:updated")).type).toBe("subscribed");
    } finally {
      owner.ws.close();
      customer.ws.close();
    }
  });

  testFn("a successful checkout publishes order:created to the customer, the seller and VelCenter", async () => {
    const fixture = await seedShop("created");
    const strangerId = await makeUser("customer", "stranger");
    const ownerId = await makeUser("owner", "watcher");

    const customer = await openSocket(harness.wsUrl, tokenFor(fixture.customerId));
    const seller = await openSocket(harness.wsUrl, tokenFor(fixture.sellerUserId));
    const stranger = await openSocket(harness.wsUrl, tokenFor(strangerId));
    const owner = await openSocket(harness.wsUrl, tokenFor(ownerId));
    try {
      const result = await buyNow(fixture, 2, crypto.randomUUID());
      expect(result.status).toBe(200);
      const orderId = result.data.data.orders[0].orderId as string;

      for (const socket of [customer, seller, owner]) {
        const frame = await socket.frames.waitFor((f) => f.type === "order:created");
        expect(frame.channel).toBe("order:created");
        expect(frame.data.orderId).toBe(orderId);
        expect(frame.data.shopId).toBe(fixture.shopId);
        expect(typeof frame.data.orderNumber).toBe("string");
        // The payload is identifiers only: no buyer identity, no address, no money.
        const serialized = JSON.stringify(frame.data);
        for (const forbidden of ["email", "phone", "address", "totalAmount", "price"]) {
          expect(serialized).not.toContain(forbidden);
        }
      }

      // A different customer is entitled to nothing and receives nothing.
      expect(await stranger.frames.has((f) => f.type === "order:created")).toBe(false);

      // The seller learns through a persisted ROW, not through the socket frame.
      const sellerRows = await notificationsOf(fixture.sellerUserId);
      expect(sellerRows.length).toBe(1);
      expect(sellerRows[0].type).toBe("order");
      expect(sellerRows[0].data.orderId).toBe(orderId);
      // The customer placed it — no notification about their own action.
      expect(await notificationsOf(fixture.customerId)).toHaveLength(0);

      const { query } = await import("../db/index.js");
      const order = await query(`SELECT order_number FROM orders WHERE id = $1`, [orderId]);
      expect(order.rows[0].order_number).toBe(result.data.data.orders[0].orderNumber);
    } finally {
      customer.ws.close();
      seller.ws.close();
      stranger.ws.close();
      owner.ws.close();
    }
  });

  testFn("a replayed request creates no second order, no second event and no second notification", async () => {
    const fixture = await seedShop("retry");
    const seller = await openSocket(harness.wsUrl, tokenFor(fixture.sellerUserId));
    const requestId = crypto.randomUUID();
    try {
      const first = await buyNow(fixture, 1, requestId);
      expect(first.status).toBe(200);
      const orderId = first.data.data.orders[0].orderId as string;
      await seller.frames.waitFor((f) => f.type === "order:created" && f.data.orderId === orderId);

      const second = await buyNow(fixture, 1, requestId);
      expect(second.status).toBe(200);
      expect(second.data.data.parentOrderId).toBe(first.data.data.parentOrderId);

      // Exactly ONE order for that request key…
      const { query } = await import("../db/index.js");
      const orders = await query(`SELECT id FROM orders WHERE user_id = $1`, [fixture.customerId]);
      expect(orders.rows.length).toBe(1);
      // …one order:created frame, one notification — a retry is not a business event.
      const created = seller.frames.frames.filter((f) => f.type === "order:created");
      expect(created.length).toBe(1);
      expect(await notificationsOf(fixture.sellerUserId)).toHaveLength(1);
      expect(await notificationsOf(fixture.customerId)).toHaveLength(0);
    } finally {
      seller.ws.close();
    }
  });

  testFn("a FAILED checkout publishes nothing and writes no notification", async () => {
    const fixture = await seedShop("failed");
    const seller = await openSocket(harness.wsUrl, tokenFor(fixture.sellerUserId));
    try {
      // Over-stock: refused before any order row is written.
      const refused = await buyNow(fixture, 99, crypto.randomUUID());
      expect(refused.status).toBe(400);

      expect(await seller.frames.has((f) => f.type === "order:created")).toBe(false);
      expect(await notificationsOf(fixture.sellerUserId)).toHaveLength(0);

      const { query } = await import("../db/index.js");
      const orders = await query(`SELECT id FROM orders WHERE user_id = $1`, [fixture.customerId]);
      expect(orders.rows.length).toBe(0);
    } finally {
      seller.ws.close();
    }
  });

  testFn("order:updated reaches the customer and the seller, never a stranger", async () => {
    const fixture = await seedShop("cancel");
    const strangerId = await makeUser("customer", "cancel-stranger");
    const customer = await openSocket(harness.wsUrl, tokenFor(fixture.customerId));
    const seller = await openSocket(harness.wsUrl, tokenFor(fixture.sellerUserId));
    const stranger = await openSocket(harness.wsUrl, tokenFor(strangerId));
    try {
      const created = await buyNow(fixture, 1, crypto.randomUUID());
      expect(created.status).toBe(200);
      const orderId = created.data.data.orders[0].orderId as string;
      const sellerRowsAfterCreation = (await notificationsOf(fixture.sellerUserId)).length;

      const cancelOrder = () =>
        fetch(`${harness.httpUrl}/api/customer/orders/${orderId}/cancel`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Cookie: `velnox_session=${tokenFor(fixture.customerId)}`,
          },
        });

      expect((await cancelOrder()).status).toBe(200);

      for (const socket of [customer, seller]) {
        const frame = await socket.frames.waitFor(
          (f) => f.type === "order:updated" && f.data.orderId === orderId,
        );
        expect(frame.data.to).toBe("cancelled");
      }
      expect(await stranger.frames.has((f) => f.type === "order:updated")).toBe(false);

      // The seller is told (their stock came back); the customer who acted is not.
      const sellerRows = await notificationsOf(fixture.sellerUserId);
      expect(sellerRows.some((r) => r.data?.orderId === orderId && /ยกเลิก/.test(r.title))).toBe(true);
      expect(await notificationsOf(fixture.customerId)).toHaveLength(0);

      // A repeated cancel is not a state change: no second event, no second row.
      expect((await cancelOrder()).status).toBe(200);
      await new Promise((r) => setTimeout(r, 200));
      const updates = seller.frames.frames.filter(
        (f) => f.type === "order:updated" && f.data.orderId === orderId,
      );
      expect(updates.length).toBe(1);
      expect((await notificationsOf(fixture.sellerUserId)).length).toBe(sellerRowsAfterCreation + 1);
    } finally {
      customer.ws.close();
      seller.ws.close();
      stranger.ws.close();
    }
  });

  testFn("shipment:updated is published once, only after the parcel row really changed", async () => {
    const fixture = await seedShop("parcel");
    const strangerId = await makeUser("customer", "parcel-stranger");
    const customer = await openSocket(harness.wsUrl, tokenFor(fixture.customerId));
    const stranger = await openSocket(harness.wsUrl, tokenFor(strangerId));
    try {
      const created = await buyNow(fixture, 1, crypto.randomUUID());
      expect(created.status).toBe(200);
      const orderId = created.data.data.orders[0].orderId as string;

      const moveShipment = () =>
        fetch(`${harness.httpUrl}/api/seller/orders/${orderId}/shipment`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Cookie: `velnox_session=${tokenFor(fixture.sellerUserId)}`,
          },
          body: JSON.stringify({ status: "created", carrier: "Kerry", trackingNumber: "P2C-0001" }),
        });

      expect((await moveShipment()).status).toBe(200);

      const frame = await customer.frames.waitFor(
        (f) => f.type === "shipment:updated" && f.data.orderId === orderId,
      );
      expect(frame.data.to).toBe("created");
      // The parcel is born in `created`: `moved` is false, `created` is true, and
      // the event still has to go out — a persisted row appeared.
      expect(frame.data.from).toBe("created");
      expect(typeof frame.data.shipmentId).toBe("string");
      expect(await stranger.frames.has((f) => f.type === "shipment:updated")).toBe(false);

      // The event describes a row that is really there.
      const { query } = await import("../db/index.js");
      const shipment = await query(`SELECT id, status FROM shipments WHERE order_id = $1`, [orderId]);
      expect(shipment.rows[0].status).toBe("created");
      expect(shipment.rows[0].id).toBe(frame.data.shipmentId);

      // The customer is told about their parcel — a row, not only a frame.
      const customerRows = await notificationsOf(fixture.customerId);
      expect(customerRows.some((r) => r.type === "shipping" && r.data?.orderId === orderId)).toBe(true);

      // A REPEAT of the same move is a no-op: no second event, no second row.
      expect((await moveShipment()).status).toBe(200);
      await new Promise((r) => setTimeout(r, 200));
      const events = customer.frames.frames.filter(
        (f) => f.type === "shipment:updated" && f.data.orderId === orderId,
      );
      expect(events.length).toBe(1);
      expect(await notificationsOf(fixture.customerId)).toHaveLength(customerRows.length);
    } finally {
      customer.ws.close();
      stranger.ws.close();
    }
  });
});
