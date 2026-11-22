import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signJwt, verifyJwt } from "../../src/core/security/jwt.ts";

describe("Core Security — Pure Cryptographic JWT", () => {
  const secret = "test-jwt-secret-very-secure-key-1234567890";

  it("signs and verifies an HS256 JWT correctly", () => {
    const token = signJwt({ userId: "usr_123", email: "user@velnox.live", role: "customer" }, secret, 3600);
    const result = verifyJwt(token, secret);

    assert.equal(result.valid, true);
    assert.ok(result.payload);
    assert.equal(result.payload?.userId, "usr_123");
    assert.equal(result.payload?.email, "user@velnox.live");
    assert.equal(result.payload?.role, "customer");
    assert.ok(result.payload?.jti);
    assert.ok(result.payload?.exp);
  });

  it("rejects token with invalid signature or wrong secret", () => {
    const token = signJwt({ userId: "usr_123" }, secret, 3600);
    const result = verifyJwt(token, "wrong-secret-key-12345");

    assert.equal(result.valid, false);
    assert.equal(result.error, "INVALID_SIGNATURE");
  });

  it("detects expired tokens honestly", () => {
    // Expires immediately (-10 seconds)
    const token = signJwt({ userId: "usr_123" }, secret, -10);
    const result = verifyJwt(token, secret);

    assert.equal(result.valid, false);
    assert.equal(result.error, "EXPIRED");
    assert.ok(result.payload);
  });

  it("rejects malformed tokens", () => {
    assert.equal(verifyJwt("not-a-jwt", secret).valid, false);
    assert.equal(verifyJwt("a.b", secret).valid, false);
    assert.equal(verifyJwt("", secret).valid, false);
  });

  it("detects tampered payload", () => {
    const token = signJwt({ userId: "usr_normal", role: "customer" }, secret, 3600);
    const parts = token.split(".");
    // Tamper with payload to elevate role to admin
    const tamperedPayload = Buffer.from(
      JSON.stringify({ userId: "usr_normal", role: "admin" }),
    ).toString("base64url");
    const tamperedToken = `${parts[0]}.${tamperedPayload}.${parts[2]}`;

    const result = verifyJwt(tamperedToken, secret);
    assert.equal(result.valid, false);
    assert.equal(result.error, "INVALID_SIGNATURE");
  });
});
