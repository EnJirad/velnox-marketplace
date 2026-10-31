/**
 * Durable send idempotency — the database, not a Map, decides.
 *
 * Before this change, "one message per clientId" lived in `recentSends`, an
 * in-process Map with a 10-minute TTL: a second backend instance, a restart or
 * a different tab could not see it, so a retry could duplicate a message and a
 * reconnect could replay a send that had already been stored.
 *
 * The claim is now a partial UNIQUE index on
 * `(conversation_id, sender_id, client_id) WHERE client_id IS NOT NULL`, and
 * every send route goes through ONE helper (`insertHumanMessage`) that inserts
 * with `ON CONFLICT … DO NOTHING`. The loser of any race reads the winner's row
 * (`findMessageByClientId`) and replays it.
 *
 * Split: the schema contract always runs; the behaviour cases need
 * `TEST_DATABASE_URL` (the guard in helpers/test-db.ts refuses production).
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

import { hasTestDatabase } from "./helpers/test-db.js";
import { purgeUsers } from "./helpers/purge.js";

const describeDb = hasTestDatabase() ? describe : describe.skip;

const SCHEMA = readFileSync(new URL("../../db/schema.sql", import.meta.url), "utf8");
const RECONCILER = readFileSync(new URL("../../db/run-sqleditor.sql", import.meta.url), "utf8");

describe("durable idempotency — schema contract", () => {
  test("both canonical SQL files declare the client id column and the unique index", () => {
    for (const sql of [SCHEMA, RECONCILER]) {
      expect(sql).toContain("client_id TEXT");
      expect(sql).toMatch(/uq_chat_messages_client_id/);
      expect(sql).toMatch(/\(conversation_id, sender_id, client_id\)/);
      expect(sql).toContain("WHERE client_id IS NOT NULL");
    }
  });

  test("the reconciler adds the column idempotently (never a destructive change)", () => {
    expect(RECONCILER).toContain("ADD COLUMN IF NOT EXISTS client_id TEXT");
    // Additive only: adding a column and an index, never dropping either.
    expect(RECONCILER).not.toMatch(/DROP COLUMN\s+client_id/i);
    expect(RECONCILER).not.toMatch(/DROP INDEX[^;]*uq_chat_messages_client_id/i);
  });

  test("every send route claims the index through the ONE helper", () => {
    const chat = readFileSync(new URL("../routes/chat.ts", import.meta.url), "utf8");
    const center = readFileSync(new URL("../routes/center-chat.ts", import.meta.url), "utf8");
    // The claim lives in one exported helper …
    expect(chat).toContain("export async function insertHumanMessage");
    expect(chat).toContain("ON CONFLICT (conversation_id, sender_id, client_id)");
    expect(chat).toContain("export async function findMessageByClientId");
    // … and the three human send paths all use it.
    expect(chat.split("await insertHumanMessage({").length - 1).toBe(2);
    expect(center).toContain("await insertHumanMessage({");
  });
});

describeDb("durable idempotency — real database (requires TEST_DATABASE_URL)", () => {
  const fixtureUsers: Array<string | null> = [];

  afterAll(async () => {
    await purgeUsers(fixtureUsers.splice(0));
  });

  async function makeConversation(tag: string): Promise<{ userId: string; conversationId: string }> {
    const { query } = await import("../db/index.js");
    const res = await query(
      `INSERT INTO users (email, name, role, status)
       VALUES ($1, $2, 'customer', 'active') RETURNING id`,
      [`idem-${tag}-${crypto.randomUUID().slice(0, 8)}@test.invalid`, `Idem ${tag}`],
    );
    const userId = res.rows[0].id as string;
    fixtureUsers.push(userId);
    const conv = await query(
      `INSERT INTO conversations (type, customer_id) VALUES ('CUSTOMER_COMPANY', $1) RETURNING id`,
      [userId],
    );
    return { userId, conversationId: conv.rows[0].id as string };
  }

  function rowCount(conversationId: string, clientId: string): Promise<number> {
    return import("../db/index.js").then(async ({ query }) => {
      const res = await query(
        `SELECT count(*)::int AS n FROM chat_messages WHERE conversation_id = $1 AND client_id = $2`,
        [conversationId, clientId],
      );
      return res.rows[0].n as number;
    });
  }

  test("the same client id writes ONE row; the loser gets no row and replays it", async () => {
    const { userId, conversationId } = await makeConversation("same");
    const { insertHumanMessage, findMessageByClientId } = await import("../routes/chat.js");
    const clientId = crypto.randomUUID();

    const first = await insertHumanMessage({
      conversationId,
      senderId: userId,
      senderRole: "customer",
      body: "hello",
      clientId,
    });
    expect(first.rows.length).toBe(1);

    // A retry — another tab, another instance, a restart: the index decides.
    const second = await insertHumanMessage({
      conversationId,
      senderId: userId,
      senderRole: "customer",
      body: "hello",
      clientId,
    });
    expect(second.rows.length).toBe(0);

    expect(await rowCount(conversationId, clientId)).toBe(1);
    const stored = await findMessageByClientId(conversationId, userId, clientId);
    expect(stored?.id).toBe(first.rows[0].id);
  });

  test("a different client id is a different message", async () => {
    const { userId, conversationId } = await makeConversation("diff");
    const { insertHumanMessage } = await import("../routes/chat.js");

    const a = await insertHumanMessage({
      conversationId,
      senderId: userId,
      senderRole: "customer",
      body: "first",
      clientId: crypto.randomUUID(),
    });
    const b = await insertHumanMessage({
      conversationId,
      senderId: userId,
      senderRole: "customer",
      body: "second",
      clientId: crypto.randomUUID(),
    });
    expect(a.rows.length).toBe(1);
    expect(b.rows.length).toBe(1);
    expect(a.rows[0].id).not.toBe(b.rows[0].id);
  });

  test("the same client id from a DIFFERENT sender is allowed (index includes sender)", async () => {
    const { userId, conversationId } = await makeConversation("sender");
    const { query } = await import("../db/index.js");
    const { insertHumanMessage } = await import("../routes/chat.js");

    // A second human whose message lands in the same conversation (staff side).
    const staff = await query(
      `INSERT INTO users (email, name, role, status)
       VALUES ($1, 'Idem staff', 'staff', 'active') RETURNING id`,
      [`idem-staff-${crypto.randomUUID().slice(0, 8)}@test.invalid`],
    );
    const staffId = staff.rows[0].id as string;
    fixtureUsers.push(staffId);

    const clientId = crypto.randomUUID();
    const fromCustomer = await insertHumanMessage({
      conversationId,
      senderId: userId,
      senderRole: "customer",
      body: "hi",
      clientId,
    });
    const fromStaff = await insertHumanMessage({
      conversationId,
      senderId: staffId,
      senderRole: "company",
      body: "hi",
      clientId,
    });
    expect(fromCustomer.rows.length).toBe(1);
    expect(fromStaff.rows.length).toBe(1);
    expect(fromStaff.rows[0].sender_id).toBe(staffId);
  });

  test("a NULL client id never conflicts (legacy and system rows keep working)", async () => {
    const { userId, conversationId } = await makeConversation("null");
    const { insertHumanMessage } = await import("../routes/chat.js");

    const a = await insertHumanMessage({
      conversationId,
      senderId: userId,
      senderRole: "customer",
      body: "no key",
      clientId: null,
    });
    const b = await insertHumanMessage({
      conversationId,
      senderId: userId,
      senderRole: "customer",
      body: "no key",
      clientId: null,
    });
    expect(a.rows.length).toBe(1);
    expect(b.rows.length).toBe(1);
    expect(a.rows[0].id).not.toBe(b.rows[0].id);
  });
});
