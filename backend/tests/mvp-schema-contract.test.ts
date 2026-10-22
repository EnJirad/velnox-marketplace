/**
 * The canonical schema contract — `db/schema.sql` and `db/run-sqleditor.sql`.
 *
 * These two files are the whole database layer of the marketplace MVP: one
 * canonical model, one installer for the Neon SQL Editor, and nothing else in
 * `db/`. There is no migration chain, no second schema and no bootstrap
 * alternative — anything that would need a migration needs a decision about
 * this schema instead.
 *
 * What this file pins, and why:
 *
 *   • the installer's DDL is byte-identical to `db/schema.sql`, so an editor
 *     install and a `psql -f` install can never diverge;
 *   • neither file contains a SQL comment — the design rationale lives in
 *     `docs/DATABASE.md`, not in the DDL;
 *   • neither file destroys anything: no DROP TABLE/COLUMN/DATABASE, no
 *     TRUNCATE, no DELETE, no INSERT/UPDATE. They only ever create;
 *   • the model is the 23-table MVP: ONE order axis, ONE stock authority
 *     (`inventory`), one retail selling-unit table that owns no stock, money
 *     as NUMERIC(12,2), provider identities, one-row-per-user reviews and
 *     favourites, and no VelRepeat / memory / wholesale / chat / staff-RBAC
 *     objects;
 *   • the installer is rerunnable: every CREATE is IF NOT EXISTS (functions
 *     CREATE OR REPLACE, triggers preceded by DROP TRIGGER IF EXISTS), and its
 *     additive upgrade section only adds missing columns/constraints, so an
 *     already-installed database can be brought forward without a migration
 *     chain and without touching a row;
 *   • the seed is platform configuration only — categories, never a fake
 *     seller, product, order or payment.
 *
 * The behavioural counterpart is `bun run test:mvp`, which applies
 * `db/schema.sql` to a disposable database and exercises the real triggers and
 * constraints through the API. Run both.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";

import {
  RUN_SQLEDITOR_SQL,
  REPO_ROOT,
  SCHEMA_SQL,
  VERIFY_BLOCK_MARKER,
  canonicalParity,
  commentTokens,
  dangerousStatements,
  ddlOf,
  declaredColumns,
  declaredIndexNames,
  declaredTables,
  declaredTriggerNames,
  readSql,
  stripSqlComments,
  upgradeOf,
  upgradedColumns,
} from "./helpers/canonical-schema.js";

const schema = readSql(SCHEMA_SQL);
const installer = readSql(RUN_SQLEDITOR_SQL);

/** The MVP model, in dependency order. A change here is a schema decision. */
const MVP_TABLES = [
  "users",
  "revoked_tokens",
  "user_identities",
  "seller_profiles",
  "categories",
  "products",
  "product_favorites",
  "product_images",
  "product_variants",
  "inventory",
  "product_selling_units",
  "media",
  "addresses",
  "carts",
  "cart_items",
  "orders",
  "order_items",
  "product_reviews",
  "shipments",
  "checkout_requests",
  "payments",
  "payment_events",
  "audit_logs",
];

/** Everything a marketplace MVP deliberately does not model. */
const FORBIDDEN_TABLES = [
  "velrepeat_plans",
  "velrepeat_items",
  "velrepeat_cycles",
  "velrepeat_packages",
  "vrepeat_packages",
  "vrepeat_deliveries",
  "subscriptions",
  "store_accounts",
  "shops",
  "checkout_groups",
  "conversations",
  "chat_messages",
  "customer_wishlist",
  "customer_profiles",
  "behavioral_events",
  "customer_events",
  "tracking_events",
  "employees",
  "departments",
  "seller_goals",
  "seller_analytics",
  "refunds",
  "settlements",
  "ledger_entries",
  "commissions",
  "inventory_movements",
  "payment_attempts",
  "payment_incidents",
  "schema_migrations",
];

const FORBIDDEN_COLUMNS = [
  "order_state",
  "fulfillment_status",
  "payment_state",
  "checkout_group_id",
  "shop_id",
  "inventory_released",
  "reservation_policy",
  "is_wholesale",
  "sold_count",
  "review_count",
  "stock",
  "committed",
  "returned",
  "correlation_id",
];

