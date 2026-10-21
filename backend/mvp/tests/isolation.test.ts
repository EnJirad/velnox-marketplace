/**
 * MVP isolation guards — the structural promises of the Phase 3 routing strategy.
 *
 * These are source-level assertions (no database, no network) because the risk
 * they cover is structural: a future edit that points an MVP query at a pre-MVP
 * table, moves a route outside `/api/mvp`, or mounts `express.json()` before the
 * webhook body buffer would not fail any behavioural test until production.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const mvpDir = join(dirname(fileURLToPath(import.meta.url)), "..");
const backendDir = join(mvpDir, "..");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "tests" || entry === "node_modules") continue;
      out.push(...walk(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const mvpFiles = walk(mvpDir).map((path) => ({ path, source: readFileSync(path, "utf8") }));
const serverSource = readFileSync(join(backendDir, "server.ts"), "utf8");

/**
 * Tables that exist ONLY in the frozen pre-MVP schema.
 *
 * `product_selling_units` was on this list until Phase 3d gave the MVP its own
 * (deliberately different: label / base_quantity / price / is_active) table of
 * that name. The guard is about not reading a table the MVP schema does not
 * have, so the name is no longer an offence.
 */
const PRE_MVP_TABLES = [
  "shops",
  "checkout_groups",
  "checkout_group_orders",
  "seller_verifications",
  "auth_identities",
  "customer_profiles",
  "product_option_groups",
  "product_option_values",
  "product_variant_values",
  "product_variant_images",
  "velrepeat_plans",
  "velrepeat_packages",
  "chat_conversations",
  "chat_messages",
  "wishlists",
  "reviews",
  "notifications",
  "refunds",
  "schema_migrations",
  "employees",
  "platform_settings",
  "store_accounts",
  "product_verifications",
];

describe("MVP tree isolation", () => {
  test("no MVP module queries a pre-MVP table", () => {
    const offenders: string[] = [];
    for (const file of mvpFiles) {
      for (const table of PRE_MVP_TABLES) {
        const pattern = new RegExp(`\\b(?:FROM|JOIN|INTO|UPDATE)\\s+${table}\\b`, "i");
        if (pattern.test(file.source)) {
          offenders.push(`${file.path} → ${table}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test("every MVP route is namespaced under /api/mvp", () => {
    const offenders: string[] = [];
    for (const file of mvpFiles) {
      for (const match of file.source.matchAll(/app\.(get|post|patch|put|delete)\(\s*[\n ]*"([^"]+)"/g)) {
        const path = match[2]!;
        if (!path.startsWith("/api/mvp/")) offenders.push(`${file.path} → ${path}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the MVP routers are mounted behind the MVP_API_ENABLED flag", () => {
    expect(serverSource).toContain("import { isMvpApiEnabled, setupMvpRoutes } from \"./mvp/index.js\"");
    expect(serverSource).toContain("if (isMvpApiEnabled()) {");
    expect(serverSource).toContain("setupMvpRoutes(app);");
  });

  test("both webhook bodies are buffered before express.json()", () => {
    const legacyRaw = serverSource.indexOf("app.use(stripeWebhookRawBody)");
    const mvpRaw = serverSource.indexOf("app.use(mvpWebhookRawBody)");
    const json = serverSource.indexOf("express.json({ limit: \"1mb\" })");
    expect(legacyRaw).toBeGreaterThan(-1);
    expect(mvpRaw).toBeGreaterThan(-1);
    expect(json).toBeGreaterThan(-1);
    expect(legacyRaw).toBeLessThan(json);
    expect(mvpRaw).toBeLessThan(json);
  });

  test("the MVP webhook is registered on the path the raw-body matcher buffers", async () => {
    const { MVP_STRIPE_WEBHOOK_PATH } = await import("../webhook-body.js");
    expect(MVP_STRIPE_WEBHOOK_PATH).toBe("/api/mvp/payments/webhook");
    const payments = mvpFiles.find((file) => file.path.endsWith("payments.ts"))!;
    expect(payments.source).toContain(`app.post(\n    "${MVP_STRIPE_WEBHOOK_PATH}"`);
  });

  test("Stripe access is centralised: one client factory, no direct SDK construction per route", () => {
    const constructors = mvpFiles.filter((file) => /new Stripe\(/.test(file.source));
    expect(constructors.map((file) => file.path.replace(mvpDir, ""))).toEqual(["/payments.ts"]);
  });

  test("money is never compared or summed as a JavaScript float in MVP code", () => {
    const offenders: string[] = [];
    for (const file of mvpFiles) {
      // `Number(row.amount)` / `parseFloat` / `toFixed` are the three ways a
      // NUMERIC column becomes an IEEE-754 value in this codebase.
      if (/\bparseFloat\s*\(/.test(file.source)) offenders.push(`${file.path} → parseFloat`);
      if (/\.toFixed\s*\(/.test(file.source)) offenders.push(`${file.path} → toFixed`);
      if (/Number\(\s*[^)]*\b(?:total_amount|subtotal|unit_price|price|amount)\b[\s,)]/.test(file.source)) {
        offenders.push(`${file.path} → Number(money column)`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
