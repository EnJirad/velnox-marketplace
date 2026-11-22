import type { DbQueryable } from "../../../../database/src/types.ts";
import { IdentityService } from "../services/identity-service.ts";
import { authenticateRequest, extractAuthToken } from "../../../core/middleware/auth-middleware.ts";
import { AppError } from "../../../core/errors/app-error.ts";
import { ACCESS_TOKEN_EXPIRY_SECONDS } from "../../../core/security/tokens.ts";

export interface HttpResponse {
  readonly status: number;
  readonly headers?: Record<string, string>;
  readonly body: any;
}

export function formatSessionCookie(accessToken: string, isProduction = true): string {
  const secure = isProduction ? "Secure; " : "";
  return `velnox_session=${encodeURIComponent(accessToken)}; HttpOnly; ${secure}SameSite=None; Path=/; Max-Age=${ACCESS_TOKEN_EXPIRY_SECONDS}`;
}

export function formatClearCookie(): string {
  return `velnox_session=; HttpOnly; Path=/; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
}

/**
 * Controller handlers for Unified Authentication (Web + Mobile).
 * Adheres to @velnox/api-contract envelope standards.
 */
export class AuthController {
  public static async register(
    db: DbQueryable,
    jwtSecret: string,
    body: unknown,
    headers: Record<string, string | undefined> = {},
  ): Promise<HttpResponse> {
    try {
      const turnstileToken = headers["cf-turnstile-token"] ?? (body as any)?.turnstileToken;
      const remoteIp = headers["x-forwarded-for"] ?? headers["cf-connecting-ip"];

      const result = await IdentityService.register(db, body, jwtSecret, {
        turnstileToken,
        remoteIp,
      });

      const cookie = formatSessionCookie(result.tokens.accessToken);

      return {
        status: 201,
        headers: {
          "Set-Cookie": cookie,
        },
        body: {
          success: true,
          data: result,
        },
      };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  public static async login(
    db: DbQueryable,
    jwtSecret: string,
    body: unknown,
    headers: Record<string, string | undefined> = {},
  ): Promise<HttpResponse> {
    try {
      const turnstileToken = headers["cf-turnstile-token"] ?? (body as any)?.turnstileToken;
      const remoteIp = headers["x-forwarded-for"] ?? headers["cf-connecting-ip"];

      const result = await IdentityService.loginWithPassword(db, body, jwtSecret, {
        turnstileToken,
        remoteIp,
      });

      const cookie = formatSessionCookie(result.tokens.accessToken);

      return {
        status: 200,
        headers: {
          "Set-Cookie": cookie,
        },
        body: {
          success: true,
          data: result,
        },
      };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  public static async refresh(
    db: DbQueryable,
    jwtSecret: string,
    body: unknown,
  ): Promise<HttpResponse> {
    try {
      const refreshToken = (body as any)?.refreshToken;
      const newTokens = await IdentityService.refreshToken(db, refreshToken, jwtSecret);
      const cookie = formatSessionCookie(newTokens.accessToken);

      return {
        status: 200,
        headers: {
          "Set-Cookie": cookie,
        },
        body: {
          success: true,
          data: newTokens,
        },
      };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  public static async logout(
    db: DbQueryable,
    jwtSecret: string,
    headers: Record<string, string | undefined>,
    body?: any,
  ): Promise<HttpResponse> {
    try {
      const accessToken = extractAuthToken(headers) ?? undefined;
      const refreshToken = body?.refreshToken;

      await IdentityService.logout(db, jwtSecret, { accessToken, refreshToken });

      return {
        status: 200,
        headers: {
          "Set-Cookie": formatClearCookie(),
        },
        body: {
          success: true,
          data: { loggedOut: true },
        },
      };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  public static async me(
    db: DbQueryable,
    jwtSecret: string,
    headers: Record<string, string | undefined>,
  ): Promise<HttpResponse> {
    try {
      const authUser = await authenticateRequest(db, headers, jwtSecret);
      const profile = await IdentityService.getProfile(db, authUser.userId);

      return {
        status: 200,
        body: {
          success: true,
          data: profile,
        },
      };
    } catch (err: any) {
      return this.handleError(err);
    }
  }

  private static handleError(err: any): HttpResponse {
    if (err instanceof AppError) {
      return {
        status: err.statusCode,
        body: {
          success: false,
          error: {
            code: err.code,
            message: err.message,
            details: err.details,
          },
        },
      };
    }

    console.error("[Identity/AuthController] Unexpected error:", err);
    return {
      status: 500,
      body: {
        success: false,
        error: {
          code: "INTERNAL_ERROR",
          message: "An internal server error occurred",
        },
      },
    };
  }
}
