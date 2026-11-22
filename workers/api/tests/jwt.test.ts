import { describe, expect, it } from "bun:test";
import { signJwt, verifyJwt } from "../src/core/security/jwt.js";

describe("Web Crypto JWT Engine", () => {
  const secret = "test-jwt-secret-at-least-32-characters-long!";

  it("signs and verifies an HS256 JWT correctly", async () => {
    const payload = {
      sub: "user-12345",
      email: "test@example.com",
      role: "customer",
      type: "access" as const,
    };

    const token = await signJwt(payload, secret, 300);
    expect(typeof token).toBe("string");
    expect(token.split(".").length).toBe(3);

    const verified = await verifyJwt(token, secret);
    expect(verified.sub).toBe("user-12345");
    expect(verified.email).toBe("test@example.com");
    expect(verified.role).toBe("customer");
    expect(verified.type).toBe("access");
    expect(typeof verified.exp).toBe("number");
  });

  it("rejects token verified with the wrong secret", async () => {
    const token = await signJwt(
      { sub: "u-1", email: "a@b.com", role: "customer", type: "access" },
      secret,
    );

    const wrongSecret = "completely-different-secret-key-32-chars!";
    expect(verifyJwt(token, wrongSecret)).rejects.toThrow("Invalid JWT signature");
  });

  it("rejects expired tokens", async () => {
    // Generate token expired 10 seconds ago
    const expiredToken = await signJwt(
      { sub: "u-1", email: "a@b.com", role: "customer", type: "access" },
      secret,
      -10,
    );

    expect(verifyJwt(expiredToken, secret)).rejects.toThrow("expired");
  });

  it("rejects tampered payload segments", async () => {
    const token = await signJwt(
      { sub: "u-1", email: "a@b.com", role: "customer", type: "access" },
      secret,
    );

    const [header, payload, sig] = token.split(".");
    // Tamper payload by modifying one char
    const tamperedPayload = payload + "x";
    const tamperedToken = `${header}.${tamperedPayload}.${sig}`;

    expect(verifyJwt(tamperedToken, secret)).rejects.toThrow();
  });

  it("rejects malformed token strings", async () => {
    expect(verifyJwt("not-a-jwt", secret)).rejects.toThrow("Malformed JWT");
    expect(verifyJwt("a.b", secret)).rejects.toThrow("Malformed JWT");
  });
});
