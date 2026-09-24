/**
 * Test-fixture cleanup — removes rows that the backend integration suite wrote
 * into the application database before database isolation existed (TASK 004A).
 *
 * WHY THIS EXISTS
 * ---------------
 * Before `database-guard.ts`, the integration tests inserted real users /
 * sellers / shops / products straight into whichever database `DATABASE_URL`
 * pointed at. The workspace `.env` holds the production Neon URL, so fixture
 * shops (`so-test-*`, `inv-*`, `p14-shop-*`, `p16-shop-*`, `lifecycle-test-*`,
 * `vr-test-*`, `review-shop-*`) became publicly visible through `GET /api/shops`
 * — that endpoint only requires `sellers.status = 'approved'`.
 *
 * The isolation fix stops new pollution. This script removes the rows that were
 * already written.
 *
 * USAGE
 * -----
 *   bun run backend/scripts/test-fixture-cleanup.ts                  # dry run (read-only, default)
 *   VELNOX_ALLOW_FIXTURE_CLEANUP=1 bun run backend/scripts/test-fixture-cleanup.ts --apply
 *
 * SAFETY MODEL
 * ------------
 * 1. **Read-only by default.** Without `--apply` the script only issues
 *    `SELECT`s. Deletion additionally requires `VELNOX_ALLOW_FIXTURE_CLEANUP=1`,
 *    so an accidental run can never delete anything.
 * 2. **Fingerprint, not guesswork.** Fixture roots are discovered from the
 *    markers the test sources actually use (`@test.local` emails and the slug
 *    allowlist below), never from a name heuristic applied to the live catalog.
 * 3. **No hand-written delete order.** The delete set is the FK closure of the
 *    fixture roots, walked through `information_schema`, so a fixture shop drags
 *    out exactly the rows that point at it — never a hardcoded table list that
 *    can silently rot when the schema changes.
 * 4. **Shared-reference guard.** A row in the delete set that points at an
 *    entity *outside* the delete set (for example a real customer's order that
 *    happens to contain a fixture product) is reported and blocks `--apply`
 *    instead of being silently deleted.
 * 5. **Transactional.** All deletes run in one transaction; any leftover
 *    blocked by a foreign key aborts the whole thing and rolls back.
 */

import {
  describeDatabaseTarget,
  isTestRunnerProcess,
  productionDatabaseTarget,
} from "../db/database-guard.js";
import { query, withTransaction } from "../db/index.js";

// ─── Fixture markers (read straight off the test sources) ───────────────────

/**
 * Every DB-backed test creates its users with a `@test.local` address
 * (`.local` is not a routable domain, so no real account can use it).
 */
const FIXTURE_EMAIL_SUFFIX = "@test.local";

/** Shop slug prefixes used by the integration suites. */
const FIXTURE_SHOP_SLUG_PREFIXES = [
  "inv-", // inventory-race.test.ts            (inv-paid, inv-cancel, inv-rel, inv-drel, …)
  "so-test-", // seller-orders.test.ts
  "p14-shop-", // seller-center-apis.test.ts
  "p16-shop-", // reviews-unique-soft-delete.test.ts
  "lifecycle-test-", // product-lifecycle.test.ts
  "vr-test-", // velrepeat-core.test.ts
  "review-shop-", // order-detail-reviews.test.ts
];

/**
 * Categories the suites create. `categories` is platform-owned taxonomy that no
 * foreign key reaches from a fixture shop, so it is reported but never deleted
 * by this script — that has to be a deliberate decision of its own.
 */
const FIXTURE_CATEGORY_SLUG_PATTERN = "^(lifecycle-test-|cat-[0-9]{13}-)";

const MAX_CLOSURE_ROUNDS = 25;
/** How many rows of a single list to print before summarising the rest. */
const LIST_LIMIT = 25;
const SAFE_IDENT = /^[a-z_][a-z0-9_]*$/;

// ─── Small helpers ──────────────────────────────────────────────────────────

function q(name: string): string {
  if (!SAFE_IDENT.test(name)) throw new Error(`Unsafe SQL identifier: ${name}`);
  return `"${name}"`;
}

function col(table: string, column: string): string {
  return `${q(table)}.${q(column)}`;
}

