/**
 * Schema drift guards.
 *
 * Production raised three 42703 ("column … does not exist") errors in a row, all
 * from the same class of bug: code, the canonical schema and the applied
 * migrations disagreeing about a column.
 *
 *   1. `sv.evidence_notes` — code selected a column the canonical schema does
 *      not define.
 *   2. `sv.review_reason_code` — the column IS canonical, but migration V0043
 *      could never be applied because the runner aborted inside V0040/V0041.
 *   3. `column "uploaded_by" does not exist` — V0008 renamed the `media` columns
 *      to names that no code and no canonical schema ever used, so every media
 *      query in production failed and the verification submit could not record
 *      its evidence.
 *
 * These tests state the invariants, so the next drift fails the suite instead of
 * production.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const schemaSql = read("db/schema.sql");
const sqlEditor = read("db/run-sqleditor.sql");
const migration008 = read("db/migrations/008_upload_auth_fixes.sql");
const migration041 = read("db/migrations/041_media_cover_lookup_index.sql");
const migration045 = read("db/migrations/045_media_column_naming.sql");

const backendMediaSources = [
  "backend/routes/upload.ts",
  "backend/routes/verification.ts",
  "backend/routes/seller.ts",
  "backend/routes/index.ts",
  "backend/routes/auth.ts",
].map(read);

/** V0008 renamed `from` → `to`; V0045 must rename it back. */
const RENAME_PAIRS = [
  ["owner_id", "uploaded_by"],
  ["object_key", "key"],
  ["cdn_url", "url"],
  ["mime_type", "content_type"],
  ["file_size", "size"],
];
/** Legacy (V0008) column names that no application code or canonical schema uses. */
const LEGACY_MEDIA_COLUMNS = RENAME_PAIRS.map(([legacy]) => legacy);
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

  test("no backend media statement uses a V0008 column name", () => {
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

  test("V0041 builds idx_media_owner_key for either media naming", () => {
    expect(migration041).toContain("('uploaded_by', 'owner_id')");
    expect(migration041).toContain("('key', 'object_key')");
    expect(migration041).toContain("'CREATE INDEX IF NOT EXISTS idx_media_owner_key ON media (%I, %I)'");
    // The index name must match the canonical schema declaration.
    expect(schemaSql).toContain("CREATE INDEX IF NOT EXISTS idx_media_owner_key ON media (uploaded_by, key)");
  });

  test("V0045 renames every V0008 column back to the canonical name", () => {
    for (const [legacy, canonical] of RENAME_PAIRS) {
      expect(migration008).toContain(`RENAME COLUMN ${canonical} TO ${legacy}`);
      expect(migration045).toContain(`'${legacy}', '${canonical}'`);
    }
    // Metadata-only, guarded and idempotent: never a destructive statement.
    expect(migration045).toContain("ALTER TABLE media RENAME COLUMN %I TO %I");
    for (const forbidden of ["DROP COLUMN", "DROP TABLE", "TRUNCATE", "DELETE FROM"]) {
      expect(migration045).not.toContain(forbidden);
    }
  });

  test("RENAME COLUMN pairs are well-formed array literals", () => {
    // A malformed pair (e.g. a missing quote) would silently skip a rename at
    // apply time and leave the columns half-migrated.
    const pairs = [...migration045.matchAll(/ARRAY\['([a-z_]+)', '([a-z_]+)'\]/g)];
    expect(pairs.map(([, from, to]) => [from, to])).toEqual(RENAME_PAIRS);
  });
});

describe("no migration after V0008 depends on the renamed media columns", () => {
  // V0041 and V0045 are the two migrations that deliberately name BOTH variants:
  // V0041 must tolerate either naming, V0045 is the rename itself.
  const files = readdirSync(join(root, "db", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .filter((f) => f > "008_upload_auth_fixes.sql")
    .filter((f) => f !== "041_media_cover_lookup_index.sql")
    .filter((f) => f !== "045_media_column_naming.sql");

  test("the migration set is non-empty (guards the filter above)", () => {
    expect(files.length).toBeGreaterThan(20);
  });

  test("V0045 is the only place the legacy names may reappear", () => {
    expect(migration045).toContain("owner_id");
    expect(migration041).toContain("owner_id");
  });

  for (const file of files) {
    test(`${file} references only canonical media columns`, () => {
      const src = read(`db/migrations/${file}`);
      for (const legacy of LEGACY_MEDIA_COLUMNS) {
        expect(src).not.toContain(legacy);
      }
    });
  }
});
