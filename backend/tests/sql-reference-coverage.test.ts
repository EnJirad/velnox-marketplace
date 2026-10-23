/**
 * SQL reference coverage — every table, index and function the backend's SQL
 * names must be declared by `db/schema.sql`.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * `db/schema.sql` is the single canonical schema: there is no migration
 * directory any more, and `db/run-sqleditor.sql` reconciles an existing
 * database to that snapshot. A query that names a table, index or function the
 * snapshot does not declare is therefore not a "lagging migration" any more —
 * it is a runtime failure: PostgreSQL answers with 42P01 (undefined table),
 * 42703 (undefined column) or 3F000 (undefined schema-object) on the first
 * request that reaches it, and the backend cannot boot its way around it.
 *
 * The complementary guard lives in `schema-drift.test.ts` in the other
 * direction (the snapshot must never ALTER a table it does not CREATE). This
 * file asks the question a cleanup of this kind actually breaks: does everything
 * the code NAMES still exist in the file that is left?
 *
 * HOW IT READS THE SOURCE (and why it is not a naive grep)
 * -------------------------------------------------------
 * A raw source scan cannot distinguish SQL from prose: a JSDoc line like
 * "…deleted FROM the row below…" or a log message that quotes a table would be
 * read as a query. So the scan is deliberately narrow:
 *
 *   1. only TEMPLATE LITERALS are scanned — this backend writes every query
 *      inside backticks (`.query(\`SELECT …\`)`), so that is the honest slice
 *      of the source; quoted prose and comments are not SQL and are not read;
 *   2. `${…}` interpolations are replaced before matching — they are
 *      TypeScript expressions, and a name inside one is a bind value, not a
 *      relation;
 *   3. SQL comments (`-- …`, `/* … *\/`) are stripped from the extracted text,
 *      so a commented-out statement or a comment that quotes a table name does
 *      not count as a reference;
 *   4. a relation reference is accepted only when the identifier is followed by
 *      a token that can follow a relation name in SQL (`WHERE`, `SET`, `(`,
 *      `,`, an alias keyword, …). `FROM the row below` is documentation and
 *      never matches; `FROM orders WHERE` always does;
 *   5. CTE names (`WITH x AS (…)` / `, x AS (…)`) are relations the STATEMENT
 *      declares, not the schema — they are collected and excluded;
 *   6. `pg_catalog`/`information_schema` relations are PostgreSQL's own, and
 *      `LATERAL` is a keyword that may follow FROM/JOIN — all three are
 *      excluded from the relation names.
 *
 * VACUITY IS TESTED, NOT ASSUMED. The last failure mode of a scanner test is
 * passing forever because it stopped finding anything: the final test in this
 * file pins the scan's own yield (file count, SQL volume, distinct references
 * found), so a refactor that broke the extraction fails here instead of
 * silently disabling the guard.
 *
 * WHAT IS NOT COVERED
 * -------------------
 * Columns, CHECK vocabularies and constraint definitions — those are asserted
 * against the snapshot by `schema-drift.test.ts`, `order-status-check-constraint.test.ts`
 * and the canonical-parity helper, which compare declarations rather than
 * references.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

import {
  declaredFunctions,
  declaredIndexNames,
  declaredTables,
} from "./helpers/canonical-schema.js";

const root = join(import.meta.dir, "..", "..");
const schemaSql = readFileSync(join(root, "db", "schema.sql"), "utf8");

const TABLES = new Set(declaredTables(schemaSql));
const INDEXES = new Set(declaredIndexNames(schemaSql));
const FUNCTIONS = new Set(declaredFunctions(schemaSql));

// ─── The scanned surface ────────────────────────────────────────────────────

/** Backend runtime sources. Tests quote dropped statements on purpose. */
const backendSources: Array<readonly [string, string]> = [
  ...new Bun.Glob("backend/**/*.ts").scanSync({ cwd: root }),
]
  .filter((file) => !file.startsWith("backend/tests/"))
  .map((file) => [file, readFileSync(join(root, file), "utf8")] as const);

/** Every template literal in one source, with TS expressions and SQL comments removed. */
function sqlStrings(src: string): string[] {
  return [...src.matchAll(/`([\s\S]*?)`/g)]
    .map((m) => m[1]!)
    .map((s) => s.replace(/\$\{[^}]*\}/g, " ? "))
    .map((s) => s.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " "));
}

/**
 * Tokens that may legally follow a relation name. A candidate `FROM <word>` is
 * only a reference when the next token is one of these or a structural
 * character — this is what keeps English prose out of the result set.
 */
const AFTER_TABLE = new Set(
  "where set returning for group order limit offset union intersect except left right inner outer cross join as on values select from".split(
    " ",
  ),
);

