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
import { afterEach, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
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
  /**
   * These cases describe a process whose only database is none at all —
   * production with no usable store. THIS process is not that process: CI sets
   * `TEST_DATABASE_URL`, and `backend/db/index.ts` builds its single `pg.Pool`
   * at import, so flipping `NODE_ENV=production` afterwards leaves a working
   * pool behind. That is why this block failed in CI while passing on a laptop
   * with no database configured: it asserted a premise it never constructed.
   *
   * The premise is built honestly instead — a child process gets the real
   * module, production rules, and no database at all. Nothing is mocked and the
   * code path under test is the shipped one.
   */
  interface FailClosedProof {
    memoryRecorded: boolean;
    memoryConsumed: string;
    prodRecord: boolean;
    prodConsume: string;
    memoryConsumeInProd: string;
  }

  let proof: FailClosedProof;

  beforeAll(() => {
    const root = join(import.meta.dir, "..", "..");
    const script = `
      const { recordNonce, consumeNonce } = await import(${JSON.stringify(join(root, "backend/lib/nonce-store.ts"))});
      const scope = ${JSON.stringify(SCOPE)};
      const ttl = ${PREAUTH_TTL_MS};
      process.env.NODE_ENV = "test";
      const memoryRecorded = await recordNonce(scope, "memory-only", ttl);
      const memoryConsumed = await consumeNonce(scope, "memory-only");
      process.env.NODE_ENV = "production";
      const prodRecord = await recordNonce(scope, "prod-nonce", ttl);
      const prodConsume = await consumeNonce(scope, "prod-nonce");
      const memoryConsumeInProd = await consumeNonce(scope, "memory-only");
      console.log(JSON.stringify({ memoryRecorded, memoryConsumed, prodRecord, prodConsume, memoryConsumeInProd }));
    `;

    // Inherit the environment EXCEPT every database variable: "no usable store"
    // has to mean no store, not "a test database happens to be configured".
    const env: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
      if (value === undefined) continue;
      if (/DATABASE_URL$/.test(key) || key === "PGHOST" || key === "PGPORT" || key === "PGDATABASE") continue;
      env[key] = value;
    }
    env.NODE_ENV = "production";
    env.BUN_TEST = "0";

    // `process.execPath` is the dynamic loader on Android, not a Bun binary, so
    // resolve the runtime from PATH instead.
    const runtime = Bun.which("bun") ?? "bun";
    const child = Bun.spawnSync([runtime, "-e", script], {
      cwd: root,
      env,
      stdout: "pipe",
      stderr: "pipe",
    });
    const line = child.stdout
      .toString()
      .trim()
      .split("\n")
      .filter((l) => l.startsWith("{"))
      .at(-1);
    if (!line) {
      throw new Error(
        `fail-closed probe produced no result (exit ${child.exitCode}): ${child.stderr.toString()}`,
      );
    }
    proof = JSON.parse(line) as FailClosedProof;
  });

  test("memory-only storage works outside production", () => {
    // The control: the fallback really does work when it is allowed, so the
    // production assertions below cannot pass for the trivial reason that
    // nothing was ever written.
    expect(proof.memoryRecorded).toBe(true);
    expect(proof.memoryConsumed).toBe("ok");
  });

  test("recording fails when production has no usable store", () => {
    expect(proof.prodRecord).toBe(false);
  });

  test("consuming reports unavailable when production has no usable store", () => {
    expect(proof.prodConsume).toBe("unavailable");
  });

  test("production never silently falls back to per-process memory", () => {
    // `memory-only` WAS recorded in this process' memory store above; in
    // production it must not be consulted.
    expect(proof.memoryConsumeInProd).toBe("unavailable");
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
