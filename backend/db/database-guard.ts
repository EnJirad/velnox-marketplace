/**
 * Database target guard — keeps integration tests away from production.
 *
 * WHY THIS EXISTS
 * ---------------
 * The backend test suite created real users/sellers/shops/products directly in
 * whichever database `DATABASE_URL` pointed at, gated only by
 * `Boolean(process.env.DATABASE_URL)`. `bun test` auto-loads `.env`, so running
 * `bun test backend/tests` in a workspace whose `.env` holds the production Neon
 * URL wrote fixture shops (`so-test-*`, `inv-*`, `inv-cancel-*`, `inv-paid-*`)
 * straight into production, where `GET /api/shops` (seller status `approved`)
 * exposed them in the public catalog.
 *
 * THE RULE
 * --------
 *  • Application runtime (Render, local dev): unchanged — `DATABASE_URL`.
 *  • Test process: `DATABASE_URL` is NEVER used. Tests may only connect to an
 *    explicitly configured disposable test database (`TEST_DATABASE_URL`), and
 *    that URL is validated before any connection is created.
 *
 * Validation is layered (a name check alone is not enough):
 *   1. `TEST_DATABASE_URL` must be set explicitly — there is no fallback.
 *   2. It must not resolve to the same host+port+database as `DATABASE_URL`.
 *   3. Host/database segments must not carry production markers.
 *   4. The database name must contain "test" (the disposable-database allowlist).
 *
 * Anything else fails closed: no connection is attempted and the test suite
 * reports why.
 *
 * This module is dependency-free (no `pg`, no `bun:test`) so both the backend
 * runtime and the test suite can import it.
 */

export type DatabaseTarget = {
  /** Lowercased hostname. Never contains credentials. */
  host: string;
  port: string;
  /** Database name (path component), credentials stripped. */
  database: string;
};

export type DatabaseClassification = "test" | "local-development" | "production" | "unknown";

export type DatabaseVerdict = {
  /** True only for a validated disposable test database. */
  ok: boolean;
  /** True when TEST_DATABASE_URL was provided at all (even if rejected). */
  configured: boolean;
  /** The URL to use — only set when `ok` is true. */
  url: string | null;
  target: DatabaseTarget | null;
  classification: DatabaseClassification;
  /** Credential-free, log-safe description of the target. */
  description: string;
  /** Human-readable explanation, safe to print. */
  reason: string;
};

type Env = Record<string, string | undefined>;

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0"]);
/** Whole segments that mean "this is the live database". Matched per segment so
 *  hostnames like `liverpool-db` are not mistaken for production. */
const PRODUCTION_MARKERS = ["prod", "production", "live", "primary"];
const TEST_DATABASE_NAME = /test/i;

/** Parse a PostgreSQL connection string into a credential-free target. */
export function parseDatabaseTarget(raw: string | null | undefined): DatabaseTarget | null {
  const value = (raw ?? "").trim();
  if (!value) return null;
  try {
    const parsed = new URL(value);
    // Reject anything that is not a PostgreSQL connection string.
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") return null;
    const database = decodeURIComponent(parsed.pathname.replace(/^\/+/, ""));
    if (!database) return null;
    return {
      host: parsed.hostname.toLowerCase(),
      port: parsed.port || "5432",
      database,
    };
  } catch {
    return null;
  }
}

export function sameDatabase(a: DatabaseTarget | null, b: DatabaseTarget | null): boolean {
  if (!a || !b) return false;
  return a.host === b.host && a.port === b.port && a.database === b.database;
}

export function hasProductionMarker(target: DatabaseTarget): boolean {
  // Split on every separator a host or database name can use so that
  // `velnox_prod`, `prod-db` and `db.prod.neon.tech` are all caught while
  // `liverpool` is not.
  const segments = [target.database, ...target.host.split(".")]
    .flatMap((part) => part.split(/[._-]+/))
    .map((s) => s.toLowerCase())
  return segments.some((segment) =>
    PRODUCTION_MARKERS.some(
      (marker) => segment === marker || segment.startsWith(`${marker}-`) || segment.startsWith(`${marker}_`),
    ),
  );
}

/** Redact the identifying part of a host so diagnostics never leak an endpoint. */
export function redactHost(host: string): string {
  if (LOOPBACK_HOSTS.has(host) || host === "") return host;
  const parts = host.split(".");
  return parts.length > 2 ? `*.${parts.slice(1).join(".")}` : `***.${parts[parts.length - 1]}`;
}

export function classifyDatabaseTarget(
  target: DatabaseTarget,
  productionTarget: DatabaseTarget | null = null,
): DatabaseClassification {
  if (sameDatabase(target, productionTarget)) return "production";
  if (hasProductionMarker(target)) return "production";
  if (TEST_DATABASE_NAME.test(target.database)) return "test";
  if (LOOPBACK_HOSTS.has(target.host)) return "local-development";
  return "unknown";
}

