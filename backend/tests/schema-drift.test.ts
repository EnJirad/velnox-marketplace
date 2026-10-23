/**
 * Schema drift guards.
 *
 * Production raised three 42703 ("column … does not exist") errors in a row, all
 * from the same class of bug: code and the canonical schema disagreeing about a
 * column (the schema is now the whole truth — db/schema.sql plus the
 * rerunnable db/run-sqleditor.sql).
 *
 *   1. `sv.evidence_notes` — code selected a column the canonical schema does
 *      not define.
 *   2. `sv.review_reason_code` — the column IS canonical, but the migration that
 *      added it could never be applied because the runner aborted earlier.
 *   3. `column "uploaded_by" does not exist` — a media column rename moved the
 *      `media` columns to names that no code and no canonical schema ever used,
 *      so every media query in production failed and the verification submit
 *      could not record its evidence.
 *
 * These tests state the invariants, so the next drift fails the suite instead of
 * production.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";


const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const schemaSql = read("db/schema.sql");
const sqlEditor = read("db/run-sqleditor.sql");

const backendMediaSources = [
  "backend/routes/upload.ts",
  "backend/routes/verification.ts",
  "backend/routes/seller.ts",
  "backend/routes/index.ts",
  "backend/routes/auth.ts",
].map(read);

/** Legacy media column names that no application code or canonical schema uses. */
const LEGACY_MEDIA_COLUMNS = ["owner_id", "object_key", "cdn_url", "mime_type", "file_size"];
/** Canonical column names every media query is written against. */
const CANONICAL_MEDIA_COLUMNS = ["url", "key", "content_type", "size", "uploaded_by"];

/** The SQL snippets that touch the `media` table, so a response field name is never mistaken for a column. */
function mediaStatements(src: string): string[] {
  return [...src.matchAll(/[^`"']*\b(?:FROM|INTO|UPDATE|TABLE)\s+media\b[^`"']*/gi)].map((m) => m[0]);
}

describe("media table column naming", () => {
  test("the canonical schema defines every column the backend queries", () => {
    const start = schemaSql.indexOf("CREATE TABLE IF NOT EXISTS media");
    const block = schemaSql.slice(start, schemaSql.indexOf(");", start));
    const columns = new Set(block.split("\n").map((line) => line.trim().split(/\s+/)[0]));
    for (const column of CANONICAL_MEDIA_COLUMNS) expect(columns.has(column)).toBe(true);
  });

  test("db/schema.sql and db/run-sqleditor.sql declare identical media columns", () => {
    const at = (sql: string) => {
      const start = sql.indexOf("CREATE TABLE IF NOT EXISTS media");
      return sql.slice(start, sql.indexOf(");", start));
    };
    expect(at(sqlEditor)).toBe(at(schemaSql));
  });

  test("no backend media statement uses a legacy column name", () => {
    for (const src of backendMediaSources) {
      const statements = mediaStatements(src);
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) {
        for (const legacy of LEGACY_MEDIA_COLUMNS) {
          expect(statement).not.toContain(legacy);
        }
      }
    }
  });

  test("the canonical schema declares the media lookup index on canonical columns", () => {
    // The snapshot uses the bare table name, the reconciler the qualified one.
    expect(schemaSql).toContain("CREATE INDEX IF NOT EXISTS idx_media_owner_key ON media (uploaded_by, key)");
    expect(sqlEditor).toMatch(/idx_media_owner_key ON (?:public\.)?media \(uploaded_by, key\)/);
  });

  test("no canonical SQL file uses a legacy media column name", () => {
    // A renamed column must not survive in the snapshot or be reintroduced by
    // the reconciler — the two files are the whole schema now.
    for (const sql of [schemaSql, sqlEditor]) {
      for (const legacy of LEGACY_MEDIA_COLUMNS) {
        expect(new RegExp(`\\b${legacy}\\b`).test(sql)).toBe(false);
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. The snapshot never alters a table it does not create
// ═══════════════════════════════════════════════════════════════════════════

describe("the canonical schema never alters a table it does not create", () => {
  // A canonical file once referenced a table that no code and no schema ever
  // created, so running db/schema.sql on a fresh database aborted with
  // `relation … does not exist`. Only statements are judged here: comments
  // legitimately document history.
  /** Comments legitimately document history; only statements matter. */
  const statements = (sql: string) =>
    sql
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");

  function phantomReferences(sql: string): string[] {
    const code = statements(sql);
    const created = new Set(
      [...code.matchAll(/CREATE (?:TEMP(?:ORARY)? )?TABLE (?:IF NOT EXISTS )?([a-z_]+)/g)].map(
        (m) => m[1],
      ),
    );
    const missing = new Set<string>();
    for (const m of code.matchAll(/ALTER TABLE (?:IF EXISTS )?([a-z_]+)/g)) {
      if (!created.has(m[1])) missing.add(m[1]);
    }
    // The reconciler's PART 2c relaxes a NOT NULL with a dynamic ALTER:
    //   EXECUTE format('ALTER TABLE public.%I ALTER COLUMN %I DROP NOT NULL', ...)
    // so the table is a bind parameter, not a literal, and the regex above reads
    // the literal `public` instead. Its target set is not hidden: it is the
    // explicit (c.table_name, c.column_name) IN (...) list in the same block, so
    // that list is checked against the tables this file creates instead.
    const dynamic = code.match(/AND \(c\.table_name, c\.column_name\) IN \(([\s\S]*?)\n\s*\)/);
    if (dynamic) {
      for (const m of dynamic[1]!.matchAll(/\('([a-z_]+)','[a-z_]+'\)/g)) {
        if (!created.has(m[1]!)) missing.add(m[1]!);
      }
      missing.delete("public");
    }
    return [...missing];
  }

  test("db/schema.sql", () => expect(phantomReferences(schemaSql)).toEqual([]));
  test("db/run-sqleditor.sql", () => expect(phantomReferences(sqlEditor)).toEqual([]));

  test("the reconciler only relaxes NOT NULL on tables it creates", () => {
    // PART 2c drives ALTER TABLE from a bind parameter, so it must be pinned
    // explicitly: every table in its target list is one this file creates.
    const created = new Set(
      [
        ...statements(sqlEditor).matchAll(
          /CREATE (?:TEMP(?:ORARY)? )?TABLE (?:IF NOT EXISTS )?([a-z_]+)/g,
        ),
      ].map((m) => m[1]),
    );
    const block = statements(sqlEditor).match(
      /AND \(c\.table_name, c\.column_name\) IN \(([\s\S]*?)\n\s*\)/,
    );
    expect(block, "the reconciler lost its PART 2c NOT NULL relax list").not.toBeNull();
    const targets = [...block![1]!.matchAll(/\('([a-z_]+)','[a-z_]+'\)/g)].map((m) => m[1]!);
    expect(targets.length).toBeGreaterThan(200);
    expect(targets.filter((t) => !created.has(t))).toEqual([]);
  });
});
