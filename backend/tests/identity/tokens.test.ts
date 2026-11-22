import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DualTokenService,
  ACCESS_TOKEN_EXPIRY_SECONDS,
  REFRESH_TOKEN_EXPIRY_SECONDS,
} from "../../src/core/security/tokens.ts";
import { UnauthorizedError } from "../../src/core/errors/app-error.ts";

describe("Core Security — DualTokenService", () => {
  const secret = "test-jwt-secret-very-secure-key-1234567890";
  const user = {
    id: "usr_001",
    email: "customer@velnox.live",
    role: "customer",
  };

  it("mints an Access Token (15 min) and Refresh Token (30 days)", () => {
    const pair = DualTokenService.mintTokenPair(user, secret);

    assert.ok(pair.accessToken);
    assert.ok(pair.refreshToken);
    assert.equal(pair.tokenType, "Bearer");
    assert.equal(pair.expiresIn, ACCESS_TOKEN_EXPIRY_SECONDS);

    const accessClaims = DualTokenService.verifyAccessToken(pair.accessToken, secret);
    assert.equal(accessClaims.userId, user.id);
    assert.equal(accessClaims.email, user.email);
    assert.equal(accessClaims.role, user.role);
    assert.equal(accessClaims.token_type, "access");
    assert.ok(accessClaims.jti);

    const refreshClaims = DualTokenService.verifyRefreshToken(pair.refreshToken, secret);
    assert.equal(refreshClaims.userId, user.id);
    assert.equal(refreshClaims.token_type, "refresh");
    assert.ok(refreshClaims.jti);
    assert.ok(refreshClaims.familyId);
  });

  it("rejects an access token presented to verifyRefreshToken", () => {
    const pair = DualTokenService.mintTokenPair(user, secret);

    assert.throws(
      () => DualTokenService.verifyRefreshToken(pair.accessToken, secret),
      (err: any) => err instanceof UnauthorizedError && err.message.includes("not a refresh token"),
    );
  });

  it("rejects a refresh token presented to verifyAccessToken", () => {
    const pair = DualTokenService.mintTokenPair(user, secret);

    assert.throws(
      () => DualTokenService.verifyAccessToken(pair.refreshToken, secret),
      (err: any) => err instanceof UnauthorizedError && err.message.includes("not an access token"),
    );
  });

  it("preserves familyId across token rotation", () => {
    const initialFamilyId = "family-xyz-123";
    const pair = DualTokenService.mintTokenPair(user, secret, initialFamilyId);
    const refreshClaims = DualTokenService.verifyRefreshToken(pair.refreshToken, secret);

    assert.equal(refreshClaims.familyId, initialFamilyId);
  });
});
