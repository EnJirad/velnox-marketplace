import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../../src/core/security/password.ts";

describe("Core Security — Password Hashing & Verification (scrypt)", () => {
  it("hashes password into $scrypt$ format", async () => {
    const password = "StrongPassword123!";
    const hash = await hashPassword(password);

    assert.ok(hash.startsWith("$scrypt$16384$8$1$"));
    assert.equal(hash.split("$").length, 7);
  });

  it("verifies correct password successfully", async () => {
    const password = "ValidPassword456";
    const hash = await hashPassword(password);

    const matches = await verifyPassword(password, hash);
    assert.equal(matches, true);
  });

  it("rejects incorrect password", async () => {
    const hash = await hashPassword("RightPassword");
    const matches = await verifyPassword("WrongPassword", hash);

    assert.equal(matches, false);
  });

  it("handles malformed hashes safely without throwing", async () => {
    assert.equal(await verifyPassword("password", ""), false);
    assert.equal(await verifyPassword("password", "invalid-hash-string"), false);
    assert.equal(await verifyPassword("password", "$bcrypt$12$salt$hash"), false);
  });
});
