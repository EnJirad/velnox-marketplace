/**
 * Reviewer → seller correction notifications, and the moderation-detail option
 * aggregation the reviewer opens the case from.
 *
 * Guards three production regressions:
 *
 *   1. `GET /api/admin/products/:productId/moderation-detail` raised
 *      PostgreSQL 42P10 — "in an aggregate with DISTINCT, ORDER BY expressions
 *      must appear in argument list" — for every product with option groups.
 *   2. A `needs_correction` reviewer decision wrote a notification row but never
 *      pushed it, so VelSeller could not see it without a manual refresh.
 *   3. Velnox has ONE notification system: these tests fail if a second API,
 *      table or component for seller notifications appears.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const productsSrc = read("backend/routes/products.ts");
const verificationSrc = read("backend/routes/verification.ts");
const chatSrc = read("backend/routes/chat.ts");
const apiRoutesSrc = read("packages/shared/src/lib/api-routes.ts");
const schemaSql = read("db/schema.sql");
const sqlEditor = read("db/run-sqleditor.sql");
const bellSrc = read("packages/shared/src/components/SellerNotificationBell.tsx");
const headerSrc = read("packages/shared/src/components/AppHeader.tsx");
const myShopSrc = read("apps/velseller/src/pages/MyShop.tsx");

describe("product moderation detail — option group aggregation", () => {
  /** Comments document the bug on purpose; only executable statements matter. */
  const statements = (src: string) =>
    src
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("//"))
      .join("\n");

  // The only legal aggregate ORDER BY with DISTINCT is one whose expressions are
  // all aggregate arguments; the offending form must never come back.
  test("no DISTINCT aggregate carries an ORDER BY outside its argument list", () => {
    expect(statements(productsSrc)).not.toContain("json_agg(DISTINCT");
    expect(statements(productsSrc)).not.toContain("jsonb_agg(DISTINCT");
  });

  test("the moderation-detail option query keeps its joins, ordering and fields", () => {
    const start = productsSrc.indexOf("moderation-detail");
    const query = productsSrc.slice(start, productsSrc.indexOf("SELECT * FROM product_attributes", start));
    // option groups ordered by pog.sort_order
    expect(query).toContain("ORDER BY pog.sort_order ASC");
    // values aggregated in pov.sort_order
    expect(query).toContain("ORDER BY pov.sort_order)");
    // every field the VelCenter dialog reads is still returned
    for (const field of ["'id', pov.id", "'value', pov.value", "'label', pov.label", "'sort_order', pov.sort_order", "'is_enabled', pov.is_enabled"]) {
      expect(query).toContain(field);
    }
    // none of the other moderation-detail sections may be dropped
    for (const section of ["product_images", "product_variants", "product_attributes", "categories", "moderation_records", "LEFT JOIN inventory i"]) {
      expect(productsSrc.slice(start)).toContain(section);
    }
  });

  test("the shipped statement matches the route's statement", () => {
    // The DB-gated integration block below runs a copy of the endpoint's SQL;
    // this keeps that copy from drifting away from what the route really ships.
    const normalized = (sql: string) => sql.replace(/\s+/g, " ").trim();
    const start = productsSrc.indexOf("SELECT pog.*, json_agg(jsonb_build_object");
    const routeSql = productsSrc.slice(start, productsSrc.indexOf("`,", start));
    expect(normalized(routeSql)).toBe(normalized(OPTION_GROUPS_SQL));
  });
});

