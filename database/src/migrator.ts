import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { calculateChecksum } from "./checksum.ts";
import type {
  DbQueryable,
  MigrationFile,
  MigrationPlan,
  MigrationRecord,
  MigrationResult,
} from "./types.ts";

export class MigrationTamperedError extends Error {
  public readonly migrationName: string;
  public readonly expectedChecksum: string;
  public readonly actualChecksum: string;

  constructor(
    migrationName: string,
    expectedChecksum: string,
    actualChecksum: string,
  ) {
    super(
      `Migration tampering detected in '${migrationName}'. ` +
        `Previously applied checksum: ${expectedChecksum}, but current file checksum: ${actualChecksum}. ` +
        `Modifying already applied migrations is strictly prohibited!`,
    );
    this.name = "MigrationTamperedError";
    this.migrationName = migrationName;
    this.expectedChecksum = expectedChecksum;
    this.actualChecksum = actualChecksum;
  }
}

export class Migrator {
  public static async ensureMigrationTable(db: DbQueryable): Promise<void> {
    const ddl = `
      CREATE TABLE IF NOT EXISTS _velnox_migrations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) UNIQUE NOT NULL,
        checksum VARCHAR(64) NOT NULL,
        executed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        execution_time_ms INTEGER NOT NULL
      );
    `;
    await db.query(ddl);
  }

  public static async getAppliedMigrations(db: DbQueryable): Promise<MigrationRecord[]> {
    await this.ensureMigrationTable(db);
    const res = await db.query(
      `SELECT id, name, checksum, executed_at, execution_time_ms FROM _velnox_migrations ORDER BY id ASC`,
    );
    return res.rows.map((row: any) => ({
      id: Number(row.id),
      name: String(row.name),
      checksum: String(row.checksum),
      executed_at: String(row.executed_at),
      execution_time_ms: Number(row.execution_time_ms),
    }));
  }

  public static async readMigrationFiles(migrationsDir: string): Promise<MigrationFile[]> {
    const entries = await readdir(migrationsDir, { withFileTypes: true });
    const sqlFiles = entries
      .filter((e) => e.isFile() && e.name.endsWith(".sql"))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

    const migrations: MigrationFile[] = [];
    for (const name of sqlFiles) {
      const filePath = join(migrationsDir, name);
      const sql = await readFile(filePath, "utf8");
      const checksum = calculateChecksum(sql);
      migrations.push({
        name,
        path: filePath,
        checksum,
        sql,
      });
    }

    return migrations;
  }

  public static async planMigrations(
    migrationsDir: string,
    db: DbQueryable,
  ): Promise<MigrationPlan> {
    const applied = await this.getAppliedMigrations(db);
    const files = await this.readMigrationFiles(migrationsDir);

    const appliedMap = new Map<string, MigrationRecord>();
    for (const record of applied) {
      appliedMap.set(record.name, record);
    }

    const pending: MigrationFile[] = [];

    for (const file of files) {
      const appliedRecord = appliedMap.get(file.name);
      if (appliedRecord) {
        if (appliedRecord.checksum !== file.checksum) {
          throw new MigrationTamperedError(
            file.name,
            appliedRecord.checksum,
            file.checksum,
          );
        }
      } else {
        pending.push(file);
      }
    }

    return { applied, pending };
  }

  public static async applyMigrations(
    migrationsDir: string,
    db: DbQueryable,
    options: { dryRun?: boolean } = {},
  ): Promise<MigrationResult> {
    const plan = await this.planMigrations(migrationsDir, db);

    if (options.dryRun || plan.pending.length === 0) {
      return {
        appliedCount: 0,
        appliedMigrations: [],
        totalExecutionTimeMs: 0,
      };
    }

    let totalExecutionTimeMs = 0;
    const appliedMigrations: string[] = [];

    for (const migration of plan.pending) {
      const start = Date.now();
      try {
        await db.query("BEGIN;");
        await db.query(migration.sql);

        const executionTimeMs = Date.now() - start;
        totalExecutionTimeMs += executionTimeMs;

        await db.query(
          `INSERT INTO _velnox_migrations (name, checksum, execution_time_ms) VALUES ($1, $2, $3)`,
          [migration.name, migration.checksum, executionTimeMs],
        );

        await db.query("COMMIT;");
        appliedMigrations.push(migration.name);
      } catch (err) {
        await db.query("ROLLBACK;").catch(() => {});
        throw new Error(
          `Failed to apply migration '${migration.name}': ${(err as Error).message}`,
          { cause: err },
        );
      }
    }

    return {
      appliedCount: appliedMigrations.length,
      appliedMigrations,
      totalExecutionTimeMs,
    };
  }
}
