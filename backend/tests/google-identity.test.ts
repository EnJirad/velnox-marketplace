import { describe, expect, test } from "bun:test";
import { validateGoogleClaims } from "../lib/google-identity.js";

/**
 * The rules that decide whether a Google ID token may identify a Velnox user.
 *
 * These run without a network call: Google's own tokeninfo has already verified
 * the signature and lifetime, so what is tested here is the part that belongs to
 * this application — audience, issuer, expiry, authorized party, verified email,
 * and the stable subject identifier.
 */

const CLIENT_ID = "1234567890-abcdefghij.apps.googleusercontent.com";
const NOW = 1_700_000_000_000; // fixed clock, so expiry is deterministic
const LATER = Math.floor(NOW / 1000) + 600;

function claims(overrides: Record<string, unknown> = {}) {
  return {
    aud: CLIENT_ID,
    iss: "https://accounts.google.com",
    exp: LATER,
    sub: "google-subject-123",
    email: "ann@example.com",
    email_verified: "true",
    name: "Ann Suriya",
    ...overrides,
  };
}

describe("valid tokens", () => {
  test("a well-formed token is accepted", () => {
    const result = validateGoogleClaims(claims(), CLIENT_ID, NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.userId).toBe("google-subject-123");
    expect(result.email).toBe("ann@example.com");
    expect(result.name).toBe("Ann Suriya");
  });

  test("the subject is the identity key, and the email is only a claim", () => {
    const a = validateGoogleClaims(claims({ sub: "sub-a" }), CLIENT_ID, NOW);
    const b = validateGoogleClaims(
      claims({ sub: "sub-b", email: "someone.else@example.com" }),
      CLIENT_ID,
      NOW,
    );

    if (!a.ok || !b.ok) throw new Error("both should be accepted");
    expect(a.userId).not.toBe(b.userId);
  });

  test("the issuer is accepted in both spellings Google uses", () => {
    for (const iss of ["https://accounts.google.com", "accounts.google.com"]) {
      expect(validateGoogleClaims(claims({ iss }), CLIENT_ID, NOW).ok).toBe(true);
    }
  });

  test("azp equal to the client id is accepted", () => {
    expect(validateGoogleClaims(claims({ azp: CLIENT_ID }), CLIENT_ID, NOW).ok).toBe(true);
  });

  test("an email is normalized to lower case", () => {
    const result = validateGoogleClaims(claims({ email: "  Ann@Example.COM " }), CLIENT_ID, NOW);
    if (!result.ok) throw new Error("should be accepted");
    expect(result.email).toBe("ann@example.com");
  });

  test("a missing name falls back to the email local part, never a blank", () => {
    const result = validateGoogleClaims(claims({ name: undefined }), CLIENT_ID, NOW);
    if (!result.ok) throw new Error("should be accepted");
    expect(result.name).toBe("ann");
  });
});

describe("rejected tokens", () => {
  test("a different audience is rejected", () => {
    const result = validateGoogleClaims(
      claims({ aud: "9999999999-other.apps.googleusercontent.com" }),
      CLIENT_ID,
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("INVALID_GOOGLE_TOKEN");
    expect(result.status).toBe(401);
  });

  test("a missing audience is rejected", () => {
    expect(validateGoogleClaims(claims({ aud: undefined }), CLIENT_ID, NOW).ok).toBe(false);
  });

  test("a foreign issuer is rejected", () => {
    for (const iss of ["https://evil.example.com", "accounts.google.com.evil.test", ""]) {
      const result = validateGoogleClaims(claims({ iss }), CLIENT_ID, NOW);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("unreachable");
      expect(result.code).toBe("INVALID_GOOGLE_TOKEN");
    }
  });

  test("an expired token is rejected", () => {
    const result = validateGoogleClaims(
      claims({ exp: Math.floor(NOW / 1000) - 1 }),
      CLIENT_ID,
      NOW,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("INVALID_GOOGLE_TOKEN");
  });

  test("a token expiring exactly now is rejected", () => {
    expect(validateGoogleClaims(claims({ exp: NOW / 1000 }), CLIENT_ID, NOW).ok).toBe(false);
  });

  test("a non-numeric expiry is rejected", () => {
    for (const exp of ["soon", undefined, null]) {
      expect(validateGoogleClaims(claims({ exp }), CLIENT_ID, NOW).ok).toBe(false);
    }
  });

  test("a mismatched authorized party is rejected", () => {
    const result = validateGoogleClaims(
      claims({ azp: "9999999999-other.apps.googleusercontent.com" }),
      CLIENT_ID,
      NOW,
    );
    expect(result.ok).toBe(false);
  });

  test("an unverified email is rejected with its own code", () => {
    const result = validateGoogleClaims(claims({ email_verified: false }), CLIENT_ID, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("EMAIL_NOT_VERIFIED");
    expect(result.status).toBe(401);
  });

  test("a missing subject is rejected even when the email is valid", () => {
    const result = validateGoogleClaims(claims({ sub: "" }), CLIENT_ID, NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.code).toBe("INVALID_GOOGLE_TOKEN");
  });

  test("a malformed email is rejected", () => {
    for (const email of ["", "ann", "ann@", "ann@b", "a b@example.com"]) {
      expect(validateGoogleClaims(claims({ email }), CLIENT_ID, NOW).ok).toBe(false);
    }
  });

  test("an unconfigured server rejects with 503 rather than accepting", () => {
    const result = validateGoogleClaims(claims(), "", NOW);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.status).toBe(503);
    expect(result.code).toBe("GOOGLE_NOT_CONFIGURED");
  });
});
