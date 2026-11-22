import { describe, expect, it } from "bun:test";
import {
  generateSecureToken,
  hashPassword,
  hashToken,
  timingSafeEqual,
  verifyPassword,
} from "../src/core/security/password.js";

describe("Web Crypto PBKDF2 Password & Token Hashing", () => {
  it("hashes password into $pbkdf2-sha256$ format and verifies correctly", async () => {
    const password = "SecurePassword123!";
    const hash = await hashPassword(password);

    expect(hash.startsWith("$pbkdf2-sha256$i=100000$")).toBe(true);

    const isMatch = await verifyPassword(password, hash);
    expect(isMatch).toBe(true);
  });

  it("rejects incorrect passwords", async () => {
    const password = "CorrectPassword123!";
    const wrongPassword = "WrongPassword123!";
    const hash = await hashPassword(password);

    const isMatch = await verifyPassword(wrongPassword, hash);
    expect(isMatch).toBe(false);
  });

  it("rejects malformed hashes safely", async () => {
    expect(await verifyPassword("password", "invalid-hash")).toBe(false);
    expect(await verifyPassword("password", "")).toBe(false);
    expect(await verifyPassword("password", "$pbkdf2-sha256$invalid")).toBe(false);
  });

  it("generates cryptographically secure tokens and hashes them deterministically", async () => {
    const token = generateSecureToken(32);
    expect(typeof token).toBe("string");
    expect(token.length).toBe(64); // 32 bytes = 64 hex chars

    const hash1 = await hashToken(token);
    const hash2 = await hashToken(token);
    expect(hash1).toBe(hash2);
    expect(hash1.length).toBe(64); // SHA-256 = 32 bytes = 64 hex chars
  });

  it("timingSafeEqual correctly compares byte arrays", () => {
    const a = new Uint8Array([1, 2, 3, 4]);
    const b = new Uint8Array([1, 2, 3, 4]);
    const c = new Uint8Array([1, 2, 3, 5]);
    const d = new Uint8Array([1, 2, 3]);

    expect(timingSafeEqual(a, b)).toBe(true);
    expect(timingSafeEqual(a, c)).toBe(false);
    expect(timingSafeEqual(a, d)).toBe(false);
  });
});
