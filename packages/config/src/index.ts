/**
 * @velnox/config — Shared Configuration & Environment Constants
 */

export const PLATFORM_NAME = "Velnox Marketplace";
export const PLATFORM_VERSION = "3.0.0";

export const API_VERSION = "v1";
export const DEFAULT_API_PREFIX = `/api/${API_VERSION}`;

export const CURRENCY_DEFAULT = "THB";
export const CURRENCY_DECIMALS = 2;

export const SESSION_COOKIE_NAME = "velnox_session";
export const REFRESH_COOKIE_NAME = "velnox_refresh";

export const PAGINATION_DEFAULTS = {
  PAGE: 1,
  LIMIT: 20,
  MAX_LIMIT: 100,
} as const;

export const RESERVATION_EXPIRY_MINUTES = 30;

export const SUPPORTED_LOCALES = ["th", "en", "my"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
