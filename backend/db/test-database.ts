/**
 * Test-database isolation guard — the single decision point for
 * "which database is this process allowed to touch?".
 *
 * ── The root cause this module closes ────────────────────────────────────────
 *
 * `backend/db/index.ts` builds the one and only `pg.Pool` for the backend from
 * `DATABASE_URL`. In this repository `DATABASE_URL` *is* the production Neon
 * connection string (see `.env.example`), and there is no second, test-only
 * database variable. Every DB-gated integration test under `backend/tests/`
 * opened on `Boolean(process.env.DATABASE_URL)` and then *wrote real rows*:
 * `inv-test-*`, `inv-paid-*`, `inv-cancel-*`, `so-test-*`, and the
 * `*@test.local` users → sellers → shops → products → orders they hang off.
 *
 * So a plain `bun test` on any machine whose environment carried the production
 * `DATABASE_URL` — the normal developer/ops shell for this repo — seeded the
 * live production database. There was no test-database concept and no guard:
 * there was a silent fallback from "test run" straight into production.
 *
 * ── The contract enforced here ───────────────────────────────────────────────
 *
 *   * A test process (`NODE_ENV=test`, which Bun sets automatically for
 *     `bun test`) resolves its connection string through
 *     `resolveConnectionString()` — the pool factory in `backend/db/index.ts`.
 *   * `TEST_DATABASE_URL` is the explicit test database and is preferred.
 *   * Anything recognisable as the production database is **refused with a
 *     hard throw**. There is deliberately no code path from "production
 *     detected" to "use it": the decision is `fatal`, never a fallback.
 *   * When nothing is configured at all, the DB-gated tests skip cleanly —
 *     that is the pre-existing, safe behaviour and must not regress into a
 *     failure that hides the real issue.
 *
 * Production is recognised by, in order of certainty:
 *
 *   1. a production environment marker (`NODE_ENV` / `APP_ENV` /
 *      `ENVIRONMENT` / `VERCEL_ENV` = `production`, or `RENDER=true` — this
 *      backend deploys on Render);
 *   2. a Neon hostname (`*.neon.tech`) — Neon is this project's production
 *      provider;
 *   3. the production database identifier actually used by the repository —
 *      the host + database of `DATABASE_URL`.
 *
 * A Neon *branch* can be used deliberately with
 * `TEST_DATABASE_ALLOW_NEON_BRANCH=1`, but even then the exact host + database
 * of the production `DATABASE_URL` stays refused.
 *
 * This module is deliberately **pure**: it parses connection metadata and never
 * opens a connection. That makes it safe to import from the pool factory, from
 * a `bun test` preload, and from tests that must not touch a database.
 */

export interface DbTarget {
  /** Hostname only — never credentials. */
  host: string;
  /** Database name only. */
  database: string;
  /** Loopback / disposable-host target (docker service, local cluster). */
  isLoopback: boolean;
  /** Neon-hosted target (`neon.tech`), i.e. this project's production provider. */
  isNeon: boolean;
}

export type TestDatabaseSource = "TEST_DATABASE_URL" | "DATABASE_URL" | null;

export interface TestDatabaseDecision {
  /** Which variable the decision was made from. */
  source: TestDatabaseSource;
  /** True when DB-gated integration tests may run. */
  available: boolean;
  /** True when the configuration is dangerous and the test run must abort. */
  fatal: boolean;
  /** Safe-to-use connection string, or null. */
  url: string | null;
  target: DbTarget | null;
  /** Human-readable reason (never contains credentials). */
  reason: string | null;
}

const NEON_HOST_SUFFIX = ".neon.tech";
const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);
const PRODUCTION_ENV_KEYS = ["NODE_ENV", "APP_ENV", "ENVIRONMENT", "VERCEL_ENV"] as const;
const PRODUCTION_ENV_VALUE = "production";
/** Render sets `RENDER=true` on the deployed backend service. */
const PRODUCTION_HOST_MARKER_KEY = "RENDER";
/** Deliberate, explicit opt-in for testing against a Neon *branch*. */
export const ALLOW_NEON_BRANCH_KEY = "TEST_DATABASE_ALLOW_NEON_BRANCH";

/** Bun sets this itself when running `bun test`. */
export function isTestProcess(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.NODE_ENV === "test" || env.BUN_TEST === "1";
}

function readEnv(env: NodeJS.ProcessEnv, key: string): string {
  return (env[key] ?? "").trim();
}

/**
 * Parse a PostgreSQL connection string into host/database metadata.
 * Returns null when the value is absent or not a parseable URL.
 * Credentials are never retained.
 */
