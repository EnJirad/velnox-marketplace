import type { DbQueryable } from "../../../../database/src/types.ts";
import { UserRepository, type CreateUserData } from "../repository/user-repository.ts";
import { TokenRepository } from "../repository/token-repository.ts";
import { DualTokenService, type AuthTokenPair } from "../../../core/security/tokens.ts";
import { hashPassword, verifyPassword } from "../../../core/security/password.ts";
import { verifyTurnstileToken } from "../../../core/security/turnstile.ts";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  TokenRevokedError,
  UnauthorizedError,
  ValidationError,
} from "../../../core/errors/app-error.ts";
import type { UserProfile } from "../domain/user.ts";

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const PASSWORD_RE = /^(?=.*[A-Za-z])(?=.*\d).{8,128}$/;

export interface RegisterInput {
  readonly email: string;
  readonly password: string;
  readonly name: string;
}

export interface LoginInput {
  readonly email: string;
  readonly password: string;
}

export function validateRegisterInput(raw: any): RegisterInput {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("Registration input must be a JSON object");
  }
  const email = String(raw.email ?? "").trim().toLowerCase();
  const password = String(raw.password ?? "");
  const name = String(raw.name ?? "").trim();

  if (!email || !EMAIL_RE.test(email)) {
    throw new ValidationError("Invalid email address");
  }
  if (!password || !PASSWORD_RE.test(password)) {
    throw new ValidationError(
      "Password must be 8-128 characters with at least one letter and one number",
    );
  }
  if (!name || name.length > 120) {
    throw new ValidationError("Name is required (max 120 characters)");
  }

  return { email, password, name };
}

export function validateLoginInput(raw: any): LoginInput {
  if (!raw || typeof raw !== "object") {
    throw new ValidationError("Login input must be a JSON object");
  }
  const email = String(raw.email ?? "").trim().toLowerCase();
  const password = String(raw.password ?? "");

  if (!email || !EMAIL_RE.test(email)) {
    throw new ValidationError("Invalid email address");
  }
  if (!password || password.length === 0) {
    throw new ValidationError("Password is required");
  }

  return { email, password };
}

export interface AuthResult {
  readonly user: UserProfile;
  readonly tokens: AuthTokenPair;
}

