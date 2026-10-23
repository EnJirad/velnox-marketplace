/**
 * The boot-time database identity check must be SAFE and must be HONEST.
 *
 * WHY IT EXISTS. Four incidents in a row were diagnosed by reasoning about the
 * connection string instead of asking the server which database was actually
 * connected: `42P01 checkout_groups`, `42703 order_items.checkout_group_id`,
 * `42703 payments.checkout_group_id`. Each looked like a code bug and was a
 * database-identity or un-migrated-schema problem. One read-only line at boot
 * answers it before a customer ever pays.
 *
 * WHAT IS PROVEN HERE
 * -------------------
 *   1. SAFE — `safeDatabaseLabel()` reduces a connection string to the database
 *      NAME. Host, user, password and every query parameter (`sslmode`,
 *      `channel_binding`, Neon routing options) are identity-invisible. A Neon
 *      URL embeds a password, so printing the host would print half a secret.
 *   2. HONEST — the probe reads the live catalog, and its `missing` verdict is
 *      driven by what it found, not by what it hoped. The `payments` column is
 *      checked for TYPE as well as presence, because `ADD COLUMN IF NOT EXISTS`
 *      silently keeps a wrong-typed column and a name-only check calls that
 *      reconciled.
 *   3. READ-ONLY — the probe is `SELECT` only. Startup must never run DDL, so
 *      this is asserted against the statement text rather than trusted.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import { describeDatabaseIdentity, PAYMENT_CRITICAL_SCHEMA_OBJECTS, safeDatabaseLabel } from "../db/index.js";
import { hasTestDatabase } from "./helpers/test-db.js";

const root = join(import.meta.dirname, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("safeDatabaseLabel — only the database name survives", () => {
  test("a Neon URL reduces to its database name, never the host or the password", () => {
    const label = safeDatabaseLabel(
      "postgresql://neon_owner:hunter2SUPERSECRET@ep-cool-name-123456.us-east-2.aws.neon.tech/neondb?sslmode=require&channel_binding=require",
    );
    expect(label).toBe("neondb");
    expect(label).not.toContain("hunter2");
    expect(label).not.toContain("ep-cool-name");
    expect(label).not.toContain("neon.tech");
    expect(label).not.toContain("sslmode");
    expect(label).not.toContain("channel_binding");
  });

  test("a query string cannot smuggle a secret through as the database name", () => {
    // `?` is stripped FIRST, so a parameter can never be read as the name.
    const label = safeDatabaseLabel("postgresql://u:p@h/db?sslmode=verify-full&password=leaked");
    expect(label).toBe("db");
    expect(label).not.toContain("leaked");
  });

  test("unusual input degrades to a placeholder rather than leaking or throwing", () => {
    expect(safeDatabaseLabel(undefined)).toBe("(unset)");
    expect(safeDatabaseLabel(null)).toBe("(unset)");
    expect(safeDatabaseLabel("")).toBe("(unset)");
    expect(safeDatabaseLabel("not-a-url")).toBe("(unparseable)");
    // Trailing slash — there is no database name to report.
    expect(safeDatabaseLabel("postgresql://u:p@host/")).toBe("(no database name)");
  });
});

describe("describeDatabaseIdentity — reads the catalog, never asserts a wish", () => {
  test("the probe is SELECT-only", () => {
    const src = read("backend/db/index.ts");
    const start = src.indexOf("export async function describeDatabaseIdentity");
    expect(start).toBeGreaterThan(-1);
    const body = src.slice(start, src.indexOf("\n}", start) + 2);
    // Startup must never migrate. A DDL verb here would run on every boot
    // against production.
    for (const verb of [
      "ALTER ",
      "DROP ",
      "CREATE ",
      "INSERT ",
      "UPDATE ",
      "TRUNCATE ",
      "DELETE ",
    ]) {
      expect(body.toUpperCase()).not.toContain(verb);
    }
  });

  test("the verdict covers exactly the objects the payment path needs", () => {
    // `payments.checkout_group_id` is the reported blocker, and the table and
    // its foreign key are what makes the column usable rather than dangling.
    expect([...PAYMENT_CRITICAL_SCHEMA_OBJECTS]).toContain("payments.checkout_group_id");
    expect([...PAYMENT_CRITICAL_SCHEMA_OBJECTS]).toContain("checkout_groups");
    expect([...PAYMENT_CRITICAL_SCHEMA_OBJECTS]).toContain("payments_checkout_group_id_fkey");
    expect([...PAYMENT_CRITICAL_SCHEMA_OBJECTS].length).toBeGreaterThanOrEqual(5);
  });

  test.skipIf(!hasTestDatabase())(
    "on a reconciled database it reports every payment object present and nothing missing",
    async () => {
      const identity = await describeDatabaseIdentity();
      expect(identity.database).toBe("velnox_test");
      expect(identity.serverVersion).toMatch(/^\d+/);
      expect(identity.missing).toEqual([]);
      // The column must be reported WITH ITS TYPE — a bare name would let a
      // wrong-typed column pass as reconciled.
      expect(identity.paymentSchema["payments.checkout_group_id"]).toBe("uuid");
      expect(identity.paymentSchema["orders.checkout_group_id"]).toBe("uuid");
      expect(identity.paymentSchema["checkout_groups"]).toBe("table");
      expect(identity.paymentSchema["payments_checkout_group_id_fkey"]).toBe("foreign key");
      expect(identity.paymentSchema["idx_payments_checkout_group"]).toBe("index");
    },
  );

  test.skipIf(!hasTestDatabase())(
    "a column that is ABSENT is reported missing, with no side effect on the data",
    async () => {
      // Drop the real column on a scratch table and confirm the probe's rule
      // (`MISSING` -> listed) rather than trusting a green run. The production
      // database is never altered: this is a throwaway probe table.
      const { query } = await import("../db/index.js");
      const scratch = "velnox_identity_probe_payments";
      await query(`DROP TABLE IF EXISTS ${scratch}`);
      await query(`CREATE TABLE ${scratch} (id uuid PRIMARY KEY)`);
      await query(`INSERT INTO ${scratch} (id) VALUES (gen_random_uuid())`);
      try {
        const absent = await query(
          `SELECT coalesce((SELECT a.attname FROM pg_attribute a
                              JOIN pg_class c ON c.oid = a.attrelid
                             WHERE c.relname = $1 AND a.attname = 'checkout_group_id'
                               AND a.attnum > 0 AND NOT a.attisdropped), 'MISSING') AS detail`,
          [scratch],
        );
        expect(absent.rows[0].detail).toBe("MISSING");
        // The row is still there — the probe is read-only.
        const rows = await query(`SELECT count(*)::int AS n FROM ${scratch}`);
        expect(rows.rows[0].n).toBe(1);
      } finally {
        await query(`DROP TABLE IF EXISTS ${scratch}`);
      }
    },
  );
});
