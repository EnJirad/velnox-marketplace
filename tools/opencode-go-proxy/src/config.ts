/**
 * Proxy configuration.
 *
 * All values are read from `BUN.env` (which works on Bun and is compatible
 * with Node's `process.env` when needed). Never hardcode credentials.
 */
import type { FilterProfile } from "./tools/filter.ts";
import type { NormalizeOptions } from "./schema/types.ts";

export interface ProxyConfig {
  /** Port the proxy listens on. */
  port: number;
  /** Upstream OpenCode Go endpoint. */
  upstream: string;
  /** Model name passed through to upstream. */
  model: string;
  /** Per-model filter profiles. */
  filterProfiles: Record<string, FilterProfile>;
  /** Normalizer options. */
  normalizer: NormalizeOptions;
  /** Request timeout (ms). */
  requestTimeoutMs: number;
  /** Whether to log tool/streaming diagnostics. */
  debug: boolean;
}

const DEFAULT_FILTER_PROFILES: Record<string, FilterProfile> = {
  "deepseek-v4.1-flash": {
    maxTools: 128,
    maxToolsOverflow: "error",
    denyServers: ["vercel", "render", "cloudflare", "stripe-sandbox"],
  },
  "default": {
    maxTools: 128,
    maxToolsOverflow: "error",
  },
};

export function loadConfig(): ProxyConfig {
  const env = Bun.env;
  return {
    port: Number(env.OPENCODE_PROXY_PORT ?? 8080),
    upstream: env.OPENCODE_PROXY_UPSTREAM ?? "https://opencode.ai/inference/go/openai/v1",
    model: env.OPENCODE_PROXY_MODEL ?? "deepseek-v4.1-flash",
    filterProfiles: DEFAULT_FILTER_PROFILES,
    normalizer: {
      maxAnyOfBranches: Number(env.OPENCODE_PROXY_MAX_ANYOF ?? 16),
      anyOfOverflow: (env.OPENCODE_PROXY_ANYOF_OVERFLOW as "chunk" | "error") ?? "chunk",
      oneOfOverflow: (env.OPENCODE_PROXY_ONEOF_OVERFLOW as "error" | "leave") ?? "error",
      dedupeBranches: env.OPENCODE_PROXY_DEDUPE !== "false",
      dropSubsumedBranches: env.OPENCODE_PROXY_SUBSUME !== "false",
      mergeScalarEnums: env.OPENCODE_PROXY_MERGE_ENUMS !== "false",
      maxMergedEnumValues: Number(env.OPENCODE_PROXY_MAX_ENUM ?? 1024),
      maxDepth: Number(env.OPENCODE_PROXY_MAX_DEPTH ?? 64),
    },
    requestTimeoutMs: Number(env.OPENCODE_PROXY_TIMEOUT ?? 120000),
    debug: env.OPENCODE_PROXY_DEBUG === "true",
  };
}