export class IdentityService {
  /**
   * Registers a new customer user with validation, Turnstile verification, and dual-token minting.
   */
  public static async register(
    db: DbQueryable,
    rawInput: unknown,
    jwtSecret: string,
    options: { turnstileToken?: string; remoteIp?: string } = {},
  ): Promise<AuthResult> {
    const input = validateRegisterInput(rawInput);

    // 1. Verify Turnstile challenge
    await verifyTurnstileToken(options.turnstileToken, options.remoteIp);

    // 2. Check email existence
    const existing = await UserRepository.findByEmail(db, input.email);
    if (existing) {
      throw new ConflictError("An account with this email already exists", "EMAIL_EXISTS");
    }

    // 3. Hash password with scrypt
    const passwordHash = await hashPassword(input.password);

    // 4. Create user record
    const createData: CreateUserData = {
      email: input.email,
      name: input.name,
      passwordHash,
      role: "customer",
      status: "active",
    };
    const user = await UserRepository.createUser(db, createData);
    await UserRepository.createCustomerProfile(db, user.id);

    // 5. Mint Dual Tokens (Access 15m + Refresh 30d)
    const tokens = DualTokenService.mintTokenPair(
      { id: user.id, email: user.email, role: user.role },
      jwtSecret,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt.getTime(),
      },
      tokens,
    };
  }

  /**
   * Authenticates user with email and password, returning dual tokens.
   */
  public static async loginWithPassword(
    db: DbQueryable,
    rawInput: unknown,
    jwtSecret: string,
    options: { turnstileToken?: string; remoteIp?: string } = {},
  ): Promise<AuthResult> {
    const input = validateLoginInput(rawInput);

    // 1. Verify Turnstile challenge
    await verifyTurnstileToken(options.turnstileToken, options.remoteIp);

    // 2. Find user
    const user = await UserRepository.findByEmail(db, input.email);
    if (!user || !user.passwordHash) {
      throw new UnauthorizedError("Invalid email or password", "INVALID_CREDENTIALS");
    }

    // 3. Verify password
    const isMatch = await verifyPassword(input.password, user.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedError("Invalid email or password", "INVALID_CREDENTIALS");
    }

    // 4. Check active status
    if (user.status !== "active") {
      throw new ForbiddenError("This account is currently disabled", "ACCOUNT_DISABLED");
    }

    // 5. Mint Dual Tokens
    const tokens = DualTokenService.mintTokenPair(
      { id: user.id, email: user.email, role: user.role },
      jwtSecret,
    );

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt.getTime(),
      },
      tokens,
    };
  }

  /**
   * Implements Refresh Token Rotation:
   * - Verifies existing refresh token.
   * - Checks against token revocation table.
   * - Revokes the used refresh token immediately.
   * - Mints a fresh Access Token and fresh Refresh Token in the same family.
   */
  public static async refreshToken(
    db: DbQueryable,
    refreshTokenString: string,
    jwtSecret: string,
  ): Promise<AuthTokenPair> {
    if (!refreshTokenString || typeof refreshTokenString !== "string") {
      throw new UnauthorizedError("Refresh token is required", "MISSING_REFRESH_TOKEN");
    }

    // 1. Verify cryptographic validity & claims
    const claims = DualTokenService.verifyRefreshToken(refreshTokenString, jwtSecret);

    // 2. Verify token is not revoked
    const isRevoked = await TokenRepository.isRevoked(db, claims.jti);
    if (isRevoked) {
      // Security: Attempting to use a revoked refresh token may indicate a token theft attack
      throw new TokenRevokedError("Refresh token has been revoked or already rotated");
    }

    // 3. Fetch user
    const user = await UserRepository.findById(db, claims.userId);
    if (!user || user.status !== "active") {
      throw new UnauthorizedError("User not found or disabled", "ACCOUNT_INACTIVE");
    }

    // 4. Rotate: Revoke the currently used refresh token
    const expiresAt = new Date(claims.exp * 1000);
    await TokenRepository.revokeToken(db, {
      tokenId: claims.jti,
      userId: user.id,
      expiresAt,
    });

    // 5. Mint new token pair preserving the familyId
    return DualTokenService.mintTokenPair(
      { id: user.id, email: user.email, role: user.role },
      jwtSecret,
      claims.familyId,
    );
  }

  /**
   * Logs out user by revoking active tokens.
   */
  public static async logout(
    db: DbQueryable,
    jwtSecret: string,
    tokens: { accessToken?: string; refreshToken?: string },
  ): Promise<void> {
    if (tokens.refreshToken) {
      try {
        const refreshClaims = DualTokenService.verifyRefreshToken(tokens.refreshToken, jwtSecret);
        await TokenRepository.revokeToken(db, {
          tokenId: refreshClaims.jti,
          userId: refreshClaims.userId,
          expiresAt: new Date(refreshClaims.exp * 1000),
        });
      } catch {
        // Continue to revoke access token even if refresh token is already expired
      }
    }

    if (tokens.accessToken) {
      try {
        const accessClaims = DualTokenService.verifyAccessToken(tokens.accessToken, jwtSecret);
        await TokenRepository.revokeToken(db, {
          tokenId: accessClaims.jti,
          userId: accessClaims.userId,
          expiresAt: new Date(accessClaims.exp * 1000),
        });
      } catch {
        // Ignore parsing errors on expired token
      }
    }
  }

  /**
   * Returns current authenticated user profile.
   */
  public static async getProfile(db: DbQueryable, userId: string): Promise<UserProfile> {
    const user = await UserRepository.findById(db, userId);
    if (!user) {
      throw new NotFoundError("User not found");
    }
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      createdAt: user.createdAt.getTime(),
    };
  }
}
