/**
 * MVP schema contract.
 *
 * `db/mvp/schema.sql` is the canonical data model for the commerce MVP. It is
 * the only place the following are allowed to be defined, and this test fails
 * the moment the file drifts from them:
 *
 *   • 20 tables — one identity, one seller, one catalog, one stock authority,
 *     one retail selling-unit table, one cart per (buyer, seller), one order
 *     per seller, one payment model;
 *   • ONE order status axis (6 values) and ONE product lifecycle (5 values);
 *   • money is NUMERIC(12,2), never floating point;
 *   • `product_variants` has no stock column — `inventory` is the only stock;
 *   • a selling unit (set/pack) is `base_quantity` base units for its own
 *     price and owns NO stock — `inventory` remains the only stock table;
 *   • non-MVP domains (VelRepeat, memory, wholesale, reviews, wishlist, chat,
 *     goals, staff RBAC, multi-shop groups) are absent;
 *   • the reset is destructive but fail-closed, and the seed contains platform
 *     categories only, never fake marketplace rows.
 *
 * The behavioural counterpart is `db/mvp/verify.sh`, which proves these rules
 * against a real PostgreSQL rather than reading the file. Run both.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const schema = read("db/mvp/schema.sql");
const reset = read("db/mvp/reset.sql");
const seed = read("db/mvp/seed.sql");

/** SQL with `--` comment lines removed, so prose never satisfies a check. */
const code = schema
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

function tableBlocks(sql: string): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const match of sql.matchAll(
    /CREATE TABLE IF NOT EXISTS ([a-z_][a-z_0-9]*) \(([\s\S]*?)\n\);/g,
  )) {
    // Comment lines are prose, not schema: strip them so a sentence that
    // mentions "stock" cannot satisfy or break a structural assertion.
    const body = match[2]!
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("--"))
      .join("\n");
    blocks.set(match[1]!, body);
  }
  return blocks;
}

function columns(body: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const raw of body.split("\n")) {
    const line = raw.trim().replace(/,$/, "");
    if (!line) continue;
    if (/^(CONSTRAINT|PRIMARY KEY|UNIQUE|CHECK|FOREIGN KEY)\b/i.test(line)) continue;
    const match = /^([a-z_][a-z_0-9]*)\s+([A-Z]+(?:\([^)]*\))?)/i.exec(line);
    if (match) out.set(match[1]!, match[2]!);
  }
  return out;
}

const tables = tableBlocks(code);
const expectedTables = [
  "addresses",
  "audit_logs",
  "cart_items",
  "carts",
  "categories",
  "checkout_requests",
  "inventory",
  "media",
  "order_items",
  "orders",
  "payment_events",
  "payments",
  "product_images",
  "product_selling_units",
  "product_variants",
  "products",
  "revoked_tokens",
  "seller_profiles",
  "shipments",
  "users",
];

const forbiddenTables = [
  "velrepeat",
  "vrepeat",
  "subscriptions",
  "behavioral_events",
  "customer_events",
  "customer_profiles",
  "customer_wishlist",
  "product_reviews",
  "conversations",
  "chat_messages",
  "seller_goals",
  "seller_analytics",
  "employees",
  "departments",
  "company_settings",
  "system_settings",
  "platform_settings",
  "commissions",
  "settlements",
  "ledger_entries",
  "outbox_events",
  "inventory_movements",
  "fulfillment_orders",
  "shipment_items",
  "order_returns",
  "payment_attempts",
  "reconciliation_runs",
  "reconciliation_findings",
  "product_verifications",
  "product_attribute",
  "product_option",
  "option_value_images",
  "product_variant_images",
  "checkout_groups",
  "store_accounts",
  "notifications",
  "refunds",
  "moderation_records",
  "seller_review_history",
  "seller_verifications",
  "seller_settings",
  "schema_migrations",
  "tracking_events",
  "shops",
  "store_accounts",
];

