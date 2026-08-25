/**
 * Centralized Velnox site configuration.
 *
 * The 4 Velnox websites — one codebase, one backend + database, but
 * four SEPARATE deployable Vite apps (apps/shop · apps/seller · apps/center ·
 * apps/corporate), each deployed to its own domain.
 *
 * SITE_URLS drives cross-application navigation across domain boundaries
 * (VelShop → "Become a Seller" → seller.velnox.com). Each app deploys
 * standalone, so the defaults are the production domains; override with
 * VITE_CORPORATE_URL / VITE_VELSHOP_URL / VITE_VELSELLER_URL /
 * VITE_VELCENTER_URL when a deployment targets a different host.
 *
 * All VITE_* values are **public** — they are intentionally exposed to the
 * browser by Vite. Never store secrets in VITE_* variables.
 */
export const SITE_URLS = {
  corporate: import.meta.env.VITE_CORPORATE_URL ?? "https://velnox.com",
  velshop: import.meta.env.VITE_VELSHOP_URL ?? "https://shop.velnox.com",
  velseller: import.meta.env.VITE_VELSELLER_URL ?? "https://seller.velnox.com",
  velcenter: import.meta.env.VITE_VELCENTER_URL ?? "https://center.velnx.com",
} as const;

export type SiteId = keyof typeof SITE_URLS;

/**
 * Backend API origin (no path).
 *
 * VITE_API_URL contains ONLY the backend origin — never include /api here.
 * Falls back to the local dev server port (3001) when the env var is absent.
 */
export const apiUrl: string =
  import.meta.env.VITE_API_URL || "http://localhost:3001";

/**
 * Full API base URL including /api prefix.
 *
 * All API requests must use this constant instead of apiUrl.
 * The /api prefix is appended ONCE here — never duplicate it.
 *
 * Example:
 *   apiUrl       = "https://velnox-api.onrender.com"
 *   apiBaseUrl   = "https://velnox-api.onrender.com/api"
 *   fetch(`${apiBaseUrl}/auth/me`)  →  https://velnox-api.onrender.com/api/auth/me
 */
export const apiBaseUrl: string = `${apiUrl.replace(/\/+$/, "")}/api`;

/**
 * Router basename for a site entry. Each app owns its own routes under its own
 * domain root; set VITE_SITE_BASENAME when the app is served from a sub-path
 * (e.g. "/shop" behind a gateway). Defaults to "/".
 */
export function siteBasename(site: SiteId): string {
  const envBase = import.meta.env.VITE_SITE_BASENAME;
  if (envBase !== undefined && envBase !== "") return envBase;
  return "/";
}

/**
 * Safely join a base URL and a path segment, avoiding double-slash issues.
 *
 * joinUrl("https://shop.velnox.com", "/products")
 *   → "https://shop.velnox.com/products"
 *
 * joinUrl("https://shop.velnox.com", "products")
 *   → "https://shop.velnox.com/products"
 *
 * joinUrl("https://shop.velnox.com", "")
 *   → "https://shop.velnox.com"
 */
export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return p ? `${b}/${p}` : b;
}
