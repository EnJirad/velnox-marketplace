/**
 * TASK 004A — regression guard for test/database isolation.
 *
 * The bug this pins: every DB-gated integration test opened on a truthiness
 * check of the `DATABASE_URL` environment variable. `DATABASE_URL` in this
 * repository *is* the production Neon connection string, so a plain `bun test`
 * on any machine carrying it wrote real fixtures — `so-test-*`, `inv-test-*`,
 * `inv-cancel-*`, `inv-paid-*`, and the `*@test.local` users → sellers → shops
 * → products → orders they hang off — straight into the live database.
 * (The exact old one-liner is quoted in `helpers/test-db.ts`, which the
 * source-level scan below deliberately does not cover so this file cannot
 * match its own search.)
 *
 * These tests assert the two halves of the fix and never touch a database:
 *
 *   1. **Behaviour** — `decideTestDatabase()` / `assertTestDatabaseIsSafe()`
 *      fail closed on production metadata and allow a disposable target. All
 *      metadata is synthesised here; no real connection string is used.
 *   2. **End to end** — a real `bun` subprocess is started with a
 *      production-looking environment and must exit non-zero with
 *      `REFUSING TEST AGAINST PRODUCTION DATABASE`, while the same subprocess
 *      pointed at a disposable database must exit 0.
 *   3. **Source level** — no test file may gate on the raw `DATABASE_URL`
 *      check again, and the pool factory must route through the guard.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  ALLOW_NEON_BRANCH_KEY,
  TestDatabaseRefusedError,
  assertTestDatabaseIsSafe,
  decideTestDatabase,
  describeTarget,
  normalizeSslMode,
  parseDbTarget,
  productionEnvironmentMarker,
  refusalReason,
  resolveConnectionString,
} from "../db/test-database.js";

const repoRoot = join(import.meta.dir, "..", "..");

// ─── Fixtures: metadata only, never a live database ────────────────────────
//
// These are deliberately non-functional hosts. Nothing here is ever connected
// to; the guard is a pure function of the connection metadata.
const PROD_NEON = "postgresql://velnox_app:sup3rsecret@ep-production-42.us-east-2.aws.neon.tech/velnox?sslmode=require";
const PROD_NEON_SAME_HOST_DB = "postgresql://other:creds@ep-production-42.us-east-2.aws.neon.tech/velnox?sslmode=require";
const PROD_NEON_BRANCH = "postgresql://velnox_app:sup3rsecret@ep-branch-99.us-east-2.aws.neon.tech/velnox_test?sslmode=require";
const DISPOSABLE = "postgresql://postgres:postgres@localhost:5432/velnox_test?sslmode=disable";
const DISPOSABLE_V6 = "postgresql://postgres:postgres@127.0.0.1:5432/velnox_test?sslmode=disable";
const PROD_PASSWORD = "sup3rsecret";

const env = (values: Record<string, string>): NodeJS.ProcessEnv => ({ ...values }) as NodeJS.ProcessEnv;

describe("test database guard — connection metadata parsing", () => {
  test("host and database are extracted; a Neon host is recognised", () => {
    const target = parseDbTarget(PROD_NEON)!;
    expect(target.host).toBe("ep-production-42.us-east-2.aws.neon.tech");
    expect(target.database).toBe("velnox");
    expect(target.isNeon).toBe(true);
    expect(target.isLoopback).toBe(false);
  });

  test("a disposable loopback target is recognised and is not Neon", () => {
    for (const url of [DISPOSABLE, DISPOSABLE_V6]) {
      const target = parseDbTarget(url)!;
      expect(target.database).toBe("velnox_test");
      expect(target.isNeon).toBe(false);
      expect(target.isLoopback).toBe(true);
    }
  });

  test("absent and unparseable values are null, never a throw", () => {
    expect(parseDbTarget(undefined)).toBeNull();
    expect(parseDbTarget("")).toBeNull();
    expect(parseDbTarget("   ")).toBeNull();
    expect(parseDbTarget("not-a-url")).toBeNull();
  });

  test("nothing in the parsed shape retains credentials", () => {
    const serialized = JSON.stringify(parseDbTarget(PROD_NEON));
    expect(serialized).not.toContain(PROD_PASSWORD);
    expect(serialized).not.toContain("velnox_app");
    expect(Object.keys(parseDbTarget(PROD_NEON)!)).toEqual(["host", "database", "isLoopback", "isNeon"]);
  });
});

describe("test database guard — production is refused", () => {
  test("a Neon host is refused (the provider this project deploys on)", () => {
    const reason = refusalReason(PROD_NEON, env({}));
    expect(reason).toContain("Neon");
    expect(reason).not.toContain(PROD_PASSWORD);
  });

  test("a production environment marker is refused on its own", () => {
    expect(productionEnvironmentMarker(env({ NODE_ENV: "production" }))).toBe("NODE_ENV=production");
    expect(productionEnvironmentMarker(env({ APP_ENV: "production" }))).toBe("APP_ENV=production");
    expect(productionEnvironmentMarker(env({ ENVIRONMENT: "production" }))).toBe("ENVIRONMENT=production");
    expect(productionEnvironmentMarker(env({ VERCEL_ENV: "production" }))).toBe("VERCEL_ENV=production");
    expect(productionEnvironmentMarker(env({ RENDER: "true" }))).toBe("RENDER=true");
    expect(productionEnvironmentMarker(env({ NODE_ENV: "test" }))).toBeNull();

    // Even a harmless-looking target is refused while the marker is present.
    expect(refusalReason(DISPOSABLE, env({ NODE_ENV: "production" }))).toContain("production environment marker");
  });

  test("the production DATABASE_URL host + database is refused even with the branch opt-in", () => {
    expect(
      refusalReason(PROD_NEON_SAME_HOST_DB, env({ DATABASE_URL: PROD_NEON, [ALLOW_NEON_BRANCH_KEY]: "1" })),
    ).toContain("production DATABASE_URL endpoint");
  });

  test("a non-production target with no marker is allowed", () => {
    expect(refusalReason(DISPOSABLE, env({}))).toBeNull();
    expect(refusalReason(PROD_NEON, env({ [ALLOW_NEON_BRANCH_KEY]: "1" }))).toBeNull();
  });
});

describe("test database guard — the decision never falls back to production", () => {
  test("no configuration at all → unavailable, and NOT fatal (tests skip)", () => {
    const decision = decideTestDatabase(env({}));
    expect(decision.available).toBe(false);
    expect(decision.fatal).toBe(false);
    expect(decision.url).toBeNull();
    expect(decision.source).toBeNull();
  });

  test("production DATABASE_URL alone → fatal, unavailable, and no URL to use", () => {
    const decision = decideTestDatabase(env({ NODE_ENV: "test", DATABASE_URL: PROD_NEON }));
    expect(decision.fatal).toBe(true);
    expect(decision.available).toBe(false);
    expect(decision.url).toBeNull();
    expect(decision.reason).toContain("DATABASE_URL is not usable as a test database");
    expect(decision.reason).not.toContain(PROD_PASSWORD);
  });

  test("assertTestDatabaseIsSafe throws the documented error for production", () => {
    let caught: unknown;
    try {
      assertTestDatabaseIsSafe(env({ NODE_ENV: "test", DATABASE_URL: PROD_NEON }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TestDatabaseRefusedError);
    const error = caught as TestDatabaseRefusedError;
    expect(error.message).toContain("REFUSING TEST AGAINST PRODUCTION DATABASE");
    expect(error.code).toBe("TEST_DATABASE_REFUSED");
    expect(error.message).not.toContain(PROD_PASSWORD);
  });

  test("an explicit TEST_DATABASE_URL is preferred and wins over DATABASE_URL", () => {
    const decision = decideTestDatabase(
      env({ NODE_ENV: "test", DATABASE_URL: PROD_NEON, TEST_DATABASE_URL: DISPOSABLE }),
    );
    expect(decision.fatal).toBe(false);
    expect(decision.available).toBe(true);
    expect(decision.source).toBe("TEST_DATABASE_URL");
    expect(decision.url).toBe(DISPOSABLE);
    expect(describeTarget(decision.target)).toBe("localhost/velnox_test");
  });

  test("an explicit TEST_DATABASE_URL that is production is fatal, not a silent skip", () => {
    const decision = decideTestDatabase(env({ NODE_ENV: "test", TEST_DATABASE_URL: PROD_NEON }));
    expect(decision.fatal).toBe(true);
    expect(decision.available).toBe(false);
    expect(decision.url).toBeNull();
    expect(decision.reason).toContain("TEST_DATABASE_URL is not usable as a test database");
  });

  test("a disposable DATABASE_URL is still usable (local dev behaviour preserved)", () => {
    const decision = decideTestDatabase(env({ NODE_ENV: "test", DATABASE_URL: DISPOSABLE }));
    expect(decision.fatal).toBe(false);
    expect(decision.available).toBe(true);
    expect(decision.source).toBe("DATABASE_URL");
  });

  test("`RENDER=true` makes the whole test process refuse a disposable DATABASE_URL", () => {
    const decision = decideTestDatabase(env({ NODE_ENV: "test", RENDER: "true", DATABASE_URL: DISPOSABLE }));
    expect(decision.fatal).toBe(true);
    expect(decision.available).toBe(false);
  });
});

describe("test database guard — the pool factory path", () => {
  test("a test process resolves to the validated test database", () => {
    expect(resolveConnectionString(env({ NODE_ENV: "test", TEST_DATABASE_URL: DISPOSABLE }))).toBe(DISPOSABLE);
  });

  test("a test process refuses production instead of returning a connection string", () => {
    expect(() => resolveConnectionString(env({ NODE_ENV: "test", DATABASE_URL: PROD_NEON }))).toThrow(
      TestDatabaseRefusedError,
    );
  });

  test("a test process with no configuration resolves to empty, never to a database", () => {
    expect(resolveConnectionString(env({ NODE_ENV: "test" }))).toBe("");
  });

  test("outside a test process DATABASE_URL is used exactly as before", () => {
    expect(resolveConnectionString(env({ DATABASE_URL: PROD_NEON }))).toBe(
      PROD_NEON.replace("sslmode=require", "sslmode=verify-full"),
    );
    expect(resolveConnectionString(env({ NODE_ENV: "production", DATABASE_URL: PROD_NEON }))).toBe(
      PROD_NEON.replace("sslmode=require", "sslmode=verify-full"),
    );
  });
});

describe("test database guard — sslmode normalisation", () => {
  test("Neon-style targets get the secure verify-full default", () => {
    expect(normalizeSslMode(PROD_NEON)).toContain("sslmode=verify-full");
    expect(normalizeSslMode(PROD_NEON)).not.toContain("sslmode=require");
    expect(normalizeSslMode("postgresql://u:p@ep-x.us-east-2.aws.neon.tech/db")).toEndWith("?sslmode=verify-full");
  });

  test("loopback targets are left untouched so a disposable database actually works", () => {
    expect(normalizeSslMode(DISPOSABLE)).toBe(DISPOSABLE);
    expect(normalizeSslMode("postgresql://postgres:postgres@localhost:5432/velnox_test")).toBe(
      "postgresql://postgres:postgres@localhost:5432/velnox_test",
    );
  });

  test("an empty connection string stays empty", () => {
    expect(normalizeSslMode("")).toBe("");
  });
});

// ─── End to end: a real subprocess must actually stop ──────────────────────

describe("test database guard — a real test process fails closed", () => {
  const PROBE = 'await import("./backend/db/test-database.ts").then((m) => m.assertTestDatabaseIsSafe());';
  const POOL_PROBE = 'await import("./backend/db/index.ts");';

  function runBunProbe(script: string, databaseEnv: Record<string, string>) {
    return Bun.spawnSync({
      cmd: [process.execPath, "-e", script],
      cwd: repoRoot,
      // A deliberately minimal environment: no real credentials are forwarded.
      env: {
        PATH: process.env.PATH ?? "",
        HOME: process.env.HOME ?? "",
        NODE_ENV: "test",
        ...databaseEnv,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
  }

  const outputOf = (result: { stdout: Uint8Array; stderr: Uint8Array }) =>
    `${new TextDecoder().decode(result.stdout)}${new TextDecoder().decode(result.stderr)}`;

  test("production DATABASE_URL → non-zero exit with the refusal message", () => {
    const result = runBunProbe(PROBE, { DATABASE_URL: PROD_NEON });
    expect(outputOf(result)).toContain("REFUSING TEST AGAINST PRODUCTION DATABASE");
    expect(result.exitCode).not.toBe(0);
  });

  test("production DATABASE_URL → the pool factory itself refuses", () => {
    const result = runBunProbe(POOL_PROBE, { DATABASE_URL: PROD_NEON });
    expect(outputOf(result)).toContain("REFUSING TEST AGAINST PRODUCTION DATABASE");
    expect(result.exitCode).not.toBe(0);
  });

  test("RENDER=true → refused", () => {
    const result = runBunProbe(PROBE, { RENDER: "true", DATABASE_URL: DISPOSABLE });
    expect(outputOf(result)).toContain("REFUSING TEST AGAINST PRODUCTION DATABASE");
    expect(result.exitCode).not.toBe(0);
  });

  test("a disposable database → allowed, exit 0", () => {
    for (const databaseEnv of [{ TEST_DATABASE_URL: DISPOSABLE }, { DATABASE_URL: DISPOSABLE }]) {
      const result = runBunProbe(PROBE, databaseEnv);
      expect(outputOf(result)).toBe("");
      expect(result.exitCode).toBe(0);
    }
  });

  test("no database configured → allowed to skip, exit 0", () => {
    const result = runBunProbe(PROBE, {});
    expect(result.exitCode).toBe(0);
  });
});

// ─── Source level: the old gate must not come back ─────────────────────────

describe("test database guard — no test may gate on the raw DATABASE_URL check", () => {
  const testsDir = join(repoRoot, "backend", "tests");
  // Built from fragments so this test file cannot match its own search.
  const RAW_GATE = new RegExp(
    ["Boolean\\(", "process\\s*[.\\[]", "[\"']?", "DATABASE_URL"].join(""),
  );

  const testFiles = readdirSync(testsDir).filter((name) => name.endsWith(".test.ts"));

  test("the suite was actually discovered", () => {
    expect(testFiles.length).toBeGreaterThan(10);
  });

  test("every DB-gated test uses the shared helper instead", () => {
    const offenders: string[] = [];
    for (const name of testFiles) {
      const source = readFileSync(join(testsDir, name), "utf8");
      if (RAW_GATE.test(source)) offenders.push(name);
    }
    expect(offenders).toEqual([]);
  });

  test("every test that imports the DB gate also imports the helper", () => {
    const gated = testFiles.filter((name) =>
      readFileSync(join(testsDir, name), "utf8").includes("hasTestDatabase"),
    );
    expect(gated.length).toBeGreaterThanOrEqual(11);
    for (const name of gated) {
      expect(readFileSync(join(testsDir, name), "utf8")).toContain('from "./helpers/test-db.js"');
    }
  });

  test("the pool factory resolves its connection string through the guard", () => {
    const source = readFileSync(join(repoRoot, "backend", "db", "index.ts"), "utf8");
    expect(source).toContain("resolveConnectionString()");
    expect(source).not.toContain("process.env.DATABASE_URL");
  });

  test("the gate helper fails fast at import time", () => {
    const source = readFileSync(join(testsDir, "helpers", "test-db.ts"), "utf8");
    expect(source).toContain("assertTestDatabaseIsSafe()");
  });
});
