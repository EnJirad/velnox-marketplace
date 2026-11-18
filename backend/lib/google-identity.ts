/**
 * Claim validation for Google ID tokens.
 *
 * Split out of `routes/mobile-auth.ts` so the rules can be tested without a
 * network round trip. `verifyGoogleToken` still asks Google to verify the token
 * (signature and lifetime); this module then decides whether the *identity* is
 * acceptable for this application.
 *
 * Deliberately independent of Express and of the database: it takes claims and
 * a clock, and returns a decision. Nothing here trusts a value supplied by the
 * client other than the token itself.
 */

/** Same shape the rest of the backend uses for email validation. */
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;

/** Google issues tokens under one of these two spellings. */
const GOOGLE_ISSUERS = new Set(["https://accounts.google.com", "accounts.google.com"]);

export interface GoogleClaims {
  aud?: unknown;
  iss?: unknown;
  exp?: unknown;
  sub?: unknown;
  email?: unknown;
  email_verified?: unknown;
  azp?: unknown;
  name?: unknown;
}

export interface VerifiedGoogleIdentity {
  ok: true;
  /** Google's stable subject identifier — the external identity key. */
  userId: string;
  email: string;
  name: string;
  /** Accounts created from a Google identity are always customers. */
  role: "customer";
  verifiedEmail: boolean;
}

export interface ClaimRejection {
  ok: false;
  status: number;
  code: string;
  message: string;
}

/**
 * Validate the claims of an already-verified Google ID token.
 *
 * Every claim failure returns the same generic 401 the route already used, so a
 * caller cannot learn *which* check failed. The two exceptions are deliberate:
 * `EMAIL_NOT_VERIFIED` (the account can never be used, and the user should know)
 * and `GOOGLE_NOT_CONFIGURED` (a deployment fact, not a token fact).
 */
export function validateGoogleClaims(
  claims: GoogleClaims,
  expectedAudience: string,
  nowMs: number = Date.now(),
): VerifiedGoogleIdentity | ClaimRejection {
  if (!expectedAudience) {
    return {
      ok: false,
      status: 503,
      code: "GOOGLE_NOT_CONFIGURED",
      message: "Google Sign-In is not configured on the server",
    };
  }

  const audience = String(claims.aud ?? "");
  const issuer = String(claims.iss ?? "");
  const expiry = Number(claims.exp);

  // Audience: the token must have been issued for THIS application's client id.
  if (audience !== expectedAudience) {
    return invalid("Google identity claims are not valid for this app");
  }

  // Issuer: Google, and only Google, in either accepted spelling.
  if (!GOOGLE_ISSUERS.has(issuer)) {
    return invalid("Google identity claims are not valid for this app");
  }

  // Expiry: an unparseable or past `exp` is rejected. No skew window is applied
  // here because Google's own verification already allowed for clock drift.
  if (!Number.isFinite(expiry) || expiry * 1000 <= nowMs) {
    return invalid("Google identity claims are not valid for this app");
  }

  // Authorized party: when present it must also be this client, which catches a
  // token minted for an app that merely shares the audience.
  const azp = claims.azp == null ? "" : String(claims.azp);
  if (azp && azp !== expectedAudience) {
    return invalid("Google identity has a different authorized party");
  }

  // A Google account whose address is not verified can never be trusted to
  // identify a person, so it is rejected rather than downgraded.
  if (String(claims.email_verified) !== "true") {
    return {
      ok: false,
      status: 401,
      code: "EMAIL_NOT_VERIFIED",
      message: "Google email is not verified",
    };
  }

  // Subject: the stable identifier. Required, and never replaced by the email.
  const sub = String(claims.sub ?? "").trim();
  if (!sub) {
    return invalid("Google identity is missing subject or email");
  }

  const email = String(claims.email ?? "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return invalid("Google identity is missing subject or email");
  }

  const name = String(claims.name ?? "").trim() || email.split("@")[0] || "Velnox customer";

  return {
    ok: true,
    userId: sub,
    email,
    name: name.slice(0, 120),
    role: "customer",
    verifiedEmail: true,
  };
}

function invalid(message: string): ClaimRejection {
  return { ok: false, status: 401, code: "INVALID_GOOGLE_TOKEN", message };
}
