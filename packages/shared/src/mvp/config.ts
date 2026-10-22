/**
 * Backend-origin resolution for the MVP client.
 *
 * WHAT IT DOES
 * ------------
 * Reads the public `VITE_*` values and resolves the origin every request goes
 * to (`apiOrigin`) plus the `/api/mvp` base derived from it. Its two callers are
 * `lib/api-client.ts` (session paths) and `mvp/client.ts` (all requests).
 *
 * The validation is deliberately strict:
 *
 *   • `VITE_API_URL` must be a BARE http(s) origin — a path, query, fragment or
 *     embedded credentials is refused rather than "fixed up";
 *   • an unparseable `VITE_API_URL` is refused (`INVALID_API_URL`) rather than
 *     guessed — the `mvp` mode is not honoured and the reason is reported;
 *   • a `mvp` request is refused in a build that declares itself production,
 *     because a staging build is also a `vite build` (`PROD=true`) and the
 *     environment must be stated explicitly rather than inferred;
 *   • only public `VITE_*` values are read — the server secret never enters the
 *     bundle, and the session stays in the httpOnly cookie.
 *
 * HISTORY (2026-10-22). `VITE_API_MODE` used to choose between two API trees:
 * `mvp` for `backend/mvp/`, default for the pre-MVP backend. That tree was
 * removed and every app now mounts the MVP UI unconditionally, so the mode no
 * longer selects what is served — only the origin, and the reason reported when
 * an `mvp` request is refused. The refusal matrix is still pinned by
 * `packages/shared/tests/mvp-config.test.ts`.
 *
 * WHERE IT IS SET
 * ---------------
 *   VITE_API_URL=<origin>      # backend origin, never includes /api
 *   VITE_API_MODE=mvp          # optional; declares the intended API mode
 *   VITE_DEPLOY_ENV=staging    # declares a non-production build
 */

/**
 * Historical mode label: `"mvp"` only when an `mvp` request was honoured. The
 * origin is resolved the same way for both values; see the header.
 */
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
 * A one-line, secret-free description of the resolved origin/mode, printed by
 * each app's footer.
 */
export function describeApiMode(config: ResolvedApiMode = getApiMode()): string {
  if (config.mode === "mvp") {
    return `[api] MVP API (${config.deployEnv}) → ${config.mvpBaseUrl}`;
  }
  if (config.disabledReason && config.disabledReason !== "MODE_NOT_REQUESTED") {
    return `[api] MVP API at ${config.mvpBaseUrl} — MVP mode refused: ${config.disabledReason} (deploy env: ${config.deployEnv})`;
  }
  return `[api] MVP API at ${config.mvpBaseUrl}`;
}
