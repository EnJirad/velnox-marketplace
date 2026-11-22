import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { calculateChecksum } from "../src/checksum.ts";
import { Migrator, MigrationTamperedError } from "../src/migrator.ts";
import type { DbQueryable } from "../src/types.ts";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const MIGRATIONS_DIR = join(__dirname, "..", "migrations");

describe("Database Migration Engine Unit Tests", () => {
  it("computes deterministic SHA-256 checksums ignoring CRLF differences", () => {
    const unix = "CREATE TABLE users (id UUID PRIMARY KEY);\n";
    const win = "CREATE TABLE users (id UUID PRIMARY KEY);\r\n";
    const sumUnix = calculateChecksum(unix);
    const sumWin = calculateChecksum(win);

    assert.equal(sumUnix.length, 64);
    assert.equal(sumUnix, sumWin);
  });

  it("reads and parses migration files in alphanumeric sequence", async () => {
    const files = await Migrator.readMigrationFiles(MIGRATIONS_DIR);
    assert.ok(files.length >= 1);
    assert.equal(files[0].name, "0001_initial_schema.sql");
    assert.ok(files[0].sql.includes("CREATE TABLE IF NOT EXISTS"));
    assert.equal(files[0].checksum.length, 64);
  });

  it("plans all files as pending on an empty database", async () => {
    const mockDb: DbQueryable = {
      async query(sql: string) {
        if (sql.includes("_velnox_migrations")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    const plan = await Migrator.planMigrations(MIGRATIONS_DIR, mockDb);
    assert.equal(plan.applied.length, 0);
    assert.equal(plan.pending.length, 1);
    assert.equal(plan.pending[0].name, "0001_initial_schema.sql");
  });

  it("detects no pending migrations when all files are already applied", async () => {
    const files = await Migrator.readMigrationFiles(MIGRATIONS_DIR);
    const mockDb: DbQueryable = {
      async query(sql: string) {
        if (sql.includes("SELECT id, name, checksum")) {
          return {
            rows: [
              {
                id: 1,
                name: files[0].name,
                checksum: files[0].checksum,
                executed_at: "2026-11-22T00:00:00Z",
                execution_time_ms: 45,
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    const plan = await Migrator.planMigrations(MIGRATIONS_DIR, mockDb);
    assert.equal(plan.applied.length, 1);
    assert.equal(plan.pending.length, 0);
  });

  it("throws MigrationTamperedError if an applied migration's checksum differs", async () => {
    const files = await Migrator.readMigrationFiles(MIGRATIONS_DIR);
    const mockDb: DbQueryable = {
      async query(sql: string) {
        if (sql.includes("SELECT id, name, checksum")) {
          return {
            rows: [
              {
                id: 1,
                name: files[0].name,
                checksum: "0000000000000000000000000000000000000000000000000000000000000000",
                executed_at: "2026-11-22T00:00:00Z",
                execution_time_ms: 45,
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    await assert.rejects(
      () => Migrator.planMigrations(MIGRATIONS_DIR, mockDb),
      MigrationTamperedError,
    );
  });

  it("applies pending migrations inside an atomic transaction", async () => {
    const executed: string[] = [];
    const mockDb: DbQueryable = {
      async query(sql: string) {
        executed.push(sql.trim());
        if (sql.includes("SELECT id, name, checksum")) {
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    const result = await Migrator.applyMigrations(MIGRATIONS_DIR, mockDb);
    assert.equal(result.appliedCount, 1);
    assert.equal(result.appliedMigrations[0], "0001_initial_schema.sql");
    assert.ok(executed.includes("BEGIN;"));
    assert.ok(executed.includes("COMMIT;"));
  });

  it("rolls back on migration execution failure", async () => {
    let rolledBack = false;
    const mockDb: DbQueryable = {
      async query(sql: string) {
        if (sql.includes("SELECT id, name, checksum")) {
          return { rows: [] };
        }
        if (sql.includes("CREATE TABLE IF NOT EXISTS") && !sql.includes("_velnox_migrations")) {
          throw new Error("Syntax error in SQL migration");
        }
        if (sql.includes("ROLLBACK;")) {
          rolledBack = true;
          return { rows: [] };
        }
        return { rows: [] };
      },
    };

    await assert.rejects(
      () => Migrator.applyMigrations(MIGRATIONS_DIR, mockDb),
      /Failed to apply migration '0001_initial_schema.sql'/,
    );
    assert.equal(rolledBack, true);
  });
});
