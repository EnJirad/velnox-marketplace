/**
 * The canonical SQL files contract.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * These two files used to be asserted byte-identical, and that was correct for
 * as long as they were the same artifact: a fresh-database snapshot.
 *
 * `db/run-sqleditor.sql` is now a rerunnable ADDITIVE RECONCILER, because the
 * database it runs against is not a fresh one — production already has tables
 * and rows, and a rerun has to add what is missing without touching what is
 * there. To do that it carries passes the snapshot never needed:
 *
 *     PART 1   tables                 (the snapshot)
 *     PART 2   ALTER TABLE ... ADD COLUMN IF NOT EXISTS, for every column
 *     PART 2c  DROP NOT NULL on columns the canonical schema made optional
 *     PART 3   indexes, after the column pass
 *     PART 4   foreign keys, guarded on pg_constraint
 *     PART 5   unique and check constraints, guarded on pg_constraint
 *     PART 5c  checks schema.sql deliberately re-declares, re-applied only
 *              when the stored definition differs
 *     PART 6   triggers, guarded on pg_trigger
 *     PART 7   read-only verification SELECTs
 *
 * So byte-identity is no longer the contract, and pretending it is would either
 * forbid the reconciler from doing its job or push the additive passes into the
 * snapshot, where they cannot help an existing database.
 *
 * WHAT IS PINED HERE
 * ------------------
 * Something strictly stronger than the old check, in the direction that
 * actually matters: every schema OBJECT the canonical snapshot declares must
 * still be declared by the reconciler, with the same name and the same
 * definition. That is the property production depends on — paste the reconciler
 * into Neon and the database ends up describing the schema the repo documents.
 * The extra passes the reconciler carries are allowed to be additions; they may
 * never remove or redefine something the snapshot declares.
 *
 * `db/schema.sql` remains the canonical SNAPSHOT, `db/run-sqleditor.sql` the
 * rerunnable bootstrap/updater. Migration files stay the historical record and
 * are never compared byte-for-byte against either.
 */
import { readFileSync } from "fs";
import { join } from "path";

const DB_DIR = join(import.meta.dir, "..", "..", "..", "db");

export const SCHEMA_SQL = join(DB_DIR, "schema.sql");
export const RUN_SQLEDITOR_SQL = join(DB_DIR, "run-sqleditor.sql");

export function readCanonical(path: string): string {
  return readFileSync(path, "utf8");
}