function heading(title: string): void {
  console.log(`\n${title}\n${"─".repeat(title.length)}`);
}

type FkEdge = {
  child: string;
  childColumn: string;
  parent: string;
  parentColumn: string;
  deleteRule: string;
};

// ─── Schema introspection ───────────────────────────────────────────────────

/** Every single-column foreign key in the `public` schema. */
async function loadForeignKeys(): Promise<FkEdge[]> {
  const res = await query(
    `SELECT tc.table_name       AS child,
            kcu.column_name     AS "childColumn",
            pk.table_name       AS parent,
            pku.column_name     AS "parentColumn",
            rc.delete_rule      AS "deleteRule"
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.constraint_schema = tc.constraint_schema
       JOIN information_schema.referential_constraints rc
         ON rc.constraint_name = tc.constraint_name
        AND rc.constraint_schema = tc.constraint_schema
       JOIN information_schema.key_column_usage pku
         ON pku.constraint_name = rc.unique_constraint_name
        AND pku.constraint_schema = rc.unique_constraint_schema
       JOIN information_schema.table_constraints pk
         ON pk.constraint_name = pku.constraint_name
        AND pk.constraint_schema = pku.constraint_schema
      WHERE tc.constraint_type = 'FOREIGN KEY'
        AND tc.table_schema = 'public'`,
  );
  return res.rows as FkEdge[];
}

/**
 * Primary key column per table. This schema gives every table a single
 * `id` column, but the script reads it instead of assuming, and refuses to
 * touch a table it cannot address by primary key.
 */
async function loadPrimaryKeys(): Promise<Map<string, string>> {
  const res = await query(
    `SELECT tc.table_name AS table, kcu.column_name AS column
       FROM information_schema.table_constraints tc
       JOIN information_schema.key_column_usage kcu
         ON kcu.constraint_name = tc.constraint_name
        AND kcu.constraint_schema = tc.constraint_schema
      WHERE tc.constraint_type = 'PRIMARY KEY'
        AND tc.table_schema = 'public'`,
  );
  const grouped = new Map<string, string[]>();
  for (const row of res.rows as { table: string; column: string }[]) {
    const list = grouped.get(row.table) ?? [];
    list.push(row.column);
    grouped.set(row.table, list);
  }
  const single = new Map<string, string>();
  for (const [table, columns] of grouped) {
    const only = columns.length === 1 ? columns[0] : undefined;
    if (only) single.set(table, only);
  }
  return single;
}

// ─── Fixture root discovery (read-only) ─────────────────────────────────────

type FixtureRoots = {
  users: { id: string; email: string; name: string | null }[];
  shops: {
    id: string;
    slug: string;
    name: string;
    ownerEmail: string;
    matchedBySlug: boolean;
    createdAt: string | null;
  }[];
  sellerIds: string[];
  productIds: string[];
};

async function findFixtureRoots(): Promise<FixtureRoots> {
  const users = (
    await query(
      `SELECT id::text AS id, email, name FROM users WHERE email LIKE $1 ORDER BY email`,
      [`%${FIXTURE_EMAIL_SUFFIX}`],
    )
  ).rows as { id: string; email: string; name: string | null }[];

  const sellerIds = (
    await query(`SELECT id::text AS id FROM sellers WHERE user_id::text = ANY($1::text[])`, [
      users.map((u) => u.id),
    ])
  ).rows.map((r: { id: string }) => r.id);

  const slugPattern = `^(${FIXTURE_SHOP_SLUG_PREFIXES.map((p) => p.replace(/-$/, "-")).join("|")})`;
  const shops = (
    await query(
      `SELECT s.id::text        AS id,
              s.slug,
              s.name,
              COALESCE(u.email, '') AS "ownerEmail",
              (s.slug ~ $2)     AS "matchedBySlug",
              s.created_at      AS "createdAt"
         FROM shops s
         JOIN sellers se ON se.id = s.seller_id
         LEFT JOIN users u ON u.id = se.user_id
        WHERE se.id::text = ANY($1::text[])
           OR (s.slug ~ $2 AND u.email LIKE $3)
        ORDER BY s.created_at NULLS LAST`,
      [sellerIds, slugPattern, `%${FIXTURE_EMAIL_SUFFIX}`],
    )
  ).rows as {
    id: string;
    slug: string;
    name: string;
    ownerEmail: string;
    matchedBySlug: boolean;
    createdAt: string | null;
  }[];

  const productIds = (
    await query(`SELECT id::text AS id FROM products WHERE shop_id::text = ANY($1::text[])`, [
      shops.map((s) => s.id),
    ])
  ).rows.map((r: { id: string }) => r.id);

  return { users, shops, sellerIds, productIds };
}