const columns = declaredColumns(schema);
const columnOf = (table: string, column: string) =>
  columns.find((c) => c.table === table && c.column === column);

describe("the two canonical files", () => {
  test("are the only files in db/", () => {
    const entries = readdirSync(join(REPO_ROOT, "db")).sort();
    expect(entries).toEqual(["run-sqleditor.sql", "schema.sql"]);
  });

  test("contain no SQL comments", () => {
    expect(commentTokens(schema)).toEqual([]);
    expect(commentTokens(installer)).toEqual([]);
  });

  test("contain no destructive or data-writing statement", () => {
    expect(dangerousStatements(schema)).toEqual([]);
    expect(dangerousStatements(installer)).toEqual([]);
  });

  test("declare identical DDL", () => {
    const parity = canonicalParity();
    expect(parity.diff).toBe("");
    expect(parity.ok).toBe(true);
  });

  test("the installer is the canonical DDL plus a guarded upgrade and a read-only check", () => {
    // DDL parity is unchanged: the CREATE section must be the schema, verbatim.
    const schemaDdl = ddlOf(schema);
    expect(ddlOf(installer)).toBe(schemaDdl);
    expect(installer.startsWith(schemaDdl)).toBe(true);

    // The upgrade section exists so a database installed from an OLDER version
    // of this schema can be brought forward. It is additive only.
    const upgrade = upgradeOf(installer);
    expect(upgrade.length).toBeGreaterThan(0);
    expect(/drop|truncate|delete|insert|update/i.test(upgrade)).toBe(false);
    for (const statement of upgrade.split(/;\s*\n(?=ALTER TABLE|DO \$\$)/)) {
      expect(
        /^ALTER TABLE [a-z_]+\s+ADD COLUMN IF NOT EXISTS [a-z_]+ [A-Z]/.test(statement) ||
          /^DO \$\$/.test(statement),
      ).toBe(true);
    }

    // Every column the upgrade adds must be a canonical column of the same
    // type, or a repaired database would not equal a freshly installed one.
    const added = upgradedColumns(installer);
    expect(added.map((c) => `${c.table}.${c.column}`).sort()).toEqual([
      "addresses.latitude",
      "addresses.longitude",
      "users.cover_url",
    ]);
    for (const column of added) {
      expect(columnOf(column.table, column.column)?.dataType).toBe(column.dataType);
    }

    // Everything after the upgrade is the read-only catalog check.
    const tail = installer.slice(installer.indexOf(VERIFY_BLOCK_MARKER)).trim();
    expect(tail.startsWith("SELECT")).toBe(true);
    expect(tail.endsWith(";")).toBe(true);
    expect(/insert|update|delete|drop|alter/i.test(tail)).toBe(false);
  });
});

