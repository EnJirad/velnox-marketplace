/**
 * Access guard for the `/api/_diag` prefix.
 *
 * WHY THIS EXISTS
 * `GET /api/_diag/schema` answers a question nothing else can: "does the
 * DEPLOYED database still match the schema this code expects?" (a column behind
 * a slow migration, an aggregate that raises 42P10 against live rows, a
 * `GROUP BY` that never accounted for a join). The coding sandbox has no
 * DATABASE_URL, so this is the only way drift becomes visible from outside.
 *
 * It shipped **public and unauthenticated**. Any anonymous caller could read:
 * which tables and columns exist, the applied migration set, product counts by
 * status, notification counts by type and audit-log row counts — i.e. a free
 * reconnaissance pass over the deployment. The endpoint is worth keeping, but it
 * is not worth keeping public.
 *
 * Applied at the PREFIX (`app.use("/api/_diag", ...requireDiagAccess)`) rather
 * than on the one route, so a diagnostic added later is guarded by default and
 * has to be *deliberately* made public instead of accidentally shipped open.
 *
 * WHO MAY USE IT
 *
 *   anonymous           → 401 (no/invalid/expired session cookie)
 *   customer / seller   → 403
 *   staff               → 403 — deliberately NOT the permission catalog:
 *                         infrastructure internals are owner/admin-only, so even
 *                         a staff member holding every permission is refused
 *   owner / admin       → allowed
 *
 * Fails closed: a database error during the role lookup answers 503, never a
 * pass-through. `roleOf` resolves through `lib/permissions.ts`, the same source
 * of truth every other VelCenter guard uses.
 */
import type { Request, RequestHandler, Response, NextFunction } from "express";
import { requireAuth } from "./auth.js";
import { roleOf } from "../lib/permissions.js";

/** The only roles allowed to reach `/api/_diag/*`. Staff is intentionally absent. */
export const DIAG_ALLOWED_ROLES: string[] = ["owner", "admin"];

/**
 * Pure role decision, kept separate so the rule is testable without a database
 * or a session. Anything that is not exactly `owner` or `admin` — `staff`,
 * `seller`, `customer`, an empty string, `null`, `undefined` — is refused.
 */
export function isDiagRoleAllowed(role: string | null | undefined): boolean {
  return typeof role === "string" && DIAG_ALLOWED_ROLES.includes(role);
}

/** The authorization half: resolve the session's role and refuse anyone else. */
const requireDiagRole: RequestHandler = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const role = await roleOf(req.user?.userId ?? "");
    if (!isDiagRoleAllowed(role)) {
      res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Owner or admin access required" } });
      return;
    }
    next();
  } catch {
    // An authorization lookup must never fail open.
    res.status(503).json({ success: false, error: { code: "AUTH_LOOKUP_FAILED", message: "Could not verify access" } });
  }
};

/**
 * Mount as `app.use("/api/_diag", ...requireDiagAccess)`.
 * Order matters: authentication first, then the role check.
 */
export const requireDiagAccess: RequestHandler[] = [requireAuth, requireDiagRole];