// ─── FK closure ─────────────────────────────────────────────────────────────

/**
 * Walk the foreign-key graph from the fixture roots downwards and collect every
 * row that references a fixture row.
 */
async function closeOverForeignKeys(opts: {
  seeds: Map<string, string[]>;
  edges: FkEdge[];
  primaryKeys: Map<string, string>;
  skipped: Set<string>;
}): Promise<Map<string, Set<string>>> {
  const targets = new Map<string, Set<string>>();
  for (const [table, ids] of opts.seeds) {
    if (ids.length > 0) targets.set(table, new Set(ids));
  }

  for (let round = 0; round < MAX_CLOSURE_ROUNDS; round += 1) {
    let changed = false;
    for (const edge of opts.edges) {
      const parents = targets.get(edge.parent);
      if (!parents || parents.size === 0) continue;
      const childPk = opts.primaryKeys.get(edge.child);
      if (!childPk) {
        opts.skipped.add(edge.child);
        continue;
      }
      const found = await query(
        `SELECT DISTINCT ${col(edge.child, childPk)}::text AS id
           FROM ${q(edge.child)}
          WHERE ${col(edge.child, edge.childColumn)}::text = ANY($1::text[])`,
        [Array.from(parents)],
      );
      const bucket = targets.get(edge.child) ?? new Set<string>();
      targets.set(edge.child, bucket);
      for (const row of found.rows as { id: string }[]) {
        if (!bucket.has(row.id)) {
          bucket.add(row.id);
          changed = true;
        }
      }
    }
    if (!changed) break;
  }

  return targets;
}

/**
 * Rows in the delete set whose foreign key points at an entity *outside* the
 * delete set — the signature of data shared with a real owner.
 *
 * Only edges between two tracked tables are evaluated: a parent the closure
 * never collected (for example `categories`) is out of scope rather than a
 * false positive.
 */
async function findSharedReferences(
  targets: Map<string, Set<string>>,
  edges: FkEdge[],
  primaryKeys: Map<string, string>,
): Promise<{ table: string; column: string; parent: string; count: number }[]> {
  const shared: { table: string; column: string; parent: string; count: number }[] = [];
  for (const edge of edges) {
    const parents = targets.get(edge.parent);
    const children = targets.get(edge.child);
    if (!parents || !children || children.size === 0) continue;
    if (!primaryKeys.has(edge.child)) continue;
    const res = await query(
      `SELECT count(*)::int AS n
         FROM ${q(edge.child)}
        WHERE ${col(edge.child, edge.childColumn)} IS NOT NULL
          AND ${col(edge.child, edge.childColumn)}::text = ANY($1::text[])
          AND NOT (${col(edge.child, edge.childColumn)}::text = ANY($2::text[]))`,
      [Array.from(children), Array.from(parents)],
    );
    const count = (res.rows[0] as { n: number } | undefined)?.n ?? 0;
    if (count > 0) shared.push({ table: edge.child, column: edge.childColumn, parent: edge.parent, count });
  }
  return shared;
}

/** How deep a table sits from the roots — children delete before parents. */
function computeDepth(tables: string[], edges: FkEdge[]): Map<string, number> {
  const depth = new Map<string, number>(tables.map((t) => [t, 0]));
  for (let round = 0; round < tables.length; round += 1) {
    let changed = false;
    for (const edge of edges) {
      if (!depth.has(edge.child) || !depth.has(edge.parent)) continue;
      const candidate = (depth.get(edge.child) ?? 0) + 1;
      if (candidate > (depth.get(edge.parent) ?? 0)) {
        depth.set(edge.parent, candidate);
        changed = true;
      }
    }
    if (!changed) break;
  }
  return depth;
}