describe("the model", () => {
  test("declares exactly the 23 MVP tables", () => {
    expect(declaredTables(schema).sort()).toEqual([...MVP_TABLES].sort());
  });

  test("declares no non-MVP table", () => {
    const tables = declaredTables(schema);
    for (const forbidden of FORBIDDEN_TABLES) expect(tables).not.toContain(forbidden);
  });

  test("declares no non-MVP column", () => {
    const names = columns.map((c) => c.column);
    for (const forbidden of FORBIDDEN_COLUMNS) expect(names).not.toContain(forbidden);
  });

  test("declares the cover, review, favourite and address-model columns the restored UI reads", () => {
    // The two deployed-database failures this contract now pins: `/auth/me`
    // selects users.cover_url, and the product list aggregates product_reviews.
    expect(columnOf("users", "cover_url")?.dataType).toBe("TEXT");
    expect(declaredTables(schema)).toContain("product_reviews");
    expect(columnOf("product_reviews", "rating")?.dataType).toBe("SMALLINT");
    expect(columnOf("product_reviews", "comment")?.dataType).toBe("TEXT");
    expect(columnOf("product_reviews", "status")?.dataType).toBe("TEXT");
    expect(columnOf("product_favorites", "user_id")).toBeDefined();
    expect(columnOf("product_favorites", "product_id")).toBeDefined();
    // Map-picked addresses: a coordinate pair, never a float.
    expect(columnOf("addresses", "latitude")?.dataType).toBe("NUMERIC(9, 6)");
    expect(columnOf("addresses", "longitude")?.dataType).toBe("NUMERIC(9, 6)");
  });

  test("keeps ONE order status axis", () => {
    const status = columnOf("orders", "status");
    expect(status?.dataType).toBe("TEXT");
    expect(schema).toContain(
      "CHECK (status IN ('pending_payment', 'paid', 'processing', 'shipped', 'delivered', 'cancelled'))",
    );
  });

  test("keeps inventory as the only stock authority", () => {
    expect(columnOf("inventory", "quantity")).toBeDefined();
    expect(columnOf("inventory", "reserved")).toBeDefined();
    expect(columnOf("product_variants", "stock")).toBeUndefined();
    expect(declaredTables(schema).filter((t) => /stock|inventory/i.test(t))).toEqual(["inventory"]);
  });

  test("models a selling unit as quantity, price and activity — never as stock", () => {
    expect(columnOf("product_selling_units", "label")).toBeDefined();
    expect(columnOf("product_selling_units", "base_quantity")).toBeDefined();
    expect(columnOf("product_selling_units", "price")).toBeDefined();
    expect(columnOf("product_selling_units", "is_active")).toBeDefined();
    expect(columnOf("product_selling_units", "quantity")).toBeUndefined();
  });

  test("stores money as NUMERIC(12, 2) and never as a float", () => {
    const money = columns.filter((c) => ["price", "subtotal", "unit_price", "total_amount", "shipping_fee", "amount"].includes(c.column));
    expect(money.length).toBeGreaterThanOrEqual(6);
    for (const col of money) expect(`${col.table}.${col.column} ${col.dataType}`).toContain("NUMERIC(12, 2)");
    for (const col of columns) expect(["REAL", "DOUBLE PRECISION", "MONEY"]).not.toContain(col.dataType);
  });

  test("enforces the lifecycle in the database, with seven triggers", () => {
    expect(declaredTriggerNames(schema).sort()).toEqual(
      [
        "trg_prevent_circular_category_parent",
        "trg_products_approved_seller",
        "trg_products_status_transition",
        "trg_orders_approved_seller",
        "trg_orders_status_transition",
        "trg_cart_items_selling_unit",
        "trg_order_items_published_product",
      ].sort(),
    );
    expect((schema.match(/LANGUAGE plpgsql/g) ?? []).length).toBe(7);
  });

  test("is rerunnable: every creation is guarded", () => {
    const unguardedTable = /CREATE TABLE (?!IF NOT EXISTS)/i.exec(stripSqlComments(schema));
    expect(unguardedTable).toBe(null);
    const unguardedIndex = /CREATE (?:UNIQUE )?INDEX (?!IF NOT EXISTS)/i.exec(stripSqlComments(schema));
    expect(unguardedIndex).toBe(null);
    expect(declaredIndexNames(schema).length).toBeGreaterThan(30);
    // Functions are replaced in place; triggers are dropped then recreated.
    expect((schema.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length).toBe(7);
    expect((schema.match(/DROP TRIGGER IF EXISTS/g) ?? []).length).toBe(7);
  });

  test("carries no extension requirement", () => {
    expect(/CREATE EXTENSION/i.test(schema)).toBe(false);
  });
});

describe("the development seed", () => {
  const seedPath = join(REPO_ROOT, "scripts", "db-seed.sql");

  test("exists next to the other database tooling", () => {
    expect(existsSync(seedPath)).toBe(true);
  });

  test("contains platform categories only", () => {
    const seed = readFileSync(seedPath, "utf8");
    const inserts = [...seed.matchAll(/INSERT INTO\s+([a-z_]+)/gi)].map((m) => m[1]!.toLowerCase());
    expect([...new Set(inserts)].sort()).toEqual(["categories"]);
    for (const forbidden of ["users", "seller_profiles", "products", "orders", "payments", "inventory"]) {
      expect(inserts).not.toContain(forbidden);
    }
  });
});