describe("MVP schema — table set", () => {
  test("declares exactly the 20 MVP tables", () => {
    expect([...tables.keys()].sort()).toEqual(expectedTables);
  });

  test("carries no table from a non-MVP domain", () => {
    const actual = [...tables.keys()];
    for (const needle of forbiddenTables) {
      expect(actual.filter((name) => name.includes(needle))).toEqual([]);
    }
  });

  test("every table declares a primary key", () => {
    for (const [name, body] of tables) {
      expect({ table: name, pk: /PRIMARY KEY/.test(body) }).toEqual({ table: name, pk: true });
    }
  });
});

describe("MVP schema — one model per domain", () => {
  test("orders has ONE canonical status axis with exactly six values", () => {
    const body = tables.get("orders")!;
    const match = /status TEXT NOT NULL DEFAULT 'pending_payment'\s+CHECK \(status IN \(([^)]*)\)\)/.exec(body);
    expect(match).not.toBeNull();
    const values = [...match![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual([
      "pending_payment",
      "paid",
      "processing",
      "shipped",
      "delivered",
      "cancelled",
    ]);
    // The axes that used to disagree with orders.status must not come back.
    expect(body).not.toMatch(/order_state|fulfillment_status|inventory_released|checkout_group_id/);
  });

  test("products has one lifecycle axis and a GENERATED approval projection", () => {
    const body = tables.get("products")!;
    const match = /status TEXT NOT NULL DEFAULT 'draft'\s+CHECK \(status IN \(([^)]*)\)\)/.exec(body);
    expect(match).not.toBeNull();
    const values = [...match![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual(["draft", "submitted", "approved", "published", "rejected"]);
    expect(body).toMatch(/approval_status TEXT GENERATED ALWAYS AS \(/);
  });

  test("seller_profiles covers pending → approved/rejected/suspended", () => {
    const body = tables.get("seller_profiles")!;
    const match = /CHECK \(status IN \(([^)]*)\)\)/.exec(body);
    expect(match).not.toBeNull();
    const values = [...match![1]!.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);
    expect(values).toEqual(["pending", "approved", "rejected", "suspended"]);
  });

  test("inventory is the ONLY stock authority", () => {
    expect(tables.get("product_variants")!).not.toMatch(/\bstock\b/);
    const inv = tables.get("inventory")!;
    expect(inv).toMatch(/quantity INTEGER NOT NULL DEFAULT 0 CHECK \(quantity >= 0\)/);
    expect(inv).toMatch(/reserved INTEGER NOT NULL DEFAULT 0 CHECK \(reserved >= 0\)/);
    expect(inv).toMatch(/CHECK \(reserved <= quantity\)/);
    // One row per (product, variant); the base product is the NULL variant.
    expect(code).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_inventory_scope_unique\s+ON inventory \(product_id, COALESCE\(variant_id/,
    );
  });

  test("one cart per buyer per seller, and no cross-seller cart line", () => {
    expect(tables.get("carts")!).toMatch(/UNIQUE \(user_id, seller_id\)/);
    expect(tables.get("cart_items")!).toMatch(/FOREIGN KEY \(cart_id, seller_id\) REFERENCES carts \(id, seller_id\)/);
    expect(tables.get("cart_items")!).toMatch(
      /FOREIGN KEY \(product_id, seller_id\) REFERENCES products \(id, seller_id\)/,
    );
    expect(tables.get("cart_items")!).toMatch(
      /FOREIGN KEY \(product_id, variant_id\) REFERENCES product_variants \(product_id, id\)/,
    );
  });

  test("one seller per order, down to the line", () => {
    expect(tables.get("orders")!).toMatch(/seller_id UUID NOT NULL REFERENCES seller_profiles\(id\)/);
    expect(tables.get("orders")!).toMatch(/UNIQUE \(id, seller_id\)/);
    expect(tables.get("order_items")!).toMatch(
      /FOREIGN KEY \(order_id, seller_id\) REFERENCES orders \(id, seller_id\)/,
    );
    expect(tables.get("order_items")!).toMatch(
      /FOREIGN KEY \(product_id, seller_id\) REFERENCES products \(id, seller_id\)/,
    );
  });

  test("an order snapshots its address, totals and line prices", () => {
    const orders = tables.get("orders")!;
    expect(orders).toMatch(/shipping_address JSONB NOT NULL/);
    expect(orders).not.toMatch(/shipping_address_id/);
    expect(orders).toMatch(/CONSTRAINT orders_total_matches_parts CHECK \(total_amount = subtotal \+ shipping_fee\)/);
    const items = tables.get("order_items")!;
    expect(items).toMatch(/product_name TEXT NOT NULL/);
    expect(items).toMatch(/unit_price NUMERIC\(12, 2\) NOT NULL/);
    expect(items).toMatch(/CONSTRAINT order_items_subtotal_matches CHECK \(subtotal = unit_price \* quantity\)/);
  });

  test("payments are Stripe-only and have one live session per order", () => {
    const payments = tables.get("payments")!;
    expect(payments).toMatch(/provider TEXT NOT NULL DEFAULT 'stripe' CHECK \(provider IN \('stripe'\)\)/);
    expect(payments).toMatch(/status IN \('pending', 'requires_action', 'processing', 'paid', 'failed', 'cancelled'\)/);
    expect(code).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_one_active_stripe\s+ON payments \(order_id\) WHERE provider = 'stripe' AND status IN \('pending', 'requires_action'\)/,
    );
    // A webhook event is claimed exactly once.
    expect(tables.get("payment_events")!).toMatch(/event_id TEXT NOT NULL UNIQUE/);
    // COD / mock payment must never appear in the canonical model.
    expect(code).not.toMatch(/'cod'/i);
    expect(code).not.toMatch(/mock/i);
  });
});

describe("MVP schema — money and constraints", () => {
  test("every monetary column is NUMERIC(12, 2)", () => {
    const monetary = new Set([
      "price",
      "unit_price",
      "subtotal",
      "shipping_fee",
      "total_amount",
      "amount",
    ]);
    for (const [table, body] of tables) {
      for (const [column, type] of columns(body)) {
        if (monetary.has(column)) {
          expect({ table, column, type }).toEqual({ table, column, type: "NUMERIC(12, 2)" });
        }
      }
    }
  });

  test("no floating-point type exists anywhere in the schema", () => {
    expect(code).not.toMatch(/\b(REAL|DOUBLE PRECISION|FLOAT)\b/i);
  });

  test("required constraints and partial indexes are declared", () => {
    const required = [
      "users_admin_requires_password",
      "seller_profiles_no_self_approval",
      "seller_profiles_approved_requires_evidence",
      "products_published_requires_evidence",
      "products_rejected_requires_reason",
      "inventory_reserved_within_stock",
      "orders_total_matches_parts",
      "order_items_subtotal_matches",
      "payments_paid_requires_evidence",
      "cart_items_cart_fk",
      "cart_items_product_fk",
      "cart_items_variant_fk",
      "product_selling_units_variant_fk",
      "order_items_order_fk",
      "order_items_product_fk",
      "order_items_variant_fk",
    ];
    for (const name of required) expect(code).toContain(name);
    expect(code).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_addresses_one_default");
    expect(code).toContain("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower");
  });

  test("the lifecycle triggers are declared and enforce the drawn transitions", () => {
    for (const fn of [
      "prevent_circular_category_parent",
      "require_approved_seller_for_product",
      "enforce_product_status_transition",
      "require_approved_seller_for_order",
      "require_published_product_for_order_item",
      "enforce_cart_item_selling_unit",
      "enforce_order_status_transition",
    ]) {
      expect(code).toContain(`CREATE OR REPLACE FUNCTION ${fn}()`);
      expect(code).toContain(`EXECUTE FUNCTION ${fn}();`);
    }
    // Order transitions, exactly as documented.
    expect(code).toContain("(OLD.status = 'pending_payment' AND NEW.status IN ('paid', 'cancelled'))");
    expect(code).toContain("(OLD.status = 'paid'            AND NEW.status IN ('processing', 'cancelled'))");
    expect(code).toContain("(OLD.status = 'processing'      AND NEW.status IN ('shipped', 'cancelled'))");
    expect(code).toContain("(OLD.status = 'shipped'         AND NEW.status = 'delivered')");
  });

  test("a selling unit describes stock instead of owning it", () => {
    const units = tables.get("product_selling_units")!;
    // Its own price and base quantity, exactly like the business rule.
    expect(units).toMatch(/base_quantity INTEGER NOT NULL DEFAULT 1\s+CHECK \(base_quantity > 0/);
    expect(units).toMatch(/price NUMERIC\(12, 2\) NOT NULL CHECK \(price >= 0\)/);
    expect(units).toMatch(/is_active BOOLEAN NOT NULL DEFAULT TRUE/);
    // NO stock column: `inventory` stays the ONE stock authority.
    expect([...columns(units).keys()]).not.toContain("quantity");
    expect([...columns(units).keys()]).not.toContain("stock");
    expect(units).toMatch(/FOREIGN KEY \(product_id, variant_id\)\s+REFERENCES product_variants \(product_id, id\) ON DELETE RESTRICT/);

    // A cart/order line names the unit, and the line's identity includes it, so
    // "2 singles" and "1 × Pack 6" can never collapse into one line.
    expect([...columns(tables.get("cart_items")!).keys()]).toContain("selling_unit_id");
    expect(code).toMatch(
      /idx_cart_items_unique_line\s+ON cart_items \([\s\S]*?COALESCE\(selling_unit_id/,
    );
    expect(tables.get("cart_items")!).toMatch(
      /selling_unit_id UUID REFERENCES product_selling_units\(id\) ON DELETE RESTRICT/,
    );

    // The order keeps the durable snapshot and derives the held stock from it.
    const items = tables.get("order_items")!;
    expect(items).toMatch(/selling_unit_label TEXT NOT NULL DEFAULT ''/);
    expect(items).toMatch(/selling_unit_base_quantity INTEGER NOT NULL DEFAULT 1/);
    expect(items).toMatch(
      /base_quantity_total INTEGER GENERATED ALWAYS AS \(quantity \* selling_unit_base_quantity\) STORED/,
    );
    expect(items).not.toMatch(/base_quantity_total INTEGER NOT NULL/);
  });

  test("schema.sql itself is non-destructive", () => {
    expect(code).not.toMatch(/DROP TABLE|DROP COLUMN|DROP SCHEMA|TRUNCATE|DELETE FROM/i);
  });
});

describe("MVP reset and seed are fail-closed", () => {
  test("reset requires a _dev/_test name AND an explicit session opt-in", () => {
    expect(reset).toContain("current_database() !~* '_(dev|test)$'");
    expect(reset).toContain("current_setting('velnox.allow_reset', true)");
    expect(reset).toContain("DROP SCHEMA IF EXISTS public CASCADE");
    expect(reset).toContain("\\ir schema.sql");
  });

  test("reset.sh never falls back to DATABASE_URL", () => {
    const script = read("db/mvp/reset.sh");
    expect(script).toContain("VELNOX_RESET_DATABASE_URL");
    expect(script).toContain("backend/db/test-database.ts");
    expect(script).toContain("the reset target is DATABASE_URL");
    expect(script).not.toMatch(/VELNOX_RESET_DATABASE_URL:-\\$DATABASE_URL/);
  });

  test("seed contains platform categories only", () => {
    expect(seed).toContain("current_database() !~* '_(dev|test)$'");
    expect(seed).toContain("INSERT INTO categories");
    for (const table of [
      "users",
      "seller_profiles",
      "products",
      "product_variants",
      "inventory",
      "orders",
      "order_items",
      "payments",
    ]) {
      expect(seed).not.toContain(`INSERT INTO ${table}`);
    }
  });
});