/** Fixture rows no foreign key reaches (reported, never deleted). */
async function findUnreachableArtifacts(): Promise<{ category: string[] }> {
  const categories = (
    await query(`SELECT slug FROM categories WHERE slug ~ $1 ORDER BY slug`, [FIXTURE_CATEGORY_SLUG_PATTERN])
  ).rows.map((row: { slug: string }) => row.slug);
  return { category: categories };
}

// ─── Reporting ──────────────────────────────────────────────────────────────

function printTarget(): void {
  const target = productionDatabaseTarget();
  const classification = target ? "application database" : "unresolved";
  console.log(`Target        : ${describeDatabaseTarget(target)} (${classification})`);
}

function printRoots(roots: FixtureRoots, remaining: Map<string, Set<string>>): void {
  heading("Fixture roots (read-only discovery)");
  console.log(`recipe          : users with email LIKE '%${FIXTURE_EMAIL_SUFFIX}'`);
  console.log(`fixture users   : ${roots.users.length}`);
  console.log(`fixture sellers : ${roots.sellerIds.length}`);
  console.log(`fixture shops   : ${roots.shops.length}`);
  console.log(`fixture products: ${roots.productIds.length}`);
  console.log(`FK closure rows : ${countRows(remaining)}`);

  if (roots.shops.length > 0) {
    heading("Fixture shops");
    for (const shop of roots.shops.slice(0, LIST_LIMIT)) {
      const slugFlag = shop.matchedBySlug ? "slug-match" : "owned";
      console.log(`  ${shop.slug.padEnd(34)} ${shop.ownerEmail.padEnd(44)} ${slugFlag}`);
    }
    if (roots.shops.length > LIST_LIMIT) {
      console.log(`  … and ${roots.shops.length - LIST_LIMIT} more`);
    }
  }
}

function countRows(targets: Map<string, Set<string>>): number {
  let total = 0;
  for (const ids of targets.values()) total += ids.size;
  return total;
}

function printClosure(targets: Map<string, Set<string>>, order: string[]): void {
  heading("Rows that --apply would delete (foreign-key closure)");
  const rows = order.filter((table) => (targets.get(table)?.size ?? 0) > 0);
  if (rows.length === 0) {
    console.log("  (none)");
    return;
  }
  for (const table of rows) {
    console.log(`  ${table.padEnd(28)} ${String(targets.get(table)?.size ?? 0).padStart(6)}`);
  }
  console.log(`  ${"TOTAL".padEnd(28)} ${String(countRows(targets)).padStart(6)}`);
}

// ─── Apply ──────────────────────────────────────────────────────────────────

async function applyDeletions(
  targets: Map<string, Set<string>>,
  order: string[],
  primaryKeys: Map<string, string>,
): Promise<{ table: string; deleted: number }[]> {
  const deletedCounts = new Map<string, number>();
  const blocked = new Map<string, string>();

  await withTransaction(async (client) => {
    let pending = order.filter((table) => (targets.get(table)?.size ?? 0) > 0);

    for (let attempt = 0; attempt < 6 && pending.length > 0; attempt += 1) {
      const stillPending: string[] = [];
      for (const table of pending) {
        const pk = primaryKeys.get(table);
        const ids = Array.from(targets.get(table) ?? []);
        if (!pk || ids.length === 0) continue;
        await client.query("SAVEPOINT fixture_delete");
        try {
          const res = await client.query(
            `DELETE FROM ${q(table)} WHERE ${col(table, pk)}::text = ANY($1::text[])`,
            [ids],
          );
          deletedCounts.set(table, (deletedCounts.get(table) ?? 0) + (res.rowCount ?? 0));
          blocked.delete(table);
          await client.query("RELEASE SAVEPOINT fixture_delete");
        } catch (err) {
          await client.query("ROLLBACK TO SAVEPOINT fixture_delete");
          stillPending.push(table);
          blocked.set(table, err instanceof Error ? err.message.split("\n")[0] ?? err.message : String(err));
        }
      }
      if (stillPending.length === pending.length) {
        pending = stillPending;
        break;
      }
      pending = stillPending;
    }

    if (pending.length > 0) {
      const detail = pending.map((t) => `  ${t}: ${blocked.get(t) ?? "still referenced"}`).join("\n");
      throw new Error(`deletion aborted — ${pending.length} table(s) could not be cleared:\n${detail}`);
    }
  });

  return [...deletedCounts.entries()]
    .map(([table, deleted]) => ({ table, deleted }))
    .sort((a, b) => a.table.localeCompare(b.table));
}

