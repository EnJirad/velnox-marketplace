/**
 * Migration numbering.
 *
 * `db/migrations/` contains four duplicated number prefixes:
 *
 *   029  fix_category_id_type          | option_value_images
 *   030  add_performance_indexes       | product_image_types
 *   034  order_shipments               | velrepeat_v2
 *   035  checkout_idempotency          | velrepeat_plans_status_fix
 *
 * A previous handoff recorded that "a prefix-keyed runner applied only one file
 * per number, which is how the V0035 repair was skipped", and a repository test
 * repeats the claim. The deployed runner does not behave that way: it derives
 * `migration_name` from the FULL filename and `schema_migrations.migration_name`
 * is UNIQUE, so two files sharing a prefix are two distinct migrations and both
 * are applied. That is why this pass does NOT renumber history — renaming an
 * applied file would orphan its `schema_migrations` row and could re-run it.
 *
 * What this test does instead:
 *   • pins the exact set of known duplicates, so a NEW collision fails the suite
 *     (new migrations must use an unused number),
 *   • records that the runner is filename-keyed, which is what makes the
 *     existing duplicates safe,
 *   • fails if a duplicate ever grows to three files sharing one number, or if
 *     the runner switches to prefix keying without renumbering.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const migrationsDir = join(root, "db", "migrations");
const workflow = readFileSync(join(root, ".github", "workflows", "migrate-neon.yml"), "utf8");

/** The duplicates that already exist in applied history. Frozen on purpose. */
const KNOWN_DUPLICATE_PREFIXES = ["029", "030", "034", "035"];

const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();

function prefixOf(file: string): string {
  return file.split("_")[0] ?? "";
}

function filesByPrefix(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const f of files) {
    const p = prefixOf(f);
    map.set(p, [...(map.get(p) ?? []), f]);
  }
  return map;
}

describe("migration numbering", () => {
  test("the migration directory is populated", () => {
    // If this ever reads zero files the rest of the suite would pass vacuously.
    expect(files.length).toBeGreaterThan(40);
  });

  test("every filename starts with a zero-padded number", () => {
    for (const f of files) {
      expect(f).toMatch(/^\d{3}_[a-z0-9_]+\.sql$/);
    }
  });

  test("no NEW duplicate number prefixes are introduced", () => {
    const byPrefix = filesByPrefix();
    const duplicates = [...byPrefix.entries()]
      .filter(([, list]) => list.length > 1)
      .map(([prefix]) => prefix)
      .sort();
    expect(duplicates).toEqual(KNOWN_DUPLICATE_PREFIXES);
  });

  test("each known duplicate is exactly two distinct files", () => {
    const byPrefix = filesByPrefix();
    for (const prefix of KNOWN_DUPLICATE_PREFIXES) {
      const list = byPrefix.get(prefix) ?? [];
      expect(list.length).toBe(2);
      expect(new Set(list).size).toBe(2);
    }
  });

  test("the deployed runner keys on the full filename, which is what makes them safe", () => {
    // Distinct migration names + a UNIQUE column = both files are applied and
    // recorded independently. If this ever changes to a numeric key, the
    // duplicates below become a real hazard and must be renumbered first.
    expect(workflow).toContain("migration_name TEXT UNIQUE NOT NULL");
    expect(workflow).toContain('migration_name="${file%.sql}"');
    // …and the pending check compares the full name, not a prefix.
    expect(workflow).toContain('fname=$(basename "$f" .sql)');
    expect(workflow).not.toMatch(/cut -d_ -f1|sed .*_-f1|\$\{fname%%_\*\}/);
  });

  test("the next free number is above every prefix in use", () => {
    // Guards the "pick an unused number" rule: the highest prefix is recorded
    // here so adding 047+ is obviously safe and reusing an old number is not.
    const highest = Math.max(...files.map((f) => Number(prefixOf(f))));
    expect(highest).toBeGreaterThanOrEqual(46);
  });
});