/** Credential-free description used by every diagnostic message. */
export function describeDatabaseTarget(target: DatabaseTarget | null): string {
  if (!target) return "not configured";
  return `host=${redactHost(target.host)} port=${target.port} database=${target.database}`;
}

/** The application's own target (`DATABASE_URL`) — used for comparison only. */
export function productionDatabaseTarget(env: Env = process.env): DatabaseTarget | null {
  return parseDatabaseTarget(env.DATABASE_URL);
}

/**
 * Is this process a test runner? `bun test` sets `NODE_ENV=test` and points
 * `Bun.main` at the test file; the extra signals keep this robust if either
 * changes.
 */
export function isTestRunnerProcess(
  env: Env = process.env,
  argv: string[] = process.argv,
  mainPath?: string,
): boolean {
  if (env.NODE_ENV === "test") return true;
  if (env.BUN_TEST === "1") return true;
  if (argv.includes("test")) return true;
  const main = mainPath ?? (globalThis as { Bun?: { main?: string } }).Bun?.main ?? "";
  return /(^|[\\/])tests?[\\/].*\.(test|spec)\.[cm]?[jt]sx?$/.test(main);
}

/**
 * Resolve the database integration tests are allowed to use.
 *
 * Never reads `DATABASE_URL` as a fallback — that fallback is the bug.
 */
export function resolveTestDatabaseUrl(env: Env = process.env): DatabaseVerdict {
  const raw = (env.TEST_DATABASE_URL ?? "").trim();
  const production = productionDatabaseTarget(env);

  if (!raw) {
    return {
      ok: false,
      configured: false,
      url: null,
      target: null,
      classification: "unknown",
      description: "not configured",
      reason:
        "TEST_DATABASE_URL is not set — integration tests require a disposable test database and never use the application DATABASE_URL",
    };
  }

  const target = parseDatabaseTarget(raw);
  if (!target) {
    return {
      ok: false,
      configured: true,
      url: null,
      target: null,
      classification: "unknown",
      description: "unparseable TEST_DATABASE_URL",
      reason: "TEST_DATABASE_URL is not a parseable PostgreSQL connection string",
    };
  }

  const classification = classifyDatabaseTarget(target, production);
  const description = describeDatabaseTarget(target);

  if (sameDatabase(target, production)) {
    return {
      ok: false,
      configured: true,
      url: null,
      target,
      classification: "production",
      description,
      reason: `TEST_DATABASE_URL points at the same database as the application DATABASE_URL (${description}) — refusing to run fixtures against it`,
    };
  }

  if (hasProductionMarker(target)) {
    return {
      ok: false,
      configured: true,
      url: null,
      target,
      classification: "production",
      description,
      reason: `TEST_DATABASE_URL looks like a production database (${description}) — refusing to run fixtures against it`,
    };
  }

  if (!TEST_DATABASE_NAME.test(target.database)) {
    return {
      ok: false,
      configured: true,
      url: null,
      target,
      classification,
      description,
      reason: `TEST_DATABASE_URL database name "${target.database}" does not contain "test" — a disposable test database (for example velnox_test) is required (${description})`,
    };
  }

  return {
    ok: true,
    configured: true,
    url: raw,
    target,
    classification: "test",
    description,
    reason: `disposable test database (${description})`,
  };
}

export type ApplicationDatabaseResolution = {
  /** Connection string to use. Empty when `blocked` is true. */
  url: string;
  /** True when the connection string is a validated disposable test database. */
  testDatabase: boolean;
  /** True when database access must fail instead of connecting. */
  blocked: boolean;
  /** Why access is blocked (safe to print). Empty when `blocked` is false. */
  reason: string;
  verdict?: DatabaseVerdict;
};

/**
 * Resolve the connection string for a database access at import time.
 *
 * Outside a test process this is exactly the previous behaviour
 * (`DATABASE_URL`). Inside a test process the application URL is never used:
 * either a validated disposable test database, or a blocked resolution.
 */
export function resolveApplicationDatabaseUrl(
  env: Env = process.env,
  argv: string[] = process.argv,
  mainPath?: string,
): ApplicationDatabaseResolution {
  if (!isTestRunnerProcess(env, argv, mainPath)) {
    return { url: (env.DATABASE_URL ?? "").trim(), testDatabase: false, blocked: false, reason: "" };
  }

  const verdict = resolveTestDatabaseUrl(env);
  if (verdict.ok && verdict.url) {
    return { url: verdict.url, testDatabase: true, blocked: false, reason: verdict.reason, verdict };
  }

  return {
    url: "",
    testDatabase: false,
    blocked: true,
    reason:
      `Refusing database access from a test process: ${verdict.reason}. ` +
      "Point TEST_DATABASE_URL at a disposable test database; the application DATABASE_URL is never used by the test suite.",
    verdict,
  };
}
