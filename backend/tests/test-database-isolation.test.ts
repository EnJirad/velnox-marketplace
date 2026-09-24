/**
 * Test database isolation guards (TASK 004A).
 *
 * Production was polluted with fixture shops (`so-test-*`, `inv-*`,
 * `inv-cancel-*`, `inv-paid-*`) because the backend integration tests created
 * real rows in whichever database the application `DATABASE_URL` pointed at —
 * `bun test` auto-loads `.env`, so that was production.
 *
 * These tests pin the fix:
 *
 *  1. `database-guard.ts` refuses any test database that is, looks like, or is
 *     not provably distinct from the production target.
 *  2. The backend pool never resolves a test-process connection from the
 *     application URL.
 *  3. No test file re-introduces the old `Boolean(process.env.DATABASE_URL)`
 *     gate — every DB-backed test must go through `./helpers/test-db.js`.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  classifyDatabaseTarget,
  isTestRunnerProcess,
  parseDatabaseTarget,
  redactHost,
  resolveApplicationDatabaseUrl,
  resolveTestDatabaseUrl,
  sameDatabase,
} from "../db/database-guard.js";
import { hasTestDatabase, requireTestDatabase, testDatabase } from "./helpers/test-db.js";

const root = join(import.meta.dir, "..", "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

const PRODUCTION_URL = "postgresql://prod_user:prod_pass@ep-cool-db-123456.us-east-2.aws.neon.tech/velnox?sslmode=require";
const TEST_URL = "postgresql://velnox:velnox@localhost:5432/velnox_test";
const SELF = "test-database-isolation.test.ts";

// ─── Target parsing ────────────────────────────────────────────────────────

describe("parseDatabaseTarget", () => {
  test("keeps host, port and database — never credentials", () => {
    const target = parseDatabaseTarget(PRODUCTION_URL);
    expect(target).toEqual({
      host: "ep-cool-db-123456.us-east-2.aws.neon.tech",
      port: "5432",
      database: "velnox",
    });
    expect(JSON.stringify(target)).not.toContain("prod_pass");
    expect(JSON.stringify(target)).not.toContain("prod_user");
  });

  test("handles an explicit port and a missing database name", () => {
    expect(parseDatabaseTarget("postgresql://u:p@localhost:6543/velnox_test")?.port).toBe("6543");
    expect(parseDatabaseTarget("postgresql://u:p@localhost:5432/")).toBeNull();
    expect(parseDatabaseTarget("not-a-url")).toBeNull();
    expect(parseDatabaseTarget("")).toBeNull();
    expect(parseDatabaseTarget(undefined)).toBeNull();
  });

  test("sameDatabase compares endpoint + database, not credentials", () => {
    const a = parseDatabaseTarget("postgresql://x:1@localhost:5432/velnox_test");
    const b = parseDatabaseTarget("postgresql://y:2@localhost:5432/velnox_test");
    const c = parseDatabaseTarget("postgresql://y:2@localhost:5433/velnox_test");
    expect(sameDatabase(a, b)).toBe(true);
    expect(sameDatabase(a, c)).toBe(false);
    expect(sameDatabase(a, null)).toBe(false);
  });

  test("only whole host/database segments count as production markers", () => {
    expect(classifyDatabaseTarget(parseDatabaseTarget("postgresql://u:p@liverpool.internal/velnox")!)).toBe("unknown");
    expect(classifyDatabaseTarget(parseDatabaseTarget("postgresql://u:p@db.prod.neon.tech/velnox")!)).toBe("production");
    expect(classifyDatabaseTarget(parseDatabaseTarget("postgresql://u:p@localhost:5432/velnox_prod")!)).toBe("production");
  });

  test("redacts identifying host labels", () => {
    expect(redactHost("ep-cool-db-123456.us-east-2.aws.neon.tech")).toBe("*.us-east-2.aws.neon.tech");
    expect(redactHost("localhost")).toBe("localhost");
    expect(redactHost("127.0.0.1")).toBe("127.0.0.1");
  });
});

// ─── Test database resolution ──────────────────────────────────────────────

describe("resolveTestDatabaseUrl", () => {
  test("is not configured without TEST_DATABASE_URL (and never falls back)", () => {
    const verdict = resolveTestDatabaseUrl({ DATABASE_URL: PRODUCTION_URL, NODE_ENV: "test" });
    expect(verdict.configured).toBe(false);
    expect(verdict.ok).toBe(false);
    expect(verdict.url).toBeNull();
    expect(verdict.reason).toContain("TEST_DATABASE_URL");
  });

  test("accepts a disposable test database", () => {
    const verdict = resolveTestDatabaseUrl({ TEST_DATABASE_URL: TEST_URL, DATABASE_URL: PRODUCTION_URL });
    expect(verdict.ok).toBe(true);
    expect(verdict.configured).toBe(true);
    expect(verdict.url).toBe(TEST_URL);
    expect(verdict.classification).toBe("test");
  });

  test("refuses the production database itself", () => {
    const verdict = resolveTestDatabaseUrl({ TEST_DATABASE_URL: PRODUCTION_URL, DATABASE_URL: PRODUCTION_URL });
    expect(verdict.ok).toBe(false);
    expect(verdict.configured).toBe(true);
    expect(verdict.classification).toBe("production");
    expect(verdict.reason).toContain("same database");
  });

  test("refuses the production endpoint under a different credential casing", () => {
    const verdict = resolveTestDatabaseUrl({
      TEST_DATABASE_URL: "postgresql://someone:else@EP-COOL-DB-123456.us-east-2.aws.neon.tech:5432/velnox",
      DATABASE_URL: PRODUCTION_URL,
    });
    expect(verdict.ok).toBe(false);
    expect(verdict.classification).toBe("production");
  });

  test("refuses production-marked targets", () => {
    const byName = resolveTestDatabaseUrl({ TEST_DATABASE_URL: "postgresql://u:p@localhost:5432/velnox_prod" });
    expect(byName.ok).toBe(false);
    expect(byName.reason).toContain("production");
    const byHost = resolveTestDatabaseUrl({ TEST_DATABASE_URL: "postgresql://u:p@db.production.internal/velnox_test" });
    expect(byHost.ok).toBe(false);
  });

  test("refuses a non-disposable database name", () => {
    const verdict = resolveTestDatabaseUrl({ TEST_DATABASE_URL: "postgresql://u:p@localhost:5432/neondb" });
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain('does not contain "test"');
  });

  test("refuses an unparseable URL", () => {
    const verdict = resolveTestDatabaseUrl({ TEST_DATABASE_URL: "mysql://u:p@localhost/velnox_test" });
    expect(verdict.ok).toBe(false);
    expect(verdict.configured).toBe(true);
    expect(verdict.url).toBeNull();
  });

  test("diagnostics never contain credentials", () => {
    for (const env of [
      { TEST_DATABASE_URL: TEST_URL, DATABASE_URL: PRODUCTION_URL },
      { TEST_DATABASE_URL: PRODUCTION_URL, DATABASE_URL: PRODUCTION_URL },
      { TEST_DATABASE_URL: "postgresql://u:secret@localhost:5432/neondb" },
    ]) {
      const verdict = resolveTestDatabaseUrl(env);
      expect(`${verdict.reason} ${verdict.description}`).not.toContain("secret");
      expect(`${verdict.reason} ${verdict.description}`).not.toContain("prod_pass");
    }
  });
});

// ─── Application pool resolution ───────────────────────────────────────────

describe("resolveApplicationDatabaseUrl", () => {
  test("application runtime still uses DATABASE_URL", () => {
    const resolution = resolveApplicationDatabaseUrl(
      { DATABASE_URL: PRODUCTION_URL, NODE_ENV: "production" },
      ["/usr/local/bin/bun", "/app/backend/server.ts"],
      "/app/backend/server.ts",
    );
    expect(resolution.blocked).toBe(false);
    expect(resolution.testDatabase).toBe(false);
    expect(resolution.url).toBe(PRODUCTION_URL);
  });

  test("a test process gets the validated test database instead", () => {
    const resolution = resolveApplicationDatabaseUrl(
      { DATABASE_URL: PRODUCTION_URL, TEST_DATABASE_URL: TEST_URL, NODE_ENV: "test" },
      ["/usr/local/bin/bun", "/app/backend/tests/x.test.ts"],
      "/app/backend/tests/x.test.ts",
    );
    expect(resolution.blocked).toBe(false);
    expect(resolution.testDatabase).toBe(true);
    expect(resolution.url).toBe(TEST_URL);
    expect(resolution.url).not.toBe(PRODUCTION_URL);
  });

  test("a test process without a test database is blocked, not silently connected", () => {
    const resolution = resolveApplicationDatabaseUrl(
      { DATABASE_URL: PRODUCTION_URL, NODE_ENV: "test" },
      ["/usr/local/bin/bun", "/app/backend/tests/x.test.ts"],
      "/app/backend/tests/x.test.ts",
    );
    expect(resolution.blocked).toBe(true);
    expect(resolution.url).toBe("");
    expect(resolution.reason).toContain("Refusing database access from a test process");
  });

  test("a test process pointed at production is blocked", () => {
    const resolution = resolveApplicationDatabaseUrl(
      { DATABASE_URL: PRODUCTION_URL, TEST_DATABASE_URL: PRODUCTION_URL, NODE_ENV: "test" },
      ["/usr/local/bin/bun"],
      "/app/backend/tests/x.test.ts",
    );
    expect(resolution.blocked).toBe(true);
    expect(resolution.reason).toContain("same database");
  });

  test("isTestRunnerProcess recognises the test runner", () => {
    expect(isTestRunnerProcess({ NODE_ENV: "test" }, ["/bin/bun", "/app/backend/tests/x.test.ts"])).toBe(true);
    expect(isTestRunnerProcess({ BUN_TEST: "1" }, ["/bin/bun"])).toBe(true);
    expect(isTestRunnerProcess({}, ["/usr/local/bin/bun", "test", "backend/tests"])).toBe(true);
    expect(
      isTestRunnerProcess({ NODE_ENV: "production" }, ["/usr/local/bin/bun", "server.ts"], "/app/backend/server.ts"),
    ).toBe(false);
  });
});

// ─── Helper wiring ─────────────────────────────────────────────────────────

describe("test helper", () => {
  test("skips integration tests unless a disposable database is configured", () => {
    expect(hasTestDatabase).toBe(testDatabase.ok);
    if (!testDatabase.ok) {
      expect(() => requireTestDatabase()).toThrow(/TEST_DATABASE_URL/);
    } else {
      expect(requireTestDatabase()).toBe(testDatabase.url);
    }
  });

  test("the backend pool resolves through the guard, never the raw env", () => {
    const src = read("backend/db/index.ts");
    expect(src).toContain("resolveApplicationDatabaseUrl");
    expect(src).not.toContain('process.env.DATABASE_URL');
  });
});

// ─── Static regression guards ──────────────────────────────────────────────

describe("no test file gates on the application database url", () => {
  const testFiles = readdirSync(join(root, "backend", "tests"))
    .filter((f) => f.endsWith(".test.ts"))
    .filter((f) => f !== SELF);

  test("the test-directory scan is non-empty (guards the filter above)", () => {
    expect(testFiles.length).toBeGreaterThan(10);
  });

  test("every DB-backed suite imports the isolation helper", () => {
    const gated = testFiles.filter((f) => read(`backend/tests/${f}`).includes("const testFn = integrationTest;"));
    expect(gated.length).toBe(9);
    for (const file of gated) {
      expect(read(`backend/tests/${file}`)).toContain('from "./helpers/test-db.js"');
    }
  });

  for (const file of testFiles) {
    test(`${file} never reads the application database url`, () => {
      const src = read(`backend/tests/${file}`);
      // Built from fragments so this guard file itself stays scannable.
      const forbidden = ["process", "env", "DATABASE_URL"].join(".");
      expect(src).not.toContain(`${forbidden}`);
      expect(src).not.toContain(`Boolean(${forbidden})`);
    });
  }
});
