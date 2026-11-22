#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Migrator } from "./src/migrator.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, "migrations");

async function main() {
  const command = process.argv[2] ?? "status";
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl || command === "check-files") {
    console.log("ℹ️  Inspecting local migration files in database/migrations/:\n");
    const files = await Migrator.readMigrationFiles(MIGRATIONS_DIR);
    console.log(`Found ${files.length} migration file(s):`);
    for (const f of files) {
      console.log(` - ${f.name} (SHA-256: ${f.checksum.slice(0, 16)}...)`);
    }
    if (!databaseUrl) {
      console.log("\n💡 Note: Set DATABASE_URL to run 'status', 'up', or 'check' against a database.");
    }
    return;
  }

  let pg: any;
  try {
    const imported = await import("pg");
    pg = imported.default ?? imported;
  } catch {
    console.error("❌ 'pg' driver is not installed in the current environment.");
    console.error("   To run migrations against PostgreSQL, ensure 'pg' or '@neondatabase/serverless' is installed.");
    process.exit(1);
  }

  const pool = new pg.Pool({
    connectionString: databaseUrl,
    ssl: databaseUrl?.includes("localhost") ? false : { rejectUnauthorized: false },
  });

  try {
    if (command === "status") {
      console.log("🔍 Checking migration status against database...\n");
      const plan = await Migrator.planMigrations(MIGRATIONS_DIR, pool);
      console.log(`Applied migrations (${plan.applied.length}):`);
      for (const m of plan.applied) {
        console.log(`  ✅ [${m.id}] ${m.name} (${m.execution_time_ms}ms) - ${m.executed_at}`);
      }

      console.log(`\nPending migrations (${plan.pending.length}):`);
      for (const m of plan.pending) {
        console.log(`  ⏳ ${m.name} (SHA-256: ${m.checksum.slice(0, 16)}...)`);
      }

      if (plan.pending.length === 0) {
        console.log("\n✨ Database schema is completely up to date!");
      }
    } else if (command === "up") {
      console.log("🚀 Applying pending migrations...\n");
      const result = await Migrator.applyMigrations(MIGRATIONS_DIR, pool);
      if (result.appliedCount === 0) {
        console.log("✨ No pending migrations to apply.");
      } else {
        console.log(`\n🎉 Successfully applied ${result.appliedCount} migration(s) in ${result.totalExecutionTimeMs}ms:`);
        for (const name of result.appliedMigrations) {
          console.log(`  - ${name}`);
        }
      }
    } else if (command === "check") {
      console.log("🔎 Dry-run check for schema drift and pending migrations...\n");
      const plan = await Migrator.planMigrations(MIGRATIONS_DIR, pool);
      console.log(`Applied: ${plan.applied.length}, Pending: ${plan.pending.length}`);
      if (plan.pending.length > 0) {
        console.log("Pending migrations exist. Run 'migrate up' to apply.");
      } else {
        console.log("✨ Schema checksums verified. Up to date.");
      }
    } else {
      console.log(`Unknown command: ${command}. Use 'status', 'up', or 'check'.`);
      process.exitCode = 1;
    }
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("❌ Migration error:", err);
  process.exit(1);
});
