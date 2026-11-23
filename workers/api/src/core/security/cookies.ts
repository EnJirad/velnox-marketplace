import { SESSION_COOKIE_NAME, REFRESH_COOKIE_NAME } from "@velnox/config";

/**
 * Cookie security utilities for Cloudflare Workers
 */

export function createSessionCookie(token: string, isProduction: boolean = false): string {
  const sameSite = isProduction ? "SameSite=None" : "SameSite=Lax";
  const secure = isProduction ? "Secure; " : "";
  // 15 minutes max age
  return `${SESSION_COOKIE_NAME}=${token}; Path=/; HttpOnly; ${secure}${sameSite}; Max-Age=900`;
}

export function createRefreshCookie(token: string, isProduction: boolean = false): string {
  const sameSite = isProduction ? "SameSite=None" : "SameSite=Lax";
  const secure = isProduction ? "Secure; " : "";
  // 7 days max age
  return `${REFRESH_COOKIE_NAME}=${token}; Path=/; HttpOnly; ${secure}${sameSite}; Max-Age=604800`;
}

export function createClearSessionCookies(): string[] {
  return [
    `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`,
    `${REFRESH_COOKIE_NAME}=; Path=/; HttpOnly; Max-Age=0`,
  ];
}

export function parseCookies(cookieHeader: string | null | undefined): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  const pairs = cookieHeader.split(";");
  for (const pair of pairs) {
    const idx = pair.indexOf("=");
    if (idx !== -1) {
      const key = pair.substring(0, idx).trim();
      const val = pair.substring(idx + 1).trim();
      if (key) {
        cookies[key] = decodeURIComponent(val);
      }
    }
  }
  return cookies;
}