// ─── Entry point ────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const allowShared = process.argv.includes("--allow-shared");
  const allow = process.env.VELNOX_ALLOW_FIXTURE_CLEANUP === "1";

  if (isTestRunnerProcess()) {
    console.error("Refusing to run inside a test process — this is a maintenance script.");
    process.exit(1);
  }

  console.log("Velnox test-fixture cleanup");
  console.log(`Mode          : ${apply ? "APPLY (deletes)" : "DRY RUN (read-only)"}`);
  printTarget();

  const current = await query("SELECT current_database() AS db");
  console.log(`Database      : ${(current.rows[0] as { db?: string } | undefined)?.db ?? "unknown"}`);

  const [edges, primaryKeys] = await Promise.all([loadForeignKeys(), loadPrimaryKeys()]);
  const skipped = new Set<string>();

  const roots = await findFixtureRoots();
  const seeds = new Map<string, string[]>([
    ["users", roots.users.map((u) => u.id)],
    ["sellers", roots.sellerIds],
    ["shops", roots.shops.map((s) => s.id)],
  ]);

  const full = await closeOverForeignKeys({ seeds, edges, primaryKeys, skipped });
  printRoots(roots, full);

  if (skipped.size > 0) {
    heading("Tables without a single primary key (not addressable — reported only)");
    console.log(`  ${[...skipped].sort().join(", ")}`);
  }

  const depth = computeDepth([...full.keys()], edges);
  const order = [...full.keys()].sort((a, b) => (depth.get(b) ?? 0) - (depth.get(a) ?? 0));

  printClosure(full, order);

  const shared = await findSharedReferences(full, edges, primaryKeys);
  if (shared.length > 0) {
    heading("⚠ Shared references — rows in the delete set that point outside it");
    for (const row of shared) {
      console.log(`  ${row.table.padEnd(24)} ${row.column.padEnd(16)} → ${row.parent}   ${String(row.count).padStart(5)} row(s)`);
    }
    console.log("\nThese rows belong to an owner outside the fixture set. Review before deleting.");
  }

  const unreachable = await findUnreachableArtifacts();
  if (unreachable.category.length > 0) {
    heading("Fixture taxonomy not reachable by foreign key (NOT deleted)");
    for (const slug of unreachable.category.slice(0, LIST_LIMIT)) console.log(`  category ${slug}`);
    if (unreachable.category.length > LIST_LIMIT) {
      console.log(`  … and ${unreachable.category.length - LIST_LIMIT} more`);
    }
  }

  if (!apply) {
    console.log("\nDRY RUN complete — nothing was written. Re-run with --apply to delete.");
    return;
  }

  if (!allow) {
    console.error("\nRefusing to delete: set VELNOX_ALLOW_FIXTURE_CLEANUP=1 to confirm this is intentional.");
    process.exit(1);
  }

  if (shared.length > 0 && !allowShared) {
    console.error(
      "\nRefusing to delete: the delete set shares references with non-fixture rows (see above). " +
        "Re-run with --allow-shared once those rows have been reviewed.",
    );
    process.exit(1);
  }

  if (countRows(full) === 0) {
    console.log("\nNothing to delete — the application database is already clean.");
    return;
  }

  heading("Deleting (single transaction)");
  const result = await applyDeletions(full, order, primaryKeys);
  for (const row of result) console.log(`  ${row.table.padEnd(28)} ${String(row.deleted).padStart(6)} deleted`);

  // ─── Verification: the fixtures must be gone ─────────────────────────────
  heading("Verification");
  const after = await findFixtureRoots();
  const remainingUsers = after.users.length;
  const remainingShops = after.shops.length;
  console.log(`  fixture users remaining : ${remainingUsers}`);
  console.log(`  fixture shops remaining : ${remainingShops}`);
  if (remainingUsers > 0 || remainingShops > 0) {
    console.error("\nVerification FAILED — fixture rows are still present.");
    process.exit(1);
  }
  console.log("  result                  : PASS — no fixture rows remain");
}

await main();
process.exit(0);
