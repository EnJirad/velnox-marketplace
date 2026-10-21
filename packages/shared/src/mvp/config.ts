/**
 * MVP API mode — the ONE switch that points a frontend at `/api/mvp`.
 *
 * WHY THIS EXISTS
 * ---------------
 * Phase 3 built a second backend tree (`backend/mvp/`) that reads ONLY
 * `db/mvp/schema.sql` and is mounted under `/api/mvp` behind
 * `MVP_API_ENABLED=true`. The deployed pre-MVP backend, its database and every
 * existing client must keep working unchanged until the cutover
 * (`db/mvp/cutover.md`). So the frontend needs a switch that is:
 *
 *   • OFF by default — no environment variable means the legacy API, exactly as
 *     today, on every app and every build;
 *   • EXPLICIT — only the literal value `mvp` selects the MVP API; a typo or a
 *     half-configured deployment falls back to legacy instead of guessing;
 *   • FAIL-CLOSED IN PRODUCTION — a production deployment cannot turn it on
 *     even if someone sets `VITE_API_MODE=mvp`, unless the build ALSO declares
 *     that it is a staging build (`VITE_DEPLOY_ENV=staging`). A staging build is
 *     a real `vite build` (so `import.meta.env.PROD` is true), which is why the
 *     deployment environment must be declared explicitly rather than inferred;
 *   • SECRET-FREE — it reads only public `VITE_*` values. Nothing here can leak
 *     a server secret into the bundle; the MVP API authenticates with the same
 *     httpOnly session cookie the legacy API uses.
 *
 * WHERE IT IS SET
 * ---------------
 *   VITE_API_MODE=mvp          # opt in (default: legacy)
 *   VITE_DEPLOY_ENV=staging    # REQUIRED for any non-development build
 *   VITE_API_URL=<origin>      # backend origin, never includes /api
 *
 * A production build that sets `VITE_API_MODE=mvp` without
 * `VITE_DEPLOY_ENV=staging` resolves to legacy and reports
 * `MVP_FORBIDDEN_IN_PRODUCTION`. This is tested in
 * `packages/shared/tests/mvp-config.test.ts`.
 */

/** Which API tree this build talks to. */
export type ApiMode = "legacy" | "mvp";

/** Why MVP mode was refused (or `null` when the resolved mode is honoured). */
export type MvpDisabledReason =
  | "MODE_NOT_REQUESTED"
  | "MVP_FORBIDDEN_IN_PRODUCTION"
  | "MVP_ENV_NOT_ALLOWED"
  | "INVALID_API_URL";

/** The public environment values the decision is allowed to read. */
export interface ApiModeEnv {
  VITE_API_MODE?: string;
  VITE_API_URL?: string;
  VITE_DEPLOY_ENV?: string;
  /** `import.meta.env.PROD` — true for every `vite build`. */
  PROD?: boolean;
}

export interface ResolvedApiMode {
  mode: ApiMode;
  /** Backend origin without `/api` (legacy convention, unchanged). */
  apiOrigin: string;
  /** MVP namespace base, e.g. `https://api.example.com/api/mvp`. */
  mvpBaseUrl: string;
  /** Deployment environment this decision was made in. */
  deployEnv: string;
  /** Non-null when MVP mode was requested but refused. */
  disabledReason: MvpDisabledReason | null;
}

/** Deployment environments in which the MVP API may be selected. */
const MVP_ALLOWED_ENVS = new Set(["staging", "development", "dev", "local", "test"]);

const DEFAULT_API_ORIGIN = "http://localhost:3001";