export function parseDbTarget(raw: string | undefined | null): DbTarget | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    let database = "";
    try {
      database = decodeURIComponent(url.pathname.replace(/^\//, ""));
    } catch {
      database = url.pathname.replace(/^\//, "");
    }
    return {
      host,
      database,
      isLoopback: LOOPBACK_HOSTS.has(host),
      isNeon: host === "neon.tech" || host.endsWith(NEON_HOST_SUFFIX),
    };
  } catch {
    return null;
  }
}

/** Safe descriptor for error messages — host + database only, no credentials. */
export function describeTarget(target: DbTarget | null): string {
  if (!target) return "unknown target";
  return `${target.host}/${target.database || "(default)"}`;
}

/** Returns the offending `KEY=value` when a production env marker is present. */
export function productionEnvironmentMarker(env: NodeJS.ProcessEnv = process.env): string | null {
  for (const key of PRODUCTION_ENV_KEYS) {
    const value = readEnv(env, key);
    if (value.toLowerCase() === PRODUCTION_ENV_VALUE) return `${key}=${value}`;
  }
  if (readEnv(env, PRODUCTION_HOST_MARKER_KEY).toLowerCase() === "true") {
    return `${PRODUCTION_HOST_MARKER_KEY}=true`;
  }
  return null;
}

/**
 * Why this candidate must not be used as a test database, or null when it is
 * acceptable. Ordered most-certain-first; the message never includes the
 * connection string or any credential.
 */
export function refusalReason(candidate: string, env: NodeJS.ProcessEnv = process.env): string | null {
  const target = parseDbTarget(candidate);
  if (!target) {
    return "it is not a parseable PostgreSQL connection string.";
  }

  const marker = productionEnvironmentMarker(env);
  if (marker) {
    return `this process carries a production environment marker (${marker}).`;
  }

  if (target.isNeon) {
    const appTarget = parseDbTarget(readEnv(env, "DATABASE_URL"));
    const appIsProduction = Boolean(appTarget?.isNeon);
    const isProductionEndpoint =
      appIsProduction && appTarget!.host === target.host && appTarget!.database === target.database;
    const branchOptIn = readEnv(env, ALLOW_NEON_BRANCH_KEY) === "1";

    if (!branchOptIn) {
      return (
        `it points at a Neon host (${target.host}); Neon is this project's production provider. ` +
        `Point TEST_DATABASE_URL at a disposable PostgreSQL instance (a CI service container or a local cluster) instead.`
      );
    }
    if (isProductionEndpoint) {
      return (
        `it is the production DATABASE_URL endpoint (${describeTarget(target)}), ` +
        `even though ${ALLOW_NEON_BRANCH_KEY}=1 is set.`
      );
    }
  }

  return null;
}

/**
 * Decide which database a test process may use.
 *
 * `fatal: true` means the caller must abort — this is the fail-closed branch and
 * it is never converted into a "use it anyway".
 */
export function decideTestDatabase(env: NodeJS.ProcessEnv = process.env): TestDatabaseDecision {
  const explicit = readEnv(env, "TEST_DATABASE_URL");
  const appUrl = readEnv(env, "DATABASE_URL");

  if (explicit) {
    const reason = refusalReason(explicit, env);
    if (reason) {
      return {
        source: "TEST_DATABASE_URL",
        available: false,
        fatal: true,
        url: null,
        target: parseDbTarget(explicit),
        reason: `TEST_DATABASE_URL is not usable as a test database: ${reason}`,
      };
    }
    return {
      source: "TEST_DATABASE_URL",
      available: true,
      fatal: false,
      url: explicit,
      target: parseDbTarget(explicit),
      reason: null,
    };
  }

  if (appUrl) {
    const reason = refusalReason(appUrl, env);
    if (reason) {
      // No fallback: the only database available is unsafe, so the run stops.
      return {
        source: "DATABASE_URL",
        available: false,
        fatal: true,
        url: null,
        target: parseDbTarget(appUrl),
        reason: `DATABASE_URL is not usable as a test database: ${reason}`,
      };
    }
    return {
      source: "DATABASE_URL",
      available: true,
      fatal: false,
      url: appUrl,
      target: parseDbTarget(appUrl),
      reason: null,
    };
  }

  return {
    source: null,
    available: false,
    fatal: false,
    url: null,
    target: null,
    reason: "no test database configured.",
  };
}

export class TestDatabaseRefusedError extends Error {
  readonly code = "TEST_DATABASE_REFUSED";
  readonly reason: string;

  constructor(reason: string) {
    super(
      [
        "REFUSING TEST AGAINST PRODUCTION DATABASE",
        `  ${reason}`,
        "  Set TEST_DATABASE_URL to a disposable PostgreSQL database (a CI service container or a",
        "  local cluster) to run the DB-gated integration tests. TEST_DATABASE_URL is never",
        "  defaulted to DATABASE_URL when DATABASE_URL looks like production.",
      ].join("\n"),
    );
    this.name = "TestDatabaseRefusedError";
    this.reason = reason;
  }
}

/**
 * Fail closed: throws when the current configuration would let a test process
 * reach production. Returns the decision otherwise, so callers can log which
 * database will be used (host + database only).
 */
export function assertTestDatabaseIsSafe(env: NodeJS.ProcessEnv = process.env): TestDatabaseDecision {
  const decision = decideTestDatabase(env);
  if (decision.fatal) {
    throw new TestDatabaseRefusedError(decision.reason ?? "unsafe test database configuration");
  }
  return decision;
}

/**
 * Neon requires TLS; a disposable PostgreSQL in CI or on a laptop generally does
 * not. Forcing `sslmode=verify-full` onto a loopback host would break exactly the
 * safe path this guard exists to allow, so loopback targets are left untouched.
 */
export function normalizeSslMode(connectionString: string): string {
  let value = connectionString ?? "";
  if (!value) return value;

  const target = parseDbTarget(value);
  if (target?.isLoopback) return value;

  if (value.includes("sslmode=require")) {
    value = value.replace("sslmode=require", "sslmode=verify-full");
  } else if (!value.includes("sslmode=")) {
    value += value.includes("?") ? "&sslmode=verify-full" : "?sslmode=verify-full";
  }
  return value;
}

/**
 * The connection string for this process.
 *
 * In a test process the decision above is authoritative: an unsafe
 * configuration throws instead of connecting. Outside a test process the app
 * `DATABASE_URL` is used exactly as before.
 */
export function resolveConnectionString(env: NodeJS.ProcessEnv = process.env): string {
  if (isTestProcess(env)) {
    const decision = assertTestDatabaseIsSafe(env);
    return normalizeSslMode(decision.url ?? "");
  }
  return normalizeSslMode(readEnv(env, "DATABASE_URL"));
}
