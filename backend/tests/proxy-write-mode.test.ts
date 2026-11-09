/**
 * Write-mode gate + cookie-helper exposure tests.
 *
 * Write mode is the only path that can mutate data, so every isolation claim is
 * tested separately: one missing proof must be enough to stay in safe mode.
 * The cookie helper is tested by running it as a process, because the risk is
 * what it PRINTS, not what it returns.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { validateWriteMode } from "../../.ai/office/scripts/dev-session-proxy.mjs";

const root = join(import.meta.dir, "..", "..");
const proofs = join(root, ".harness", "write-mode-proofs");
const COOKIES = join(root, ".ai", "office", "scripts", "cookies.mjs");

const ENV_ID = "local-isolated";
const BASE = "http://127.0.0.1:4100";

const validProof = {
  environment: "test",
  writesApproved: true,
  disposable: true,
  envId: ENV_ID,
  apiBase: BASE,
  databaseUrlHost: "127.0.0.1",
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

function proofFile(name, body, mode = 0o600) {
  const path = join(proofs, `${name}.json`);
  writeFileSync(path, typeof body === "string" ? body : JSON.stringify(body), { mode });
  chmodSync(path, mode);
  return path;
}

const baseEnv = {
  PROXY_ALLOW_WRITES: "1",
  PROXY_TEST_ENV_ID: ENV_ID,
  PROXY_TEST_API_BASE: BASE,
};

beforeAll(() => mkdirSync(proofs, { recursive: true }));
afterAll(() => rmSync(proofs, { recursive: true, force: true }));

describe("write mode is off unless every proof is present", () => {
  test("default environment stays in safe mode", () => {
    expect(validateWriteMode({ env: {} })).toEqual({ ok: false, code: "WRITES_DISABLED" });
  });

  test("the opt-in flag alone is not enough", () => {
    expect(validateWriteMode({ env: { PROXY_ALLOW_WRITES: "1" } }).code).toBe("BAD_ENV_ID");
  });

  test("a missing environment id is refused", () => {
    const env = { ...baseEnv, PROXY_TEST_ENV_ID: "" };
    expect(validateWriteMode({ env }).code).toBe("BAD_ENV_ID");
  });

  test("an environment id that claims production is refused", () => {
    const env = { ...baseEnv, PROXY_TEST_ENV_ID: "prod-main" };
    expect(validateWriteMode({ env }).code).toBe("BAD_ENV_ID");
  });

  test("the known production API is refused", () => {
    const env = { ...baseEnv, PROXY_TEST_API_BASE: "https://velnox-api.onrender.com" };
    expect(validateWriteMode({ env }).code).toBe("PRODUCTION_HOST");
  });

  test("a production alias is refused", () => {
    const env = { ...baseEnv, PROXY_TEST_API_BASE: "https://velcenter.vercel.app" };
    expect(validateWriteMode({ env }).code).toBe("PRODUCTION_HOST");
  });

  test("an unknown remote host is refused", () => {
    const env = { ...baseEnv, PROXY_TEST_API_BASE: "http://10.0.0.5:4100" };
    expect(validateWriteMode({ env }).code).toBe("NOT_LOOPBACK");
  });

  test("credentials inside the URL are refused", () => {
    const env = { ...baseEnv, PROXY_TEST_API_BASE: "http://user:pass@127.0.0.1:4100" };
    expect(validateWriteMode({ env }).code).toBe("CREDENTIALS_IN_URL");
  });

  test("https to loopback is refused (no TLS proof)", () => {
    const env = { ...baseEnv, PROXY_TEST_API_BASE: "https://127.0.0.1:4100" };
    expect(validateWriteMode({ env }).code).toBe("BAD_PROTOCOL");
  });

  test("a privileged port is refused", () => {
    const env = { ...baseEnv, PROXY_TEST_API_BASE: "http://127.0.0.1:80" };
    expect(validateWriteMode({ env }).code).toBe("BAD_PORT");
  });

  test("a missing proof file is refused", () => {
    const env = { ...baseEnv, PROXY_TEST_DB_PROOF: join(root, ".ai/secrets/does-not-exist.json") };
    expect(validateWriteMode({ env }).code).toBe("PROOF_UNREADABLE");
  });
});

describe("proof file validation", () => {
  test("no proof path is refused", () => {
    expect(validateWriteMode({ env: baseEnv }).code).toBe("NO_PROOF");
  });

  test("group-readable proof is refused", () => {
    const path = proofFile("perms", validProof, 0o644);
    const env = { ...baseEnv, PROXY_TEST_DB_PROOF: path };
    expect(validateWriteMode({ env }).code).toBe("PROOF_PERMISSIONS");
  });

  test("malformed JSON is refused", () => {
    const path = proofFile("broken", "{not json", 0o600);
    const env = { ...baseEnv, PROXY_TEST_DB_PROOF: path };
    expect(validateWriteMode({ env }).code).toBe("PROOF_MALFORMED");
  });

  test("a non-test environment is refused", () => {
    const path = proofFile("prod-env", { ...validProof, environment: "production" });
    expect(validateWriteMode({ env: { ...baseEnv, PROXY_TEST_DB_PROOF: path } }).code).toBe("NOT_TEST_ENV");
  });

  test("writesApproved:false is refused", () => {
    const path = proofFile("no-approval", { ...validProof, writesApproved: false });
    expect(validateWriteMode({ env: { ...baseEnv, PROXY_TEST_DB_PROOF: path } }).code).toBe("WRITES_NOT_APPROVED");
  });

  test("a non-disposable database is refused", () => {
    const path = proofFile("keep-db", { ...validProof, disposable: false });
    expect(validateWriteMode({ env: { ...baseEnv, PROXY_TEST_DB_PROOF: path } }).code).toBe("DB_NOT_DISPOSABLE");
  });

  test("an env id mismatch is refused", () => {
    const path = proofFile("env-mismatch", { ...validProof, envId: "another-env" });
    expect(validateWriteMode({ env: { ...baseEnv, PROXY_TEST_DB_PROOF: path } }).code).toBe("ENV_ID_MISMATCH");
  });

  test("an API base mismatch is refused", () => {
    const path = proofFile("base-mismatch", { ...validProof, apiBase: "http://127.0.0.1:4200" });
    expect(validateWriteMode({ env: { ...baseEnv, PROXY_TEST_DB_PROOF: path } }).code).toBe("API_BASE_MISMATCH");
  });

  test("a remote database host is refused", () => {
    const path = proofFile("remote-db", { ...validProof, databaseUrlHost: "ep-cool-123.eu-central-1.aws.neon.tech" });
    expect(validateWriteMode({ env: { ...baseEnv, PROXY_TEST_DB_PROOF: path } }).code).toBe("DB_NOT_ISOLATED");
  });

  test("an expired proof is refused", () => {
    const path = proofFile("expired", { ...validProof, expiresAt: "2000-01-01T00:00:00Z" });
    expect(validateWriteMode({ env: { ...baseEnv, PROXY_TEST_DB_PROOF: path } }).code).toBe("PROOF_EXPIRED");
  });

  test("a fully proven local stack is accepted", () => {
    const path = proofFile("ok", validProof);
    const result = validateWriteMode({ env: { ...baseEnv, PROXY_TEST_DB_PROOF: path } });
    expect(result).toEqual({ ok: true, apiBase: BASE, envId: ENV_ID });
  });
});

// ── cookie helper: what it prints is the risk ──────────────────────────────
const runCookies = (args) => {
  const proc = Bun.spawnSync({ cmd: ["bun", COOKIES, ...args], cwd: root, stdout: "pipe", stderr: "pipe" });
  return {
    code: proc.exitCode,
    out: new TextDecoder().decode(proc.stdout),
    err: new TextDecoder().decode(proc.stderr),
  };
};

// The store is a LOCAL session secret: absent on CI, in a fresh clone, and on any
// machine that never ran the dev proxy. Reading it at module scope made this file
// fail to even load (an unhandled ENOENT between tests), which reported a broken
// gate instead of a real finding. Read it softly and let the tests that need a
// real token SKIP, the same way the DB-gated suites skip without a database.
const STORE = join(root, ".ai", "secrets", "browser-cookies.json");
const hasStore = existsSync(STORE);
const anyToken = (() => {
  if (!hasStore) return "";
  try {
    const accounts = Object.values(JSON.parse(readFileSync(STORE, "utf8")).accounts ?? {});
    return Object.values(accounts[0]?.cookies ?? {})[0] ?? "";
  } catch {
    return "";
  }
})();

// Only a real session value proves "nothing leaked"; without one, skip rather than
// assert against an empty string and call that a pass.
const needsStore = test.skipIf(!hasStore || !anyToken);

describe("cookies.mjs never prints a session value", () => {
  needsStore("listing leaks neither the cookie name value nor a JWT", () => {
    const { out } = runCookies([]);
    expect(out).not.toContain(anyToken);
    expect(out).not.toMatch(/eyJ[A-Za-z0-9_-]{10,}/);
  });

  needsStore("--status leaks nothing", () => {
    const { out } = runCookies(["--status"]);
    expect(out).not.toContain(anyToken);
    expect(out).toMatch(/git-ignored: yes/);
  });

  needsStore("a bare account argument refuses instead of printing the cookie", () => {
    const { out, err, code } = runCookies(["owner"]);
    expect(code).not.toBe(0);
    expect(out + err).not.toContain(anyToken);
    expect(out + err).toContain("raw cookie output is disabled");
  });

  needsStore("--header and --curl are gone", () => {
    for (const flag of ["--header", "--curl"]) {
      const { out, err, code } = runCookies(["owner", flag]);
      expect(code).not.toBe(0);
      expect(out + err).not.toContain(anyToken);
    }
  });

  needsStore("an unknown account error carries no secret", () => {
    const { err, code } = runCookies(["nobody"]);
    expect(code).not.toBe(0);
    expect(err).not.toContain(anyToken);
  });

  needsStore("--check prints identity only, never the cookie", () => {
    const { out, code } = runCookies(["owner", "--check"]);
    expect(code).toBe(0);
    expect(out).not.toContain(anyToken);
    expect(out).toContain('"role"');
  });

  needsStore("raw export refuses without explicit human authorisation", () => {
    const { err, code } = runCookies(["owner", "--export-file", join(root, ".harness", "leak.txt")]);
    expect(code).not.toBe(0);
    expect(err).toContain("human-only");
  });
});