function normaliseEnvName(value: string | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

/**
 * Validate the configured backend origin.
 *
 * `VITE_API_URL` is documented as an ORIGIN (`sites.ts` appends `/api` itself), so
 * a value carrying a path, query, fragment or embedded credentials is a
 * configuration error, not something to "fix up". Returning `null` makes the
 * caller fall back to legacy rather than write requests to a surprising URL.
 */
export function normaliseApiOrigin(value: string | undefined): string | null {
  const raw = (value ?? "").trim();
  if (!raw) return `${DEFAULT_API_ORIGIN.replace(/\/+$/, "")}`;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  if (parsed.username || parsed.password) return null;
  if (parsed.pathname !== "" && parsed.pathname !== "/") return null;
  if (parsed.search || parsed.hash) return null;
  return parsed.origin;
}

/**
 * Pure decision function: environment in, API mode out.
 *
 * Every branch is total and side-effect free so the production-safety matrix is
 * testable without a browser or a build.
 */
export function resolveApiMode(env: ApiModeEnv = {}): ResolvedApiMode {
  const requested = normaliseEnvName(env.VITE_API_MODE);
  const deployEnv = normaliseEnvName(env.VITE_DEPLOY_ENV) || (env.PROD ? "production" : "development");

  const apiOrigin = normaliseApiOrigin(env.VITE_API_URL);
  const legacyOrigin = apiOrigin ?? DEFAULT_API_ORIGIN.replace(/\/+$/, "");

  const legacy = (disabledReason: MvpDisabledReason): ResolvedApiMode => ({
    mode: "legacy",
    apiOrigin: legacyOrigin,
    mvpBaseUrl: `${legacyOrigin}/api/mvp`,
    deployEnv,
    disabledReason,
  });

  if (requested !== "mvp") return legacy("MODE_NOT_REQUESTED");
  // An unparseable origin is never silently replaced with localhost: the caller
  // asked for the MVP API, so a wrong base URL is refused, not guessed.
  if (!apiOrigin) return legacy("INVALID_API_URL");
  if (deployEnv === "production") return legacy("MVP_FORBIDDEN_IN_PRODUCTION");
  if (!MVP_ALLOWED_ENVS.has(deployEnv)) return legacy("MVP_ENV_NOT_ALLOWED");

  return {
    mode: "mvp",
    apiOrigin,
    mvpBaseUrl: `${apiOrigin}/api/mvp`,
    deployEnv,
    disabledReason: null,
  };
}

/**
 * `import.meta.env` in a shape the pure function accepts.
 *
 * `import.meta.env` is replaced at build time by Vite and is present (partially)
 * under Bun's test runner; both are read defensively so this module can be
 * imported by a test process without a bundler.
 */
function readPublicEnv(): ApiModeEnv {
  const env = ((import.meta as unknown as { env?: Record<string, unknown> }).env ?? {}) as Record<
    string,
    unknown
  >;
  const str = (key: string): string | undefined =>
    typeof env[key] === "string" ? (env[key] as string) : undefined;
  return {
    VITE_API_MODE: str("VITE_API_MODE"),
    VITE_API_URL: str("VITE_API_URL"),
    VITE_DEPLOY_ENV: str("VITE_DEPLOY_ENV"),
    PROD: env.PROD === true,
  };
}

let cached: ResolvedApiMode | null = null;

/** The resolved mode for this process (computed once). */
export function getApiMode(): ResolvedApiMode {
  if (!cached) cached = resolveApiMode(readPublicEnv());
  return cached;
}

/** True when this build talks to `/api/mvp`. Default: false. */
export function isMvpMode(): boolean {
  return getApiMode().mode === "mvp";
}

/** Test seam: resolve against an explicit environment. */
export function setApiModeForTests(env: ApiModeEnv | null): void {
  cached = env ? resolveApiMode(env) : null;
}

/**
 * A one-line, secret-free description for the console/log when a deployment
 * asked for MVP mode and was refused. Printed once by `reportApiMode()`.
 */
export function describeApiMode(config: ResolvedApiMode = getApiMode()): string {
  if (config.mode === "mvp") {
    return `[api] MVP mode (${config.deployEnv}) → ${config.mvpBaseUrl}`;
  }
  if (config.disabledReason && config.disabledReason !== "MODE_NOT_REQUESTED") {
    return `[api] legacy mode — MVP refused: ${config.disabledReason} (deploy env: ${config.deployEnv})`;
  }
  return "[api] legacy mode";
}