/** Relation names one statement references (CTEs removed, system catalogs excluded). */
function tableReferences(sql: string): string[] {
  const ctes = new Set(
    [...sql.matchAll(/(?:\bWITH\s+|,\s*)([a-z_][a-z_0-9_]*)\s+AS\s*\(/gi)].map((m) =>
      m[1]!.toLowerCase(),
    ),
  );
  const out: string[] = [];
  for (const m of sql.matchAll(
    /\b(?:FROM|INTO|UPDATE|JOIN|TABLE)\s+(?:ONLY\s+)?(?:public\.)?([a-z_][a-z_0-9]*)\b/gi,
  )) {
    const name = m[1]!.toLowerCase();
    // `JOIN LATERAL (…)` — a keyword, not a relation.
    if (name === "lateral") continue;
    if (/^(pg_|information_schema)/.test(name)) continue;
    if (ctes.has(name)) continue;
    // The decision is made on what FOLLOWS the identifier, after its
    // whitespace: `INSERT INTO t (col …` and `FROM orders WHERE …` are both
    // references, and `from the row below` is not.
    const tail = sql.slice(m.index! + m[0].length).trimStart();
    const first = tail.charAt(0);
    const nextWord = (tail.match(/^[a-z_]+/i)?.[0] ?? "").toLowerCase();
    if ("(,);".includes(first) || AFTER_TABLE.has(nextWord)) {
      out.push(name);
    }
  }
  return out;
}

/**
 * Underscored PostgreSQL built-ins. A callee containing an underscore is either
 * a project function — which `db/schema.sql` must declare — or one of these.
 * The list is explicit on purpose: adding a name here is a decision that has to
 * be read, not a permissive wildcard.
 */
const PG_BUILTINS = new Set(
  `uuid_generate_v4 uuid_generate_v1v4 gen_random_uuid set_config current_setting current_schema current_database
nextval pg_advisory_lock pg_advisory_unlock pg_advisory_xact_lock to_regclass to_regtype to_jsonb to_json to_char
to_date to_timestamp jsonb_build_object json_build_object jsonb_array_elements jsonb_array_elements_text jsonb_set
jsonb_array_length json_agg bool_or row_to_json string_agg array_agg date_trunc date_part regexp_replace regexp_match
string_to_array string_to_table quotename pg_get_constraintdef pg_get_indexdef pg_get_expr pg_size_pretty split_part
substring strpos position overlay format_type`
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => s.toLowerCase()),
);

/**
 * Every reference of one kind the backend makes that `db/schema.sql` does not
 * declare, as `file: name` so a failure names the exact query to fix.
 */
function undeclared(kind: "table" | "index" | "function"): string[] {
  const missing = new Set<string>();
  for (const [file, src] of backendSources) {
    for (const sql of sqlStrings(src)) {
      if (kind === "table") {
        for (const name of tableReferences(sql)) {
          if (!TABLES.has(name)) missing.add(`${file}: ${name}`);
        }
      } else if (kind === "index") {
        // Only names the code itself asserts on: an index reference is a name
        // the query planner hint, a test assertion or a guarded create depends
        // on, and each one must exist in the snapshot.
        for (const m of sql.matchAll(/\b(?:idx|uq)_[a-z0-9_]+/g)) {
          if (!INDEXES.has(m[0])) missing.add(`${file}: ${m[0]}`);
        }
      } else {
        for (const m of sql.matchAll(/\b([a-z_][a-z_0-9_]*_[a-z_0-9]+)\s*\(/gi)) {
          const name = m[1]!.toLowerCase();
          // `INSERT INTO t (col, …)` names a table's column list, not a call.
          if (TABLES.has(name) || INDEXES.has(name)) continue;
          if (FUNCTIONS.has(name) || PG_BUILTINS.has(name)) continue;
          missing.add(`${file}: ${name}`);
        }
      }
    }
  }
  return [...missing].sort();
}

// ─── The guards ─────────────────────────────────────────────────────────────

describe("SQL reference coverage — the backend only names what db/schema.sql declares", () => {
  test("the scan itself is not vacuous", () => {
    // Guards on the extraction. If a refactor stopped producing template-literal
    // SQL, or the glob stopped matching, every assertion below would pass while
    // checking nothing — the failure mode a scanner test actually has.
    expect(backendSources.length).toBeGreaterThan(20);

    const sqlBytes = backendSources
      .map(([, src]) => sqlStrings(src).join(""))
      .reduce((sum, sql) => sum + sql.length, 0);
    expect(sqlBytes).toBeGreaterThan(10_000);

    // The scan must keep finding a real surface — a drop to near-zero means the
    // extractor, not the schema, broke.
    const allTables = new Set<string>();
    const allIndexes = new Set<string>();
    for (const [, src] of backendSources) {
      for (const sql of sqlStrings(src)) {
        for (const name of tableReferences(sql)) allTables.add(name);
        for (const m of sql.matchAll(/\b(?:idx|uq)_[a-z0-9_]+/g)) allIndexes.add(m[0]);
      }
    }
    expect(allTables.size).toBeGreaterThan(20);
    expect(allIndexes.size).toBeGreaterThanOrEqual(5);

    // …and the declarations it is compared against must be real too.
    expect(TABLES.size).toBeGreaterThan(40);
    expect(INDEXES.size).toBeGreaterThan(50);
  });

  test("every table the backend queries is declared by db/schema.sql", () => {
    expect(undeclared("table")).toEqual([]);
  });

  test("every index name the backend references is declared by db/schema.sql", () => {
    expect(undeclared("index")).toEqual([]);
  });

  test("every function the backend calls is declared or is a documented built-in", () => {
    expect(undeclared("function")).toEqual([]);
  });

  test("every function db/schema.sql declares is used — no dead schema objects", () => {
    // The inverse direction: a declared function with no caller and no trigger
    // is dead weight the snapshot should not carry. Both functions the snapshot
    // declares are trigger functions, so the CREATE TRIGGER that names them is
    // also a use — which is why the schema's own text is part of the haystack.
    const haystack = backendSources.map(([, src]) => src).join("\n") + "\n" + schemaSql;
    for (const fn of FUNCTIONS) {
      expect(haystack.includes(fn), `declared function ${fn} is referenced nowhere`).toBe(true);
    }
    expect(FUNCTIONS.size).toBeGreaterThan(0);
  });
});
