/**
 * One-time pre-authentication nonces — the property that makes the Google gate
 * real.
 *
 * A signed cookie with a TTL is a bearer token: replaying it works until it
 * expires. What turns it into a one-time token is a server-side record that is
 * consumed ATOMICALLY. These tests pin that property:
 *
 *   • one nonce, one use — the second attempt is `replayed`
 *   • concurrent attempts: exactly one wins, even with ten in flight
 *   • an expired record reports `expired`, not `replayed`
 *   • production with no store is `unavailable` (fail closed) — never a silent
 *     per-process fallback
 *
 * The shared Postgres path is exercised when TEST_DATABASE_URL is configured;
 * without it the in-memory fallback (non-production only) runs the same logic.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  consumeNonce,
  recordNonce,
  resetNonceStoreForTests,
} from "../lib/nonce-store.js";
import {
  PREAUTH_NONCE_SCOPE,
  PREAUTH_TTL_MS,
  createPreAuthProof,
  validatePreAuthProof,
} from "../lib/preauth-proof.js";

const ORIGINAL_ENV = { ...process.env };
const SCOPE = PREAUTH_NONCE_SCOPE;

beforeEach(() => {
  resetNonceStoreForTests();
  process.env.NODE_ENV = "test";
  process.env.PREAUTH_PROOF_SECRET = "nonce-test-secret-32-characters-ok!!";
  delete process.env.OAUTH_STATE_SECRET;
  process.env.JWT_SECRET = "jwt-test-secret-32-characters-ok!!!";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  resetNonceStoreForTests();
});

describe("one nonce, one use", () => {
  test("the first consume wins and the second is replayed", async () => {
    const nonce = "nonce-one-use";
    expect(await recordNonce(SCOPE, nonce, PREAUTH_TTL_MS)).toBe(true);
    expect(await consumeNonce(SCOPE, nonce)).toBe("ok");
    expect(await consumeNonce(SCOPE, nonce)).toBe("replayed");
  });

  test("a nonce that was never recorded is rejected", async () => {
    expect(await consumeNonce(SCOPE, "never-seen")).toBe("replayed");
  });

  test("a new sign-in mints a new nonce, so a consumed one is never re-armed", async () => {
    const first = createPreAuthProof();
    await recordNonce(SCOPE, first.nonce, PREAUTH_TTL_MS);
    expect(await consumeNonce(SCOPE, first.nonce)).toBe("ok");

    const second = createPreAuthProof();
    expect(second.nonce).not.toBe(first.nonce);
    // The fresh one works; the spent one still does not.
    await recordNonce(SCOPE, second.nonce, PREAUTH_TTL_MS);
    expect(await consumeNonce(SCOPE, second.nonce)).toBe("ok");
    expect(await consumeNonce(SCOPE, first.nonce)).toBe("replayed");
  });

  test("different scopes do not collide", async () => {
    const nonce = "shared-value";
    await recordNonce("scope_a", nonce, PREAUTH_TTL_MS);
    expect(await consumeNonce("scope_b", nonce)).toBe("replayed");
    expect(await consumeNonce("scope_a", nonce)).toBe("ok");
  });
});

describe("concurrent replay", () => {
  test("ten simultaneous consumes: exactly one wins", async () => {
    const nonce = "concurrent-replay";
    await recordNonce(SCOPE, nonce, PREAUTH_TTL_MS);
    const outcomes = await Promise.all(
      Array.from({ length: 10 }, () => consumeNonce(SCOPE, nonce)),
    );
    expect(outcomes.filter((o) => o === "ok")).toHaveLength(1);
    expect(outcomes.filter((o) => o === "replayed")).toHaveLength(9);
  });

  test("concurrent consumes across different scopes are independent", async () => {
    await recordNonce("a", "n1", PREAUTH_TTL_MS);
    await recordNonce("b", "n1", PREAUTH_TTL_MS);
    const [first, second] = await Promise.all([
      consumeNonce("a", "n1"),
      consumeNonce("b", "n1"),
    ]);
    expect(first).toBe("ok");
    expect(second).toBe("ok");
  });
});

describe("expiry", () => {
  test("an expired record reports expired, not replayed", async () => {
    const nonce = "expired-nonce";
    // Record it as already expired.
    await recordNonce(SCOPE, nonce, -1_000);
    expect(await consumeNonce(SCOPE, nonce)).toBe("expired");
  });

  test("an expired record is still removed by the failed consume", async () => {
    const nonce = "expired-then-gone";
    await recordNonce(SCOPE, nonce, -1_000);
    expect(await consumeNonce(SCOPE, nonce)).toBe("expired");
    // Second attempt finds nothing left.
    expect(await consumeNonce(SCOPE, nonce)).toBe("replayed");
  });
});

describe("store failure is fail-closed in production", () => {
  test("recording fails when production has no usable store", async () => {
    process.env.NODE_ENV = "production";
    // No TEST_DATABASE_URL / DATABASE_URL in this environment, so the Postgres
    // path throws and the in-memory fallback is forbidden.
    expect(await recordNonce(SCOPE, "prod-nonce", PREAUTH_TTL_MS)).toBe(false);
  });

  test("consuming reports unavailable when production has no usable store", async () => {
    process.env.NODE_ENV = "production";
    expect(await consumeNonce(SCOPE, "prod-nonce")).toBe("unavailable");
  });

  test("production never silently falls back to per-process memory", async () => {
    // Record while non-production so the value exists in the memory store…
    await recordNonce(SCOPE, "memory-only", PREAUTH_TTL_MS);
    // …then switch to production. The memory store must not be consulted.
    process.env.NODE_ENV = "production";
    expect(await consumeNonce(SCOPE, "memory-only")).toBe("unavailable");
  });
});

describe("the proof and the nonce are the same value", () => {
  test("minting returns the nonce the validator reads back", () => {
    const proof = createPreAuthProof();
    expect(typeof proof.nonce).toBe("string");
    expect(proof.nonce.length).toBeGreaterThanOrEqual(32);
    const validation = validatePreAuthProof(proof.cookieValue);
    expect(validation.ok).toBe(true);
    if (validation.ok) expect(validation.nonce).toBe(proof.nonce);
  });

  test("the end-to-end gate: mint → record → consume once", async () => {
    const proof = createPreAuthProof();
    expect(await recordNonce(SCOPE, proof.nonce, proof.maxAgeMs)).toBe(true);

    const validation = validatePreAuthProof(proof.cookieValue);
    expect(validation.ok).toBe(true);
    if (!validation.ok) return;

    expect(await consumeNonce(SCOPE, validation.nonce)).toBe("ok");
    // Replaying the very same cookie now fails.
    expect(await consumeNonce(SCOPE, validation.nonce)).toBe("replayed");
  });

  test("a forged proof never reaches the nonce store", async () => {
    const proof = createPreAuthProof();
    const [payload] = proof.cookieValue.split(".");
    const forged = `${payload}.deadbeef`;
    expect(validatePreAuthProof(forged).ok).toBe(false);
    // Nothing was consumed because nothing valid was presented.
    expect(await consumeNonce(SCOPE, proof.nonce)).toBe("replayed");
  });
});

describe("no secret material is stored", () => {
  test("the store keys are hashes, not the nonce itself", async () => {
    const nonce = "raw-nonce-must-not-be-stored";
    await recordNonce(SCOPE, nonce, PREAUTH_TTL_MS);
    // The public API never exposes keys; assert the design contract instead:
    // the module hashes with sha256 and stores only that digest.
    const src = readNonceStore();
    expect(src).toContain('crypto.createHash("sha256")');
    expect(src).toContain("nonce_hash");
    expect(src).not.toContain("console.log");
    expect(src).not.toContain("console.warn");
  });
});

function readNonceStore(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fs = require("node:fs") as typeof import("node:fs");
  return fs.readFileSync(
    new URL("../lib/nonce-store.ts", import.meta.url),
    "utf8",
  );
}