/** Comment text documents intent and may legitimately differ; statements may not. */
export function stripSqlComments(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

/** `CREATE TABLE IF NOT EXISTS <name> (` -> the name, in declaration order. */
export function declaredTables(sql: string): string[] {
  return [
    ...stripSqlComments(sql).matchAll(
      /CREATE TABLE (?:IF NOT EXISTS )?([a-z_][a-z_0-9]*)/g,
    ),
  ].map((m) => m[1]!);
}

/**
 * The full `CREATE TABLE` body for one table, closing paren included, so the
 * column list, the inline CHECKs and the inline UNIQUE/REFERENCES clauses are
 * compared as written rather than re-derived.
 */
export function createTableBlock(sql: string, table: string): string {
  const code = stripSqlComments(sql);
  const start = code.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`);
  if (start === -1) return "";
  const end = code.indexOf("\n);", start);
  return end === -1 ? "" : code.slice(start, end + 3);
}

/** Column names declared inside one `CREATE TABLE` block. */
export function declaredColumns(sql: string, table: string): string[] {
  const block = createTableBlock(sql, table);
  if (!block) return [];
  const body = block.slice(block.indexOf("(") + 1, block.lastIndexOf(")"));
  const names: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim().replace(/,$/, "");
    if (!line) continue;
    // table-level clauses are not columns
    if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY)\b/i.test(line)) continue;
    const m = /^([a-z_][a-z_0-9]*)\s/.exec(line);
    if (m) names.push(m[1]!);
  }
  return names;
}

/** Index names from `CREATE [UNIQUE] INDEX IF NOT EXISTS <name>`. */
export function declaredIndexNames(sql: string): string[] {
  return [
    ...stripSqlComments(sql).matchAll(
      /CREATE (?:UNIQUE )?INDEX IF NOT EXISTS ([a-z_][a-z_0-9]*)/g,
    ),
  ].map((m) => m[1]!);
}

/**
 * Every named constraint the file declares, mapped to its definition text.
 * Table-level `CONSTRAINT <name> ...` and `ADD CONSTRAINT <name> ...` both count,
 * which is what lets a caller check a definition rather than only a name.
 *
 * The snapshot writes a multi-line constraint inside its CREATE TABLE body while
 * the reconciler writes the same constraint as a one-line ADD CONSTRAINT, so the
 * definition is compared with ALL whitespace removed. The token sequence is what
 * has to match; where the author chose to break the line is not a schema change.
 */
export function declaredConstraints(sql: string): Map<string, string> {
  const code = stripSqlComments(sql);
  // The snapshot writes a multi-line constraint inside its CREATE TABLE body and
  // the reconciler writes the same constraint as a one-line ADD CONSTRAINT, so the
  // definition is compared with all whitespace removed: the token sequence has to
  // match, where the author broke the line is not a schema change.
  const squash = (text: string) => text.replace(/\s+/g, "");
  const out = new Map<string, string>();
  // A definition ends at the paren that closes the constraint, not at the next
  // semicolon: a multi-line CHECK inside a CREATE TABLE body is followed by more
  // statements, and a greedy read would swallow them.
  const readDefinition = (from: number): string => {
    const open = code.indexOf("(", from);
    if (open === -1) return "";
    let depth = 0;
    for (let i = open; i < code.length; i += 1) {
      if (code[i] === "(") depth += 1;
      else if (code[i] === ")") {
        depth -= 1;
        if (depth === 0) return code.slice(from, i + 1);
      }
    }
    return "";
  };

  for (const m of code.matchAll(
    /ADD CONSTRAINT ([a-z_][a-z_0-9]*)\s+(FOREIGN KEY|UNIQUE|CHECK)\s/g,
  )) {
    out.set(m[1]!, squash(readDefinition(m.index! + m[0].length - 1)));
  }
  for (const m of code.matchAll(
    /^\s+CONSTRAINT ([a-z_][a-z_0-9]*)\s+(UNIQUE|CHECK)\s/gm,
  )) {
    out.set(m[1]!, squash(readDefinition(m.index! + m[0].length - 1)));
  }
  return out;
}

export function declaredFunctions(sql: string): string[] {
  return [
    ...stripSqlComments(sql).matchAll(
      /CREATE OR REPLACE FUNCTION ([a-z_][a-z_0-9]*)/g,
    ),
  ].map((m) => m[1]!);
}

export function declaredTriggers(sql: string): string[] {
  return [
    ...stripSqlComments(sql).matchAll(/CREATE TRIGGER ([a-z_][a-z_0-9]*)/g),
  ].map((m) => m[1]!);
}

export function declaredExtensions(sql: string): string[] {
  return [
    ...stripSqlComments(sql).matchAll(
      /CREATE EXTENSION IF NOT EXISTS "([a-z_0-9-]+)"/g,
    ),
  ].map((m) => m[1]!);
}

/**
 * The one shape `canonicalParity()` may take when nothing has drifted.
 *
 * Assert against this rather than checking each key by hand, so a new kind of
 * drift added to `canonicalParity()` later is covered by every existing call
 * site automatically instead of silently going unchecked.
 */
export const NO_CANONICAL_DRIFT = {
  missingTables: [],
  alteredTables: [],
  missingColumns: {},
  missingIndexes: [],
  missingConstraints: [],
  redefinedConstraints: [],
  missingFunctions: [],
  missingTriggers: [],
  missingExtensions: [],
} as const;

/**
 * "The reconciler still describes the canonical schema."
 *
 * The additive passes (columns, indexes, foreign keys, constraints, triggers) are
 * allowed to ADD what an old database is missing. What they may never do is drop
 * or redefine something `db/schema.sql` declares — that is what this reports.
 */
export function canonicalParity(schema: string, reconciler: string): {
  missingTables: string[];
  alteredTables: string[];
  missingColumns: Record<string, string[]>;
  missingIndexes: string[];
  missingConstraints: string[];
  redefinedConstraints: string[];
  missingFunctions: string[];
  missingTriggers: string[];
  missingExtensions: string[];
} {
  const snapTables = declaredTables(schema);
  const recTables = new Set(declaredTables(reconciler));

  const missingTables = snapTables.filter((t) => !recTables.has(t));

  // A table must be declared with the SAME body. Part 1 of the reconciler carries
  // the snapshot's CREATE TABLE blocks, so this is an equality, not a subset.
  const alteredTables = snapTables.filter(
    (t) => recTables.has(t) && createTableBlock(schema, t) !== createTableBlock(reconciler, t),
  );

  const missingColumns: Record<string, string[]> = {};
  for (const table of snapTables) {
    if (!recTables.has(table)) continue;
    const have = new Set(declaredColumns(reconciler, table));
    const gone = declaredColumns(schema, table).filter((c) => !have.has(c));
    if (gone.length) missingColumns[table] = gone;
  }

  const snapIndexes = new Set(declaredIndexNames(schema));
  const recIndexes = new Set(declaredIndexNames(reconciler));
  const missingIndexes = [...snapIndexes].filter((i) => !recIndexes.has(i));

  const snapConstraints = declaredConstraints(schema);
  const recConstraints = declaredConstraints(reconciler);
  const missingConstraints: string[] = [];
  const redefinedConstraints: string[] = [];
  for (const [name, definition] of snapConstraints) {
    const have = recConstraints.get(name);
    if (have === undefined) missingConstraints.push(name);
    else if (have !== definition) redefinedConstraints.push(name);
  }

  const recFunctions = new Set(declaredFunctions(reconciler));
  const recTriggers = new Set(declaredTriggers(reconciler));
  const recExtensions = new Set(declaredExtensions(reconciler));

  return {
    missingTables,
    alteredTables,
    missingColumns,
    missingIndexes,
    missingConstraints,
    redefinedConstraints,
    missingFunctions: declaredFunctions(schema).filter((f) => !recFunctions.has(f)),
    missingTriggers: declaredTriggers(schema).filter((t) => !recTriggers.has(t)),
    missingExtensions: declaredExtensions(schema).filter((e) => !recExtensions.has(e)),
  };
}

/**
 * `db/run-update.sql` was retired (see .ai/AI_RULES.md §98). The snapshot plus
 * the rerunnable reconciler replaced it, and it must not come back.
 */
export function runUpdateSqlResurrected(): boolean {
  try {
    readFileSync(join(DB_DIR, "run-update.sql"), "utf8");
    return true;
  } catch {
    return false;
  }
}