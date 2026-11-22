import { signJwt, verifyJwt, type JwtPayload } from "./jwt.ts";
import { TokenExpiredError, UnauthorizedError } from "../errors/app-error.ts";

export const ACCESS_TOKEN_EXPIRY_SECONDS = 15 * 60; // 15 minutes
export const REFRESH_TOKEN_EXPIRY_SECONDS = 30 * 24 * 60 * 60; // 30 days

export interface AuthTokenPair {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly tokenType: "Bearer";
  readonly expiresIn: number; // in seconds (for access token)
}

export interface AccessTokenClaims extends JwtPayload {
  readonly userId: string;
  readonly email: string;
  readonly role: string;
  readonly token_type: "access";
  readonly jti: string;
}

export interface RefreshTokenClaims extends JwtPayload {
  readonly userId: string;
  readonly email: string;
  readonly token_type: "refresh";
  readonly jti: string;
  readonly familyId: string;
}

export class DualTokenService {
  /**
   * Mints an Access Token (15 min) and Refresh Token (30 days).
   */
  public static mintTokenPair(
    user: { id: string; email: string; role: string },
    secret: string,
    familyId?: string,
  ): AuthTokenPair {
    const currentFamilyId = familyId ?? crypto.randomUUID();
    const accessJti = crypto.randomUUID();
    const refreshJti = crypto.randomUUID();

    const accessToken = signJwt(
      {
        sub: user.id,
        userId: user.id,
        email: user.email,
        role: user.role,
        token_type: "access",
        jti: accessJti,
      },
      secret,
      ACCESS_TOKEN_EXPIRY_SECONDS,
    );

    const refreshToken = signJwt(
      {
        sub: user.id,
        userId: user.id,
        email: user.email,
        token_type: "refresh",
        jti: refreshJti,
        familyId: currentFamilyId,
      },
      secret,
      REFRESH_TOKEN_EXPIRY_SECONDS,
    );

    return {
      accessToken,
      refreshToken,
      tokenType: "Bearer",
      expiresIn: ACCESS_TOKEN_EXPIRY_SECONDS,
    };
  }

  /**
   * Verifies an Access Token and ensures token_type === "access".
   */
  public static verifyAccessToken(token: string, secret: string): AccessTokenClaims {
    const result = verifyJwt<AccessTokenClaims>(token, secret);
    if (!result.valid || !result.payload) {
      if (result.error === "EXPIRED") {
        throw new TokenExpiredError("Access token has expired");
      }
      throw new UnauthorizedError("Invalid access token");
    }

    if (result.payload.token_type !== "access") {
      throw new UnauthorizedError("Token is not an access token");
    }

    return result.payload;
  }

  /**
   * Verifies a Refresh Token and ensures token_type === "refresh".
   */
  public static verifyRefreshToken(token: string, secret: string): RefreshTokenClaims {
    const result = verifyJwt<RefreshTokenClaims>(token, secret);
    if (!result.valid || !result.payload) {
      if (result.error === "EXPIRED") {
        throw new TokenExpiredError("Refresh token has expired");
      }
      throw new UnauthorizedError("Invalid refresh token");
    }

    if (result.payload.token_type !== "refresh") {
      throw new UnauthorizedError("Token is not a refresh token");
    }

    return result.payload;
  }
}
