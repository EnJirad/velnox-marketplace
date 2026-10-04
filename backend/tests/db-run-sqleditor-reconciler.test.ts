/**
 * `db/run-sqleditor.sql` — the rerunnable additive reconciler.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `helpers/canonical-schema.ts` proves the reconciler DECLARES everything
 * `db/schema.sql` declares. That is necessary but not sufficient, because the two
 * files answer different questions:
 *
 *   snapshot    → what the current schema IS
 *   reconciler  → what has to happen to a database that ALREADY HAS DATA
 *
 * The clearest gap that leaves: add a column to `db/schema.sql` and the parity
 * test still passes, because Part 1 carries the new `CREATE TABLE` body verbatim
 * and the parity check only compares what is declared. But a database created
 * BEFORE that column existed would silently never receive it — which is the
 * entire reason the column pass exists. Nothing else in the suite catches that,
 * and the failure mode is invisible: the run exits 0 and the checkout breaks
 * later, in production.
 *
 * So this file pins the guarantees that make a rerun safe, each of which is a
 * property of the FILE rather than of the current schema:
 *
 *   1. every declared column also has an `ADD COLUMN IF NOT EXISTS` pass;
 *   2. every declared index is created, and AFTER that column pass — an index on
 *      a column an older database lacks aborts the whole run;
 *   3. no foreign key, unique/check constraint or trigger is added unguarded,
 *      because a bare `ADD CONSTRAINT` / `CREATE TRIGGER` fails on the second run;
 *   4. the file stays additive: no DROP TABLE / DROP COLUMN / TRUNCATE / DELETE;
 *   5. no `EXCEPTION` handler anywhere, so a failure cannot masquerade as success;
 *   6. it still carries its read-only verification queries;
 *   7. it ASSERTS rather than only reports, so a green run means the database
 *      was reconciled instead of merely uneventful.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import {
  createTableBlock,
  declaredColumns,
  declaredIndexNames,
  declaredTables,
  stripSqlComments,
  unqualified,
} from "./helpers/canonical-schema.js";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const schema = read("db/schema.sql");
const reconciler = read("db/run-sqleditor.sql");
const code = stripSqlComments(reconciler);
// The reconciler qualifies every statement that mutates an existing table and pins
// search_path, so `public.orders` and `orders` are the same object here. Compare
// unqualified so the assertions below are about WHAT exists, not its spelling.
const flat = unqualified(code);

const lineOf = (needle: string): number => {
  const at = code.indexOf(needle);
  expect(at, `db/run-sqleditor.sql lost "${needle}"`).toBeGreaterThan(-1);
  return code.slice(0, at).split("\n").length;
};

describe("the column pass reaches every column the schema declares", () => {
  const tables = declaredTables(schema);
  const missing: string[] = [];

  for (const table of tables) {
    for (const column of declaredColumns(schema, table)) {
      if (
        !flat.includes(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column} `) &&
        !flat.includes(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${column}\n`)
      ) {
        missing.push(`${table}.${column}`);
      }
    }
  }

  test("no declared column is missing its ADD COLUMN IF NOT EXISTS", () => {
    expect(missing).toEqual([]);
  });

  test("the pass covers the whole schema, not a sample", () => {
    expect(tables.length).toBeGreaterThan(60);
    expect(missing.length).toBe(0);
  });

  test("every table body in the reconciler is the one db/schema.sql declares", () => {
    // Part 1 carries the snapshot's CREATE TABLE blocks verbatim. If someone adds
    // a column to the snapshot and forgets to regenerate the additive passes, this
    // is where the table body diverges.
    const divergent = tables.filter(
      (t) => createTableBlock(schema, t) !== createTableBlock(reconciler, t),
    );
    expect(divergent).toEqual([]);
  });
});

describe("nothing is created before what it depends on", () => {
  test("every index is created after the last column is added", () => {
    const lastColumn = lineOf("ADD COLUMN IF NOT EXISTS");
    const allColumnLines = [...code.matchAll(/ADD COLUMN IF NOT EXISTS/g)].map(
      (m) => code.slice(0, m.index).split("\n").length,
    );
    const last = Math.max(...allColumnLines);

    const firstIndex = Math.min(
      ...[...code.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/g)].map(
        (m) => code.slice(0, m.index).split("\n").length,
      ),
    );

    expect(firstIndex).toBeGreaterThan(last);
    expect(lastColumn).toBeGreaterThan(-1);
  });

  test("no index is created in the table section", () => {
    // Part 1 is the snapshot's table declarations. An index sitting there aborts
    // the run against any database that is missing the column it is built on, so
    // none may appear before the column pass has started. (The PART headers are
    // comments and are stripped, so the column pass itself is the boundary.)
    const partOneEnd = lineOf("ADD COLUMN IF NOT EXISTS");
    const stray = [...code.matchAll(/CREATE (?:UNIQUE )?INDEX IF NOT EXISTS/g)]
      .map((m) => code.slice(0, m.index).split("\n").length)
      .filter((line) => line < partOneEnd);
    expect(stray).toEqual([]);
  });

  test("every declared index name is present", () => {
    const declared = declaredIndexNames(schema);
    const missing = declared.filter(
      (name) => !flat.includes(`INDEX IF NOT EXISTS ${name} `) && !flat.includes(`INDEX IF NOT EXISTS ${name}\n`),
    );
    expect(missing).toEqual([]);
    expect(declared.length).toBeGreaterThan(100);
  });
});

describe("nothing is added without a guard", () => {
  test("every ADD CONSTRAINT is inside a pg_constraint-guarded block", () => {
    // A bare `ALTER TABLE … ADD CONSTRAINT` is exactly the statement that fails
    // on the second run, so each one must be preceded by an existence check on
    // pg_constraint naming THAT SAME constraint, inside its own DO block.
    const probeAdds = new Set<string>();
    const unguarded: string[] = [];

    for (const m of code.matchAll(/ADD CONSTRAINT ([a-z_][a-z_0-9]*)/g)) {
      const name = m[1]!;
      const before = code.slice(0, m.index);
      const blockStart = before.lastIndexOf("DO $$");
      const guard = before.lastIndexOf(`conname = '${name}'`);
      if (guard > blockStart) continue;

      // The one legitimate exception: PART 5c adds a throwaway CHECK to a TEMP
      // table it created two lines earlier in the same block, which therefore
      // cannot already exist. That has to be proven, not assumed.
      if (name.startsWith("velnox_defn_probe")) {
        const block = before.slice(blockStart);
        const createdProbe = /CREATE TEMP TABLE (velnox_defn_probe_\d+) \(LIKE public\./.exec(block);
        if (createdProbe) {
          probeAdds.add(createdProbe[1]!);
          continue;
        }
      }
      unguarded.push(name);
    }

    expect(unguarded).toEqual([]);
    expect(probeAdds.size).toBeGreaterThan(0);
  });

  test("the trigger is guarded on pg_trigger", () => {
    expect(code).toMatch(
      /FROM pg_trigger\s+WHERE tgname = 'trg_prevent_circular_category_parent'/,
    );
    expect(code).toContain("NOT tgisinternal");
  });

  test("both extensions are created conditionally", () => {
    expect(code).toContain('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
    expect(code).toContain('CREATE EXTENSION IF NOT EXISTS "pgcrypto"');
  });
});

describe("the file stays additive and honest", () => {
  const banned: Array<[string, RegExp]> = [
    ["DROP TABLE", /^\s*DROP\s+TABLE\b/im],
    ["DROP COLUMN", /^\s*(?:ALTER\s+TABLE\s+\w+\s+)?DROP\s+COLUMN\b/im],
    ["TRUNCATE", /^\s*TRUNCATE\b/im],
    ["DELETE", /^\s*DELETE\s+FROM\b/im],
    ["EXCEPTION handler", /EXCEPTION\s+WHEN\b/i],
  ];

  for (const [label, pattern] of banned) {
    test(`contains no ${label}`, () => {
      expect(code).not.toMatch(pattern);
    });
  }

  test("the one DROP CONSTRAINT is the one migration 054 superseded", () => {
    const drops = [...code.matchAll(/^\s*ALTER TABLE (\w+) DROP CONSTRAINT (?:IF EXISTS )?(\w+)/gim)]
      .map((m) => `${m[1]}.${m[2]}`)
      .filter((name) => !name.startsWith("velnox_defn_probe"));
    // payments_exactly_one_parent_check is retired on purpose (migration 054);
    // the five status/pricing checks are only dropped when the stored definition
    // differs from db/schema.sql.
    for (const name of drops) {
      expect([
        "payments.payments_exactly_one_parent_check",
        "velrepeat_pricing_snapshots.velrepeat_pricing_snapshots_cycle_price_not_null",
        "velrepeat_pricing_snapshots.velrepeat_pricing_snapshots_total_not_below_cycle",
        "velrepeat_plans.velrepeat_plans_status_check",
        "velrepeat_runs.velrepeat_runs_status_check",
        "sellers.sellers_status_check",
        "orders.orders_status_check",
      ]).toContain(name);
    }
    expect(code).toContain("ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_exactly_one_parent_check");
  });

  test("it still carries its read-only verification queries", () => {
    expect(code).toContain("to_regclass('public.checkout_groups')");
    // PART 7 reports BOTH group columns with their type, not one table's name.
    expect(code).toContain("c.table_name IN ('orders','payments')");
    expect(code).toContain("c.column_name='checkout_group_id'");
    expect(code).toContain("c.udt_name AS data_type");
    expect(code).toContain("idx_payments_one_active_stripe_group");
  });

  test("the checkout_groups objects the payment flow depends on are all declared", () => {
    for (const object of [
      "CREATE TABLE IF NOT EXISTS checkout_groups",
      "idx_checkout_groups_user",
      "orders_checkout_group_id_fkey",
      "idx_orders_checkout_group",
      "payments_checkout_group_id_fkey",
      "idx_payments_checkout_group",
      "idx_payments_one_active_stripe_group",
    ]) {
      expect(code).toContain(object);
    }
  });

  // The assertion block is located from the END of the read-only PART 7, not from
// its own "-- PART 8" header: `code` has comments stripped, so a header-based
// search silently yields -1 and every `slice(-1, …)` after it becomes a
// one-character vacuous pass. Anchoring on the last PART 7 statement instead puts
// the whole assertion block in the slice.
const PART7_END = "UNION ALL SELECT 'indexes', count(*)::text FROM pg_indexes";
const PART8_ANCHOR = "RAISE EXCEPTION 'velnox: run-sqleditor.sql finished";
const part8 = code.slice(code.indexOf(PART7_END));

test("the run ASSERTS, it does not only report", () => {
    // A verification query that only prints can be ignored and still be a green
    // run. PART 8 raises instead, so "PASS" cannot mean "the script stayed
    // quiet". db/verify-reconciler.sh proves the behaviour against a real
    // database; this pins that the assertion is still in the file.
    expect(reconciler).toContain("PART 8 - assertion");
    expect(part8).toContain(PART8_ANCHOR);
    // Every object the checkout flow reads or writes must be one it checks.
    for (const object of [
      "to_regclass('public.checkout_groups')",
      "table_name='orders'",
      "table_name='payments'",
      "column_name='checkout_group_id'",
      "indexname='idx_checkout_groups_user'",
      "indexname='idx_orders_checkout_group'",
      "indexname='idx_payments_checkout_group'",
      "indexname='idx_payments_one_active_stripe_group'",
      "conname='orders_checkout_group_id_fkey'",
      "conname='payments_checkout_group_id_fkey'",
    ]) {
      expect(part8).toContain(object);
    }
  });

  test("the assertion checks TYPE and DEPENDENCY, not only names", () => {
    // WHY. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS <name> <type>` is a NO-OP
    // when a column of that NAME already exists under a different type, and a
    // foreign key is never dropped by a name check. Both pass a name-only
    // verification and both then fail at runtime — the reported incident is
    // exactly `42703 column "checkout_group_id" does not exist` in the payment
    // path. So existence is the least this file may claim.
    //
    // BOTH group columns must be pinned to `uuid` — the code binds a UUID, and
    // `orders` was reconciled first, so one without the other is a half-fix.
    const typedColumns = [...part8.matchAll(/column_name='checkout_group_id'\s+AND udt_name='uuid'/g)];
    expect(typedColumns.length, "both group columns must be asserted as uuid").toBe(2);

    // The index assertion must require the column to be IN the index, so an
    // index of the right name over the wrong column cannot pass. All three
    // group indexes are keyed on `checkout_group_id` — note that
    // `idx_payments_one_active_stripe_group` does not carry the name, so this
    // is checked by name rather than by pattern.
    for (const indexName of [
      "idx_orders_checkout_group",
      "idx_payments_checkout_group",
      "idx_payments_one_active_stripe_group",
    ]) {
      expect(part8).toMatch(
        new RegExp(`indexname='${indexName}'\\s*\\n?\\s*AND indexdef LIKE '%\\(checkout_group_id\\)%'`),
      );
    }

    // The foreign keys must assert the PARENT and the delete rule.
    // `confdeltype='n'` is SET NULL, the architecture's rule: deleting a
    // checkout group must not take its payment rows with it.
    const fkChecks = [...part8.matchAll(/conname='([a-z_]*checkout_group_id_fkey)'\s*\n?\s*AND rel\.relname='checkout_groups' AND con\.confdeltype='n'/g)];
    expect(fkChecks.length, "both group foreign keys must assert parent and ON DELETE SET NULL").toBe(2);

    // And PART 7 must REPORT the type, so an operator reading the run's output
    // sees the table | column | type row rather than a bare column name.
    // Anchored on a surviving statement, never on the `-- PART 7` header: `code`
    // has comments stripped, so a header search yields -1 and the slice is empty.
    const PART7_START = "SELECT 'checkout_groups' AS object, to_regclass('public.checkout_groups')";
    const part7 = code.slice(code.indexOf(PART7_START), code.indexOf(PART7_END));
    expect(part7.length, "the PART 7 slice was empty — the anchor moved").toBeGreaterThan(0);
    expect(part7).toContain("udt_name AS data_type");
    expect(part7).toContain("on_delete_action");
  });

  test("the assertion is not weakened to a name-only check by a later edit", () => {
    // Regression guard on the exact strings above, so a future "simplification"
    // back to existence-only fails here rather than in production.
    expect(part8).not.toMatch(/column_name='checkout_group_id'\s*\)\s*THEN/);
    expect(part8).toContain("missing or have the wrong shape");
  });

  test("the assertion cannot swallow its own failure", () => {
    // An EXCEPTION handler anywhere near it would turn the failure back into a
    // silent pass, which is the exact outcome this file exists to prevent.
    expect(part8.length).toBeGreaterThan(500);
    expect(part8).not.toMatch(/EXCEPTION\s+WHEN/i);
  });
});