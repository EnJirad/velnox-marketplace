import type { AuthSessionData, AuthTokens, AuthUser, LoginInput, RegisterInput } from "@velnox/api-contract";
import { signJwt } from "../../core/security/jwt.js";
import { generateSecureToken, hashPassword, hashToken, verifyPassword } from "../../core/security/password.js";
import type { IIdentityRepository } from "./identity-repository.js";
import type { UserRecord } from "./types.js";

export class IdentityService {
  constructor(
    private readonly repo: IIdentityRepository,
    private readonly jwtSecret: string,
  ) {}

  private userToAuthUser(user: UserRecord): AuthUser {
    return {
      id: user.id,
      email: user.email,
      name: user.name || null,
      role: user.role === "center_admin" || user.role === "center_superadmin" ? "admin" : (user.role as any),
      avatarUrl: user.avatar_url || null,
      createdAt: Math.floor(new Date(user.created_at).getTime() / 1000),
    };
  }

  private async generateDualTokens(user: UserRecord): Promise<AuthTokens> {
    // 1. Generate 15-minute Access Token
    const accessToken = await signJwt(
      {
        sub: user.id,
        email: user.email,
        role: user.role,
        name: user.name,
        type: "access",
      },
      this.jwtSecret,
      15 * 60, // 15 mins
    );

    // 2. Generate 7-day Refresh Token
    const rawRefreshToken = generateSecureToken(32);
    const tokenHash = await hashToken(rawRefreshToken);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    await this.repo.createRefreshToken({
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    });

    return {
      accessToken,
      tokenType: "Bearer",
      expiresIn: 15 * 60,
      refreshToken: rawRefreshToken,
    };
  }

  async register(input: RegisterInput): Promise<AuthSessionData> {
    const existing = await this.repo.findUserByEmail(input.email);
    if (existing) {
      const err = new Error("An account with this email address already exists.");
      (err as any).status = 409;
      (err as any).code = "CONFLICT";
      throw err;
    }

    const passwordHash = await hashPassword(input.password);
    const user = await this.repo.createUser({
      email: input.email,
      name: input.name,
      role: input.role as any,
      password_hash: passwordHash,
      phone: input.phone,
    });

    // Record local auth identity
    await this.repo.createIdentity({
      user_id: user.id,
      provider: "local",
      provider_user_id: user.email,
      email: user.email,
    });

    const tokens = await this.generateDualTokens(user);

    return {
      user: this.userToAuthUser(user),
      tokens,
    };
  }

  async login(input: LoginInput): Promise<AuthSessionData> {
    const user = await this.repo.findUserByEmail(input.email);
    if (!user || !user.password_hash) {
      const err = new Error("Invalid email or password.");
      (err as any).status = 401;
      (err as any).code = "UNAUTHORIZED";
      throw err;
    }

    if (user.status !== "active") {
      const err = new Error(`Account is ${user.status}. Please contact support.`);
      (err as any).status = 403;
      (err as any).code = "FORBIDDEN";
      throw err;
    }

    const isValid = await verifyPassword(input.password, user.password_hash);
    if (!isValid) {
      const err = new Error("Invalid email or password.");
      (err as any).status = 401;
      (err as any).code = "UNAUTHORIZED";
      throw err;
    }

    const tokens = await this.generateDualTokens(user);

    return {
      user: this.userToAuthUser(user),
      tokens,
    };
  }

  /**
   * Refresh Token Rotation: Revokes existing token and issues fresh pair
   */
  async refresh(rawRefreshToken: string): Promise<AuthTokens> {
    if (!rawRefreshToken || rawRefreshToken.length < 10) {
      const err = new Error("Refresh token is required.");
      (err as any).status = 400;
      (err as any).code = "VALIDATION_ERROR";
      throw err;
    }

    const tokenHash = await hashToken(rawRefreshToken);
    const tokenRecord = await this.repo.findRefreshToken(tokenHash);

    if (!tokenRecord) {
      const err = new Error("Invalid refresh token.");
      (err as any).status = 401;
      (err as any).code = "UNAUTHORIZED";
      throw err;
    }

    if (tokenRecord.revoked) {
      // Possible token theft! Revoke all user refresh tokens for safety
      await this.repo.revokeAllUserRefreshTokens(tokenRecord.user_id);
      const err = new Error("Refresh token has been revoked. All sessions invalidated.");
      (err as any).status = 401;
      (err as any).code = "UNAUTHORIZED";
      throw err;
    }

    const now = new Date();
    if (new Date(tokenRecord.expires_at) < now) {
      const err = new Error("Refresh token has expired.");
      (err as any).status = 401;
      (err as any).code = "UNAUTHORIZED";
      throw err;
    }

    // Revoke old token (Rotation)
    await this.repo.revokeRefreshToken(tokenHash);

    const user = await this.repo.findUserById(tokenRecord.user_id);
    if (!user || user.status !== "active") {
      const err = new Error("User account is inactive or not found.");
      (err as any).status = 401;
      (err as any).code = "UNAUTHORIZED";
      throw err;
    }

    // Issue fresh pair
    return this.generateDualTokens(user);
  }

  async logout(rawRefreshToken?: string, userId?: string): Promise<void> {
    if (rawRefreshToken) {
      const tokenHash = await hashToken(rawRefreshToken);
      await this.repo.revokeRefreshToken(tokenHash);
    } else if (userId) {
      await this.repo.revokeAllUserRefreshTokens(userId);
    }
  }

  async getMe(userId: string): Promise<AuthUser> {
    const user = await this.repo.findUserById(userId);
    if (!user) {
      const err = new Error("User not found.");
      (err as any).status = 404;
      (err as any).code = "NOT_FOUND";
      throw err;
    }
    return this.userToAuthUser(user);
  }

  async loginWithOAuth(
    provider: "google" | "line",
    providerUserId: string,
    email: string,
    name: string = "",
    avatarUrl?: string,
  ): Promise<AuthSessionData> {
    // 1. Check if identity already exists
    let identity = await this.repo.findIdentity(provider, providerUserId);
    let user: UserRecord | null = null;

    if (identity) {
      user = await this.repo.findUserById(identity.user_id);
    } else {
      // 2. Check if user with same email exists
      user = await this.repo.findUserByEmail(email);
      if (!user) {
        // Create new user
        user = await this.repo.createUser({
          email,
          name,
          avatar_url: avatarUrl,
          role: "customer",
        });
      }

      // Link identity
      await this.repo.createIdentity({
        user_id: user.id,
        provider,
        provider_user_id: providerUserId,
        email,
      });
    }

    if (!user) {
      const err = new Error("Failed to resolve user account.");
      (err as any).status = 500;
      throw err;
    }

    const tokens = await this.generateDualTokens(user);
    return {
      user: this.userToAuthUser(user),
      tokens,
    };
  }
}
