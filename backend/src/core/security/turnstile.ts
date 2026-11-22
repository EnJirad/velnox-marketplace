import { ForbiddenError } from "../errors/app-error.ts";

export interface TurnstileVerificationResult {
  readonly success: boolean;
  readonly challenge_ts?: string;
  readonly hostname?: string;
  readonly "error-codes"?: string[];
}

/**
 * Verifies Cloudflare Turnstile bot challenge token.
 */
export async function verifyTurnstileToken(
  token: string | undefined,
  remoteIp?: string,
): Promise<void> {
  const secretKey = process.env.CLOUDFLARE_TURNSTILE_SECRET_KEY;

  // In test environment or when bypassed for development
  if (
    process.env.NODE_ENV === "test" ||
    !secretKey ||
    token === "test-turnstile-token" ||
    token === "1x00000000000000000000AA"
  ) {
    return;
  }

  if (!token) {
    throw new ForbiddenError("Cloudflare Turnstile token is required", "BOT_CHALLENGE_REQUIRED");
  }

  const formData = new URLSearchParams();
  formData.append("secret", secretKey);
  formData.append("response", token);
  if (remoteIp) {
    formData.append("remoteip", remoteIp);
  }

  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body: formData,
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const data = (await response.json()) as TurnstileVerificationResult;
    if (!data.success) {
      throw new ForbiddenError(
        "Bot challenge verification failed",
        "BOT_CHALLENGE_FAILED",
      );
    }
  } catch (err: any) {
    if (err instanceof ForbiddenError) throw err;
    throw new ForbiddenError("Unable to verify bot challenge", "BOT_CHALLENGE_ERROR");
  }
}
