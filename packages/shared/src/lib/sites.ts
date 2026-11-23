/**
 * Centralized Velnox site configuration.
 *
 * The 4 Velnox websites — one codebase, one backend + database, but
 * four SEPARATE deployable Vite apps (apps/shop · apps/seller · apps/center ·
 * apps/corporate), each deployed to its own domain.
 *
 * SITE_URLS drives cross-application navigation across domain boundaries
 * (VelShop → "Become a Seller" → seller.velnox.live). Each app deploys
 * standalone, so the defaults are the production domains; override with
 * VITE_CORPORATE_URL / VITE_VELSHOP_URL / VITE_VELSELLER_URL /
 * VITE_VELCENTER_URL when a deployment targets a different host.
 *
 * All VITE_* values are **public** — they are intentionally exposed to the
 * browser by Vite. Never store secrets in VITE_* variables.
 */
function normalizeSiteUrl(url: string | undefined, fallback: string): string {
  if (!url || !url.trim()) return fallback;
  const trimmed = url.trim();
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export const SITE_URLS = {
  corporate: normalizeSiteUrl(import.meta.env.VITE_CORPORATE_URL, "https://velnox.live"),
  velshop: normalizeSiteUrl(import.meta.env.VITE_VELSHOP_URL, "https://shop.velnox.live"),
  velseller: normalizeSiteUrl(import.meta.env.VITE_VELSELLER_URL, "https://seller.velnox.live"),
  velcenter: normalizeSiteUrl(import.meta.env.VITE_VELCENTER_URL, "https://center.velnox.live"),
} as const;

export type SiteId = keyof typeof SITE_URLS;

/**
 * Backend API origin (no path).
 *
 * VITE_API_URL contains ONLY the backend origin — never include /api here.
 * Defaults to https://api.velnox.live in production and http://localhost:8787 for local Workers dev.
 */
export const apiUrl: string = normalizeSiteUrl(
  import.meta.env.VITE_API_URL,
  import.meta.env.PROD
    ? "https://velnox-api.ma0979354966-js91934.workers.dev"
    : "http://localhost:8787"
);

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
 * joinUrl("https://shop.velnox.live", "/products")
 *   → "https://shop.velnox.live/products"
 *
 * joinUrl("https://shop.velnox.live", "products")
 *   → "https://shop.velnox.live/products"
 *
 * joinUrl("https://shop.velnox.live", "")
 *   → "https://shop.velnox.live"
 */
export function joinUrl(base: string, path: string): string {
  const b = base.replace(/\/+$/, "");
  const p = path.replace(/^\/+/, "");
  return p ? `${b}/${p}` : b;
}
