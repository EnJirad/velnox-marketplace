import type { MiddlewareHandler } from "hono";
import { parseCookies } from "../core/security/cookies.js";
import { type JwtPayload, verifyJwt } from "../core/security/jwt.js";
import type { Bindings, Variables } from "../types.js";
import { SESSION_COOKIE_NAME } from "@velnox/config";

/**
 * Authentication Middleware: extracts & verifies JWT from Bearer header or Session Cookie
 */
export const authMiddleware: MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> = async (
  c,
  next,
) => {
  const secret = c.env?.JWT_SECRET || "velnox-default-development-jwt-secret-at-least-32-chars";

  // 1. Try Authorization: Bearer <token>
  let token: string | null = null;
  const authHeader = c.req.header("Authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    token = authHeader.substring(7).trim();
  }

  // 2. Fall back to Cookie: velnox_session=<token>
  if (!token) {
    const cookies = parseCookies(c.req.header("Cookie"));
    token = cookies[SESSION_COOKIE_NAME] || null;
  }

  if (!token) {
    const err = new Error("Authentication required.");
    (err as any).status = 401;
    (err as any).code = "UNAUTHORIZED";
    throw err;
  }

  try {
    const payload = await verifyJwt(token, secret);
    if (payload.type !== "access") {
      const err = new Error("Invalid token type: access token required.");
      (err as any).status = 401;
      (err as any).code = "UNAUTHORIZED";
      throw err;
    }
    c.set("user", payload);
  } catch (err: any) {
    const authErr = new Error(err.message || "Invalid or expired session token.");
    (authErr as any).status = 401;
    (authErr as any).code = "UNAUTHORIZED";
    throw authErr;
  }

  await next();
};

/**
 * Role-Based Access Control (RBAC) Guard Middleware
 */
export function requireRole(
  ...allowedRoles: Array<"customer" | "seller" | "center_staff" | "center_admin" | "center_superadmin" | "admin">
): MiddlewareHandler<{ Bindings: Bindings; Variables: Variables }> {
  return async (c, next) => {
    const user = c.get("user");
    if (!user) {
      const err = new Error("Authentication required.");
      (err as any).status = 401;
      (err as any).code = "UNAUTHORIZED";
      throw err;
    }

    const userRole = user.role;
    const hasRole = allowedRoles.includes(userRole as any) ||
      (allowedRoles.includes("admin") && (userRole === "center_admin" || userRole === "center_superadmin"));

    if (!hasRole) {
      const err = new Error(`Forbidden: required role '${allowedRoles.join(", ")}' not granted.`);
      (err as any).status = 403;
      (err as any).code = "FORBIDDEN";
      throw err;
    }

    await next();
  };
}
