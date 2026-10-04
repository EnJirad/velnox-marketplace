/**
 * `checkout_group_id` must be read from `orders` — and only from `orders`.
 *
 * THE PRODUCTION FAILURE THIS PINS
 * --------------------------------
 * Render reported, in order:
 *
 *   SELECT id FROM checkout_groups WHERE id = $1 AND user_id = $2      → worked
 *   SELECT id, shop_id, status, … FROM orders
 *     WHERE checkout_group_id = $1 ORDER BY …                           → worked
 *   …then the query that reads ORDER ITEMS:
 *     ERROR 42703  column "checkout_group_id" does not exist
 *
 * With `public.orders.checkout_group_id` confirmed present in Neon, a
 * 42703 naming that column UNQUALIFIED can only mean one thing: the statement's
 * FROM/JOIN scope contained no relation that has it. PostgreSQL reports the bare
 * column name exactly when nothing in scope resolves it — which is the whole
 * reason the two successful queries above do not raise it.
 *
 * So the failure mode this guards is a statement that filters a group while
 * reading `order_items`, where `orders` is not in scope:
 *
 *     FROM order_items oi LEFT JOIN products p … WHERE checkout_group_id = $1
 *
 * The fix for that is NEVER a new column. `checkout_group_id` is the
 * checkout-group → orders edge; reaching it from an item means joining up to
 * `orders` and qualifying: `o.checkout_group_id`.
 *
 * WHAT IS PROVEN HERE
 * -------------------
 *   1. STATIC — every SQL string in backend that mentions `checkout_group_id`
 *      either qualifies it, or has a relation in scope that owns it. A join
 *      that pulls `orders` in without qualifying is caught here, before deploy.
 *   2. LIVE — against a real PostgreSQL carrying the real schema, the exact
 *      statements the checkout flow runs are executed in order, over a real
 *      checkout_groups → orders → order_items fixture. The item statement is
 *      read out of `routes/stripe.ts` itself, so this test cannot drift from the
 *      query production runs.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import { query } from "../db/index.js";
import {
  readGroupOrders,
  readOwnedCheckoutGroup,
  sumGroupOrderTotal,
} from "../lib/checkout-groups.js";
import { hasTestDatabase } from "./helpers/test-db.js";

const root = join(import.meta.dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const USER = "cccccccc-0000-4000-8000-00000000c001";
const SELLER = "cccccccc-0000-4000-8000-00000000c002";
const SHOP_A = "cccccccc-0000-4000-8000-00000000c003";
const SHOP_B = "cccccccc-0000-4000-8000-00000000c004";
const PRODUCT_A = "cccccccc-0000-4000-8000-00000000c005";
const PRODUCT_B = "cccccccc-0000-4000-8000-00000000c006";
const GROUP = "cccccccc-0000-4000-8000-00000000c007";
const ORDER_A = "cccccccc-0000-4000-8000-00000000c008";
const ORDER_B = "cccccccc-0000-4000-8000-00000000c009";
const OWNER = "cccccccc-0000-4000-8000-00000000c00a";

// ── 1. static: SQL scope ────────────────────────────────────────────────────

/** Every backtick SQL string in backend/, with where it came from. */
function sqlBlocks(): Array<{ file: string; line: number; sql: string }> {
  const out: Array<{ file: string; line: number; sql: string }> = [];
  const walk = (dir: string) => {
    for (const entry of require("fs").readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "tests" || entry.name === "node_modules") continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const src = readFileSync(full, "utf8");
      for (const m of src.matchAll(/`([^`]*)`/g)) {
        if (!/\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(m[1]!)) continue;
        if (!m[1]!.includes("checkout_group_id")) continue;
        out.push({
          file: full.replace(`${root}/`, ""),
          line: src.slice(0, m.index).split("\n").length,
          sql: m[1]!,
        });
      }
    }
  };
  walk(join(root, "backend"));
  return out;
}

describe("every checkout_group_id reference resolves inside its own SQL scope", () => {
  const blocks = sqlBlocks();

  test("the scan actually found the checkout-group SQL", () => {
    // A scan that matched nothing would make every assertion below vacuous.
    expect(blocks.length).toBeGreaterThan(10);
    expect(blocks.some((b) => b.file.includes("stripe.ts"))).toBe(true);
    expect(blocks.some((b) => b.file.includes("checkout-groups.ts"))).toBe(true);
  });

  test("no statement filters on a bare checkout_group_id outside orders/payments", () => {
    const offenders: string[] = [];
    for (const { file, line, sql } of blocks) {
      const inScope = new Set(
        [...sql.matchAll(/(?:FROM|JOIN|INTO|UPDATE)\s+([a-z_][a-z_0-9]*)/gi)].map(
          (m) => m[1]!.toLowerCase(),
        ),
      );
      // A relation that legitimately owns the column.
      const owner = ["orders", "payments"].some((t) => inScope.has(t));
      if (owner) continue;
      offenders.push(`${file}:${line}  scope=[${[...inScope].join(", ")}]`);
    }
    expect(offenders).toEqual([]);
  });

  test("a multi-table statement qualifies the column or has orders in scope", () => {
    // The exact shape that produced 42703: order_items plus a group filter.
    const multi = blocks.filter((b) => /\border_items\b/.test(b.sql) && /orders/.test(b.sql));
    expect(multi.length).toBeGreaterThan(0);
    for (const { file, line, sql } of multi) {
      const qualified = /(?:[a-z_][a-z_0-9]*\.)checkout_group_id/.test(sql);
      const joinsOrders = /JOIN\s+orders\b/i.test(sql);
      expect(`${file}:${line} ${qualified || joinsOrders}`).toContain("true");
    }
  });

  test("no backend code invents checkout_group_id on order_items", () => {
    // The column belongs to the checkout-group → orders edge. A copy on
    // order_items would be a second source of truth for the same fact.
    const offenders = blocks
      .filter((b) => /\border_items\b/.test(b.sql) && /INSERT\s+INTO\s+order_items/i.test(b.sql))
      .filter((b) => /INSERT\s+INTO\s+order_items[\s\S]*?checkout_group_id/i.test(b.sql))
      .map((b) => `${b.file}:${b.line}`);
    expect(offenders).toEqual([]);
  });

  test("the item statement production runs qualifies o.checkout_group_id", () => {
    const src = read("backend/routes/stripe.ts");
    const block = src.match(/`[^`]*FROM order_items oi[^`]*`/g) ?? [];
    const groupItems = block.filter((b) => b.includes("checkout_group_id"));
    expect(groupItems.length).toBeGreaterThan(0);
    for (const sql of groupItems) {
      expect(sql).toMatch(/\bo\.checkout_group_id\s*=/);
    }
  });
});

// ── 2. live: the real statements over a real fixture ───────────────────────

describe.skipIf(!hasTestDatabase())("the checkout-group item read works on a real database", () => {
  beforeAll(async () => {
    await query(
      `INSERT INTO users (id, email, name, role) VALUES ($1, 'cgi-scope@test.local', 'CGI Scope', 'customer')
       ON CONFLICT (id) DO NOTHING`,
      [USER],
    );
    // sellers.user_id references users(id), so the owning account must exist too.
    await query(
      `INSERT INTO users (id, email, name, role) VALUES ($1, 'cgi-owner@test.local', 'CGI Owner', 'seller')
       ON CONFLICT (id) DO NOTHING`,
      [OWNER],
    );
    await query(
      `INSERT INTO sellers (id, user_id, status, verification_status) VALUES ($1, $2, 'approved', 'verified')
       ON CONFLICT (id) DO NOTHING`,
      [SELLER, OWNER],
    );
    await query(
      `INSERT INTO shops (id, seller_id, name, slug) VALUES ($1,$3,'Scope Shop A','cgi-scope-a'), ($2,$3,'Scope Shop B','cgi-scope-b')
       ON CONFLICT (id) DO NOTHING`,
      [SHOP_A, SHOP_B, SELLER],
    );
    await query(
      `INSERT INTO products (id, shop_id, name, slug, price, status) VALUES ($1,$3,'Scope P1','cgi-scope-p1',10,'active'), ($2,$4,'Scope P2','cgi-scope-p2',20,'active')
       ON CONFLICT (id) DO NOTHING`,
      [PRODUCT_A, PRODUCT_B, SHOP_A, SHOP_B],
    );
    await query(
      `INSERT INTO checkout_groups (id, user_id, total_amount, currency, item_count, shop_count)
       VALUES ($1,$2,30,'THB',2,2) ON CONFLICT (id) DO NOTHING`,
      [GROUP, USER],
    );
    await query(
      `INSERT INTO orders (id, user_id, shop_id, order_number, status, subtotal, total_amount, checkout_group_id)
       VALUES ($1,$4,$5,'180000000000000001','pending',10,10,$3), ($2,$4,$6,'180000000000000002','pending',20,20,$3)
       ON CONFLICT (id) DO NOTHING`,
      [ORDER_A, ORDER_B, GROUP, USER, SHOP_A, SHOP_B],
    );
    await query(
      `INSERT INTO order_items (order_id, product_id, shop_id, quantity, price, subtotal, product_name)
       VALUES ($1,$3,$4,1,10,10,'Scope P1'), ($2,$5,$6,1,20,20,'Scope P2')
       ON CONFLICT DO NOTHING`,
      [ORDER_A, ORDER_B, PRODUCT_A, SHOP_A, PRODUCT_B, SHOP_B],
    );
  });

  afterAll(async () => {
    await query(`DELETE FROM order_items WHERE order_id = ANY($1::uuid[])`, [[ORDER_A, ORDER_B]]);
    await query(`DELETE FROM orders WHERE id = ANY($1::uuid[])`, [[ORDER_A, ORDER_B]]);
    await query(`DELETE FROM checkout_groups WHERE id = $1`, [GROUP]);
    await query(`DELETE FROM products WHERE id = ANY($1::uuid[])`, [[PRODUCT_A, PRODUCT_B]]);
    await query(`DELETE FROM shops WHERE id = ANY($1::uuid[])`, [[SHOP_A, SHOP_B]]);
    await query(`DELETE FROM sellers WHERE id = $1`, [SELLER]);
    await query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[USER, OWNER]]);
  });

  test("step 1 — the group reads (the query the log shows working)", async () => {
    const group = await readOwnedCheckoutGroup(GROUP, USER);
    expect(group?.id).toBe(GROUP);
    expect(group?.shop_count).toBe(2);
  });

  test("step 2 — orders by group read through orders.checkout_group_id", async () => {
    const orders = await readGroupOrders({ query: (sql, p) => query(sql, p) }, GROUP);
    expect(orders.map((o) => o.id).sort()).toEqual([ORDER_A, ORDER_B].sort());
  });

  test("step 3 — the group total re-derives from the order rows", async () => {
    const { total } = await sumGroupOrderTotal({ query: (sql, p) => query(sql, p) }, GROUP);
    expect(total).toBe("30.00");
  });

  test("step 4 — THE FAILING STATEMENT: items by group, executed for real", async () => {
    // Taken verbatim out of routes/stripe.ts, so this is the query production
    // runs rather than a paraphrase of it.
    const src = read("backend/routes/stripe.ts");
    const sql =
      src
        .match(/`SELECT oi\.order_id[\s\S]*?ORDER BY oi\.order_id ASC, oi\.created_at ASC`/)?.[0]
        ?.replace(/^`|`$/g, "") ?? "";
    expect(sql, "the item statement was not found in backend/routes/stripe.ts").toContain(
      "FROM order_items oi",
    );
    expect(sql).toContain("JOIN orders o");

    // If this ever regresses to a bare `checkout_group_id`, PostgreSQL raises
    // 42703 here exactly as it did in production. The parameter stays bound,
    // exactly as production sends it — substituting the id into the text would
    // test a different statement than the one that failed.
    const res = await query(sql, [GROUP]);
    expect(res.rows.length).toBe(2);
    expect(res.rows.map((r: any) => r.order_id).sort()).toEqual([ORDER_A, ORDER_B].sort());
  });

  test("step 4b — a group filter with orders OUT of scope reproduces 42703", async () => {
    // Negative control, and the shape production actually hit.
    //
    // Simply dropping the `o.` alias does NOT break: `orders` is joined in that
    // statement, so a bare name still resolves to it. PostgreSQL only raises 42703
    // for an unqualified column when NO relation in scope owns it — which means the
    // failing statement read `order_items` WITHOUT `orders` in its FROM/JOIN list.
    // That is what is reproduced here, against the same schema and the same rows.
    //
    // Without this control, step 4 could pass merely because the fixture cannot
    // produce the error at all.
    const broken = `SELECT oi.order_id
        FROM order_items oi
       WHERE checkout_group_id = $1
       ORDER BY oi.created_at ASC`;
    let message = "";
    let code = "";
    try {
      await query(broken, [GROUP]);
    } catch (err: any) {
      code = String(err?.code ?? "");
      message = String(err?.message ?? "");
    }
    expect(code).toBe("42703");
    expect(message).toContain("checkout_group_id");
    expect(message).toContain("does not exist");

    // And the qualified form of that same join — the fix — must succeed.
    const fixed = `SELECT oi.order_id
        FROM order_items oi
        JOIN orders o ON o.id = oi.order_id
       WHERE o.checkout_group_id = $1
       ORDER BY oi.created_at ASC`;
    const res = await query(fixed, [GROUP]);
    expect(res.rows.length).toBe(2);
  });

  test("step 5 — items are reached through order_id, never a group column", async () => {
    const res = await query(
      `SELECT oi.order_id, oi.product_name FROM order_items oi WHERE oi.order_id = ANY($1::uuid[]) ORDER BY oi.order_id`,
      [[ORDER_A, ORDER_B]],
    );
    expect(res.rows.length).toBe(2);
    // order_items genuinely has no group column; the link is order_items → orders.
    const own = await query(
      `SELECT count(*)::int AS n FROM information_schema.columns
        WHERE table_schema='public' AND table_name='order_items' AND column_name='checkout_group_id'`,
    );
    expect(own.rows[0].n).toBe(0);
  });
});