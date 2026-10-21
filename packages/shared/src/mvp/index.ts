/**
 * MVP client surface (`@velnox/shared/mvp`).
 *
 * Reached ONLY by pages that are mounted when `isMvpMode()` is true; the legacy
 * API client and routes are untouched.
 */
export {
  describeApiMode,
  getApiMode,
  isMvpMode,
  normaliseApiOrigin,
  resolveApiMode,
  setApiModeForTests,
  type ApiMode,
  type ApiModeEnv,
  type MvpDisabledReason,
  type ResolvedApiMode,
} from "./config.js";

export { MVP_ROUTES } from "./routes.js";

export {
  MVP_TIMEOUT_MS,
  MvpApiError,
  createMvpHttp,
  createMvpHttpFromEnv,
  type MvpHttp,
  type MvpHttpConfig,
  type MvpRequestOptions,
} from "./client.js";

export {
  createMvpApi,
  getMvpApi,
  setMvpApiForTests,
  type MvpApi,
  type MvpCheckoutInput,
  type MvpSellerSession,
} from "./api.js";

export type * from "./types.js";