describe("needs_correction notification reaches the seller", () => {
  test("the reviewer decision writes the canonical notification", () => {
    expect(verificationSrc).toContain("seller_verification_needs_correction");
    expect(verificationSrc).toContain("INSERT INTO notifications (user_id, type, title, message, data)");
    // The applicant-visible context travels in `data` so the UI can deep-link.
    expect(verificationSrc).toContain("JSON.stringify({ verificationId, action, reasonCode: code || null, reason: reason || null })");
    // Notifications must never break the review transaction.
    expect(verificationSrc).toContain("[verification] notification write failed (non-fatal)");
  });

  test("the notification is pushed over the existing realtime fan-out", () => {
    // Same primitive and event the customer bell already listens to — no new
    // socket subsystem, no new channel.
    expect(verificationSrc).toContain("sendToUser(targetUserId, \"\", CHANNELS.NOTIFICATION_CREATED");
    expect(chatSrc).toContain("sendToUser(userId, \"\", CHANNELS.NOTIFICATION_CREATED");
  });

  test("the seller bell reuses the one existing notification API", () => {
    for (const action of [
      "api.customer.myNotifications",
      "api.customer.markNotificationReadAction",
      "api.customer.markAllNotificationsRead",
    ]) {
      expect(bellSrc).toContain(action);
      // exactly one definition in the API surface — no duplicate endpoint
      expect(apiRoutesSrc.split(action).length - 1).toBe(1);
    }
    expect(bellSrc).toContain("/api/customer/notifications");
    // freshness: realtime event + polling fallback
    expect(bellSrc).toContain("onChatEvent(\"notification:created\"");
    expect(verificationSrc.includes("CHANNELS.NOTIFICATION_CREATED")).toBe(true);
    expect(bellSrc).toContain("setInterval");
  });

  test("notifications are scoped to the authenticated user", () => {
    const listStart = chatSrc.indexOf('app.get("/api/customer/notifications"');
    const listRoute = chatSrc.slice(listStart, chatSrc.indexOf("app.patch(", listStart));
    expect(listRoute).toContain("WHERE user_id = $1");
    expect(listRoute).toContain("req.user!.userId");
    // the client may never choose whose notifications are read
    expect(listRoute).not.toContain("req.query.user_id");
    expect(listRoute).not.toContain("req.body.user_id");
    // mark-as-read enforces ownership in the same statement
    expect(chatSrc).toContain("UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2");
  });

  test("the seller bell renders the mapped reason and deep-links the case", () => {
    expect(bellSrc).toContain("seller_verification_needs_correction");
    // reason code -> localized label via the shared vocabulary, not inline copy
    expect(bellSrc).toContain("REVIEW_REASON_CODES");
    expect(bellSrc).toContain("reasonCodeKey");
    // verificationId from the payload opens the seller's own verification flow
    expect(bellSrc).toContain("/seller/shop?verification=");
    expect(bellSrc).toContain("verificationId");
    // never a hard-coded seller/user id
    expect(bellSrc).not.toMatch(/seller[_-]?id\s*=\s*["']/i);
  });

  test("the bell is mounted in the seller header and the wizard honours the deep link", () => {
    expect(headerSrc).toContain("SellerNotificationBell");
    expect(myShopSrc).toContain('searchParams.get("verification")');
    expect(myShopSrc).toContain('setVerifyTarget({ kind: "seller" })');
    expect(myShopSrc).toContain("useSearchParams");
  });

  test("no second notification system exists", () => {
    for (const sql of [schemaSql, sqlEditor]) {
      expect(sql).toContain("CREATE TABLE IF NOT EXISTS notifications");
      expect(sql).not.toContain("seller_notifications");
      expect(sql).not.toContain("notifications2");
    }
    expect(apiRoutesSrc).not.toContain("/api/seller/notifications");
  });
});

// ─── Integration (needs DATABASE_URL) ──────────────────────────────────────

/** The exact statement `GET /api/admin/products/:productId/moderation-detail` ships. */
const OPTION_GROUPS_SQL = `SELECT pog.*, json_agg(jsonb_build_object('id', pov.id, 'value', pov.value, 'label', pov.label, 'sort_order', pov.sort_order, 'is_enabled', pov.is_enabled) ORDER BY pov.sort_order) as values
           FROM product_option_groups pog
           LEFT JOIN product_option_values pov ON pov.option_group_id = pog.id
           WHERE pog.product_id = $1
           GROUP BY pog.id
           ORDER BY pog.sort_order ASC`;

describe("product moderation detail (integration)", () => {
  const hasDb = Boolean(process.env.DATABASE_URL);
  const testFn = hasDb ? test : test.skip;

  testFn("executes for a product that has option groups (42P10 regression)", async () => {
    const { query } = await import("../db/index.js");
    const target = await query(
      `SELECT product_id FROM product_option_groups GROUP BY product_id ORDER BY COUNT(*) DESC LIMIT 1`,
    );
    const productId = target.rows[0]?.product_id;
    if (!productId) return; // nothing seeded in this environment
    const r = await query(OPTION_GROUPS_SQL, [productId]);
    expect(r.rows.length).toBeGreaterThan(0);
    for (const row of r.rows) {
      const values = Array.isArray(row.values) ? row.values.filter((v: any) => v && v.id) : [];
      // no duplicate values
      expect(new Set(values.map((v: any) => v.id)).size).toBe(values.length);
      // ordered by pov.sort_order
      const orders = values.map((v: any) => Number(v.sort_order));
      expect([...orders].sort((a, b) => a - b)).toEqual(orders);
    }
  });

  testFn("executes for a product without option groups", async () => {
    const { query } = await import("../db/index.js");
    const p = await query(
      `SELECT id FROM products p WHERE NOT EXISTS (SELECT 1 FROM product_option_groups g WHERE g.product_id = p.id) LIMIT 1`,
    );
    const productId = p.rows[0]?.id;
    if (!productId) return;
    const r = await query(OPTION_GROUPS_SQL, [productId]);
    expect(r.rows).toEqual([]);
  });

  testFn("every other moderation-detail section still queries", async () => {
    const { query } = await import("../db/index.js");
    const p = await query(`SELECT id FROM products LIMIT 1`);
    const productId = p.rows[0]?.id;
    if (!productId) return;
    for (const sql of [
      "SELECT * FROM product_images WHERE product_id = $1 ORDER BY sort_order ASC",
      "SELECT * FROM product_variants WHERE product_id = $1 ORDER BY sort_order ASC",
      "SELECT * FROM product_attributes WHERE product_id = $1 ORDER BY sort_order ASC",
      `SELECT mr.*, u.name as moderator_name FROM moderation_records mr LEFT JOIN users u ON mr.moderator_id = u.id WHERE mr.entity_type = 'product' AND mr.entity_id = $1 ORDER BY mr.created_at DESC LIMIT 20`,
    ]) {
      // must not throw — a broken section is what made the whole detail 500
      await query(sql, [productId]);
    }
  });
});
