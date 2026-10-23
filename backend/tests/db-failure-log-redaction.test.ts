/**
 * A failing database statement must be ATTRIBUTABLE without leaking anything.
 *
 * WHY
 * ---
 * Production logged `statement: "SELECT"` for a 42703 on `checkout_group_id` and
 * that was useless: every failing statement logs the same word, so the error
 * could not be attributed to a file or a route. The fix logs the redacted
 * statement and its relation scope.
 *
 * The risk that fix introduces is obvious and is the reason these tests exist:
 * SQL text carries values. `WHERE email = 'buyer@example.com'` must never reach a
 * log line, and neither must a dollar-quoted function body containing a secret.
 * Parameters were never interpolated and still are not — only the SHAPE is
 * printed.
 */
import { describe, expect, test } from "bun:test";

import { sqlForLog, sqlTablesForLog } from "../db/index.js";

describe("sqlForLog redacts every literal", () => {
  test("a single-quoted value never survives", () => {
    const out = sqlForLog(
      "SELECT id FROM users WHERE email = 'buyer@example.com' AND status = 'active'",
    )!;
    expect(out).not.toContain("buyer@example.com");
    expect(out).not.toContain("active");
    expect(out).toContain("?");
  });

  test("a value containing an escaped quote is still redacted", () => {
    const out = sqlForLog("SELECT * FROM t WHERE name = 'O''Brien'")!;
    expect(out).toBe("SELECT * FROM t WHERE name = ?");
    expect(out).not.toContain("Brien");
  });

  test("a dollar-quoted body is removed whole", () => {
    const out = sqlForLog(
      `CREATE OR REPLACE FUNCTION f() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'secret-token-abc'; END; $$ LANGUAGE plpgsql`,
    )!;
    expect(out).not.toContain("secret-token-abc");
  });

  test("a comment cannot hide or inject a value", () => {
    const out = sqlForLog("SELECT 1 -- password = 'hunter2'")!;
    expect(out).not.toContain("hunter2");
  });

  test("the shape of the statement is still readable", () => {
    const out = sqlForLog(
      "SELECT oi.order_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.checkout_group_id = $1",
    )!;
    // The identifier a 42703 names must survive — that is the whole point.
    expect(out).toContain("order_items");
    expect(out).toContain("o.checkout_group_id");
  });

  test("a placeholder is not mistaken for a literal", () => {
    const out = sqlForLog("SELECT 1 WHERE a = 'x' AND b = 'y'")!;
    expect(out.match(/\?/g)?.length).toBe(2);
  });

  test("empty and null input are handled", () => {
    expect(sqlForLog(null)).toBeNull();
    expect(sqlForLog("")).toBeNull();
    expect(sqlForLog("   \n  ")).toBeNull();
  });

  test("a very long statement is truncated, not dumped", () => {
    const out = sqlForLog(`SELECT ${"a,".repeat(2000)}z FROM t`)!;
    expect(out.length).toBeLessThanOrEqual(400);
  });

  test("no parameter placeholder is ever filled in with a value", () => {
    // The caller passes params separately and they are never interpolated, so
    // this is the shape of what actually reaches the log.
    const out = sqlForLog("SELECT * FROM users WHERE id = $1 AND token = $2")!;
    expect(out).toContain("$1");
    expect(out).toContain("$2");
    expect(out).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}/i);
  });
});

describe("sqlTablesForLog names the scope a column must resolve in", () => {
  test("it reports every relation in the statement", () => {
    const tables = sqlTablesForLog(
      `SELECT oi.order_id FROM order_items oi JOIN orders o ON o.id = oi.order_id WHERE o.checkout_group_id = $1`,
    );
    expect(tables.sort()).toEqual(["order_items", "orders"]);
  });

  test("it is what makes an unqualified column attributable", () => {
    // order_items alone: nothing in scope owns checkout_group_id -> 42703.
    expect(sqlTablesForLog("SELECT 1 FROM order_items oi WHERE checkout_group_id = $1")).toEqual([
      "order_items",
    ]);
  });

  test("null input yields no relations", () => {
    expect(sqlTablesForLog(null)).toEqual([]);
  });
});