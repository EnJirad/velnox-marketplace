/**
 * The canonical schema pair, parsed.
 *
 * `db/schema.sql` is the one and only data model of the marketplace MVP.
 * `db/run-sqleditor.sql` installs exactly the same model from a Neon SQL
 * Editor and finishes with a read-only verification query. This helper parses
 * both so a test can assert on what they declare instead of pattern-matching
 * prose — neither file may contain a single SQL comment, so there is no prose
 * to trip over.
 *
 * No destructive statement exists in either file: they only ever create. The
 * development/test reset is `scripts/db-reset.sh`, which refuses any database
 * that is not named `*_dev` / `*_test`.
 */
import { readFileSync } from "fs";
import { join } from "path";

export const REPO_ROOT = join(import.meta.dir, "..", "..", "..");
export const SCHEMA_SQL = "db/schema.sql";
export const RUN_SQLEDITOR_SQL = "db/run-sqleditor.sql";

export const readSql = (rel: string): string => readFileSync(join(REPO_ROOT, rel), "utf8");

/**
 * Remove `--` and `/* … *\/` comments while respecting single-quoted strings,
 * double-quoted identifiers and dollar-quoted function bodies (comments inside
 * a function body are removed too, by recursing into it).
 */
export function stripSqlComments(sql: string): string {
  let out = "";
  let i = 0;
  const n = sql.length;

  while (i < n) {
    const c = sql[i]!;
    const c2 = sql.slice(i, i + 2);

    if (c2 === "--") {
      i += 2;
      while (i < n && sql[i] !== "\n") i++;
      continue;
    }
    if (c2 === "/*") {
      i += 2;
      while (i < n && sql.slice(i, i + 2) !== "*/") {
        if (sql[i] === "\n") out += "\n";
        i++;
      }
      i += 2;
      continue;
    }
    if (c === "'") {
      out += c;
      i++;
      while (i < n) {
        out += sql[i];
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            out += sql[i + 1];
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    if (c === '"') {
      out += c;
      i++;
      while (i < n) {
        out += sql[i];
        if (sql[i] === '"') {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    const dollar = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
    if (dollar) {
      const tag = dollar[0];
      const end = sql.indexOf(tag, i + tag.length);
      const stop = end === -1 ? n : end;
      out += tag + stripSqlComments(sql.slice(i + tag.length, stop)) + tag;
      i = stop + tag.length;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** Comment tokens left in a file — an empty array is the only accepted answer. */
export const commentTokens = (sql: string): string[] =>
  sql.match(/--[^\n]*|\/\*[\s\S]*?\*\//g) ?? [];

/** Statements that may destroy data or schema. Neither file may contain one. */
export const DANGEROUS = [
  /\bDROP\s+TABLE\b/i,
  /\bDROP\s+COLUMN\b/i,
  /\bDROP\s+DATABASE\b/i,
  /\bDROP\s+SCHEMA\b/i,
  /\bTRUNCATE\b/i,
  /\bDELETE\s+FROM\b/i,
  /\bUPDATE\s+\w+\s+SET\b/i,
  /\bINSERT\s+INTO\b/i,
];

export const dangerousStatements = (sql: string): string[] =>
  DANGEROUS.filter((re) => re.test(stripSqlComments(sql))).map(String);

/** The verification block `run-sqleditor.sql` appends; `schema.sql` has none. */
export const VERIFY_BLOCK_MARKER = "SELECT\n  (SELECT count(*) FROM information_schema.tables";

/** The DDL both files must declare identically. */
export function ddlOf(sql: string): string {
  const clean = stripSqlComments(sql);
  const at = clean.indexOf(VERIFY_BLOCK_MARKER);
  return (at === -1 ? clean : clean.slice(0, at)).trim();
}

/** Table names declared by `CREATE TABLE [IF NOT EXISTS] <name>`. */
export const declaredTables = (sql: string): string[] =>
  [...stripSqlComments(sql).matchAll(/CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)/g)].map((m) => m[1]!);

/** `(table.column, dataType)` for every `name TYPE` line inside a CREATE TABLE. */
export function declaredColumns(sql: string): Array<{ table: string; column: string; dataType: string }> {
  const clean = stripSqlComments(sql);
  const out: Array<{ table: string; column: string; dataType: string }> = [];
  const tables = /CREATE TABLE (?:IF NOT EXISTS )?([a-z_]+)([\s\S]*?);/g;
  for (const match of clean.matchAll(tables)) {
    const table = match[1]!;
    const body = match[2]!;
    for (const line of body.split("\n")) {
      const col = /^\s{2}([a-z_]+)\s+([A-Z][A-Z0-9_]*(?:\s*\(\s*\d+(?:\s*,\s*\d+)?\s*\))?)/.exec(line);
      if (col) out.push({ table, column: col[1]!, dataType: col[2]!.replace(/\s+/g, " ") });
    }
  }
  return out;
}

export const declaredIndexNames = (sql: string): string[] =>
  [...stripSqlComments(sql).matchAll(/CREATE (?:UNIQUE )?INDEX (?:IF NOT EXISTS )?([a-z_0-9]+)/g)].map((m) => m[1]!);

export const declaredTriggerNames = (sql: string): string[] =>
  [...stripSqlComments(sql).matchAll(/CREATE TRIGGER ([a-z_0-9]+)/g)].map((m) => m[1]!);

/** Parity: both files declare byte-identical DDL. */
export const canonicalParity = (): { ok: boolean; diff: string } => {
  const a = ddlOf(readSql(SCHEMA_SQL));
  const b = ddlOf(readSql(RUN_SQLEDITOR_SQL));
  if (a === b) return { ok: true, diff: "" };
  const aLines = a.split("\n");
  const bLines = b.split("\n");
  const at = aLines.findIndex((line, idx) => line !== bLines[idx]);
  return {
    ok: false,
    diff: `first difference at line ${at + 1}:\n  schema.sql:        ${aLines[at] ?? "<eof>"}\n  run-sqleditor.sql: ${bLines[at] ?? "<eof>"}`,
  };
};
