import type { DbQueryable } from "../../../../database/src/types.ts";
import { DualTokenService, type AccessTokenClaims } from "../security/tokens.ts";
import { TokenRepository } from "../../modules/identity/repository/token-repository.ts";
import { ForbiddenError, UnauthorizedError } from "../errors/app-error.ts";
import type { UserRole } from "../../modules/identity/domain/user.ts";

export interface AuthenticatedUser {
  readonly userId: string;
  readonly email: string;
  readonly role: UserRole;
  readonly jti: string;
}

export interface AuthContext {
  user?: AuthenticatedUser;
  token?: string;
}

/**
 * Extracts raw token from either Authorization header or Cookie.
 */
export function extractAuthToken(headers: Record<string, string | undefined>): string | null {
  const authHeader = headers["authorization"] ?? headers["Authorization"];
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return authHeader.slice(7).trim();
  }

  const cookieHeader = headers["cookie"] ?? headers["Cookie"];
  if (cookieHeader) {
    const match = cookieHeader.match(/(?:^|;\s*)velnox_session=([^;]+)/);
    if (match && match[1]) {
      return decodeURIComponent(match[1]);
    }
  }

  return null;
}

/**
 * Authenticates request extracting token from Bearer header or httpOnly cookie,
 * validating signature, expiration, and checking the token revocation database.
 */
export async function authenticateRequest(
  db: DbQueryable,
  headers: Record<string, string | undefined>,
  jwtSecret: string,
): Promise<AuthenticatedUser> {
  const token = extractAuthToken(headers);
  if (!token) {
    throw new UnauthorizedError("Authentication required", "NO_TOKEN_PROVIDED");
  }

  // 1. Verify cryptographic validity and expiration
  const claims: AccessTokenClaims = DualTokenService.verifyAccessToken(token, jwtSecret);

  // 2. Verify token has not been revoked
  const isRevoked = await TokenRepository.isRevoked(db, claims.jti);
  if (isRevoked) {
    throw new UnauthorizedError("Session has been terminated or revoked", "TOKEN_REVOKED");
  }

  return {
    userId: claims.userId,
    email: claims.email,
    role: claims.role as UserRole,
    jti: claims.jti,
  };
}

/**
 * Guards routes enforcing user to have one of the required roles.
 */
export function assertUserRole(user: AuthenticatedUser, allowedRoles: UserRole[]): void {
  if (!allowedRoles.includes(user.role)) {
    throw new ForbiddenError(
      `Access denied: required one of [${allowedRoles.join(", ")}], but user role is '${user.role}'`,
      "INSUFFICIENT_PERMISSIONS",
    );
  }
}
